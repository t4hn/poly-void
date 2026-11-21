import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScrollThrottleStep,
  clampThrottle,
  stepThrottle,
  computePitchSign,
  evaluateDockingAlignment,
  evaluateProximityWarning,
  computeEngineAudioParams,
  evaluateMassLock,
  projectTargetIndicator,
  projectToRadarBlip,
  computeCollisionDamage,
  computeMouseSteerAxes,
  MASS_LOCK_CLEARANCE_M,
  MOUSE_DEADZONE_PX,
  MOUSE_MAX_RADIUS_PX,
  SCROLL_THROTTLE_STEP,
  THROTTLE_MIN,
  THROTTLE_MAX,
} from './flightMath';
import { computeSystemAsteroidStyle } from './AsteroidField';
import { generateSystemLayout } from './systemLayout';
import {
  generateGalaxySector,
  canJumpToSystem,
  hasReachableNeighbor,
  findDistressRescueSystem,
  SECTOR_SYSTEM_COUNT,
  MAX_JUMP_RANGE_LY,
} from './galaxy';
import {
  createInitialTradingState,
  createStationMarket,
  buyCommodity,
  buyMaxCommodity,
  sellCommodity,
  refuelShip,
  repairHull,
  purchaseCargoExtension,
  purchasePulseLaserMk2,
  purchaseShieldBooster,
  purchaseFuelScoop,
  applyEmergencyDistressJump,
  collectSalvageOre,
  getCargoUsed,
  getCargoUpgradeCost,
  getSystemTradeHints,
  INITIAL_CREDITS,
  INITIAL_FUEL_LY,
  CARGO_UPGRADE_INCREMENT,
  PULSE_LASER_MK2_COST,
  SHIELD_BOOSTER_COST,
  FUEL_SCOOP_COST,
} from './trading';
import {
  DEFAULT_PILOT_SETTINGS,
  saveGameToStorage,
  loadGameFromStorage,
  clearSavedGame,
  saveSettingsToStorage,
  loadSettingsFromStorage,
  sanitizePilotSettings,
  type StorageLike,
} from './saveState';
import {
  deriveSystemSecurityLevel,
  getSecuritySpawnConfig,
  evaluateSecurityPirateSpawn,
  getCombatRankProgress,
  computeLeadInterceptPoint,
  computeGimbalAimDirection,
  computePostEncounterCooldownSec,
  PIRATE_COOLDOWN_MIN_SEC,
  PIRATE_COOLDOWN_MAX_SEC,
} from './combat';
import {
  SHIP_COMPUTER_LINES,
  ShipComputer,
  computeShipComputerVolume,
  evaluateShipDamageAlerts,
  type SpeechSynthLike,
  type SpeechUtteranceLike,
} from './ShipComputer';
import { awardPirateBounty, applyEscapePodEjection } from './trading';

test('throttle clamps cleanly between reverse limit and 100%', () => {
  assert.equal(clampThrottle(1.4), THROTTLE_MAX);
  assert.equal(clampThrottle(-0.8), THROTTLE_MIN);
  assert.equal(stepThrottle(0.5, 1, 1.0, 0.8), 1.0);
  assert.equal(stepThrottle(0.05, -1, 0.1, 0.8), 0);
});

test('pitch sign flips when invertPitch is toggled', () => {
  assert.equal(computePitchSign(false), -1);
  assert.equal(computePitchSign(true), 1);
});

test('docking alignment detects generous aligned corridor and bay capture vs unsafe speed', () => {
  const bayPos = { x: 0, y: 0, z: 0 };
  const bayOutwardNormal = { x: 0, y: 0, z: 1 };

  const aligned = evaluateDockingAlignment({
    shipPos: { x: 12, y: -6, z: 220 },
    shipForward: { x: 0, y: 0, z: -1 },
    shipSpeedMps: 50,
    bayPos,
    bayOutwardNormal,
  });
  assert.equal(aligned.isCorridorAligned, true);
  assert.equal(aligned.isOrientationAligned, true);
  assert.equal(aligned.isSpeedSafe, true);
  assert.equal(aligned.isReadyToDock, true);
  assert.equal(aligned.isInsideBay, false);

  const tooFast = evaluateDockingAlignment({
    shipPos: { x: 0, y: 0, z: 22 },
    shipForward: { x: 0, y: 0, z: -1 },
    shipSpeedMps: 140,
    bayPos,
    bayOutwardNormal,
  });
  assert.equal(tooFast.isInsideBay, true);
  assert.equal(tooFast.isSpeedSafe, false);
  assert.equal(tooFast.isReadyToDock, false);

  const captureReady = evaluateDockingAlignment({
    shipPos: { x: 4, y: 2, z: 28 },
    shipForward: { x: 0, y: 0, z: -1 },
    shipSpeedMps: 45,
    bayPos,
    bayOutwardNormal,
  });
  assert.equal(captureReady.isInsideBay, true);
  assert.equal(captureReady.isReadyToDock, true);
});

test('radar projects world offsets into ship-local coordinates with elevation stalk', () => {
  const blip = projectToRadarBlip({
    id: 'station',
    kind: 'station',
    worldOffset: { x: 100, y: 150, z: -200 },
    shipRight: { x: 1, y: 0, z: 0 },
    shipUp: { x: 0, y: 1, z: 0 },
    shipForward: { x: 0, y: 0, z: -1 },
    radarRange: 1000,
  });
  assert.ok(blip.rx > 0);
  assert.ok(blip.rz < 0);
  assert.ok(blip.ry > 0);
});

test('collision damage ignores gentle scrapes and scales with impact speed', () => {
  assert.equal(computeCollisionDamage(8), 0);
  assert.ok(computeCollisionDamage(90) > computeCollisionDamage(30));
});

test('galaxy generator produces 64 deterministic star systems with reachable neighbors & distress fallback', () => {
  const sectorA = generateGalaxySector(1984);
  const sectorB = generateGalaxySector(1984);
  assert.equal(sectorA.length, SECTOR_SYSTEM_COUNT);
  assert.equal(sectorA[0].name, 'Lave');
  assert.deepEqual(sectorA[5], sectorB[5]);

  const reachable = sectorA.filter(
    (s) => canJumpToSystem(sectorA[0], s, MAX_JUMP_RANGE_LY).ok
  );
  assert.ok(reachable.length >= 4, 'Expected at least 4 reachable systems from Lave');

  const firstJump = reachable[0];
  const lowFuel = canJumpToSystem(sectorA[0], firstJump, 0.5);
  assert.equal(lowFuel.ok, false);

  assert.equal(hasReachableNeighbor(sectorA[0], sectorA, 0.2), false);
  const rescue = findDistressRescueSystem(sectorA[0], sectorA);
  assert.ok(rescue !== null);
  assert.notEqual(rescue!.system.id, sectorA[0].id);
});

test('economy-reactive market pricing, Buy Max, Sell profit, Refuel, and Salvage work cleanly', () => {
  const sector = generateGalaxySector(1984);
  const agri = sector.find((s) => s.economy === 'Rich Agricultural')!;
  const ind = sector.find((s) => s.economy === 'Rich Industrial')!;

  const agriMarket = createStationMarket(agri, 1);
  const indMarket = createStationMarket(ind, 1);

  const agriFood = agriMarket.find((m) => m.id === 'food')!;
  const indFood = indMarket.find((m) => m.id === 'food')!;
  const agriComp = agriMarket.find((m) => m.id === 'computers')!;
  const indComp = indMarket.find((m) => m.id === 'computers')!;

  assert.ok(agriFood.price < indFood.price, 'Food should be cheaper in Agricultural world');
  assert.ok(indComp.price < agriComp.price, 'Computers should be cheaper in Industrial world');

  const initial = createInitialTradingState(agri);
  assert.equal(initial.credits, INITIAL_CREDITS);
  assert.equal(initial.fuel, INITIAL_FUEL_LY);
  assert.equal(getCargoUsed(initial.cargo), 0);

  const boughtMax = buyMaxCommodity(initial, 'food');
  assert.equal(boughtMax.ok, true);
  assert.ok(boughtMax.quantityBought >= 5);
  assert.equal(getCargoUsed(boughtMax.state.cargo), boughtMax.quantityBought);

  // Move market to Industrial prices and verify netProfit is positive
  const atInd = { ...boughtMax.state, market: indMarket };
  const sold = sellCommodity(atInd, 'food', boughtMax.quantityBought);
  assert.equal(sold.ok, true);
  assert.ok(sold.netProfit > 50, 'Selling Lave Food at Industrial world should yield profit');
  assert.equal(getCargoUsed(sold.state.cargo), 0);

  const lowFuelState = { ...initial, fuel: 2.5 };
  const refueled = refuelShip(lowFuelState);
  assert.equal(refueled.ok, true);
  assert.equal(refueled.state.fuel, 7.0);
  assert.ok(refueled.state.credits < initial.credits);

  const damaged = { ...initial, credits: 200, hull: 80 };
  const repaired = repairHull(damaged);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.state.hull, 100);

  const salvaged = collectSalvageOre(initial, 'palladium', 2, 12);
  assert.equal(salvaged.addedUnits, 2);
  assert.equal(salvaged.state.cargo.minerals, 2);
});

test('shipyard outfitting upgrades, distress jump, and localStorage save/restore work cleanly', () => {
  const sector = generateGalaxySector(1984);
  let state = { ...createInitialTradingState(sector[0]), credits: 1200, fuel: 0.4 };

  const tierCost = getCargoUpgradeCost(0);
  const cargoUp = purchaseCargoExtension(state);
  assert.equal(cargoUp.ok, true);
  state = cargoUp.state;
  assert.equal(state.cargoCapacity, 20 + CARGO_UPGRADE_INCREMENT);
  assert.equal(state.upgrades.cargoBayTier, 1);
  assert.equal(state.credits, 1200 - tierCost);

  const laserUp = purchasePulseLaserMk2(state);
  assert.equal(laserUp.ok, true);
  state = laserUp.state;
  assert.equal(state.upgrades.pulseLaserMk2, true);
  assert.equal(state.credits, 1200 - tierCost - PULSE_LASER_MK2_COST);

  const shieldUp = purchaseShieldBooster(state);
  assert.equal(shieldUp.ok, true);
  state = shieldUp.state;
  assert.equal(state.upgrades.shieldBooster, true);
  assert.equal(state.maxHull, 150);
  assert.equal(state.hull, 150);
  assert.equal(state.credits, 1200 - tierCost - PULSE_LASER_MK2_COST - SHIELD_BOOSTER_COST);

  const scoopUp = purchaseFuelScoop(state);
  assert.equal(scoopUp.ok, true);
  state = scoopUp.state;
  assert.equal(state.upgrades.fuelScoop, true);
  assert.equal(
    state.credits,
    Math.round((1200 - tierCost - PULSE_LASER_MK2_COST - SHIELD_BOOSTER_COST - FUEL_SCOOP_COST) * 10) / 10
  );

  // Buy cargo & test distress rescue jump
  const bought = buyCommodity(state, 'food', 5);
  assert.equal(bought.ok, true);
  state = bought.state;

  const rescue = findDistressRescueSystem(sector[0], sector)!;
  const rescued = applyEmergencyDistressJump(state, rescue.system);
  state = rescued.state;
  assert.equal(state.systemId, rescue.system.id);
  assert.ok(state.fuel >= 2.0);

  // Save / Load / Clear persistence via in-memory mock StorageLike
  const mem = new Map<string, string>();
  const mockStorage: StorageLike = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };

  state = { ...state, pirateKills: 7 };
  const saved = saveGameToStorage(state, rescue.system, mockStorage);
  assert.ok(saved !== null);
  const loaded = loadGameFromStorage(sector, mockStorage);
  assert.ok(loaded !== null);
  assert.equal(loaded!.system.id, rescue.system.id);
  assert.equal(loaded!.trading.credits, state.credits);
  assert.equal(loaded!.trading.cargo.food, 5);
  assert.equal(loaded!.trading.cargoCapacity, state.cargoCapacity);
  assert.equal(loaded!.trading.upgrades.pulseLaserMk2, true);
  assert.equal(loaded!.trading.upgrades.shieldBooster, true);
  assert.equal(loaded!.trading.upgrades.fuelScoop, true);
  assert.equal(loaded!.trading.maxHull, 150);
  assert.equal(loaded!.trading.pirateKills, 7);

  clearSavedGame(mockStorage);
  assert.equal(loadGameFromStorage(sector, mockStorage), null);
});

test('engine audio params scale pitch, filter, and volume with throttle and mute cleanly', () => {
  const idle = computeEngineAudioParams(0, true, false);
  const full = computeEngineAudioParams(1, true, false);
  const muted = computeEngineAudioParams(1, true, true);
  const paused = computeEngineAudioParams(1, false, false);

  assert.ok(full.oscFreqHz > idle.oscFreqHz);
  assert.ok(full.noiseFilterHz > idle.noiseFilterHz);
  assert.ok(full.gain > idle.gain);
  assert.ok(full.noiseGain > idle.noiseGain);
  assert.equal(muted.gain, 0);
  assert.equal(muted.noiseGain, 0);
  assert.equal(paused.gain, 0);
});

test('proximity warning flags close asteroids and unsafe docking bay approach speeds', () => {
  const safeDocking = evaluateDockingAlignment({
    shipPos: { x: 0, y: 0, z: 220 },
    shipForward: { x: 0, y: 0, z: -1 },
    shipSpeedMps: 50,
    bayPos: { x: 0, y: 0, z: 0 },
    bayOutwardNormal: { x: 0, y: 0, z: 1 },
  });
  const clear = evaluateProximityWarning({
    shipSpeedMps: 50,
    nearestAsteroidClearanceM: 180,
    nearestAsteroidClosingMps: 10,
    stationDistanceM: 400,
    stationCollisionRadiusM: 120,
    docking: safeDocking,
  });
  assert.equal(clear.active, false);

  const astWarn = evaluateProximityWarning({
    shipSpeedMps: 90,
    nearestAsteroidClearanceM: 32,
    nearestAsteroidClosingMps: 55,
    stationDistanceM: 700,
    stationCollisionRadiusM: 120,
    docking: safeDocking,
  });
  assert.equal(astWarn.active, true);
  assert.equal(astWarn.kind, 'asteroid');

  const fastBayDocking = evaluateDockingAlignment({
    shipPos: { x: 0, y: 0, z: 220 },
    shipForward: { x: 0, y: 0, z: -1 },
    shipSpeedMps: 165,
    bayPos: { x: 0, y: 0, z: 0 },
    bayOutwardNormal: { x: 0, y: 0, z: 1 },
  });
  const bayWarn = evaluateProximityWarning({
    shipSpeedMps: 165,
    nearestAsteroidClearanceM: 250,
    nearestAsteroidClosingMps: 0,
    stationDistanceM: 220,
    stationCollisionRadiusM: 120,
    docking: fastBayDocking,
  });
  assert.equal(bayWarn.active, true);
  assert.equal(bayWarn.kind, 'station-speed');
});

test('per-system asteroid style produces distinct tints and sizes across economies', () => {
  const agriRock = computeSystemAsteroidStyle(0, 'Rich Agricultural', 3, 0x5c6473);
  const miningRock = computeSystemAsteroidStyle(5, 'Mining', 3, 0x5c6473);
  assert.notEqual(agriRock.baseColorHex, miningRock.baseColorHex);
  assert.ok(miningRock.collisionRadius >= miningRock.radius);
});

test('procedural system layouts generate 1-3 planets, ~25km arrival distance, orbital station, and separated asteroid belts', () => {
  const sector = generateGalaxySector(1984);
  for (const sys of sector) {
    const layout = generateSystemLayout(sys);
    assert.ok(layout.planets.length >= 1 && layout.planets.length <= 3);

    const primary = layout.planets[0];
    assert.equal(primary.isPrimary, true);
    if (sys.economy === 'Rich Agricultural' || sys.economy === 'High-Tech') {
      assert.equal(primary.archetype, 'terrestrial');
      assert.equal(primary.hasMoon, true);
    }

    const arrivalToPlanet = Math.hypot(
      layout.arrivalPosition.x - primary.position.x,
      layout.arrivalPosition.y - primary.position.y,
      layout.arrivalPosition.z - primary.position.z
    );
    assert.ok(
      Math.abs(arrivalToPlanet - 25000) < 600,
      `Expected ~25km arrival distance, got ${arrivalToPlanet}`
    );

    const stationAltitude = Math.hypot(
      layout.stationPosition.x - primary.position.x,
      layout.stationPosition.y - primary.position.y,
      layout.stationPosition.z - primary.position.z
    ) - primary.radius;
    assert.ok(stationAltitude >= 1200 && stationAltitude <= 2400);

    const beaconDist = Math.hypot(
      layout.navBeaconPosition.x - layout.stationPosition.x,
      layout.navBeaconPosition.y - layout.stationPosition.y,
      layout.navBeaconPosition.z - layout.stationPosition.z
    );
    assert.ok(beaconDist >= 400 && beaconDist <= 800);

    // Arrival point must not be inside any mass-lock or asteroid belt
    assert.ok(layout.asteroidClusters.length >= 1);
    for (const cluster of layout.asteroidClusters) {
      const distFromArrival = Math.hypot(
        layout.arrivalPosition.x - cluster.position.x,
        layout.arrivalPosition.y - cluster.position.y,
        layout.arrivalPosition.z - cluster.position.z
      );
      assert.ok(distFromArrival > 8000, `Cluster too close to arrival: ${distFromArrival}`);
    }
  }
});

test('Mass-Lock safety engages within 3km of planets, stations, sun, and asteroid fields', () => {
  const bodies = [
    {
      id: 'station',
      name: 'Lave Orbital',
      kind: 'station' as const,
      position: { x: 0, y: 0, z: -20000 },
      surfaceRadius: 150,
    },
    {
      id: 'planet-0',
      name: 'Lave Prime',
      kind: 'planet' as const,
      position: { x: 0, y: 0, z: -23500 },
      surfaceRadius: 2100,
    },
  ];

  const openSpace = evaluateMassLock({ x: 0, y: 0, z: 0 }, bodies);
  assert.equal(openSpace.locked, false);

  const nearStation = evaluateMassLock({ x: 0, y: 0, z: -20000 + MASS_LOCK_CLEARANCE_M }, bodies);
  assert.equal(nearStation.locked, true);
  assert.equal(nearStation.blockingBodyName, 'Lave Orbital');

  const nearPlanet = evaluateMassLock({ x: 0, y: 0, z: -23500 - 2100 - 2500 }, bodies);
  assert.equal(nearPlanet.locked, true);
  assert.equal(nearPlanet.blockingBodyName, 'Lave Prime');
});

test('off-screen target indicator computes viewport perimeter arrow and angle even when behind ship', () => {
  const right = { x: 1, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };

  const ahead = projectTargetIndicator({
    worldOffset: { x: 0, y: 0, z: -10000 },
    shipRight: right,
    shipUp: up,
    shipForward: forward,
    ndcX: 0,
    ndcY: 0,
    ndcZ: 0.5,
  });
  assert.equal(ahead.onScreen, true);

  const farRight = projectTargetIndicator({
    worldOffset: { x: 5000, y: 0, z: 0 },
    shipRight: right,
    shipUp: up,
    shipForward: forward,
    ndcX: 3.5,
    ndcY: 0,
    ndcZ: 0.9,
  });
  assert.equal(farRight.onScreen, false);
  assert.ok(farRight.edgeX >= 74 && farRight.edgeX <= 78);
  assert.ok(Math.abs(farRight.edgeAngleDeg - 90) < 1);

  const behind = projectTargetIndicator({
    worldOffset: { x: 0, y: -100, z: 5000 },
    shipRight: right,
    shipUp: up,
    shipForward: forward,
    ndcX: 0,
    ndcY: 0,
    ndcZ: 1.5,
  });
  assert.equal(behind.onScreen, false);
  assert.ok(behind.edgeY >= 74 && behind.edgeY <= 80);
});

test('cruise drive intensifies engine audio pitch and filter cutoff', () => {
  const normal = computeEngineAudioParams(1, true, false, 0);
  const cruise = computeEngineAudioParams(1, true, false, 1);
  assert.ok(cruise.oscFreqHz > normal.oscFreqHz + 40);
  assert.ok(cruise.noiseFilterHz > normal.noiseFilterHz + 300);
  assert.ok(cruise.gain > normal.gain);
});

test('system security ratings and pirate spawn evaluation are strictly security-based with 0% in High Security', () => {
  assert.equal(deriveSystemSecurityLevel('High-Tech', 10), 'High Security');
  assert.equal(deriveSystemSecurityLevel('Rich Industrial', 9), 'High Security');
  assert.equal(deriveSystemSecurityLevel('Rich Agricultural', 7), 'Medium Security');
  assert.equal(deriveSystemSecurityLevel('Mining', 5), 'Anarchy');
  assert.equal(deriveSystemSecurityLevel('Poor Industrial', 4), 'Anarchy');

  const highCfg = getSecuritySpawnConfig('High Security');
  assert.equal(highCfg.spawnProbabilityPerCheck, 0);
  assert.equal(highCfg.maxActivePirates, 0);

  // Even with randomRoll=0 and cruising in open space, High Security never spawns pirates
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'High Security',
      activePirateCount: 0,
      stationDistanceMeters: 15000,
      isCruising: true,
      randomRoll: 0,
    }),
    false
  );

  // Station safe zone (< 2.6 km) prevents spawns even in Anarchy
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'Anarchy',
      activePirateCount: 0,
      stationDistanceMeters: 1800,
      isCruising: false,
      randomRoll: 0,
    }),
    false
  );

  // Anarchy has much higher spawn rate than Medium Security in open space
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'Medium Security',
      activePirateCount: 0,
      stationDistanceMeters: 8000,
      isCruising: false,
      randomRoll: 0.45,
    }),
    false
  );
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'Anarchy',
      activePirateCount: 0,
      stationDistanceMeters: 8000,
      isCruising: false,
      randomRoll: 0.45,
    }),
    true
  );
});

test('combat rank ladder, pirate bounties, cargo pod salvage, lead intercept, and Escape Pod ejection work cleanly', () => {
  assert.equal(getCombatRankProgress(0).rank, 'Harmless');
  assert.equal(getCombatRankProgress(1).rank, 'Mostly Harmless');
  assert.equal(getCombatRankProgress(3).rank, 'Poor');
  assert.equal(getCombatRankProgress(16).rank, 'Competent');
  assert.equal(getCombatRankProgress(50).rank, 'ELITE');
  assert.equal(getCombatRankProgress(50).progressPct, 100);

  const sector = generateGalaxySector(1984);
  let state = createInitialTradingState(sector[0]);
  const b1 = awardPirateBounty(state, 95);
  state = b1.state;
  assert.equal(state.credits, INITIAL_CREDITS + 95);
  assert.equal(state.pirateKills, 1);
  assert.equal(b1.promoted, true);
  assert.equal(b1.newRank, 'Mostly Harmless');

  // Scoop pirate luxury goods pod into cargo hold
  const loot = collectSalvageOre(state, 'luxury_goods', 2, 0);
  state = loot.state;
  assert.equal(loot.addedUnits, 2);
  assert.equal(state.cargo.luxury_goods, 2);

  // Upgrade ship then test Escape Pod ejection preserves upgrades, credits, and kills while losing unsold cargo
  const up = purchasePulseLaserMk2({ ...state, credits: 500, hull: 12 });
  assert.equal(up.ok, true);
  const ejected = applyEscapePodEjection(up.state);
  assert.equal(ejected.lostCargoTons, 2);
  assert.equal(getCargoUsed(ejected.state.cargo), 0);
  assert.equal(ejected.state.hull, ejected.state.maxHull);
  assert.equal(ejected.state.credits, up.state.credits);
  assert.equal(ejected.state.pirateKills, 1);
  assert.equal(ejected.state.upgrades.pulseLaserMk2, true);

  // Lead intercept projects target forward along velocity
  const lead = computeLeadInterceptPoint({
    shooterPos: { x: 0, y: 0, z: 0 },
    targetPos: { x: 0, y: 0, z: -720 },
    targetVel: { x: 100, y: 0, z: 0 },
    projectileSpeedMps: 720,
  });
  assert.ok(Math.abs(lead.x - 100) < 0.01);
  assert.equal(lead.z, -720);
});

test('virtual joystick mouse steering deadzone, proportionality, and directional signs', () => {
  // Inside deadzone produces zero pitch/yaw
  const center = computeMouseSteerAxes(10, -12);
  assert.equal(center.inDeadzone, true);
  assert.equal(center.pitch, 0);
  assert.equal(center.yaw, 0);

  // Cursor straight UP (offsetY < 0) -> positive pitch (nose up toward cursor)
  const midSpan = MOUSE_DEADZONE_PX + (MOUSE_MAX_RADIUS_PX - MOUSE_DEADZONE_PX) * 0.5;
  const up = computeMouseSteerAxes(0, -midSpan);
  assert.equal(up.inDeadzone, false);
  assert.ok(Math.abs(up.pitch - 0.5) < 0.01);
  assert.ok(Math.abs(up.yaw) < 0.001);

  // Cursor far RIGHT (offsetX > 0) -> negative yaw (nose right toward cursor), clamped to 1
  const right = computeMouseSteerAxes(MOUSE_MAX_RADIUS_PX * 2, 0);
  assert.equal(right.inDeadzone, false);
  assert.ok(Math.abs(right.yaw - -1) < 0.001);
  assert.ok(Math.abs(right.pitch) < 0.001);

  // Cursor LEFT (offsetX < 0) -> positive yaw (nose left toward cursor)
  const left = computeMouseSteerAxes(-midSpan, 0);
  assert.ok(Math.abs(left.yaw - 0.5) < 0.01);
});

test('gimbal assist tracks lead target within 5-degree cone and ignores targets outside cone', () => {
  // ~3 degrees off forward (-Z)
  const angle3Rad = (3 * Math.PI) / 180;
  const within = computeGimbalAimDirection({
    shooterPos: { x: 0, y: 0, z: 0 },
    shooterForward: { x: 0, y: 0, z: -1 },
    leadTargetPos: {
      x: Math.sin(angle3Rad) * 500,
      y: 0,
      z: -Math.cos(angle3Rad) * 500,
    },
  });
  assert.equal(within.gimbalActive, true);
  assert.ok(within.direction.x > 0.04);

  // ~10 degrees off forward (-Z) -> outside 5-degree cone
  const angle10Rad = (10 * Math.PI) / 180;
  const outside = computeGimbalAimDirection({
    shooterPos: { x: 0, y: 0, z: 0 },
    shooterForward: { x: 0, y: 0, z: -1 },
    leadTargetPos: {
      x: Math.sin(angle10Rad) * 500,
      y: 0,
      z: -Math.cos(angle10Rad) * 500,
    },
  });
  assert.equal(outside.gimbalActive, false);
  assert.equal(outside.direction.x, 0);
  assert.equal(outside.direction.z, -1);
});

test('pirate spawn cooldown enforces 45-60s breather and caps group sizes fairly', () => {
  assert.equal(computePostEncounterCooldownSec(0), PIRATE_COOLDOWN_MIN_SEC);
  assert.equal(computePostEncounterCooldownSec(1), PIRATE_COOLDOWN_MAX_SEC);
  const mid = computePostEncounterCooldownSec(0.5);
  assert.ok(mid >= 45 && mid <= 60);

  // Even in Anarchy with randomRoll=0, active cooldown blocks spawns
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'Anarchy',
      activePirateCount: 0,
      stationDistanceMeters: 10000,
      isCruising: true,
      randomRoll: 0,
      spawnCooldownRemainingSec: 32,
    }),
    false
  );

  // Medium Security caps at 1 active pirate; Anarchy caps at 2
  assert.equal(getSecuritySpawnConfig('Medium Security').maxActivePirates, 1);
  assert.equal(getSecuritySpawnConfig('Anarchy').maxActivePirates, 2);
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'Medium Security',
      activePirateCount: 1,
      stationDistanceMeters: 10000,
      isCruising: false,
      randomRoll: 0,
      spawnCooldownRemainingSec: 0,
    }),
    false
  );
  assert.equal(
    evaluateSecurityPirateSpawn({
      securityLevel: 'Anarchy',
      activePirateCount: 2,
      stationDistanceMeters: 10000,
      isCruising: false,
      randomRoll: 0,
      spawnCooldownRemainingSec: 0,
    }),
    false
  );
});

test('scroll wheel throttle steps cleanly, snaps at zero, and clamps between reverse and 100%', () => {
  // Scroll up (negative deltaY) increments throttle by SCROLL_THROTTLE_STEP (5%)
  assert.equal(applyScrollThrottleStep(0.2, -120), 0.2 + SCROLL_THROTTLE_STEP);
  assert.equal(applyScrollThrottleStep(0.98, -120), THROTTLE_MAX);

  // Scroll down (positive deltaY) decrements throttle and snaps cleanly to 0 before reverse
  assert.equal(applyScrollThrottleStep(0.03, 120), 0);
  assert.equal(applyScrollThrottleStep(0, 120), -SCROLL_THROTTLE_STEP);
  assert.equal(applyScrollThrottleStep(-0.33, 120), THROTTLE_MIN);
  assert.equal(applyScrollThrottleStep(-0.02, -120), 0);

  // Zero or non-finite deltaY leaves throttle unchanged
  assert.equal(applyScrollThrottleStep(0.4, 0), 0.4);
});

test('pilot settings save, load, and sanitize defaults across localStorage restarts', () => {
  const mem = new Map<string, string>();
  const mockStorage: StorageLike = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };

  assert.deepEqual(loadSettingsFromStorage(mockStorage), DEFAULT_PILOT_SETTINGS);

  const custom = {
    muted: true,
    volume: 0.4,
    voiceEnabled: false,
    mouseSteerEnabled: false,
    invertPitch: true,
    cameraMode: 'chase' as const,
    hudTheme: 'amber' as const,
  };
  saveSettingsToStorage(custom, mockStorage);
  assert.deepEqual(loadSettingsFromStorage(mockStorage), custom);

  const sanitized = sanitizePilotSettings({
    muted: 'bad',
    volume: 1.9,
    voiceEnabled: 'bad',
    mouseSteerEnabled: false,
    invertPitch: true,
    cameraMode: 'invalid',
    hudTheme: 'unknown_theme',
  });
  assert.deepEqual(sanitized, {
    muted: DEFAULT_PILOT_SETTINGS.muted,
    volume: 1,
    voiceEnabled: DEFAULT_PILOT_SETTINGS.voiceEnabled,
    mouseSteerEnabled: false,
    invertPitch: true,
    cameraMode: 'cockpit',
    hudTheme: 'cobalt',
  });
});

test('ShipComputer speaks sci-fi cadence, cancels overlaps, and respects voiceEnabled/mute/volume', () => {
  const spoken: SpeechUtteranceLike[] = [];
  let cancelCount = 0;
  const fakeSynth: SpeechSynthLike = {
    cancel: () => {
      cancelCount++;
    },
    speak: (u) => {
      spoken.push(u);
    },
    getVoices: () => [],
  };

  const computer = new ShipComputer({
    synth: fakeSynth,
    createUtterance: (text) => ({
      text,
      pitch: 1,
      rate: 1,
      volume: 1,
      lang: 'en-US',
    }),
  });

  assert.equal(computeShipComputerVolume(true, false, 0.8), 0.8);
  assert.equal(computeShipComputerVolume(false, false, 0.8), 0);
  assert.equal(computeShipComputerVolume(true, true, 0.8), 0);

  computer.setAudioState(false, 0.65);
  assert.equal(computer.speak(SHIP_COMPUTER_LINES.supercruiseEngaged, 1000), true);
  assert.equal(cancelCount, 1);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Supercruise engaged');
  assert.ok(spoken[0].pitch < 0.9);
  assert.ok(spoken[0].rate > 1.0);
  assert.equal(spoken[0].volume, 0.65);

  // Rapid duplicate within 900ms is suppressed, distinct line cancels and speaks immediately
  assert.equal(computer.speak(SHIP_COMPUTER_LINES.supercruiseEngaged, 1200), false);
  assert.equal(computer.speak(SHIP_COMPUTER_LINES.targetDestroyed, 1250), true);
  assert.equal(cancelCount, 2);
  assert.equal(spoken.length, 2);

  // Muting or disabling Ship AI Voice cancels speech and blocks further lines
  computer.setAudioState(true, 0.65);
  assert.equal(cancelCount, 3);
  assert.equal(computer.speak(SHIP_COMPUTER_LINES.dockingComplete, 3000), false);

  computer.setAudioState(false, 0.65);
  computer.setEnabled(false);
  assert.equal(cancelCount, 4);
  assert.equal(computer.speak(SHIP_COMPUTER_LINES.dockingComplete, 4000), false);
});

test('evaluateShipDamageAlerts triggers Shields offline and Hull integrity critical without spam', () => {
  const shieldDrop = evaluateShipDamageAlerts({
    prevShield: 25,
    nextShield: 0,
    nextHull: 90,
    maxHull: 100,
    hullCriticalAlreadyAnnounced: false,
  });
  assert.equal(shieldDrop.shieldsJustOffline, true);
  assert.equal(shieldDrop.hullJustCritical, false);
  assert.equal(shieldDrop.spokenAlert, SHIP_COMPUTER_LINES.shieldsOffline);

  const hullCrit = evaluateShipDamageAlerts({
    prevShield: 0,
    nextShield: 0,
    nextHull: 22,
    maxHull: 100,
    hullCriticalAlreadyAnnounced: false,
  });
  assert.equal(hullCrit.hullJustCritical, true);
  assert.equal(hullCrit.nextHullCriticalAnnounced, true);
  assert.equal(hullCrit.spokenAlert, SHIP_COMPUTER_LINES.hullCritical);

  // Subsequent hull hit while still critical does not re-announce
  const repeatCrit = evaluateShipDamageAlerts({
    prevShield: 0,
    nextShield: 0,
    nextHull: 15,
    maxHull: 100,
    hullCriticalAlreadyAnnounced: hullCrit.nextHullCriticalAnnounced,
  });
  assert.equal(repeatCrit.hullJustCritical, false);
  assert.equal(repeatCrit.spokenAlert, null);

  // Repairing above 35% resets critical latch
  const repaired = evaluateShipDamageAlerts({
    prevShield: 100,
    nextShield: 100,
    nextHull: 100,
    maxHull: 100,
    hullCriticalAlreadyAnnounced: true,
  });
  assert.equal(repaired.nextHullCriticalAnnounced, false);
});

test('getSystemTradeHints surfaces best exports, high demand, and cargo profit/loss vs avgCostBasis', () => {
  const sector = generateGalaxySector(1984);
  const lave = sector[0]; // Rich Agricultural
  const leesti = sector[1]; // Rich Industrial

  const laveHints = getSystemTradeHints(lave);
  assert.deepEqual(
    laveHints.bestExports.map((e) => e.id),
    ['food', 'textiles']
  );
  assert.deepEqual(
    laveHints.highDemand.map((d) => d.id),
    ['computers', 'machinery', 'luxury_goods']
  );
  assert.equal(laveHints.cargoQuotes.length, 0);

  const leestiHintsEmpty = getSystemTradeHints(leesti);
  assert.deepEqual(
    leestiHintsEmpty.bestExports.map((e) => e.id),
    ['machinery', 'alloys', 'computers']
  );
  assert.equal(leestiHintsEmpty.highDemand[0].id, 'food');

  // Buy Food at Lave and salvage Minerals -> inspect Leesti (profit on Food) and Lave (loss/even)
  const initial = createInitialTradingState(lave);
  const boughtFood = buyCommodity(initial, 'food', 8).state;
  const withSalvage = collectSalvageOre(boughtFood, 'palladium', 2, 0).state;

  const leestiWithCargo = getSystemTradeHints(leesti, withSalvage.cargo, withSalvage.avgCostBasis);
  assert.equal(leestiWithCargo.cargoQuotes.length, 2);
  const foodAtLeesti = leestiWithCargo.cargoQuotes.find((q) => q.id === 'food')!;
  assert.equal(foodAtLeesti.verdict, 'profit');
  assert.ok(foodAtLeesti.deltaPerUnit > 8);
  assert.ok(foodAtLeesti.totalDelta > 64);

  const mineralsAtLeesti = leestiWithCargo.cargoQuotes.find((q) => q.id === 'minerals')!;
  assert.equal(mineralsAtLeesti.verdict, 'salvage');
  assert.ok(mineralsAtLeesti.totalDelta > 0);

  // Overpaid Computers compared to High-Tech price -> shows loss at High-Tech system
  const highTech = sector.find((s) => s.economy === 'High-Tech')!;
  const overpricedHints = getSystemTradeHints(highTech, { computers: 3 }, { computers: 130 });
  assert.equal(overpricedHints.cargoQuotes[0].verdict, 'loss');
  assert.ok(overpricedHints.cargoQuotes[0].deltaPerUnit < -50);
});






