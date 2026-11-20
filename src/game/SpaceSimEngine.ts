import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AsteroidField } from './AsteroidField';
import { AudioEngine } from './AudioEngine';
import {
  AUTO_DOCK_MAX_RANGE_M,
  computeCollisionDamage,
  evaluateDockingAlignment,
  projectToRadarBlip,
} from './flightMath';
import { canJumpToSystem, MAX_JUMP_RANGE_LY } from './galaxy';
import { detectSoftwareGl } from './LowPolyHelpers';
import { ParticleField } from './ParticleField';
import { RadarHUD } from './RadarHUD';
import { type FlightInputState, ShipController } from './ShipController';
import { Station } from './Station';
import type {
  CameraMode,
  GamePhase,
  HudSnapshot,
  RadarBlip,
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
  onCanisterCollected: (commodityId: 'palladium' | 'titanium' | 'platinum') => void;
  onPhaseChange: (phase: GamePhase) => void;
  onToggleStarMap: () => void;
  onHyperspaceComplete: (destination: StarSystem, fuelUsedLY: number) => void;
}

export class SpaceSimEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: SpaceSimCallbacks;
  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly station: Station;
  private readonly ship: ShipController;
  private readonly asteroids: AsteroidField;
  private readonly particles: ParticleField;
  private readonly radar = new RadarHUD();
  public readonly audio = new AudioEngine();

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
  private selectedJumpSystem: StarSystem | null = null;

  private autoDockActive = false;
  private hyperspaceCountdown: number | null = null;
  private hyperspaceFlash = 0;
  private asteroidsCleared = 0;

  private alertMessage: string | null = null;
  private alertTimer = 0;
  private hitstopTimer = 0;
  private trauma = 0;
  private titleOrbitAngle = 0.45;
  private hudEmitAccum = 0;

  private frameId = 0;
  private lastTime = 0;
  private disposed = false;

  private readonly keysHeld = new Set<string>();
  private zeroThrottleQueued = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    initialSystem: StarSystem,
    callbacks: SpaceSimCallbacks
  ) {
    this.container = container;
    this.currentSystem = initialSystem;
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
    this.scene.fog = new THREE.FogExp2(0x090d16, 0.00048);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(66, width / height, 0.25, 4800);

    this.station = new Station(new THREE.Vector3(0, 0, -680));
    this.station.name = `${initialSystem.name.toUpperCase()} ORBITAL // CORIOLIS HUB`;
    this.scene.add(this.station.group);

    this.ship = new ShipController(this.scene);
    this.scene.add(this.ship.cockpitRig);
    this.ship.reset();

    this.asteroids = new AsteroidField(this.station.group.position);
    this.scene.add(this.asteroids.group);

    this.particles = new ParticleField(this.scene, this.isSoftwareGl);
    this.particles.setSunAppearance(
      initialSystem.sunColorHex,
      initialSystem.sunCoronaHex,
      initialSystem.sunLightHex
    );

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.attachInputListeners();
    this.lastTime = performance.now();
    this.scheduleNextTick();
  }

  public attachRadarCanvas(canvas: HTMLCanvasElement | null): void {
    this.radar.attachCanvas(canvas);
  }

  public setStarMapOpen(open: boolean): void {
    this.starMapOpen = open;
    if (open) {
      this.keysHeld.clear();
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
    system: StarSystem;
  }): void {
    this.credits = meta.credits;
    this.cargoUsed = meta.cargoUsed;
    this.cargoCapacity = meta.cargoCapacity;
    this.fuel = meta.fuel;
    this.maxFuel = meta.maxFuel;
    this.ship.hull = meta.hull;
    this.currentSystem = meta.system;
    this.station.name = `${meta.system.name.toUpperCase()} ORBITAL // CORIOLIS HUB`;
    this.emitHudSnapshot();
  }

  public setInvertPitch(invert: boolean): void {
    this.ship.invertPitch = invert;
    this.emitHudSnapshot();
  }

  public toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'cockpit' ? 'chase' : 'cockpit';
    this.emitHudSnapshot();
  }

  public toggleMute(): void {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.isMuted());
    this.emitHudSnapshot();
  }

  public toggleAutoDock(): void {
    if (this.phase !== 'playing' || this.isDocked || this.hyperspaceCountdown !== null) return;
    this.audio.unlock();
    const dist = this.ship.position.distanceTo(this.station.group.position);
    if (dist > AUTO_DOCK_MAX_RANGE_M) {
      this.setAlert('AUTO-DOCK UNAVAILABLE BEYOND 2.0 KM', 2.2);
      return;
    }
    this.autoDockActive = !this.autoDockActive;
    if (this.autoDockActive) {
      this.audio.playAutoDock();
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
    this.isDocked = false;
    this.starMapOpen = false;
    this.autoDockActive = false;
    this.setPhase('playing');
    this.emitHudSnapshot();
  }

  public pause(): void {
    if (this.phase !== 'playing') return;
    this.keysHeld.clear();
    this.autoDockActive = false;
    this.audio.updateThruster(0, false);
    this.setPhase('paused');
    this.emitHudSnapshot();
  }

  public resume(): void {
    if (this.phase !== 'paused') return;
    this.audio.unlock();
    this.keysHeld.clear();
    this.isDocked = false;
    this.setPhase('playing');
    this.emitHudSnapshot();
  }

  public undock(): void {
    this.audio.unlock();
    this.keysHeld.clear();
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
    this.isDocked = false;
    this.starMapOpen = false;
    this.autoDockActive = false;
    this.hyperspaceCountdown = null;
    this.hyperspaceFlash = 0;
    this.asteroidsCleared = 0;
    this.trauma = 0;
    this.hitstopTimer = 0;
    this.currentSystem = initialSystem;
    this.selectedJumpSystem = null;
    this.station.name = `${initialSystem.name.toUpperCase()} ORBITAL // CORIOLIS HUB`;
    this.particles.setSunAppearance(
      initialSystem.sunColorHex,
      initialSystem.sunCoronaHex,
      initialSystem.sunLightHex
    );
    this.ship.reset();
    this.asteroids.reset(this.station.group.position, initialSystem.index);
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
    this.keysHeld.clear();
    this.ship.velocity.set(0, 0, 0);
    this.ship.throttle = 0;
    this.audio.updateThruster(0, false);
    this.audio.playDock();
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
    this.audio.playHyperspaceBoom();
    this.currentSystem = dest;
    this.selectedJumpSystem = null;
    this.fuel = Math.max(0, Math.round((this.fuel - check.distance) * 10) / 10);

    // Update new system environment, sun, station designation, asteroids, and arrival pose
    this.station.name = `${dest.name.toUpperCase()} ORBITAL // CORIOLIS HUB`;
    this.particles.setSunAppearance(dest.sunColorHex, dest.sunCoronaHex, dest.sunLightHex);
    this.asteroids.reset(this.station.group.position, dest.index);

    this.ship.position.set(0, 0, 140);
    this.ship.quaternion.identity();
    this.ship.throttle = 0.22;
    this.ship.velocity.set(0, 0, -52);

    this.callbacks.onHyperspaceComplete(dest, check.distance);
    this.setAlert(`ARRIVED IN ${dest.name.toUpperCase()} (${dest.economy.toUpperCase()})`, 3.2);
    this.emitHudSnapshot();
  }

  private setPhase(next: GamePhase): void {
    this.phase = next;
    document.body.dataset.state = next;
    this.callbacks.onPhaseChange(next);
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
      if (e.code === 'KeyV' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.toggleCameraMode();
      }
      if (e.code === 'KeyF' && !e.repeat && this.phase === 'playing' && !this.starMapOpen) {
        this.triggerManualDockIfReady();
      }
      if (e.code === 'KeyI' && !e.repeat && (this.phase === 'playing' || this.phase === 'title')) {
        this.setInvertPitch(!this.ship.invertPitch);
      }
      if (e.code === 'KeyN' && !e.repeat) {
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

    const onBlur = () => {
      this.keysHeld.clear();
    };

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
        throttleUp: false,
        throttleDown: false,
        fireHeld: false,
        zeroThrottleJustPressed: false,
      };
    }
    const input: FlightInputState = {
      pitchDown: this.keysHeld.has('KeyW'),
      pitchUp: this.keysHeld.has('KeyS'),
      rollLeft: this.keysHeld.has('KeyA'),
      rollRight: this.keysHeld.has('KeyD'),
      yawLeft: this.keysHeld.has('KeyQ'),
      yawRight: this.keysHeld.has('KeyE'),
      throttleUp:
        this.keysHeld.has('ShiftLeft') ||
        this.keysHeld.has('ShiftRight') ||
        this.keysHeld.has('ArrowUp'),
      throttleDown:
        this.keysHeld.has('ControlLeft') ||
        this.keysHeld.has('ControlRight') ||
        this.keysHeld.has('ArrowDown'),
      fireHeld: this.keysHeld.has('Space'),
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
      this.titleOrbitAngle += dt * 0.14;
      const stPos = this.station.group.position;
      const orbitR = 395;
      this.camera.position.set(
        stPos.x + Math.sin(this.titleOrbitAngle) * orbitR,
        stPos.y + 92 + Math.sin(this.titleOrbitAngle * 0.6) * 28,
        stPos.z + Math.cos(this.titleOrbitAngle) * orbitR
      );
      this.camera.lookAt(stPos.x - 75, stPos.y + 8, stPos.z);
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
      this.audio.updateThruster(this.ship.throttle, true);
      this.asteroids.update(dt);
      this.checkCollisionsAndPickups();
    } else {
      const input = this.readFlightInput();
      this.ship.update(dt, input, this.camera, this.cameraMode, () => {
        this.audio.playLaser();
      });
      this.audio.updateThruster(Math.abs(this.ship.throttle), true);
      this.asteroids.update(dt);
      this.checkLaserHits();
      this.checkCollisionsAndPickups();
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - 1.8 * dt);
      const shake = this.trauma * this.trauma * 0.045;
      this.camera.rotateX((Math.random() * 2 - 1) * shake);
      this.camera.rotateY((Math.random() * 2 - 1) * shake);
      this.camera.rotateZ((Math.random() * 2 - 1) * shake * 1.4);
    }

    this.ship.getForward(_fwd);
    this.particles.update(dt, this.ship.position, this.ship.velocity, _fwd, warpBoost);

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.08 || this.hyperspaceFlash > 0 || this.hyperspaceCountdown !== null) {
      this.hudEmitAccum = 0;
      this.emitHudSnapshot();
    }
  }

  private checkLaserHits(): void {
    for (const bolt of this.ship.laserPool) {
      if (!bolt.active) continue;
      for (const ast of this.asteroids.asteroids) {
        if (ast.destroyed) continue;
        const dist = bolt.pos.distanceTo(ast.mesh.position);
        if (dist <= ast.radius + 4.5) {
          bolt.active = false;
          bolt.mesh.visible = false;
          const destroyed = this.asteroids.damageAsteroid(ast, 14);
          if (destroyed) {
            this.asteroidsCleared++;
            this.hitstopTimer = 0.04;
            this.trauma = Math.min(1, this.trauma + 0.45);
            this.audio.playExplosion();
            this.particles.spawnBurst(ast.mesh.position, 22, 65, 0xf59e0b, 1.9);
            this.setAlert(`ASTEROID FRACTURED — ORE CANISTER RELEASED`, 2.4);
          } else {
            this.audio.playImpact(false);
            this.particles.spawnBurst(bolt.pos, 6, 36, 0x38bdf8, 0.8);
          }
          break;
        }
      }
    }
  }

  private checkCollisionsAndPickups(): void {
    const shipRadius = 5.5;

    for (const can of this.asteroids.canisters) {
      if (can.collected) continue;
      if (this.ship.position.distanceTo(can.position) <= 26) {
        can.collected = true;
        can.mesh.visible = false;
        this.audio.playPickup();
        this.particles.spawnBurst(can.position, 10, 26, 0x34d399, 0.9);
        this.callbacks.onCanisterCollected(can.commodityId);
        this.setAlert(`SCOOPED ${can.name} (+12.0 Cr)`, 2.2);
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
    this.hitstopTimer = 0.05;
    this.trauma = Math.min(1, this.trauma + 0.65);
    this.audio.playImpact(true);
    this.particles.spawnBurst(pos, 14, 48, 0xf87171, 1.2);
    const dead = this.ship.applyDamage(dmg);
    this.setAlert(`HULL IMPACT -${dmg}%`, 1.8);
    if (dead) {
      this.keysHeld.clear();
      this.audio.updateThruster(0, false);
      this.audio.playExplosion();
      this.setPhase('gameover');
    }
    this.emitHudSnapshot();
  }

  private computeTargetAndRadar(): {
    target: TargetInfo | null;
    blips: RadarBlip[];
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

    const radarRange = 920;
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

    let bestTarget: TargetInfo | null = null;
    let bestScore = Infinity;

    const evaluateCandidate = (
      id: string,
      name: string,
      kind: TargetInfo['kind'],
      worldPos: THREE.Vector3
    ) => {
      _toTarget.copy(worldPos).sub(this.ship.position);
      const dist = _toTarget.length();
      const dirDot = dist > 0.01 ? _toTarget.dot(_fwd) / dist : 1;

      _proj.copy(worldPos).project(this.camera);
      const onScreen =
        _proj.z >= -1 && _proj.z <= 1 && Math.abs(_proj.x) <= 0.96 && Math.abs(_proj.y) <= 0.96;

      const anglePenalty = (1 - Math.max(0, dirDot)) * 450;
      const score = dist + anglePenalty + (kind === 'station' || kind === 'bay' ? 60 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestTarget = {
          id,
          name,
          kind,
          distanceMeters: dist,
          bearingDot: dirDot,
          screenX: (_proj.x * 0.5 + 0.5) * 100,
          screenY: (-_proj.y * 0.5 + 0.5) * 100,
          onScreen,
        };
      }
    };

    evaluateCandidate('station-bay', this.station.name, 'bay', bay.position);

    for (const ast of this.asteroids.asteroids) {
      if (ast.destroyed) continue;
      _toTarget.copy(ast.mesh.position).sub(this.ship.position);
      if (_toTarget.length() <= 1300) {
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
      if (_toTarget.length() <= 680) {
        evaluateCandidate(ast.id, ast.name, 'asteroid', ast.mesh.position);
      }
    }

    for (const can of this.asteroids.canisters) {
      if (can.collected) continue;
      _toTarget.copy(can.position).sub(this.ship.position);
      if (_toTarget.length() <= 1000) {
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
        evaluateCandidate(can.id, can.name, 'canister', can.position);
      }
    }

    return { target: bestTarget, blips, docking };
  }

  private emitHudSnapshot(): void {
    const { target, blips, docking } = this.computeTargetAndRadar();
    if (this.phase === 'playing') {
      this.radar.render(blips, target?.id ?? null);
    }

    const stationDist = this.ship.position.distanceTo(this.station.group.position);
    const canAutoDock =
      this.phase === 'playing' &&
      !this.isDocked &&
      stationDist <= AUTO_DOCK_MAX_RANGE_M &&
      this.hyperspaceCountdown === null;

    const jumpCheck = this.selectedJumpSystem
      ? canJumpToSystem(this.currentSystem, this.selectedJumpSystem, this.fuel, this.maxFuel)
      : null;

    this.callbacks.onHudUpdate({
      phase: this.phase,
      isDocked: this.isDocked,
      speedMps: this.ship.velocity.length(),
      maxSpeedMps: this.ship.maxSpeedMps,
      throttle: this.ship.throttle,
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
      selectedJumpSystemName: this.selectedJumpSystem?.name ?? null,
      selectedJumpDistanceLY: jumpCheck ? jumpCheck.distance : null,
      canJumpSelected: Boolean(jumpCheck?.ok),
      autoDockActive: this.autoDockActive,
      canAutoDock,
      hyperspaceCountdown: this.hyperspaceCountdown,
      hyperspaceFlash: this.hyperspaceFlash,
      asteroidsCleared: this.asteroidsCleared,
      distanceFlownKm: this.ship.distanceFlownKm,
      invertPitch: this.ship.invertPitch,
      cameraMode: this.cameraMode,
      muted: this.audio.isMuted(),
      target,
      docking,
      alertMessage: this.alertMessage,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupListeners();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
