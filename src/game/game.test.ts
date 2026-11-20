import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampThrottle,
  stepThrottle,
  computePitchSign,
  evaluateDockingAlignment,
  projectToRadarBlip,
  computeCollisionDamage,
  THROTTLE_MIN,
  THROTTLE_MAX,
} from './flightMath';
import {
  generateGalaxySector,
  canJumpToSystem,
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
  upgradeCargoBay,
  collectSalvageOre,
  getCargoUsed,
  INITIAL_CREDITS,
  INITIAL_FUEL_LY,
  CARGO_UPGRADE_COST,
} from './trading';

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

test('galaxy generator produces 64 deterministic star systems with reachable neighbors', () => {
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
});

test('economy-reactive market pricing, Buy Max, Sell, Refuel, and Salvage work cleanly', () => {
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

  const sold = sellCommodity(boughtMax.state, 'food', boughtMax.quantityBought);
  assert.equal(sold.ok, true);
  assert.equal(getCargoUsed(sold.state.cargo), 0);

  // Refuel test
  const lowFuelState = { ...initial, fuel: 2.5 };
  const refueled = refuelShip(lowFuelState);
  assert.equal(refueled.ok, true);
  assert.equal(refueled.state.fuel, 7.0);
  assert.ok(refueled.state.credits < initial.credits);

  // Repair & cargo upgrade
  const damaged = { ...initial, credits: 200, hull: 80 };
  const repaired = repairHull(damaged);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.state.hull, 100);

  const rich = { ...initial, credits: 200 };
  const upgraded = upgradeCargoBay(rich);
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.state.credits, 200 - CARGO_UPGRADE_COST);
  assert.equal(upgraded.state.cargoCapacity, initial.cargoCapacity + 10);

  // Salvage maps to minerals/alloys
  const salvaged = collectSalvageOre(initial, 'palladium', 2, 12);
  assert.equal(salvaged.addedUnits, 2);
  assert.equal(salvaged.state.cargo.minerals, 2);
});
