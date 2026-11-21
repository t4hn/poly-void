import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AsteroidField } from './AsteroidField';
import { AudioEngine } from './AudioEngine';
import {
  applyScrollThrottleStep,
  AUTO_DOCK_MAX_RANGE_M,
  computeCollisionDamage,
  computeMouseSteerAxes,
  evaluateDockingAlignment,
  evaluateMassLock,
  evaluateProximityWarning,
  type MassLockBody,
  projectTargetIndicator,
  projectToRadarBlip,
} from './flightMath';
import {
  computeGimbalAimDirection,
  computeLeadInterceptPoint,
  computePostEncounterCooldownSec,
  evaluateSecurityPirateSpawn,
  getCombatRankProgress,
  getSecuritySpawnConfig,
} from './combat';
import { canJumpToSystem, MAX_JUMP_RANGE_LY } from './galaxy';
import { detectSoftwareGl } from './LowPolyHelpers';
import { ParticleField } from './ParticleField';
import { PirateManager } from './PirateManager';
import { PlanetSystem } from './PlanetSystem';
import { RadarHUD } from './RadarHUD';
import {
  SHIP_COMPUTER_LINES,
  ShipComputer,
  evaluateShipDamageAlerts,
} from './ShipComputer';
import { type FlightInputState, ShipController } from './ShipController';
import { Station } from './Station';
import { generateSystemLayout, type SystemLayoutPlan } from './systemLayout';
import { createDefaultUpgrades } from './trading';
import { getHudTheme } from './themes';
import type { PilotSettings } from './saveState';
import type {
  CameraMode,
  GamePhase,
  HudSnapshot,
  NavWaypointSummary,
  RadarBlip,
  SalvageCommodityId,
  ScreenHostileMarker,
  ShipUpgrades,
  StarSystem,
  TargetInfo,
} from './types';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _proj = new THREE.Vector3();

export interface SpaceSimCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onDockRequested: () => void;
  onCanisterCollected: (
    commodityId: SalvageCommodityId,
    units: number,
    bountyCredits: number,
    isPirateCargo: boolean
  ) => void;
  onPirateDestroyed: (pirateName: string, bountyCr: number) => void;
  onEscapePodEjected: () => void;
  onPhaseChange: (phase: GamePhase) => void;
  onToggleStarMap: () => void;
  onHyperspaceComplete: (destination: StarSystem, fuelUsedLY: number) => void;
  onFuelScooped: (newFuelLY: number) => void;
}

export class SpaceSimEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: SpaceSimCallbacks;
  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly station: Station;
  private readonly planetSystem: PlanetSystem;
  private readonly ship: ShipController;
  private readonly asteroids: AsteroidField;
  private readonly pirates: PirateManager;
  private readonly particles: ParticleField;
  private readonly radar = new RadarHUD();
  public readonly audio = new AudioEngine();
  public readonly computer = new ShipComputer();

  private phase: GamePhase = 'title';
  private isDocked = false;
  private starMapOpen = false;
  private cameraMode: CameraMode = 'cockpit';
  private credits = 100.0;
  private cargoUsed = 0;
  private cargoCapacity = 20;
  private fuel = MAX_JUMP_RANGE_LY;
  private maxFuel = MAX_JUMP_RANGE_LY;
  private currentSystem: StarSystem;
  private systemLayout: SystemLayoutPlan;
  private selectedJumpSystem: StarSystem | null = null;
  private upgrades: ShipUpgrades = createDefaultUpgrades();
  private lockedWaypointId = 'station-bay';

  private autoDockActive = false;
  private hyperspaceCountdown: number | null = null;
  private hyperspaceFlash = 0;
  private isScoopingFuel = false;
  private sunDistanceMeters = 40000;
  private scoopAudioTimer = 0;
  private lastEmittedScoopTenth = -1;
  private asteroidsCleared = 0;
  private pirateKills = 0;
  private pirateSpawnTimer = 5.0;
  private pirateCooldownTimer = 0;

  private alertMessage: string | null = null;
  private alertTimer = 0;
  private proximityBeepTimer = 0;
  private hitstopTimer = 0;
  private trauma = 0;
  private hullCriticalAnnounced = false;
  private wasCruiseActive = false;
  private titleOrbitAngle = 0.45;
  private hudEmitAccum = 0;

  private frameId = 0;
  private lastTime = 0;
  private disposed = false;

  private readonly keysHeld = new Set<string>();
  private zeroThrottleQueued = false;
  private mouseSteerEnabled = true;
  private mouseOffsetX = 0;
  private mouseOffsetY = 0;
  private mouseFireHeld = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    initialSystem: StarSystem,
    callbacks: SpaceSimCallbacks,
    initialSettings?: PilotSettings
  ) {
    this.container = container;
    this.currentSystem = initialSystem;
    this.systemLayout = generateSystemLayout(initialSystem);
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareGl();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090d16);
    this.scene.fog = new THREE.FogExp2(0x090d16, 0.00001);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(66, width / height, 0.5, 160000);

    this.station = new Station(new THREE.Vector3());
    this.scene.add(this.station.group);

    this.planetSystem = new PlanetSystem(this.systemLayout);
    this.scene.add(this.planetSystem.group);

    this.ship = new ShipController(this.scene);
    this.scene.add(this.ship.cockpitRig);

    this.asteroids = new AsteroidField(
      this.systemLayout.asteroidClusters,
      initialSystem.index,
      initialSystem.economy
    );
    this.scene.add(this.asteroids.group);

    this.pirates = new PirateManager();
    this.scene.add(this.pirates.group);

    this.particles = new ParticleField(this.scene, this.isSoftwareGl);
    this.applySystemLayout(initialSystem, true);

    if (initialSettings) {
      this.applyPilotSettings(initialSettings);
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.attachInputListeners();
    this.lastTime = performance.now();
    this.scheduleNextTick();
  }

  private applySystemLayout(system: StarSystem, resetShipToArrival: boolean): void {
    this.currentSystem = system;
    this.systemLayout = generateSystemLayout(system);
    this.lockedWaypointId = 'station-bay';

    const stPos = this.systemLayout.stationPosition;
    const facing = this.systemLayout.stationBayFacing;
    this.station.group.position.set(stPos.x, stPos.y, stPos.z);
    this.station.group.lookAt(stPos.x + facing.x, stPos.y + facing.y, stPos.z + facing.z);
    this.station.group.updateMatrixWorld(true);
    this.station.name = `${system.name.toUpperCase()} ORBITAL // CORIOLIS HUB`;

    this.planetSystem.reset(this.systemLayout);
    this.asteroids.reset(this.systemLayout.asteroidClusters, system.index, system.economy);
    this.pirates.reset();
    this.pirateCooldownTimer = 0;
    this.pirateSpawnTimer = getSecuritySpawnConfig(system.securityLevel).checkIntervalSec;
    this.particles.setSunAppearance(
      system.sunColorHex,
      system.sunCoronaHex,
      system.sunLightHex
    );
    this.particles.updateSunLightFocus(this.station.group.position);

    if (resetShipToArrival) {
      this.ship.setSpawnPose(
        this.systemLayout.arrivalPosition,
        this.systemLayout.arrivalLookTarget,
        52
      );
      this.sunDistanceMeters = this.ship.position.distanceTo(
        this.particles.getSunWorldPosition()
      );
    }
  }

  public attachRadarCanvas(canvas: HTMLCanvasElement | null): void {
    this.radar.attachCanvas(canvas);
  }

  public setStarMapOpen(open: boolean): void {
    this.starMapOpen = open;
    if (open) {
      this.keysHeld.clear();
      this.resetMouseFlightInput();
    }
    this.emitHudSnapshot();
  }

  public setSelectedJumpSystem(system: StarSystem | null): void {
    this.selectedJumpSystem = system;
    this.emitHudSnapshot();
  }

  public syncTradingMeta(meta: {
    credits: number;
    cargoUsed: number;
    cargoCapacity: number;
    fuel: number;
    maxFuel: number;
    hull: number;
    pirateKills?: number;
    upgrades: ShipUpgrades;
    system: StarSystem;
  }): void {
    this.credits = meta.credits;
    this.cargoUsed = meta.cargoUsed;
    this.cargoCapacity = meta.cargoCapacity;
    this.fuel = meta.fuel;
    this.maxFuel = meta.maxFuel;
    if (typeof meta.pirateKills === 'number') {
      this.pirateKills = meta.pirateKills;
    }
    this.upgrades = { ...meta.upgrades };
    this.ship.applyUpgrades(this.upgrades);
    this.ship.hull = Math.min(this.ship.maxHull, meta.hull);
    if (this.ship.maxHull > 0 && this.ship.hull / this.ship.maxHull > 0.35) {
      this.hullCriticalAnnounced = false;
    }
    const systemChanged = this.currentSystem.id !== meta.system.id;
    if (systemChanged) {
      this.applySystemLayout(meta.system, true);
    } else {
      this.currentSystem = meta.system;
      this.station.name = `${meta.system.name.toUpperCase()} ORBITAL // CORIOLIS HUB`;
      this.particles.setSunAppearance(
        meta.system.sunColorHex,
        meta.system.sunCoronaHex,
        meta.system.sunLightHex
      );
    }
    this.emitHudSnapshot();
  }

  public triggerDistressJump(destination: StarSystem): void {
    this.audio.unlock();
    this.autoDockActive = false;
    this.ship.dropFromCruise(52);
    this.starMapOpen = false;
    this.hyperspaceCountdown = null;
    this.keysHeld.clear();
    if (this.phase === 'paused') {
      this.setPhase('playing');
    }

    this.hyperspaceFlash = 1.0;
    this.wasCruiseActive = false;
    this.audio.playHyperspaceBoom();
    this.computer.speak(SHIP_COMPUTER_LINES.hyperspaceComplete);
    this.selectedJumpSystem = null;
    this.applySystemLayout(destination, true);
    this.setAlert(`DISTRESS TOW ARRIVED IN ${destination.name.toUpperCase()}`, 3.4);
    this.emitHudSnapshot();
  }

  public applyPilotSettings(settings: PilotSettings): void {
    this.ship.invertPitch = settings.invertPitch;
    this.mouseSteerEnabled = settings.mouseSteerEnabled;
    this.cameraMode = settings.cameraMode;
    this.audio.setVolume(settings.volume);
    this.audio.setMuted(settings.muted);
    this.computer.setEnabled(settings.voiceEnabled);
    this.computer.setAudioState(settings.muted, settings.volume);
    this.radar.setAccentRgb(getHudTheme(settings.hudTheme).accentRgb);
    this.emitHudSnapshot();
  }

  public setHudThemeRgb(rgb: string): void {
    this.radar.setAccentRgb(rgb);
    if (this.phase === 'playing') {
      const { target, blips } = this.computeTargetAndRadar();
      this.radar.render(blips, target?.id ?? null);
    }
  }

  public setInvertPitch(invert: boolean): void {
    this.ship.invertPitch = invert;
    this.emitHudSnapshot();
  }

  public toggleMouseSteer(): void {
    this.mouseSteerEnabled = !this.mouseSteerEnabled;
    this.mouseOffsetX = 0;
    this.mouseOffsetY = 0;
    this.audio.unlock();
    this.audio.playUiBlip('select');
    this.setAlert(
      this.mouseSteerEnabled
        ? 'MOUSE STEERING ENABLED [V]'
        : 'MOUSE STEERING OFF — KEYBOARD FLIGHT [V]',
      2.0
    );
    this.emitHudSnapshot();
  }

  public toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
    this.emitHudSnapshot();
  }

  public toggleMute(): void {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.isMuted());
    this.computer.setAudioState(this.audio.isMuted(), this.audio.getVolume());
    this.emitHudSnapshot();
  }

  public setVolume(volume: number): void {
    this.audio.unlock();
    this.audio.setVolume(volume);
    this.computer.setAudioState(this.audio.isMuted(), this.audio.getVolume());
    this.emitHudSnapshot();
  }

  public toggleVoice(): void {
    this.audio.unlock();
    this.computer.setEnabled(!this.computer.isEnabled());
    this.emitHudSnapshot();
  }

  private getMassLockBodies(): MassLockBody[] {
    const bodies: MassLockBody[] = [
      {
        id: 'station-bay',
        name: this.station.name,
        kind: 'bay',
        position: this.station.group.position,
        surfaceRadius: this.station.collisionRadius,
      },
      {
        id: 'local-star',
        name: `${this.currentSystem.name.toUpperCase()} STAR`,
        kind: 'star',
        position: this.systemLayout.sunPosition,
        surfaceRadius: this.systemLayout.sunRadius,
      },
    ];
    for (const p of this.systemLayout.planets) {
      bodies.push({
        id: p.id,
        name: p.name,
        kind: 'planet',
        position: p.position,
        surfaceRadius: p.radius,
      });
    }
    for (const c of this.systemLayout.asteroidClusters) {
      bodies.push({
        id: c.id,
        name: c.name,
        kind: 'asteroid_belt',
        position: c.position,
        surfaceRadius: c.radius * 0.45,
      });
    }
    for (const p of this.pirates.pirates) {
      if (p.destroyed) continue;
      bodies.push({
        id: p.id,
        name: p.name,
        kind: 'pirate',
        position: p.position,
        surfaceRadius: p.collisionRadius,
      });
    }
    return bodies;
  }

  public toggleCruiseDrive(): void {
    if (this.phase !== 'playing' || this.isDocked || this.hyperspaceCountdown !== null) return;
    this.audio.unlock();
    if (this.ship.cruiseActive) {
      this.ship.dropFromCruise(185);
      this.wasCruiseActive = false;
      this.audio.playCruiseDisengage(false);
      this.computer.speak(SHIP_COMPUTER_LINES.supercruiseDropped);
      this.setAlert('CRUISE DRIVE DISENGAGED', 1.8);
      this.emitHudSnapshot();
      return;
    }

    const massLock = evaluateMassLock(this.ship.position, this.getMassLockBodies());
    if (massLock.locked) {
      this.audio.playUiBlip('tab');
      const bodyLabel = massLock.blockingBodyName?.split('//')[0].trim() ?? 'NEARBY MASS';
      this.computer.speak(
        massLock.blockingBodyKind === 'pirate'
          ? SHIP_COMPUTER_LINES.pirateInterdiction
          : SHIP_COMPUTER_LINES.massLocked
      );
      this.setAlert(`MASS-LOCKED (${bodyLabel}) — CLEAR 3.0 KM`, 2.4);
      this.emitHudSnapshot();
      return;
    }

    this.autoDockActive = false;
    this.ship.cruiseActive = true;
    this.wasCruiseActive = true;
    this.ship.throttle = 1.0;
    this.audio.playCruiseEngage();
    this.computer.speak(SHIP_COMPUTER_LINES.supercruiseEngaged);
    this.setAlert('CRUISE DRIVE ENGAGED (16x)', 2.4);
    this.emitHudSnapshot();
  }

  private getWaypointOrder(): Array<{
    id: string;
    name: string;
    kind: TargetInfo['kind'];
    wpKind: NavWaypointSummary['kind'];
    subtitle: string;
    pos: { x: number; y: number; z: number };
  }> {
    const bay = this.station.getDockingBayWorldTransform();
    const list: Array<{
      id: string;
      name: string;
      kind: TargetInfo['kind'];
      wpKind: NavWaypointSummary['kind'];
      subtitle: string;
      pos: { x: number; y: number; z: number };
    }> = [
      {
        id: 'station-bay',
        name: this.station.name,
        kind: 'bay',
        wpKind: 'station',
        subtitle: 'Orbital Station',
        pos: bay.position,
      },
    ];
    for (const p of this.pirates.pirates) {
      if (p.destroyed) continue;
      list.push({
        id: p.id,
        name: p.name,
        kind: 'pirate',
        wpKind: 'pirate',
        subtitle: `Hostile Raider · ${p.bountyCr} Cr`,
        pos: p.position,
      });
    }
    for (const p of this.systemLayout.planets) {
      list.push({
        id: p.id,
        name: p.name,
        kind: 'planet',
        wpKind: 'planet',
        subtitle:
          p.archetype === 'terrestrial'
            ? p.hasMoon
              ? 'Terrestrial · Moon'
              : 'Terrestrial'
            : p.archetype === 'gas_giant'
              ? p.hasRings
                ? 'Ringed Gas Giant'
                : 'Gas Giant'
              : p.archetype === 'volcanic'
                ? 'Volcanic World'
                : 'Arid Rocky World',
        pos: p.position,
      });
    }
    list.push({
      id: 'local-star',
      name: `${this.currentSystem.name.toUpperCase()} STAR (CORONA)`,
      kind: 'star',
      wpKind: 'star',
      subtitle: 'Local Sun',
      pos: this.systemLayout.sunPosition,
    });
    for (const c of this.systemLayout.asteroidClusters) {
      list.push({
        id: c.id,
        name: c.name,
        kind: 'asteroid_belt',
        wpKind: 'asteroid_belt',
        subtitle: 'Mining Cluster',
        pos: c.position,
      });
    }
    return list;
  }

  public cycleTargetWaypoint(): void {
    if (this.phase !== 'playing' || this.isDocked) return;
    this.audio.unlock();
    const list = this.getWaypointOrder();
    if (list.length === 0) return;
    const idx = list.findIndex((w) => w.id === this.lockedWaypointId);
    const next = list[(idx + 1) % list.length];
    this.lockedWaypointId = next.id;
    this.audio.playUiBlip('select');
    this.setAlert(
      next.kind === 'pirate' ? `HOSTILE LOCK → ${next.name.toUpperCase()}` : `NAV LOCK → ${next.name}`,
      1.8
    );
    this.emitHudSnapshot();
  }

  public selectWaypoint(id: string): void {
    if (this.phase !== 'playing' || this.isDocked) return;
    this.audio.unlock();
    const list = this.getWaypointOrder();
    const found = list.find((w) => w.id === id);
    if (!found) return;
    this.lockedWaypointId = found.id;
    this.audio.playUiBlip('select');
    this.emitHudSnapshot();
  }

  public selectTarget(id: string): void {
    this.selectWaypoint(id);
  }

  public toggleAutoDock(): void {
    if (this.phase !== 'playing' || this.isDocked || this.hyperspaceCountdown !== null) return;
    this.audio.unlock();
    const dist = this.ship.position.distanceTo(this.station.group.position);
    if (dist > AUTO_DOCK_MAX_RANGE_M) {
      this.setAlert('AUTO-DOCK UNAVAILABLE BEYOND 2.0 KM', 2.2);
      return;
    }
    if (this.ship.cruiseActive) {
      this.ship.dropFromCruise(120);
      this.wasCruiseActive = false;
      this.audio.playCruiseDisengage(false);
    }
    this.autoDockActive = !this.autoDockActive;
    if (this.autoDockActive) {
      this.audio.playAutoDock();
      this.computer.speak(SHIP_COMPUTER_LINES.autoDockEngaged);
      this.setAlert('AUTO-DOCK ENGAGED — GUIDING TO BAY', 2.5);
    } else {
      this.setAlert('AUTO-DOCK DISENGAGED', 1.6);
    }
    this.emitHudSnapshot();
  }

  public triggerHyperspaceJump(): void {
    if (this.isDocked) {
      this.setAlert('UNDOCK FROM STATION BEFORE JUMPING', 2.2);
      return;
    }
    if (this.hyperspaceCountdown !== null) return;
    if (!this.selectedJumpSystem) {
      this.callbacks.onToggleStarMap();
      return;
    }
    const check = canJumpToSystem(this.currentSystem, this.selectedJumpSystem, this.fuel, this.maxFuel);
    if (!check.ok) {
      this.setAlert(check.reason ?? 'CANNOT JUMP TO SELECTED SYSTEM', 2.2);
      return;
    }

    this.audio.unlock();
    this.autoDockActive = false;
    this.starMapOpen = false;
    this.keysHeld.clear();
    if (this.phase === 'paused') {
      this.setPhase('playing');
    }
    this.hyperspaceCountdown = 3.0;
    this.audio.playHyperspaceCharge();
    this.setAlert(`HYPERSPACE JUMP TO ${this.selectedJumpSystem.name.toUpperCase()}`, 3.0);
    this.emitHudSnapshot();
  }

  public setAlert(msg: string, duration = 2.5): void {
    this.alertMessage = msg;
    this.alertTimer = duration;
    this.emitHudSnapshot();
  }

  public launch(fromUserGesture = true): void {
    if (fromUserGesture) {
      this.audio.unlock();
    }
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.isDocked = false;
    this.starMapOpen = false;
    this.autoDockActive = false;
    this.setPhase('playing');
    this.emitHudSnapshot();
  }

  public pause(): void {
    if (this.phase !== 'playing') return;
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.autoDockActive = false;
    this.audio.stopHyperspaceCharge();
    this.audio.updateThruster(0, false);
    this.setPhase('paused');
    this.emitHudSnapshot();
  }

  public resume(): void {
    if (this.phase !== 'paused') return;
    this.audio.unlock();
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.isDocked = false;
    this.setPhase('playing');
    this.emitHudSnapshot();
  }

  public undock(): void {
    this.audio.unlock();
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.isDocked = false;
    this.autoDockActive = false;

    const bay = this.station.getDockingBayWorldTransform();
    this.ship.position.copy(bay.position).addScaledVector(bay.outwardNormal, 128);
    const lookAway = this.ship.position.clone().addScaledVector(bay.outwardNormal, 140);
    const mat = new THREE.Matrix4().lookAt(this.ship.position, lookAway, new THREE.Vector3(0, 1, 0));
    this.ship.quaternion.setFromRotationMatrix(mat);
    this.ship.throttle = 0.28;
    this.ship.velocity.copy(bay.outwardNormal).multiplyScalar(68);
    this.setPhase('playing');
    this.setAlert('LAUNCH CLEARANCE GRANTED — FLY SAFE', 2.4);
    this.emitHudSnapshot();
  }

  public restart(initialSystem: StarSystem, autoPlay = true): void {
    this.audio.unlock();
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.isDocked = false;
    this.starMapOpen = false;
    this.autoDockActive = false;
    this.hyperspaceCountdown = null;
    this.hyperspaceFlash = 0;
    this.asteroidsCleared = 0;
    this.pirateKills = 0;
    this.pirateCooldownTimer = 0;
    this.trauma = 0;
    this.hitstopTimer = 0;
    this.hullCriticalAnnounced = false;
    this.wasCruiseActive = false;
    this.selectedJumpSystem = null;
    this.upgrades = createDefaultUpgrades();
    this.isScoopingFuel = false;
    this.pirates.reset();
    this.ship.reset();
    this.ship.applyUpgrades(this.upgrades);
    this.applySystemLayout(initialSystem, true);
    this.audio.stopHyperspaceCharge();
    this.computer.stop();
    this.setPhase(autoPlay ? 'playing' : 'title');
    this.emitHudSnapshot();
  }

  public triggerManualDockIfReady(): void {
    if (this.phase !== 'playing' || this.isDocked) return;
    const bay = this.station.getDockingBayWorldTransform();
    this.ship.getForward(_fwd);
    const alignment = evaluateDockingAlignment({
      shipPos: this.ship.position,
      shipForward: _fwd,
      shipSpeedMps: this.ship.velocity.length(),
      bayPos: bay.position,
      bayOutwardNormal: bay.outwardNormal,
    });
    if (alignment.isReadyToDock && alignment.distanceMeters < 180) {
      this.enterDockingBay();
    }
  }

  private enterDockingBay(): void {
    this.isDocked = true;
    this.autoDockActive = false;
    this.ship.cruiseActive = false;
    this.wasCruiseActive = false;
    this.ship.cruiseBlend = 0;
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.pirates.reset();
    this.ship.velocity.set(0, 0, 0);
    this.ship.throttle = 0;
    this.audio.updateThruster(0, false, 0);
    this.audio.playDock();
    this.computer.speak(SHIP_COMPUTER_LINES.dockingComplete);
    this.setPhase('paused');
    this.callbacks.onDockRequested();
    this.emitHudSnapshot();
  }

  private completeHyperspaceJump(): void {
    const dest = this.selectedJumpSystem;
    if (!dest) {
      this.hyperspaceCountdown = null;
      return;
    }
    const check = canJumpToSystem(this.currentSystem, dest, this.fuel, this.maxFuel);
    this.hyperspaceCountdown = null;
    if (!check.ok) {
      this.setAlert(check.reason ?? 'JUMP ABORTED', 2.2);
      return;
    }

    this.hyperspaceFlash = 1.0;
    this.wasCruiseActive = false;
    this.audio.playHyperspaceBoom();
    this.computer.speak(SHIP_COMPUTER_LINES.hyperspaceComplete);
    this.selectedJumpSystem = null;
    this.fuel = Math.max(0, Math.round((this.fuel - check.distance) * 10) / 10);

    // Update new system layout, planets, station, asteroid belts, sun, and arrival pose
    this.applySystemLayout(dest, true);

    this.callbacks.onHyperspaceComplete(dest, check.distance);
    this.setAlert(`ARRIVED IN ${dest.name.toUpperCase()} (${dest.economy.toUpperCase()})`, 3.2);
    this.emitHudSnapshot();
  }

  private setPhase(next: GamePhase): void {
    this.phase = next;
    document.body.dataset.state = next;
    this.callbacks.onPhaseChange(next);
  }

  private resetMouseFlightInput(): void {
    this.mouseOffsetX = 0;
    this.mouseOffsetY = 0;
    this.mouseFireHeld = false;
  }

  private attachInputListeners(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.phase === 'playing') {
        this.audio.unlock();
      }
      if (
        ['ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(
          e.code
        )
      ) {
        if (this.phase === 'playing' && !this.starMapOpen) {
          e.preventDefault();
        }
      }
      if (e.code === 'KeyX' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.zeroThrottleQueued = true;
      }
      if (e.code === 'KeyJ' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.toggleCruiseDrive();
      }
      if (e.code === 'KeyT' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.cycleTargetWaypoint();
      }
      if (e.code === 'KeyC' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.toggleAutoDock();
      }
      if (e.code === 'KeyM' && !e.repeat && (this.phase === 'playing' || this.starMapOpen)) {
        if (!this.isDocked) {
          this.callbacks.onToggleStarMap();
        }
      }
      if (e.code === 'KeyH' && !e.repeat && (this.phase === 'playing' || this.starMapOpen)) {
        if (!this.isDocked) {
          this.triggerHyperspaceJump();
        }
      }
      if (
        e.code === 'KeyV' &&
        !e.repeat &&
        !this.starMapOpen &&
        !this.isDocked &&
        (this.phase === 'playing' || this.phase === 'paused')
      ) {
        this.toggleMouseSteer();
      }
      if (
        e.code === 'KeyG' &&
        !e.repeat &&
        !this.starMapOpen &&
        !this.isDocked &&
        (this.phase === 'playing' || this.phase === 'paused')
      ) {
        this.toggleCameraMode();
      }
      if (e.code === 'KeyF' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.triggerManualDockIfReady();
      }
      if (
        e.code === 'KeyI' &&
        !e.repeat &&
        !this.isDocked &&
        (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'title')
      ) {
        this.setInvertPitch(!this.ship.invertPitch);
      }
      if (e.code === 'KeyN' && !e.repeat && !this.isDocked) {
        this.toggleMute();
      }

      // Manual steering disengages Auto-Dock
      if (
        this.autoDockActive &&
        ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)
      ) {
        this.autoDockActive = false;
        this.setAlert('MANUAL OVERRIDE — AUTO-DOCK OFF', 1.6);
      }

      this.keysHeld.add(e.code);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keysHeld.delete(e.code);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (
        this.phase !== 'playing' ||
        this.isDocked ||
        this.starMapOpen ||
        !this.mouseSteerEnabled
      ) {
        return;
      }
      const rect = this.container.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      this.mouseOffsetX = e.clientX - cx;
      this.mouseOffsetY = e.clientY - cy;
    };

    const onPointerDown = (e: PointerEvent) => {
      this.audio.unlock();
      if (
        e.button === 0 &&
        this.phase === 'playing' &&
        !this.isDocked &&
        !this.starMapOpen &&
        e.target === this.renderer.domElement
      ) {
        this.mouseFireHeld = true;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 0) {
        this.mouseFireHeld = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (this.phase !== 'playing' || this.isDocked || this.starMapOpen) {
        return;
      }
      e.preventDefault();
      if (this.ship.cruiseActive || this.autoDockActive || e.deltaY === 0) {
        return;
      }
      this.audio.unlock();
      const nextThrottle = applyScrollThrottleStep(this.ship.throttle, e.deltaY);
      if (nextThrottle !== this.ship.throttle) {
        this.ship.throttle = nextThrottle;
        this.audio.updateThruster(Math.abs(this.ship.throttle), true, this.ship.cruiseBlend);
        this.hudEmitAccum = 0;
        this.emitHudSnapshot();
      }
    };

    const onBlur = () => {
      this.keysHeld.clear();
      this.resetMouseFlightInput();
    };

    this.renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    this.resizeObserver = new ResizeObserver(() => {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
    this.resizeObserver.observe(this.container);

    this.cleanupListeners = () => {
      this.renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      this.resizeObserver?.disconnect();
    };
  }

  private cleanupListeners: () => void = () => {};

  private readFlightInput(): FlightInputState {
    if (this.starMapOpen) {
      return {
        pitchUp: false,
        pitchDown: false,
        rollLeft: false,
        rollRight: false,
        yawLeft: false,
        yawRight: false,
        mousePitch: 0,
        mouseYaw: 0,
        throttleUp: false,
        throttleDown: false,
        fireHeld: false,
        zeroThrottleJustPressed: false,
      };
    }
    const mouseSteer = this.mouseSteerEnabled
      ? computeMouseSteerAxes(this.mouseOffsetX, this.mouseOffsetY)
      : { pitch: 0, yaw: 0 };

    const input: FlightInputState = {
      pitchDown: this.keysHeld.has('KeyW'),
      pitchUp: this.keysHeld.has('KeyS'),
      rollLeft: this.keysHeld.has('KeyA'),
      rollRight: this.keysHeld.has('KeyD'),
      yawLeft: this.keysHeld.has('KeyQ'),
      yawRight: this.keysHeld.has('KeyE'),
      mousePitch: mouseSteer.pitch,
      mouseYaw: mouseSteer.yaw,
      throttleUp:
        this.keysHeld.has('ShiftLeft') ||
        this.keysHeld.has('ShiftRight') ||
        this.keysHeld.has('ArrowUp'),
      throttleDown:
        this.keysHeld.has('ControlLeft') ||
        this.keysHeld.has('ControlRight') ||
        this.keysHeld.has('ArrowDown'),
      fireHeld: this.keysHeld.has('Space') || this.mouseFireHeld,
      zeroThrottleJustPressed: this.zeroThrottleQueued,
    };
    this.zeroThrottleQueued = false;
    return input;
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(() => this.tick());
  }

  private afterDraw(cb: () => void): void {
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (this.disposed) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            this.frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            this.frameId = window.setTimeout(cb, 80);
          }
        };
        this.frameId = window.setTimeout(poll, 5);
        return;
      }
    } catch {
      // Fallback
    }
    this.frameId = window.setTimeout(cb, 80);
  }

  private tick(): void {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.stepSimulation(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private stepSimulation(dt: number): void {
    if (this.phase !== 'paused') {
      this.station.update(dt);
      this.planetSystem.update(dt);
    }

    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) {
        this.alertMessage = null;
      }
    }

    if (this.hyperspaceFlash > 0) {
      this.hyperspaceFlash = Math.max(0, this.hyperspaceFlash - dt * 1.8);
    }

    if (this.phase === 'title') {
      this.ship.cockpitRig.visible = false;
      this.ship.shipGroup.visible = false;
      this.titleOrbitAngle += dt * 0.12;
      const stPos = this.station.group.position;
      this.particles.updateSunLightFocus(stPos);
      const primary = this.systemLayout.planets[0];
      // Frame the station from the outward-facing side so the primary planet looms majestically behind it
      const dirX = primary ? stPos.x - primary.position.x : 0;
      const dirZ = primary ? stPos.z - primary.position.z : 1;
      const baseAngle = Math.atan2(dirX, dirZ) + Math.sin(this.titleOrbitAngle) * 0.42;
      const orbitR = 440;
      this.camera.position.set(
        stPos.x + Math.sin(baseAngle) * orbitR,
        stPos.y + 88 + Math.sin(this.titleOrbitAngle * 0.7) * 24,
        stPos.z + Math.cos(baseAngle) * orbitR
      );
      this.camera.lookAt(stPos.x - 40, stPos.y + 8, stPos.z);
      this.asteroids.update(dt);
      this.particles.update(
        dt,
        this.camera.position,
        new THREE.Vector3(0, 0, -18),
        new THREE.Vector3(0, 0, -1)
      );
      return;
    }

    if (this.phase === 'paused' || this.phase === 'gameover') {
      return;
    }

    // Hyperspace countdown progression
    let warpBoost = 0;
    if (this.hyperspaceCountdown !== null) {
      this.hyperspaceCountdown -= dt;
      warpBoost = Math.min(1, (3.0 - Math.max(0, this.hyperspaceCountdown)) / 3.0);
      if (this.hyperspaceCountdown <= 0) {
        this.completeHyperspaceJump();
      }
    }

    this.ship.shipGroup.visible = this.cameraMode === 'chase';
    this.particles.updateSunLightFocus(this.ship.position);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
    } else if (this.autoDockActive) {
      // Autopilot guidance: align to corridor staging point first if far/off-axis, then straight into bay
      const bay = this.station.getDockingBayWorldTransform();
      const corridorPoint = bay.position.clone().addScaledVector(bay.outwardNormal, 145);
      const distToBay = this.ship.position.distanceTo(bay.position);
      const distToCorridor = this.ship.position.distanceTo(corridorPoint);
      const toShip = this.ship.position.clone().sub(bay.position);
      const alongNormal = toShip.dot(bay.outwardNormal);
      const lateral = toShip.clone().addScaledVector(bay.outwardNormal, -alongNormal).length();

      const useCorridor = alongNormal < 40 || (distToCorridor > 55 && lateral > 42);
      const targetPos = useCorridor ? corridorPoint : bay.position;
      const desiredSpeed =
        distToBay > 450 ? 150 : distToBay > 160 ? 95 : 46;

      this.ship.updateAutoDock(dt, targetPos, desiredSpeed, this.camera, this.cameraMode);
      this.audio.updateThruster(this.ship.throttle, true, 0);
      this.asteroids.update(dt);
      this.checkCollisionsAndPickups();
    } else {
      const input = this.readFlightInput();
      const gimbalTarget = this.getLockedPirateLeadTarget();
      this.ship.update(
        dt,
        input,
        this.camera,
        this.cameraMode,
        () => {
          this.audio.playLaser(this.ship.pulseLaserMk2);
          this.trauma = Math.min(0.32, this.trauma + (this.ship.pulseLaserMk2 ? 0.14 : 0.1));
        },
        warpBoost,
        gimbalTarget?.leadWorld ?? null
      );

      // Detect throttle-down or X key dropping Supercruise inside ShipController
      if (this.wasCruiseActive && !this.ship.cruiseActive) {
        this.wasCruiseActive = false;
        this.audio.playCruiseDisengage(false);
        this.computer.speak(SHIP_COMPUTER_LINES.supercruiseDropped);
      }

      // Mass-Lock Safety: drop out of Cruise Drive automatically within 3 km of any celestial/orbital mass
      if (this.ship.cruiseActive) {
        const massLock = evaluateMassLock(this.ship.position, this.getMassLockBodies());
        if (massLock.locked) {
          this.ship.dropFromCruise(185);
          this.wasCruiseActive = false;
          this.audio.playCruiseDisengage(true);
          this.computer.speak(
            massLock.blockingBodyKind === 'pirate'
              ? SHIP_COMPUTER_LINES.pirateInterdiction
              : SHIP_COMPUTER_LINES.massLocked
          );
          this.trauma = Math.min(1, this.trauma + 0.28);
          const bodyLabel = massLock.blockingBodyName?.split('//')[0].trim() ?? 'PROXIMITY MASS';
          this.setAlert(`MASS-LOCK DROP — ${bodyLabel.toUpperCase()}`, 2.8);
        }
      }

      if (input.throttleUp && this.ship.throttle > 0.32) {
        this.trauma = Math.min(0.22, this.trauma + 0.85 * dt);
      }
      if (this.ship.cruiseBlend > 0.15) {
        this.trauma = Math.min(0.2, this.trauma + this.ship.cruiseBlend * 0.42 * dt);
      }
      if (warpBoost > 0.12) {
        this.trauma = Math.min(0.36, this.trauma + warpBoost * 1.1 * dt);
      }
      this.audio.updateThruster(Math.abs(this.ship.throttle), true, this.ship.cruiseBlend);
      this.asteroids.update(dt);
      this.updateSecurityPirateSpawns(dt);
      const prevActivePirates = this.pirates.getActiveCount();
      this.pirates.update(dt, this.ship.position, this.ship.velocity, () => {
        this.audio.playEnemyLaser();
      });
      if (
        prevActivePirates > 0 &&
        this.pirates.getActiveCount() === 0 &&
        this.pirateCooldownTimer <= 0
      ) {
        this.pirateCooldownTimer = computePostEncounterCooldownSec(Math.random());
      }
      this.checkLaserHits();
      this.checkEnemyLaserHits();
      this.checkCollisionsAndPickups();
      this.checkProximityWarnings(dt);
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - 2.1 * dt);
      const shake = this.trauma * this.trauma * 0.045;
      this.camera.rotateX((Math.random() * 2 - 1) * shake);
      this.camera.rotateY((Math.random() * 2 - 1) * shake);
      this.camera.rotateZ((Math.random() * 2 - 1) * shake * 1.4);
    }

    // Planet Atmosphere / Surface Boundary Repulsion
    for (const p of this.systemLayout.planets) {
      _toTarget.set(
        this.ship.position.x - p.position.x,
        this.ship.position.y - p.position.y,
        this.ship.position.z - p.position.z
      );
      const dist = _toTarget.length();
      const minClear = p.radius + 45;
      if (dist < minClear && dist > 0.01) {
        _toTarget.divideScalar(dist);
        this.ship.position.set(
          p.position.x + _toTarget.x * (minClear + 15),
          p.position.y + _toTarget.y * (minClear + 15),
          p.position.z + _toTarget.z * (minClear + 15)
        );
        const impactSpeed = this.ship.velocity.length();
        this.ship.velocity.reflect(_toTarget).multiplyScalar(0.35);
        if (this.ship.cruiseActive) {
          this.ship.dropFromCruise(140);
          this.audio.playCruiseDisengage(true);
        }
        const dmg = computeCollisionDamage(Math.min(impactSpeed, 180), 0.7);
        if (dmg > 0) {
          this.handleHullImpact(dmg, this.ship.position);
        }
        this.setAlert(`PLANETARY EXCLUSION BOUNDARY — ${p.name}`, 2.2);
      }
    }

    // Solar Corona Fuel Scooping & Photosphere Thermal Boundary
    const sunPos = this.particles.getSunWorldPosition();
    this.sunDistanceMeters = this.ship.position.distanceTo(sunPos);
    if (this.sunDistanceMeters < this.systemLayout.sunThermalRadius) {
      const pushOut = this.ship.position.clone().sub(sunPos).normalize();
      this.ship.position.copy(sunPos).addScaledVector(pushOut, this.systemLayout.sunThermalRadius + 25);
      this.ship.velocity.reflect(pushOut).multiplyScalar(0.5);
      this.setAlert('THERMAL PHOTOSPHERE LIMIT — PULL BACK', 1.8);
    }

    if (
      this.upgrades.fuelScoop &&
      this.sunDistanceMeters <= this.systemLayout.sunScoopRadius &&
      this.fuel < this.maxFuel - 0.01
    ) {
      this.isScoopingFuel = true;
      const prox = Math.max(
        0.55,
        Math.min(
          1.4,
          (this.systemLayout.sunScoopRadius - this.sunDistanceMeters) / 1400 + 0.55
        )
      );
      this.fuel = Math.min(this.maxFuel, this.fuel + 0.85 * prox * dt);
      const tenth = Math.floor(this.fuel * 10);
      if (tenth > this.lastEmittedScoopTenth || this.fuel >= this.maxFuel) {
        this.lastEmittedScoopTenth = tenth;
        const rounded = Math.min(this.maxFuel, Math.round(this.fuel * 10) / 10);
        this.callbacks.onFuelScooped(rounded);
      }
      this.scoopAudioTimer -= dt;
      if (this.scoopAudioTimer <= 0) {
        this.scoopAudioTimer = 0.35;
        this.audio.playFuelScoopPulse();
      }
    } else {
      this.isScoopingFuel = false;
      this.lastEmittedScoopTenth = Math.floor(this.fuel * 10);
      if (
        !this.upgrades.fuelScoop &&
        this.sunDistanceMeters <= this.systemLayout.sunScoopRadius &&
        !this.alertMessage
      ) {
        this.setAlert('SOLAR CORONA — INSTALL FUEL SCOOP TO SKIM', 2.0);
      }
    }

    this.ship.getForward(_fwd);
    this.particles.update(
      dt,
      this.ship.position,
      this.ship.velocity,
      _fwd,
      warpBoost,
      this.ship.cruiseBlend
    );

    this.hudEmitAccum += dt;
    if (
      this.hudEmitAccum >= 0.08 ||
      this.hyperspaceFlash > 0 ||
      this.hyperspaceCountdown !== null ||
      this.isScoopingFuel
    ) {
      this.hudEmitAccum = 0;
      this.emitHudSnapshot();
    }
  }

  private getLockedPirateLeadTarget(): {
    leadWorld: THREE.Vector3;
    gimbalLocked: boolean;
  } | null {
    const lockedPirate = this.pirates.pirates.find(
      (p) => !p.destroyed && p.id === this.lockedWaypointId
    );
    if (!lockedPirate) return null;
    const dist = this.ship.position.distanceTo(lockedPirate.position);
    if (dist > 1650) return null;

    const lead = computeLeadInterceptPoint({
      shooterPos: this.ship.position,
      targetPos: lockedPirate.position,
      targetVel: lockedPirate.velocity,
      projectileSpeedMps: this.ship.getLaserSpeed(),
    });
    const leadWorld = new THREE.Vector3(lead.x, lead.y, lead.z);
    this.ship.getForward(_fwd);
    const gimbal = computeGimbalAimDirection({
      shooterPos: this.ship.position,
      shooterForward: _fwd,
      leadTargetPos: leadWorld,
    });
    return {
      leadWorld,
      gimbalLocked: gimbal.gimbalActive,
    };
  }

  private updateSecurityPirateSpawns(dt: number): void {
    if (this.isDocked || this.hyperspaceCountdown !== null || this.autoDockActive) return;
    if (this.pirateCooldownTimer > 0) {
      this.pirateCooldownTimer = Math.max(0, this.pirateCooldownTimer - dt);
      return;
    }
    this.pirateSpawnTimer -= dt;
    if (this.pirateSpawnTimer > 0) return;

    const cfg = getSecuritySpawnConfig(this.currentSystem.securityLevel);
    this.pirateSpawnTimer = cfg.checkIntervalSec;

    const shouldSpawn = evaluateSecurityPirateSpawn({
      securityLevel: this.currentSystem.securityLevel,
      activePirateCount: this.pirates.getActiveCount(),
      stationDistanceMeters: this.ship.position.distanceTo(this.station.group.position),
      isCruising: this.ship.cruiseActive,
      randomRoll: Math.random(),
      spawnCooldownRemainingSec: this.pirateCooldownTimer,
    });
    if (!shouldSpawn) return;

    this.ship.getForward(_fwd);
    const pirate = this.pirates.spawnPirateNearPlayer(this.ship.position, _fwd, Math.random());
    if (this.ship.cruiseActive) {
      this.ship.dropFromCruise(185);
      this.wasCruiseActive = false;
      this.audio.playCruiseDisengage(true);
      this.trauma = Math.min(1, this.trauma + 0.34);
    }
    this.audio.playProximityWarning(true);
    this.computer.speak(SHIP_COMPUTER_LINES.pirateInterdiction);
    this.setAlert(`INTERDICTION — ${pirate.name.toUpperCase()} INBOUND`, 3.0);
  }

  private checkLaserHits(): void {
    for (const bolt of this.ship.laserPool) {
      if (!bolt.active) continue;

      let consumed = false;
      for (const pirate of this.pirates.pirates) {
        if (pirate.destroyed) continue;
        const dist = bolt.pos.distanceTo(pirate.position);
        if (dist <= pirate.collisionRadius + 5.0) {
          bolt.active = false;
          bolt.mesh.visible = false;
          consumed = true;
          const res = this.pirates.damagePirate(pirate, this.ship.getLaserDamage());
          if (res.destroyed) {
            this.pirateKills++;
            this.pirateCooldownTimer = computePostEncounterCooldownSec(Math.random());
            this.hitstopTimer = 0.055;
            this.trauma = Math.min(1, this.trauma + 0.58);
            this.audio.playExplosion();
            this.computer.speak(SHIP_COMPUTER_LINES.targetDestroyed);
            this.particles.spawnBurst(pirate.position, 28, 85, 0xf97316, 2.2);

            if (Math.random() < 0.78) {
              const lootTable: SalvageCommodityId[] = ['alloys', 'machinery', 'luxury_goods'];
              const lootId = lootTable[Math.floor(Math.random() * lootTable.length)];
              const lootUnits = Math.random() < 0.35 ? 2 : 1;
              this.asteroids.spawnCanister(pirate.position, lootId, lootUnits, 0);
            }

            if (this.lockedWaypointId === pirate.id) {
              const nextPirate = this.pirates.pirates.find((p) => !p.destroyed);
              this.lockedWaypointId = nextPirate ? nextPirate.id : 'station-bay';
            }

            this.callbacks.onPirateDestroyed(pirate.name, pirate.bountyCr);
            this.setAlert(
              `${pirate.name.toUpperCase()} DESTROYED · +${pirate.bountyCr} Cr BOUNTY`,
              2.8
            );
          } else {
            this.audio.playImpact(false);
            const sparkColor = res.shieldHit ? 0x38bdf8 : 0xfbbf24;
            this.particles.spawnBurst(bolt.pos, 10, 52, sparkColor, 0.78);
          }
          break;
        }
      }
      if (consumed) continue;

      for (const ast of this.asteroids.asteroids) {
        if (ast.destroyed) continue;
        const dist = bolt.pos.distanceTo(ast.mesh.position);
        if (dist <= ast.radius + 4.5) {
          bolt.active = false;
          bolt.mesh.visible = false;
          const destroyed = this.asteroids.damageAsteroid(ast, this.ship.getLaserDamage());
          if (destroyed) {
            this.asteroidsCleared++;
            this.hitstopTimer = 0.04;
            this.trauma = Math.min(1, this.trauma + 0.45);
            this.audio.playExplosion();
            this.particles.spawnBurst(ast.mesh.position, 22, 65, 0xf59e0b, 1.9);
            this.setAlert(`ASTEROID FRACTURED — ORE CANISTER RELEASED`, 2.4);
          } else {
            this.audio.playImpact(false);
            const sparkColor = this.ship.pulseLaserMk2 ? 0xfbbf24 : 0x38bdf8;
            this.particles.spawnBurst(bolt.pos, 10, 48, sparkColor, 0.72);
          }
          break;
        }
      }
    }
  }

  private checkEnemyLaserHits(): void {
    for (const bolt of this.pirates.enemyBolts) {
      if (!bolt.active) continue;
      if (bolt.pos.distanceTo(this.ship.position) <= 9.5) {
        bolt.active = false;
        bolt.mesh.visible = false;
        this.handleHullImpact(bolt.damage, bolt.pos);
      }
    }
  }

  private checkProximityWarnings(dt: number): void {
    this.proximityBeepTimer = Math.max(0, this.proximityBeepTimer - dt);
    if (this.hyperspaceCountdown !== null || this.isDocked || this.autoDockActive) return;

    let nearestClearance = Infinity;
    let nearestClosing = 0;
    for (const ast of this.asteroids.asteroids) {
      if (ast.destroyed) continue;
      _toTarget.copy(ast.mesh.position).sub(this.ship.position);
      const dist = _toTarget.length();
      const clearance = dist - ast.radius - 5.5;
      if (clearance < nearestClearance) {
        nearestClearance = clearance;
        nearestClosing = dist > 0.01 ? this.ship.velocity.dot(_toTarget) / dist : 0;
      }
    }

    const bay = this.station.getDockingBayWorldTransform();
    this.ship.getForward(_fwd);
    const docking = evaluateDockingAlignment({
      shipPos: this.ship.position,
      shipForward: _fwd,
      shipSpeedMps: this.ship.velocity.length(),
      bayPos: bay.position,
      bayOutwardNormal: bay.outwardNormal,
    });

    const prox = evaluateProximityWarning({
      shipSpeedMps: this.ship.velocity.length(),
      nearestAsteroidClearanceM: nearestClearance,
      nearestAsteroidClosingMps: nearestClosing,
      stationDistanceM: this.ship.position.distanceTo(this.station.group.position),
      stationCollisionRadiusM: this.station.collisionRadius,
      docking,
    });

    if (prox.active && prox.message) {
      if (!this.alertMessage) {
        this.setAlert(prox.message, 0.9);
      }
      if (this.proximityBeepTimer <= 0) {
        this.proximityBeepTimer = prox.urgent ? 0.58 : 0.95;
        this.audio.playProximityWarning(prox.urgent);
      }
    }
  }

  private checkCollisionsAndPickups(): void {
    const shipRadius = 5.5;

    for (const can of this.asteroids.canisters) {
      if (can.collected) continue;
      if (this.ship.position.distanceTo(can.position) <= 26) {
        const isPirateCargo = can.bountyCredits <= 0;
        if (isPirateCargo && this.cargoUsed >= this.cargoCapacity) {
          if (!this.alertMessage) {
            this.setAlert(`CARGO HOLD FULL — CANNOT SCOOP ${can.name}`, 2.0);
          }
          continue;
        }
        can.collected = true;
        can.mesh.visible = false;
        this.audio.playPickup();
        this.particles.spawnBurst(
          can.position,
          10,
          26,
          isPirateCargo ? 0xf59e0b : 0x34d399,
          0.9
        );
        this.callbacks.onCanisterCollected(
          can.commodityId,
          can.units,
          can.bountyCredits,
          isPirateCargo
        );
        this.setAlert(
          isPirateCargo
            ? `SCOOPED ${can.units}t ${can.name.replace('CARGO POD: ', '')}`
            : `SCOOPED ${can.name} (+${can.bountyCredits.toFixed(1)} Cr)`,
          2.2
        );
      }
    }

    const bay = this.station.getDockingBayWorldTransform();
    this.ship.getForward(_fwd);
    const docking = evaluateDockingAlignment({
      shipPos: this.ship.position,
      shipForward: _fwd,
      shipSpeedMps: this.ship.velocity.length(),
      bayPos: bay.position,
      bayOutwardNormal: bay.outwardNormal,
    });

    if (docking.isInsideBay && (docking.isSpeedSafe || this.autoDockActive)) {
      this.enterDockingBay();
      return;
    }

    const distToStation = this.ship.position.distanceTo(this.station.group.position);
    if (
      !this.autoDockActive &&
      distToStation < this.station.collisionRadius &&
      !docking.isInsideBay &&
      !docking.isCorridorAligned
    ) {
      const pushDir = this.ship.position
        .clone()
        .sub(this.station.group.position)
        .normalize();
      this.ship.position.copy(this.station.group.position).addScaledVector(
        pushDir,
        this.station.collisionRadius + 4
      );
      const impactSpeed = this.ship.velocity.length();
      this.ship.velocity.reflect(pushDir).multiplyScalar(0.45);
      const dmg = computeCollisionDamage(impactSpeed, 1.1);
      if (dmg > 0) {
        this.handleHullImpact(dmg, this.ship.position);
      }
    }

    if (!this.autoDockActive) {
      for (const ast of this.asteroids.asteroids) {
        if (ast.destroyed) continue;
        const minSep = ast.radius + shipRadius;
        const dist = this.ship.position.distanceTo(ast.mesh.position);
        if (dist < minSep) {
          const push = this.ship.position
            .clone()
            .sub(ast.mesh.position)
            .normalize();
          this.ship.position.copy(ast.mesh.position).addScaledVector(push, minSep + 2);
          const impactSpeed = this.ship.velocity.length();
          this.ship.velocity.reflect(push).multiplyScalar(0.5);
          const dmg = computeCollisionDamage(impactSpeed, 1.0);
          if (dmg > 0) {
            this.handleHullImpact(dmg, this.ship.position);
          }
        }
      }
    }
  }

  private handleHullImpact(dmg: number, pos: THREE.Vector3): void {
    this.hitstopTimer = 0.045;
    this.trauma = Math.min(1, this.trauma + 0.58);
    this.audio.playImpact(true);
    const prevHull = this.ship.hull;
    const prevShield = this.ship.shield;
    const dead = this.ship.applyDamage(dmg);
    const shieldOnly = this.ship.hull === prevHull && this.ship.shield < prevShield;
    this.particles.spawnBurst(pos, 14, 48, shieldOnly ? 0x38bdf8 : 0xf87171, 1.2);
    this.setAlert(shieldOnly ? `SHIELD HIT -${dmg}` : `HULL IMPACT -${dmg}%`, 1.6);

    const damageAlert = evaluateShipDamageAlerts({
      prevShield,
      nextShield: this.ship.shield,
      nextHull: this.ship.hull,
      maxHull: this.ship.maxHull,
      hullCriticalAlreadyAnnounced: this.hullCriticalAnnounced,
    });
    this.hullCriticalAnnounced = damageAlert.nextHullCriticalAnnounced;
    if (damageAlert.spokenAlert) {
      this.computer.speak(damageAlert.spokenAlert);
    }

    if (dead) {
      this.triggerEscapePodEjection();
      return;
    }
    this.emitHudSnapshot();
  }

  private triggerEscapePodEjection(): void {
    this.keysHeld.clear();
    this.resetMouseFlightInput();
    this.autoDockActive = false;
    this.hullCriticalAnnounced = false;
    this.wasCruiseActive = false;
    this.pirates.reset();
    this.ship.restoreFullIntegrity();
    this.isDocked = true;
    this.audio.updateThruster(0, false, 0);
    this.audio.playEscapePod();
    this.setPhase('paused');
    this.callbacks.onEscapePodEjected();
    this.emitHudSnapshot();
  }

  private computeTargetAndRadar(): {
    target: TargetInfo | null;
    blips: RadarBlip[];
    waypoints: NavWaypointSummary[];
    hostileMarkers: ScreenHostileMarker[];
    docking: ReturnType<typeof evaluateDockingAlignment>;
  } {
    const bay = this.station.getDockingBayWorldTransform();
    this.ship.getForward(_fwd);
    this.ship.getRight(_right);
    this.ship.getUp(_up);

    const docking = evaluateDockingAlignment({
      shipPos: this.ship.position,
      shipForward: _fwd,
      shipSpeedMps: this.ship.velocity.length(),
      bayPos: bay.position,
      bayOutwardNormal: bay.outwardNormal,
    });

    const radarRange = 2200;
    const blips: RadarBlip[] = [];

    _toTarget.copy(this.station.group.position).sub(this.ship.position);
    blips.push(
      projectToRadarBlip({
        id: 'station-main',
        kind: 'station',
        worldOffset: _toTarget,
        shipRight: _right,
        shipUp: _up,
        shipForward: _fwd,
        radarRange,
      })
    );

    _toTarget.copy(bay.position).sub(this.ship.position);
    blips.push(
      projectToRadarBlip({
        id: 'station-bay',
        kind: 'bay',
        worldOffset: _toTarget,
        shipRight: _right,
        shipUp: _up,
        shipForward: _fwd,
        radarRange,
      })
    );

    _toTarget.copy(this.particles.getSunWorldPosition()).sub(this.ship.position);
    blips.push(
      projectToRadarBlip({
        id: 'local-star',
        kind: 'star',
        worldOffset: _toTarget,
        shipRight: _right,
        shipUp: _up,
        shipForward: _fwd,
        radarRange: 45000,
      })
    );

    for (const p of this.systemLayout.planets) {
      _toTarget.set(
        p.position.x - this.ship.position.x,
        p.position.y - this.ship.position.y,
        p.position.z - this.ship.position.z
      );
      blips.push(
        projectToRadarBlip({
          id: p.id,
          kind: 'planet',
          worldOffset: _toTarget,
          shipRight: _right,
          shipUp: _up,
          shipForward: _fwd,
          radarRange: 45000,
        })
      );
    }

    for (const c of this.systemLayout.asteroidClusters) {
      _toTarget.set(
        c.position.x - this.ship.position.x,
        c.position.y - this.ship.position.y,
        c.position.z - this.ship.position.z
      );
      blips.push(
        projectToRadarBlip({
          id: c.id,
          kind: 'asteroid_belt',
          worldOffset: _toTarget,
          shipRight: _right,
          shipUp: _up,
          shipForward: _fwd,
          radarRange: 45000,
        })
      );
    }

    for (let i = 0; i < this.planetSystem.shuttles.length; i++) {
      const sh = this.planetSystem.shuttles[i];
      _toTarget.copy(sh.group.position).sub(this.ship.position);
      if (_toTarget.length() <= 3400) {
        blips.push(
          projectToRadarBlip({
            id: `shuttle-${i}`,
            kind: 'shuttle',
            worldOffset: _toTarget,
            shipRight: _right,
            shipUp: _up,
            shipForward: _fwd,
            radarRange,
          })
        );
      }
    }

    for (const ast of this.asteroids.asteroids) {
      if (ast.destroyed) continue;
      _toTarget.copy(ast.mesh.position).sub(this.ship.position);
      if (_toTarget.length() <= 2400) {
        blips.push(
          projectToRadarBlip({
            id: ast.id,
            kind: 'asteroid',
            worldOffset: _toTarget,
            shipRight: _right,
            shipUp: _up,
            shipForward: _fwd,
            radarRange,
          })
        );
      }
    }

    for (const can of this.asteroids.canisters) {
      if (can.collected) continue;
      _toTarget.copy(can.position).sub(this.ship.position);
      if (_toTarget.length() <= 1600) {
        blips.push(
          projectToRadarBlip({
            id: can.id,
            kind: 'canister',
            worldOffset: _toTarget,
            shipRight: _right,
            shipUp: _up,
            shipForward: _fwd,
            radarRange,
          })
        );
      }
    }

    const hostileMarkers: ScreenHostileMarker[] = [];
    for (const p of this.pirates.pirates) {
      if (p.destroyed) continue;
      _toTarget.copy(p.position).sub(this.ship.position);
      const dist = _toTarget.length();
      if (dist <= 4000) {
        blips.push(
          projectToRadarBlip({
            id: p.id,
            kind: 'pirate',
            worldOffset: _toTarget,
            shipRight: _right,
            shipUp: _up,
            shipForward: _fwd,
            radarRange: 3200,
          })
        );
      }

      _proj.copy(p.position).project(this.camera);
      if (_proj.z <= 1 && Math.abs(_proj.x) <= 0.96 && Math.abs(_proj.y) <= 0.94) {
        hostileMarkers.push({
          id: p.id,
          name: p.name,
          distanceMeters: dist,
          screenX: (_proj.x * 0.5 + 0.5) * 100,
          screenY: (-_proj.y * 0.5 + 0.5) * 100,
          hullPct: Math.round((p.hull / p.maxHull) * 100),
          shieldPct: Math.round((p.shield / p.maxShield) * 100),
          isLocked: p.id === this.lockedWaypointId,
        });
      }
    }

    // Build Waypoint list & lock onto active waypoint
    const waypointSpecs = this.getWaypointOrder();
    const waypoints: NavWaypointSummary[] = waypointSpecs.map((wp) => {
      const dist = Math.hypot(
        wp.pos.x - this.ship.position.x,
        wp.pos.y - this.ship.position.y,
        wp.pos.z - this.ship.position.z
      );
      return {
        id: wp.id,
        name: wp.name,
        kind: wp.wpKind,
        distanceMeters: dist,
        subtitle: wp.subtitle,
      };
    });

    const activeSpec =
      waypointSpecs.find((w) => w.id === this.lockedWaypointId) ?? waypointSpecs[0];
    if (activeSpec) {
      this.lockedWaypointId = activeSpec.id;
    }

    let target: TargetInfo | null = null;
    if (activeSpec) {
      _toTarget.set(
        activeSpec.pos.x - this.ship.position.x,
        activeSpec.pos.y - this.ship.position.y,
        activeSpec.pos.z - this.ship.position.z
      );
      const dist = _toTarget.length();
      _proj.set(activeSpec.pos.x, activeSpec.pos.y, activeSpec.pos.z).project(this.camera);
      const indicator = projectTargetIndicator({
        worldOffset: _toTarget,
        shipRight: _right,
        shipUp: _up,
        shipForward: _fwd,
        ndcX: _proj.x,
        ndcY: _proj.y,
        ndcZ: _proj.z,
      });

      target = {
        id: activeSpec.id,
        name: activeSpec.name,
        kind: activeSpec.kind,
        distanceMeters: dist,
        bearingDot: indicator.bearingDot,
        screenX: indicator.screenX,
        screenY: indicator.screenY,
        edgeX: indicator.edgeX,
        edgeY: indicator.edgeY,
        edgeAngleDeg: indicator.edgeAngleDeg,
        onScreen: indicator.onScreen,
      };

      if (activeSpec.kind === 'pirate') {
        const lockedPirate = this.pirates.pirates.find(
          (p) => p.id === activeSpec.id && !p.destroyed
        );
        if (lockedPirate) {
          target.hullPct = Math.round((lockedPirate.hull / lockedPirate.maxHull) * 100);
          target.shieldPct = Math.round((lockedPirate.shield / lockedPirate.maxShield) * 100);
          target.bountyCr = lockedPirate.bountyCr;

          const leadWorld = computeLeadInterceptPoint({
            shooterPos: this.ship.position,
            targetPos: lockedPirate.position,
            targetVel: lockedPirate.velocity,
            projectileSpeedMps: this.ship.getLaserSpeed(),
          });
          _proj.set(leadWorld.x, leadWorld.y, leadWorld.z).project(this.camera);
          target.leadOnScreen =
            _proj.z <= 1 && Math.abs(_proj.x) <= 0.96 && Math.abs(_proj.y) <= 0.94;
          target.leadScreenX = (_proj.x * 0.5 + 0.5) * 100;
          target.leadScreenY = (-_proj.y * 0.5 + 0.5) * 100;
        }
      }
    }

    return { target, blips, waypoints, hostileMarkers, docking };
  }

  private emitHudSnapshot(): void {
    const { target, blips, waypoints, hostileMarkers, docking } = this.computeTargetAndRadar();
    if (this.phase === 'playing') {
      this.radar.render(blips, target?.id ?? null);
    }

    const stationDist = this.ship.position.distanceTo(this.station.group.position);
    const canAutoDock =
      this.phase === 'playing' &&
      !this.isDocked &&
      stationDist <= AUTO_DOCK_MAX_RANGE_M &&
      this.hyperspaceCountdown === null;

    const massLock = evaluateMassLock(this.ship.position, this.getMassLockBodies());
    const canEngageCruise =
      this.phase === 'playing' &&
      !this.isDocked &&
      this.hyperspaceCountdown === null &&
      !massLock.locked;

    const jumpCheck = this.selectedJumpSystem
      ? canJumpToSystem(this.currentSystem, this.selectedJumpSystem, this.fuel, this.maxFuel)
      : null;

    const mouseSteer = this.mouseSteerEnabled
      ? computeMouseSteerAxes(this.mouseOffsetX, this.mouseOffsetY)
      : null;
    const gimbalTarget = this.getLockedPirateLeadTarget();

    this.callbacks.onHudUpdate({
      phase: this.phase,
      isDocked: this.isDocked,
      speedMps: this.ship.velocity.length(),
      maxSpeedMps: this.ship.maxSpeedMps,
      throttle: this.ship.throttle,
      cruiseActive: this.ship.cruiseActive,
      canEngageCruise,
      massLockBodyName: massLock.blockingBodyName,
      hull: this.ship.hull,
      maxHull: this.ship.maxHull,
      shield: this.ship.shield,
      maxShield: this.ship.maxShield,
      weaponHeat: this.ship.weaponHeat,
      credits: this.credits,
      cargoUsed: this.cargoUsed,
      cargoCapacity: this.cargoCapacity,
      fuel: this.fuel,
      maxFuel: this.maxFuel,
      currentSystemId: this.currentSystem.id,
      currentSystemName: this.currentSystem.name,
      currentSystemEconomy: this.currentSystem.economy,
      currentSystemSecurity: this.currentSystem.securityLevel,
      selectedJumpSystemName: this.selectedJumpSystem?.name ?? null,
      selectedJumpDistanceLY: jumpCheck ? jumpCheck.distance : null,
      canJumpSelected: Boolean(jumpCheck?.ok),
      autoDockActive: this.autoDockActive,
      canAutoDock,
      hyperspaceCountdown: this.hyperspaceCountdown,
      hyperspaceFlash: this.hyperspaceFlash,
      isScoopingFuel: this.isScoopingFuel,
      sunDistanceMeters: this.sunDistanceMeters,
      upgrades: { ...this.upgrades },
      asteroidsCleared: this.asteroidsCleared,
      pirateKills: this.pirateKills,
      combatRank: getCombatRankProgress(this.pirateKills).rank,
      activePirateCount: this.pirates.getActiveCount(),
      hostileMarkers,
      distanceFlownKm: this.ship.distanceFlownKm,
      invertPitch: this.ship.invertPitch,
      mouseSteerEnabled: this.mouseSteerEnabled,
      mouseSteerActive: Boolean(mouseSteer && !mouseSteer.inDeadzone),
      gimbalLocked: Boolean(gimbalTarget?.gimbalLocked),
      cameraMode: this.cameraMode,
      muted: this.audio.isMuted(),
      volume: this.audio.getVolume(),
      voiceEnabled: this.computer.isEnabled(),
      target,
      waypoints,
      lockedWaypointId: this.lockedWaypointId,
      docking,
      alertMessage: this.alertMessage,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupListeners();
    this.computer.stop();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
