import * as THREE from 'three';
import { computeGimbalAimDirection } from './combat';
import {
  BASE_MAX_SPEED_MPS,
  computePitchSign,
  CRUISE_MAX_SPEED_MPS,
  dampScalar,
  stepThrottle,
  THROTTLE_MAX,
  THROTTLE_MIN,
} from './flightMath';
import { attachFacetOutlines, createFlatMaterial } from './LowPolyHelpers';
import type { CameraMode, ShipUpgrades } from './types';

export interface LaserBolt {
  active: boolean;
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export interface FlightInputState {
  pitchUp: boolean;
  pitchDown: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  yawLeft: boolean;
  yawRight: boolean;
  mousePitch: number;
  mouseYaw: number;
  throttleUp: boolean;
  throttleDown: boolean;
  fireHeld: boolean;
  zeroThrottleJustPressed: boolean;
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _desiredVel = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _lookPoint = new THREE.Vector3();
const _lookMat = new THREE.Matrix4();
const _rotQuat = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

const BOLT_POOL_SIZE = 32;
const BOLT_SPEED = 720;
const BOLT_LIFETIME = 1.45;
const FIRE_COOLDOWN = 0.16;

export class ShipController {
  public readonly shipGroup = new THREE.Group();
  public readonly cockpitRig = new THREE.Group();
  public readonly laserPool: LaserBolt[] = [];

  public readonly position = new THREE.Vector3(0, 0, 80);
  public readonly quaternion = new THREE.Quaternion();
  public readonly velocity = new THREE.Vector3();
  public readonly maxSpeedMps = BASE_MAX_SPEED_MPS;

  public throttle = 0.18;
  public cruiseActive = false;
  public cruiseBlend = 0; // 0..1 smooth speed & audio/VFX ramp
  public invertPitch = false;
  public hull = 100;
  public maxHull = 100;
  public shield = 100;
  public maxShield = 100;
  public weaponHeat = 0;
  public distanceFlownKm = 0;
  public pulseLaserMk2 = false;
  public shieldBooster = false;

  // Angular rates (rad/s) in ship local space
  private pitchRate = 0;
  private yawRate = 0;
  private rollRate = 0;

  // Camera & cockpit sway state
  private swayRoll = 0;
  private swayPitch = 0;
  private swayYaw = 0;
  private recoilZ = 0;
  private fireCooldownTimer = 0;
  private muzzleFlashTimer = 0;
  private shieldRegenDelay = 0;

  private readonly shipModel: THREE.Group;
  private readonly thrusterFlames: THREE.Mesh[] = [];
  private readonly pylonMat: THREE.MeshStandardMaterial;
  private readonly cockpitPylonLeft: THREE.Mesh;
  private readonly cockpitPylonRight: THREE.Mesh;
  private readonly muzzleFlashLeft: THREE.Group;
  private readonly muzzleFlashRight: THREE.Group;
  private readonly externalMuzzleLeft: THREE.Mesh;
  private readonly externalMuzzleRight: THREE.Mesh;
  private readonly muzzleLight: THREE.PointLight;
  private readonly boltCoreMat: THREE.MeshBasicMaterial;
  private readonly boltGlowMat: THREE.MeshBasicMaterial;
  private readonly flashMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    const extFlashMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flashMat = extFlashMat;
    const extFlashGeo = new THREE.OctahedronGeometry(0.45, 0);
    this.externalMuzzleLeft = new THREE.Mesh(extFlashGeo, extFlashMat);
    this.externalMuzzleLeft.position.set(-1.4, -0.25, -4.3);
    this.externalMuzzleLeft.visible = false;
    this.externalMuzzleRight = new THREE.Mesh(extFlashGeo, extFlashMat);
    this.externalMuzzleRight.position.set(1.4, -0.25, -4.3);
    this.externalMuzzleRight.visible = false;

    this.shipModel = this.buildCompositeStarfighter();
    this.shipModel.add(this.externalMuzzleLeft);
    this.shipModel.add(this.externalMuzzleRight);
    this.shipGroup.add(this.shipModel);
    this.shipGroup.position.copy(this.position);
    scene.add(this.shipGroup);

    // Cockpit foreground frame + nose weapon pylons (visible in Cockpit Cam)
    const frameMat = createFlatMaterial(0x1e293b, { roughness: 0.5, metalness: 0.6 });
    this.pylonMat = createFlatMaterial(0x475569, {
      roughness: 0.4,
      metalness: 0.6,
      emissive: 0x000000,
      emissiveIntensity: 1,
    });

    // Subtle outer corner canopy struts (never obstruct center 85% viewport)
    const leftStrut = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.35, 0.055), frameMat);
    leftStrut.position.set(-1.32, 0.2, -1.15);
    leftStrut.rotation.set(0.28, 0.1, -0.34);
    attachFacetOutlines(leftStrut, 0x050811, 15, 0.8);
    this.cockpitRig.add(leftStrut);

    const rightStrut = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.35, 0.055), frameMat);
    rightStrut.position.set(1.32, 0.2, -1.15);
    rightStrut.rotation.set(0.28, -0.1, 0.34);
    attachFacetOutlines(rightStrut, 0x050811, 15, 0.8);
    this.cockpitRig.add(rightStrut);

    const topCrossbar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.045, 0.055), frameMat);
    topCrossbar.position.set(0, 0.92, -1.0);
    attachFacetOutlines(topCrossbar, 0x050811, 15, 0.8);
    this.cockpitRig.add(topCrossbar);

    // Lower-corner nose laser barrels that kick back and illuminate on firing
    const barrelGeo = new THREE.CylinderGeometry(0.045, 0.07, 1.3, 6);
    barrelGeo.rotateX(Math.PI / 2);

    this.cockpitPylonLeft = new THREE.Mesh(barrelGeo, this.pylonMat);
    this.cockpitPylonLeft.position.set(-0.92, -0.58, -1.55);
    this.cockpitPylonLeft.rotation.y = -0.05;
    attachFacetOutlines(this.cockpitPylonLeft, 0x050811, 15, 0.85);
    this.cockpitRig.add(this.cockpitPylonLeft);

    this.cockpitPylonRight = new THREE.Mesh(barrelGeo, this.pylonMat);
    this.cockpitPylonRight.position.set(0.92, -0.58, -1.55);
    this.cockpitPylonRight.rotation.y = 0.05;
    attachFacetOutlines(this.cockpitPylonRight, 0x050811, 15, 0.85);
    this.cockpitRig.add(this.cockpitPylonRight);

    const buildMuzzleStar = (): THREE.Group => {
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.15, 0),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      const flareGeo = new THREE.OctahedronGeometry(0.36, 0);
      const flareH = new THREE.Mesh(flareGeo, this.flashMat);
      flareH.scale.set(1.45, 0.22, 0.22);
      const flareV = new THREE.Mesh(flareGeo, this.flashMat);
      flareV.scale.set(0.22, 1.35, 0.22);
      g.add(core, flareH, flareV);
      return g;
    };

    this.muzzleFlashLeft = buildMuzzleStar();
    this.muzzleFlashLeft.position.set(-0.88, -0.57, -2.25);
    this.muzzleFlashLeft.visible = false;
    this.cockpitRig.add(this.muzzleFlashLeft);

    this.muzzleFlashRight = buildMuzzleStar();
    this.muzzleFlashRight.position.set(0.88, -0.57, -2.25);
    this.muzzleFlashRight.visible = false;
    this.cockpitRig.add(this.muzzleFlashRight);

    this.muzzleLight = new THREE.PointLight(0x38bdf8, 0, 18);
    this.muzzleLight.position.set(0, -0.35, -2.15);
    this.cockpitRig.add(this.muzzleLight);

    // Pre-allocate dual glowing emissive laser bolt pool (white-hot core + additive glow sheath)
    const coreGeo = new THREE.BoxGeometry(0.18, 0.18, 9.0);
    const glowGeo = new THREE.BoxGeometry(0.56, 0.56, 9.8);
    this.boltCoreMat = new THREE.MeshBasicMaterial({
      color: 0xf0f9ff,
    });
    this.boltGlowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < BOLT_POOL_SIZE; i++) {
      const boltGroup = new THREE.Group();
      const coreMesh = new THREE.Mesh(coreGeo, this.boltCoreMat);
      const glowMesh = new THREE.Mesh(glowGeo, this.boltGlowMat);
      boltGroup.add(coreMesh, glowMesh);
      boltGroup.visible = false;
      scene.add(boltGroup);
      this.laserPool.push({
        active: false,
        mesh: boltGroup,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
      });
    }
  }

  private buildCompositeStarfighter(): THREE.Group {
    const group = new THREE.Group();

    const fuselageMat = createFlatMaterial(0xcbd5e1, { roughness: 0.45, metalness: 0.45 });
    const wingMat = createFlatMaterial(0x475569, { roughness: 0.65, metalness: 0.35 });
    const trimMat = createFlatMaterial(0xf59e0b, { roughness: 0.4, metalness: 0.3 });
    const canopyMat = createFlatMaterial(0x0ea5e9, {
      roughness: 0.15,
      metalness: 0.85,
      emissive: 0x0369a1,
      emissiveIntensity: 0.35,
    });
    const nozzleMat = createFlatMaterial(0x1e293b, { roughness: 0.5, metalness: 0.7 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

    // 1. Central Wedge Fuselage
    const hullGeo = new THREE.ConeGeometry(2.1, 11.5, 4);
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.rotateZ(Math.PI / 4);
    hullGeo.scale(1.35, 0.55, 1.0);
    const hullMesh = new THREE.Mesh(hullGeo, fuselageMat);
    hullMesh.castShadow = true;
    attachFacetOutlines(hullMesh, 0x050811, 15, 0.85);
    group.add(hullMesh);

    // 2. Swept Delta Wings (Left & Right)
    [-1, 1].forEach((side) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.35, 4.4), wingMat);
      wing.position.set(side * 3.4, -0.1, 2.2);
      wing.rotation.y = side * -0.34;
      wing.rotation.z = side * -0.06;
      wing.castShadow = true;
      attachFacetOutlines(wing, 0x050811, 15, 0.85);
      group.add(wing);

      // Wingtip stabilizer fins + amber accent stripe
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.6, 2.6), trimMat);
      fin.position.set(side * 5.7, 0.55, 2.8);
      fin.rotation.z = side * -0.18;
      attachFacetOutlines(fin, 0x050811, 15, 0.85);
      group.add(fin);

      // Twin Nose Laser Cannons
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.2, 6), nozzleMat);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(side * 1.4, -0.25, -2.5);
      attachFacetOutlines(cannon, 0x050811, 15, 0.8);
      group.add(cannon);

      // Rear Thruster Nozzle + Dynamic Plasma Plume
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 1.6, 6), nozzleMat);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * 1.1, 0, 5.2);
      attachFacetOutlines(nozzle, 0x050811, 15, 0.8);
      group.add(nozzle);

      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 6), flameMat);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(side * 1.1, 0, 6.8);
      this.thrusterFlames.push(flame);
      group.add(flame);
    });

    // 3. Dorsal Cockpit Canopy
    const canopy = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), canopyMat);
    canopy.scale.set(0.85, 0.55, 1.9);
    canopy.position.set(0, 0.65, -0.4);
    attachFacetOutlines(canopy, 0x050811, 15, 0.85);
    group.add(canopy);

    return group;
  }

  public reset(): void {
    this.position.set(0, 0, 80);
    this.quaternion.identity();
    this.velocity.set(0, 0, -28);
    this.pitchRate = 0;
    this.yawRate = 0;
    this.rollRate = 0;
    this.throttle = 0.18;
    this.cruiseActive = false;
    this.cruiseBlend = 0;
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.weaponHeat = 0;
    this.distanceFlownKm = 0;
    this.swayRoll = 0;
    this.swayPitch = 0;
    this.swayYaw = 0;
    this.recoilZ = 0;
    this.fireCooldownTimer = 0;
    this.muzzleFlashTimer = 0;
    this.shieldRegenDelay = 0;

    for (const bolt of this.laserPool) {
      bolt.active = false;
      bolt.mesh.visible = false;
    }

    this.shipGroup.position.copy(this.position);
    this.shipGroup.quaternion.copy(this.quaternion);
  }

  public setSpawnPose(
    position: { x: number; y: number; z: number },
    lookTarget: { x: number; y: number; z: number },
    initialSpeedMps = 48
  ): void {
    this.position.set(position.x, position.y, position.z);
    const targetVec = new THREE.Vector3(lookTarget.x, lookTarget.y, lookTarget.z);
    const lookMat = new THREE.Matrix4().lookAt(this.position, targetVec, new THREE.Vector3(0, 1, 0));
    this.quaternion.setFromRotationMatrix(lookMat);
    this.getForward(_forward);
    this.throttle = THREE.MathUtils.clamp(initialSpeedMps / this.maxSpeedMps, 0, 1);
    this.velocity.copy(_forward).multiplyScalar(initialSpeedMps);
    this.cruiseActive = false;
    this.cruiseBlend = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.rollRate = 0;
    this.shipGroup.position.copy(this.position);
    this.shipGroup.quaternion.copy(this.quaternion);
  }

  public dropFromCruise(safeSpeedMps = 185): void {
    this.cruiseActive = false;
    this.getForward(_forward);
    const curSpeed = this.velocity.length();
    if (curSpeed > safeSpeedMps) {
      this.velocity.copy(_forward).multiplyScalar(safeSpeedMps);
    }
    this.throttle = THREE.MathUtils.clamp(safeSpeedMps / this.maxSpeedMps, 0.4, 0.85);
  }

  public getForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
  }

  public getRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
  }

  public getUp(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion).normalize();
  }

  public applyDamage(amount: number): boolean {
    if (amount <= 0) return false;
    this.shieldRegenDelay = 3.2;
    let remaining = amount;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield = Math.max(0, this.shield - absorbed);
      remaining -= absorbed;
    }
    if (remaining > 0) {
      this.hull = Math.max(0, this.hull - remaining);
    }
    return this.hull <= 0;
  }

  public applyUpgrades(upgrades: ShipUpgrades): void {
    this.pulseLaserMk2 = upgrades.pulseLaserMk2;
    this.boltCoreMat.color.setHex(upgrades.pulseLaserMk2 ? 0xfffbeb : 0xf0f9ff);
    this.boltGlowMat.color.setHex(upgrades.pulseLaserMk2 ? 0xf59e0b : 0x38bdf8);
    this.flashMat.color.setHex(upgrades.pulseLaserMk2 ? 0xfbbf24 : 0x38bdf8);
    this.muzzleLight.color.setHex(upgrades.pulseLaserMk2 ? 0xfbbf24 : 0x38bdf8);

    const prevMaxShield = this.maxShield;
    this.shieldBooster = upgrades.shieldBooster;
    this.maxHull = upgrades.shieldBooster ? 150 : 100;
    this.maxShield = upgrades.shieldBooster ? 150 : 100;
    if (this.maxShield > prevMaxShield) {
      this.shield = Math.min(this.maxShield, this.shield + (this.maxShield - prevMaxShield));
    } else {
      this.shield = Math.min(this.maxShield, this.shield);
    }
    this.hull = Math.min(this.maxHull, this.hull);
  }

  public getLaserDamage(): number {
    return this.pulseLaserMk2 ? 36 : 20;
  }

  public getLaserSpeed(): number {
    return this.pulseLaserMk2 ? 920 : BOLT_SPEED;
  }

  public restoreFullIntegrity(): void {
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.weaponHeat = 0;
    this.shieldRegenDelay = 0;
    this.cruiseActive = false;
    this.cruiseBlend = 0;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    for (const bolt of this.laserPool) {
      bolt.active = false;
      bolt.mesh.visible = false;
    }
  }

  public tryFireLasers(gimbalLeadTarget?: THREE.Vector3 | null): boolean {
    if (this.fireCooldownTimer > 0 || this.weaponHeat > 0.94) return false;

    this.fireCooldownTimer = this.pulseLaserMk2 ? 0.092 : FIRE_COOLDOWN;
    this.weaponHeat = Math.min(1, this.weaponHeat + (this.pulseLaserMk2 ? 0.05 : 0.085));
    this.recoilZ = 0.14;
    this.muzzleFlashTimer = 0.055;

    this.getForward(_forward);
    this.getRight(_right);
    this.getUp(_up);

    let gimbalActive = false;
    if (gimbalLeadTarget) {
      const gimbal = computeGimbalAimDirection({
        shooterPos: this.position,
        shooterForward: _forward,
        leadTargetPos: gimbalLeadTarget,
      });
      gimbalActive = gimbal.gimbalActive;
    }

    const boltSpeed = this.pulseLaserMk2 ? 920 : BOLT_SPEED;
    const offsets = [-1.4, 1.4];
    let spawned = 0;
    for (const sideX of offsets) {
      const slot = this.laserPool.find((b) => !b.active);
      if (!slot) break;
      slot.active = true;
      slot.life = 0;
      slot.pos
        .copy(this.position)
        .addScaledVector(_right, sideX)
        .addScaledVector(_up, -0.35)
        .addScaledVector(_forward, 3.8);

      if (gimbalActive && gimbalLeadTarget) {
        _aimDir.copy(gimbalLeadTarget).sub(slot.pos);
        if (_aimDir.lengthSq() > 0.001) {
          _aimDir.normalize();
        } else {
          _aimDir.copy(_forward);
        }
        slot.vel
          .copy(_aimDir)
          .multiplyScalar(boltSpeed)
          .addScaledVector(this.velocity, 0.35);
        _lookPoint.copy(slot.pos).add(_aimDir);
        _lookMat.lookAt(slot.pos, _lookPoint, _up);
        slot.mesh.quaternion.setFromRotationMatrix(_lookMat);
      } else {
        slot.vel
          .copy(_forward)
          .multiplyScalar(boltSpeed)
          .addScaledVector(this.velocity, 0.35);
        slot.mesh.quaternion.copy(this.quaternion);
      }

      slot.mesh.position.copy(slot.pos);
      slot.mesh.visible = true;
      spawned++;
    }
    return spawned > 0;
  }

  public update(
    dt: number,
    input: FlightInputState,
    camera: THREE.PerspectiveCamera,
    cameraMode: CameraMode,
    onFire?: () => void,
    warpBoost = 0,
    gimbalLeadTarget?: THREE.Vector3 | null
  ): void {
    // 1. Throttle control (Cruise Drive locks throttle to 100% until throttled down or dropped)
    if (this.cruiseActive) {
      if (input.zeroThrottleJustPressed || input.throttleDown) {
        this.cruiseActive = false;
      } else {
        this.throttle = 1.0;
      }
    }

    if (!this.cruiseActive) {
      if (input.zeroThrottleJustPressed) {
        this.throttle = 0;
      } else {
        const tDelta = (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0);
        this.throttle = stepThrottle(this.throttle, tDelta, dt, 0.62);
      }
    }
    this.throttle = THREE.MathUtils.clamp(this.throttle, THROTTLE_MIN, THROTTLE_MAX);

    // Smoothly ramp Cruise Drive blend (fast disengage, exhilarating spool-up)
    this.cruiseBlend = dampScalar(
      this.cruiseBlend,
      this.cruiseActive ? 1 : 0,
      this.cruiseActive ? 1.5 : 4.2,
      dt
    );
    if (!this.cruiseActive && this.cruiseBlend < 0.004) {
      this.cruiseBlend = 0;
    }

    // 2. Angular velocity with gentle rotational damping (additive keyboard + virtual joystick mouse)
    const pitchSign = computePitchSign(this.invertPitch);
    // W (pitchDown key) -> pitchSign, S (pitchUp key) -> -pitchSign
    const kbPitch =
      (input.pitchDown ? pitchSign : 0) + (input.pitchUp ? -pitchSign : 0);
    const kbYaw = (input.yawLeft ? 1 : 0) - (input.yawRight ? 1 : 0);
    const pitchInput = THREE.MathUtils.clamp(kbPitch + input.mousePitch, -1, 1);
    const rollInput = (input.rollLeft ? 1 : 0) - (input.rollRight ? 1 : 0);
    const yawInput = THREE.MathUtils.clamp(kbYaw + input.mouseYaw, -1, 1);

    const cruiseTurnDamp = 1 - this.cruiseBlend * 0.35;
    const maxPitchRate = 1.45 * cruiseTurnDamp;
    const maxRollRate = 2.25 * cruiseTurnDamp;
    const maxYawRate = 1.05 * cruiseTurnDamp;

    this.pitchRate = dampScalar(this.pitchRate, pitchInput * maxPitchRate, 7.5, dt);
    this.rollRate = dampScalar(this.rollRate, rollInput * maxRollRate, 7.5, dt);
    this.yawRate = dampScalar(this.yawRate, yawInput * maxYawRate, 7.0, dt);

    if (Math.abs(this.pitchRate) > 0.0001) {
      _rotQuat.setFromAxisAngle(_axisX, this.pitchRate * dt);
      this.quaternion.multiply(_rotQuat);
    }
    if (Math.abs(this.yawRate) > 0.0001) {
      _rotQuat.setFromAxisAngle(_axisY, this.yawRate * dt);
      this.quaternion.multiply(_rotQuat);
    }
    if (Math.abs(this.rollRate) > 0.0001) {
      _rotQuat.setFromAxisAngle(_axisZ, this.rollRate * dt);
      this.quaternion.multiply(_rotQuat);
    }
    this.quaternion.normalize();

    // 3. Arcade-Newtonian velocity with Supercruise 16x speed ramp
    this.getForward(_forward);
    const effectiveMaxSpeed =
      this.maxSpeedMps + this.cruiseBlend * (CRUISE_MAX_SPEED_MPS - this.maxSpeedMps);
    const targetSpeed = this.throttle * effectiveMaxSpeed;
    _desiredVel.copy(_forward).multiplyScalar(targetSpeed);

    const accelFactor = 1 - Math.exp(-(3.4 + this.cruiseBlend * 1.4) * dt);
    this.velocity.lerp(_desiredVel, accelFactor);

    const stepDist = this.velocity.length() * dt;
    this.distanceFlownKm += stepDist / 1000;
    this.position.addScaledVector(this.velocity, dt);

    // Sync world ship model
    this.shipGroup.position.copy(this.position);
    this.shipGroup.quaternion.copy(this.quaternion);

    // Scale thruster plumes with throttle & Cruise Drive boost
    const flameScale =
      this.throttle >= 0
        ? 0.25 + this.throttle * 1.4 + this.cruiseBlend * 1.85
        : 0.12;
    const flameWidth = 0.85 + this.cruiseBlend * 0.38;
    for (const flame of this.thrusterFlames) {
      flame.scale.set(flameWidth, flameScale, flameWidth);
    }

    // 4. Weapons, heat, shields, recoil
    this.fireCooldownTimer = Math.max(0, this.fireCooldownTimer - dt);
    this.weaponHeat = Math.max(0, this.weaponHeat - 0.28 * dt);

    if (input.fireHeld && this.tryFireLasers(gimbalLeadTarget)) {
      onFire?.();
    }

    this.recoilZ = dampScalar(this.recoilZ, 0, 18, dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    const flashActive = this.muzzleFlashTimer > 0;
    const showCockpitFlash = flashActive && cameraMode === 'cockpit';
    const showChaseFlash = flashActive && cameraMode === 'chase';
    this.muzzleFlashLeft.visible = showCockpitFlash;
    this.muzzleFlashRight.visible = showCockpitFlash;
    this.externalMuzzleLeft.visible = showChaseFlash;
    this.externalMuzzleRight.visible = showChaseFlash;

    if (showCockpitFlash) {
      const s = 0.85 + (this.muzzleFlashTimer / 0.055) * 0.45;
      this.muzzleFlashLeft.scale.setScalar(s);
      this.muzzleFlashRight.scale.setScalar(s);
      this.muzzleFlashLeft.rotation.z = Math.random() * Math.PI;
      this.muzzleFlashRight.rotation.z = Math.random() * Math.PI;
    }

    this.muzzleLight.intensity = showCockpitFlash ? 5.6 : 0;
    this.pylonMat.emissive.setHex(
      showCockpitFlash ? (this.pulseLaserMk2 ? 0xf59e0b : 0x38bdf8) : 0x000000
    );
    this.pylonMat.emissiveIntensity = showCockpitFlash ? 0.95 : 1;

    this.cockpitPylonLeft.position.z = -1.48 + this.recoilZ;
    this.cockpitPylonRight.position.z = -1.48 + this.recoilZ;

    if (this.shieldRegenDelay > 0) {
      this.shieldRegenDelay -= dt;
    } else if (this.shield < this.maxShield && this.hull > 0) {
      const regenRate = this.shieldBooster ? 9.5 : 6.5;
      this.shield = Math.min(this.maxShield, this.shield + regenRate * dt);
    }

    // 5. Update active laser bolts
    for (const bolt of this.laserPool) {
      if (!bolt.active) continue;
      bolt.life += dt;
      if (bolt.life >= BOLT_LIFETIME) {
        bolt.active = false;
        bolt.mesh.visible = false;
        continue;
      }
      bolt.pos.addScaledVector(bolt.vel, dt);
      bolt.mesh.position.copy(bolt.pos);
    }

    // 6. Camera positioning & subtle tactile cockpit sway/banking
    this.swayRoll = dampScalar(this.swayRoll, -this.rollRate * 0.045, 9, dt);
    this.swayPitch = dampScalar(this.swayPitch, -this.pitchRate * 0.032, 9, dt);
    this.swayYaw = dampScalar(this.swayYaw, -this.yawRate * 0.035, 9, dt);

    if (cameraMode === 'cockpit') {
      this.shipModel.visible = false;
      this.cockpitRig.visible = true;

      camera.position.copy(this.position);
      camera.quaternion.copy(this.quaternion);
      camera.rotateX(this.swayPitch);
      camera.rotateY(this.swayYaw);
      camera.rotateZ(this.swayRoll);

      this.cockpitRig.position.copy(camera.position);
      this.cockpitRig.quaternion.copy(camera.quaternion);
      this.cockpitRig.position.addScaledVector(
        _forward,
        -this.recoilZ * 0.18
      );
    } else {
      this.shipModel.visible = true;
      this.cockpitRig.visible = false;

      this.getUp(_up);
      const chasePos = this.position
        .clone()
        .addScaledVector(_forward, -22)
        .addScaledVector(_up, 6.2);
      camera.position.lerp(chasePos, 1 - Math.exp(-10 * dt));
      const lookTarget = this.position.clone().addScaledVector(_forward, 45);
      camera.lookAt(lookTarget);
    }

    // Subtle speed, Cruise Drive, & hyperspace tunnel FOV kick
    const speedRatio = Math.min(1, this.velocity.length() / this.maxSpeedMps);
    const targetFov = 66 + speedRatio * 7 + this.cruiseBlend * 11 + warpBoost * 14;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = dampScalar(camera.fov, targetFov, 7, dt);
      camera.updateProjectionMatrix();
    }
  }

  public updateAutoDock(
    dt: number,
    targetPos: THREE.Vector3,
    desiredSpeedMps: number,
    camera: THREE.PerspectiveCamera,
    cameraMode: CameraMode
  ): void {
    const toTarget = targetPos.clone().sub(this.position);
    const dist = toTarget.length();
    if (dist > 0.01) {
      toTarget.normalize();
      const targetMatrix = new THREE.Matrix4().lookAt(
        this.position,
        this.position.clone().add(toTarget),
        new THREE.Vector3(0, 1, 0)
      );
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(targetMatrix);
      this.quaternion.slerp(targetQuat, 1 - Math.exp(-3.8 * dt)).normalize();
    }

    this.getForward(_forward);
    this.throttle = THREE.MathUtils.clamp(desiredSpeedMps / this.maxSpeedMps, 0, 1);
    _desiredVel.copy(_forward).multiplyScalar(desiredSpeedMps);
    this.velocity.lerp(_desiredVel, 1 - Math.exp(-3.6 * dt));

    this.distanceFlownKm += (this.velocity.length() * dt) / 1000;
    this.position.addScaledVector(this.velocity, dt);

    this.shipGroup.position.copy(this.position);
    this.shipGroup.quaternion.copy(this.quaternion);

    const flameScale = 0.25 + this.throttle * 1.4;
    for (const flame of this.thrusterFlames) {
      flame.scale.set(0.85, flameScale, 0.85);
    }

    // Update active laser bolts cleanly even during autopilot
    for (const bolt of this.laserPool) {
      if (!bolt.active) continue;
      bolt.life += dt;
      if (bolt.life >= BOLT_LIFETIME) {
        bolt.active = false;
        bolt.mesh.visible = false;
        continue;
      }
      bolt.pos.addScaledVector(bolt.vel, dt);
      bolt.mesh.position.copy(bolt.pos);
    }

    if (cameraMode === 'cockpit') {
      this.shipModel.visible = false;
      this.cockpitRig.visible = true;
      camera.position.copy(this.position);
      camera.quaternion.copy(this.quaternion);
      this.cockpitRig.position.copy(camera.position);
      this.cockpitRig.quaternion.copy(camera.quaternion);
    } else {
      this.shipModel.visible = true;
      this.cockpitRig.visible = false;
      this.getUp(_up);
      const chasePos = this.position
        .clone()
        .addScaledVector(_forward, -22)
        .addScaledVector(_up, 6.2);
      camera.position.lerp(chasePos, 1 - Math.exp(-10 * dt));
      camera.lookAt(this.position.clone().addScaledVector(_forward, 45));
    }
  }
}
