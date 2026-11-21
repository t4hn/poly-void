import * as THREE from 'three';
import { computeLeadInterceptPoint } from './combat';
import { attachFacetOutlines, createFlatMaterial } from './LowPolyHelpers';

export interface PirateArchetype {
  name: string;
  hullHp: number;
  shieldHp: number;
  bountyCr: number;
  maxSpeed: number;
  turnRate: number;
  fireCooldown: number;
  laserDamage: number;
  scale: number;
  accentHex: number;
}

const PIRATE_ARCHETYPES: PirateArchetype[] = [
  {
    name: 'Sidewinder Raider',
    hullHp: 56,
    shieldHp: 42,
    bountyCr: 55,
    maxSpeed: 195,
    turnRate: 2.3,
    fireCooldown: 0.72,
    laserDamage: 8,
    scale: 1.35,
    accentHex: 0xef4444,
  },
  {
    name: 'Cobra Interceptor',
    hullHp: 78,
    shieldHp: 62,
    bountyCr: 95,
    maxSpeed: 215,
    turnRate: 2.5,
    fireCooldown: 0.58,
    laserDamage: 10,
    scale: 1.55,
    accentHex: 0xf97316,
  },
  {
    name: 'Viper Corsair',
    hullHp: 102,
    shieldHp: 85,
    bountyCr: 145,
    maxSpeed: 228,
    turnRate: 2.65,
    fireCooldown: 0.48,
    laserDamage: 12,
    scale: 1.68,
    accentHex: 0xe11d48,
  },
];

export interface PirateShip {
  id: string;
  name: string;
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  baseColorHex: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  bountyCr: number;
  maxSpeed: number;
  turnRate: number;
  fireCooldown: number;
  fireTimer: number;
  laserDamage: number;
  collisionRadius: number;
  hitFlashTimer: number;
  shieldRegenDelay: number;
  maneuverMode: 'attack' | 'breakaway';
  maneuverTimer: number;
  strafeSign: number;
  destroyed: boolean;
}

export interface EnemyLaserBolt {
  active: boolean;
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
}

const ENEMY_BOLT_POOL_SIZE = 24;
const ENEMY_BOLT_SPEED = 480;
const ENEMY_BOLT_LIFETIME = 2.2;

const _toPlayer = new THREE.Vector3();
const _desiredDir = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _desiredVel = new THREE.Vector3();
const _lookPoint = new THREE.Vector3();
const _lookMat = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _upAxis = new THREE.Vector3(0, 1, 0);

export class PirateManager {
  public readonly group = new THREE.Group();
  public readonly pirates: PirateShip[] = [];
  public readonly enemyBolts: EnemyLaserBolt[] = [];

  private idCounter = 0;
  private readonly boltCoreMat = new THREE.MeshBasicMaterial({ color: 0xffe4e6 });
  private readonly boltGlowMat = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor() {
    const coreGeo = new THREE.BoxGeometry(0.18, 0.18, 8.2);
    const glowGeo = new THREE.BoxGeometry(0.56, 0.56, 9.0);
    for (let i = 0; i < ENEMY_BOLT_POOL_SIZE; i++) {
      const boltGroup = new THREE.Group();
      boltGroup.add(
        new THREE.Mesh(coreGeo, this.boltCoreMat),
        new THREE.Mesh(glowGeo, this.boltGlowMat)
      );
      boltGroup.visible = false;
      this.group.add(boltGroup);
      this.enemyBolts.push({
        active: false,
        mesh: boltGroup,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        damage: 8,
      });
    }
  }

  private buildRaiderMesh(archetype: PirateArchetype): {
    meshGroup: THREE.Group;
    bodyMat: THREE.MeshStandardMaterial;
    baseColorHex: number;
  } {
    const g = new THREE.Group();
    const baseColorHex = 0x383e52;
    const bodyMat = createFlatMaterial(baseColorHex, {
      roughness: 0.42,
      metalness: 0.52,
      emissive: 0x000000,
      emissiveIntensity: 1,
    });
    const accentMat = createFlatMaterial(archetype.accentHex, {
      roughness: 0.3,
      metalness: 0.45,
      emissive: archetype.accentHex,
      emissiveIntensity: 0.25,
    });
    const cockpitMat = createFlatMaterial(0xf87171, {
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xdc2626,
      emissiveIntensity: 0.85,
    });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });

    // Aggressive sharp delta arrowhead fuselage
    const hullGeo = new THREE.ConeGeometry(2.3, 12.2, 4);
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.rotateZ(Math.PI / 4);
    hullGeo.scale(1.45, 0.52, 1.0);
    const hull = new THREE.Mesh(hullGeo, bodyMat);
    hull.castShadow = true;
    attachFacetOutlines(hull, 0x050811, 14, 0.9);
    g.add(hull);

    // Forward-swept jagged wings + crimson wingtip blades
    [-1, 1].forEach((side) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.36, 3.8), bodyMat);
      wing.position.set(side * 3.6, -0.05, 1.2);
      wing.rotation.y = side * 0.42; // forward-swept raider silhouette
      wing.rotation.z = side * -0.1;
      attachFacetOutlines(wing, 0x050811, 14, 0.9);
      g.add(wing);

      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.85, 3.1), accentMat);
      blade.position.set(side * 6.0, 0.35, 0.2);
      blade.rotation.z = side * 0.22;
      attachFacetOutlines(blade, 0x050811, 14, 0.9);
      g.add(blade);

      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.52, 2.8, 5), flameMat);
      plume.rotation.x = Math.PI / 2;
      plume.position.set(side * 1.15, 0, 6.8);
      g.add(plume);
    });

    const canopy = new THREE.Mesh(new THREE.OctahedronGeometry(1.05, 0), cockpitMat);
    canopy.scale.set(0.8, 0.52, 1.9);
    canopy.position.set(0, 0.65, -0.6);
    attachFacetOutlines(canopy, 0x050811, 14, 0.9);
    g.add(canopy);

    g.scale.setScalar(archetype.scale);
    return { meshGroup: g, bodyMat, baseColorHex };
  }

  public spawnPirateNearPlayer(
    playerPos: THREE.Vector3,
    playerForward: THREE.Vector3,
    rollSeed = Math.random()
  ): PirateShip {
    const archIdx = Math.min(
      PIRATE_ARCHETYPES.length - 1,
      Math.floor(rollSeed * PIRATE_ARCHETYPES.length)
    );
    const arch = PIRATE_ARCHETYPES[archIdx];
    const { meshGroup, bodyMat, baseColorHex } = this.buildRaiderMesh(arch);

    // Spawn 2.1 - 2.6 km ahead in a flanking cone so player spots them right after mass-lock drop
    const sideAngle = ((this.idCounter % 2 === 0 ? 1 : -1) * (0.28 + (rollSeed * 0.35))) % Math.PI;
    const fwd = playerForward.clone().normalize();
    const right = new THREE.Vector3().crossVectors(fwd, _upAxis);
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    const spawnDist = 2150 + rollSeed * 420;
    const spawnPos = playerPos
      .clone()
      .addScaledVector(fwd, spawnDist * Math.cos(sideAngle))
      .addScaledVector(right, spawnDist * Math.sin(sideAngle))
      .addScaledVector(up, (rollSeed - 0.5) * 260);

    _lookMat.lookAt(spawnPos, playerPos, _upAxis);
    const quat = new THREE.Quaternion().setFromRotationMatrix(_lookMat);

    meshGroup.position.copy(spawnPos);
    meshGroup.quaternion.copy(quat);
    this.group.add(meshGroup);

    const id = `pirate-${++this.idCounter}`;
    const pirate: PirateShip = {
      id,
      name: arch.name,
      group: meshGroup,
      bodyMat,
      baseColorHex,
      position: meshGroup.position,
      velocity: playerPos.clone().sub(spawnPos).normalize().multiplyScalar(arch.maxSpeed * 0.85),
      quaternion: meshGroup.quaternion,
      hull: arch.hullHp,
      maxHull: arch.hullHp,
      shield: arch.shieldHp,
      maxShield: arch.shieldHp,
      bountyCr: arch.bountyCr,
      maxSpeed: arch.maxSpeed,
      turnRate: arch.turnRate,
      fireCooldown: arch.fireCooldown,
      fireTimer: 0.9,
      laserDamage: arch.laserDamage,
      collisionRadius: 11.5 * arch.scale,
      hitFlashTimer: 0,
      shieldRegenDelay: 0,
      maneuverMode: 'attack',
      maneuverTimer: 8,
      strafeSign: this.idCounter % 2 === 0 ? 1 : -1,
      destroyed: false,
    };
    this.pirates.push(pirate);
    return pirate;
  }

  public damagePirate(
    pirate: PirateShip,
    amount: number
  ): { destroyed: boolean; shieldHit: boolean } {
    if (pirate.destroyed || amount <= 0) {
      return { destroyed: false, shieldHit: false };
    }
    pirate.shieldRegenDelay = 4.2;
    pirate.hitFlashTimer = 0.08;
    let remaining = amount;
    let shieldHit = false;
    if (pirate.shield > 0) {
      shieldHit = true;
      const absorbed = Math.min(pirate.shield, remaining);
      pirate.shield = Math.max(0, pirate.shield - absorbed);
      remaining -= absorbed;
    }
    if (remaining > 0) {
      pirate.hull = Math.max(0, pirate.hull - remaining);
    }

    pirate.bodyMat.emissive.setHex(shieldHit && remaining === 0 ? 0x38bdf8 : 0xfbbf24);
    pirate.bodyMat.emissiveIntensity = 1.5;

    if (pirate.hull <= 0) {
      pirate.destroyed = true;
      pirate.group.visible = false;
      return { destroyed: true, shieldHit };
    }
    return { destroyed: false, shieldHit };
  }

  private fireEnemyLaser(pirate: PirateShip, aimTarget: THREE.Vector3): void {
    const slot = this.enemyBolts.find((b) => !b.active);
    if (!slot) return;

    _forward.set(0, 0, -1).applyQuaternion(pirate.quaternion).normalize();
    _desiredDir.copy(aimTarget).sub(pirate.position).normalize();
    // Slight angular spread so dogfighting rewards evasive maneuvers
    _desiredDir.x += (Math.random() - 0.5) * 0.045;
    _desiredDir.y += (Math.random() - 0.5) * 0.045;
    _desiredDir.z += (Math.random() - 0.5) * 0.045;
    _desiredDir.normalize();

    slot.active = true;
    slot.life = 0;
    slot.damage = pirate.laserDamage;
    slot.pos.copy(pirate.position).addScaledVector(_forward, 6.2);
    slot.vel
      .copy(_desiredDir)
      .multiplyScalar(ENEMY_BOLT_SPEED)
      .addScaledVector(pirate.velocity, 0.25);

    _lookPoint.copy(slot.pos).add(_desiredDir);
    _lookMat.lookAt(slot.pos, _lookPoint, _upAxis);
    slot.mesh.position.copy(slot.pos);
    slot.mesh.quaternion.setFromRotationMatrix(_lookMat);
    slot.mesh.visible = true;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    onEnemyFire: () => void
  ): void {
    // Update active enemy laser bolts
    for (const bolt of this.enemyBolts) {
      if (!bolt.active) continue;
      bolt.life += dt;
      if (bolt.life >= ENEMY_BOLT_LIFETIME) {
        bolt.active = false;
        bolt.mesh.visible = false;
        continue;
      }
      bolt.pos.addScaledVector(bolt.vel, dt);
      bolt.mesh.position.copy(bolt.pos);
    }

    // Update active pirates
    for (let i = this.pirates.length - 1; i >= 0; i--) {
      const p = this.pirates[i];
      if (p.destroyed) {
        this.group.remove(p.group);
        this.pirates.splice(i, 1);
        continue;
      }

      if (p.hitFlashTimer > 0) {
        p.hitFlashTimer -= dt;
        if (p.hitFlashTimer <= 0) {
          p.bodyMat.emissive.setHex(0x000000);
          p.bodyMat.emissiveIntensity = 1;
        }
      }

      if (p.shieldRegenDelay > 0) {
        p.shieldRegenDelay -= dt;
      } else if (p.shield < p.maxShield) {
        p.shield = Math.min(p.maxShield, p.shield + 4.5 * dt);
      }

      _toPlayer.copy(playerPos).sub(p.position);
      const dist = _toPlayer.length();

      // Despawn cleanly if player outruns pirate past 7.5 km
      if (dist > 7500) {
        p.destroyed = true;
        this.group.remove(p.group);
        this.pirates.splice(i, 1);
        continue;
      }

      p.maneuverTimer -= dt;
      if (p.maneuverMode === 'attack' && (dist < 220 || p.maneuverTimer <= 0)) {
        p.maneuverMode = 'breakaway';
        p.maneuverTimer = 2.8;
        p.strafeSign *= -1;
      } else if (p.maneuverMode === 'breakaway' && (dist > 780 || p.maneuverTimer <= 0)) {
        p.maneuverMode = 'attack';
        p.maneuverTimer = 6.5;
      }

      _forward.set(0, 0, -1).applyQuaternion(p.quaternion).normalize();
      _right.set(1, 0, 0).applyQuaternion(p.quaternion).normalize();
      _up.set(0, 1, 0).applyQuaternion(p.quaternion).normalize();

      if (p.maneuverMode === 'attack') {
        const lead = computeLeadInterceptPoint({
          shooterPos: p.position,
          targetPos: playerPos,
          targetVel: playerVel,
          projectileSpeedMps: ENEMY_BOLT_SPEED,
        });
        _desiredDir
          .set(lead.x - p.position.x, lead.y - p.position.y, lead.z - p.position.z)
          .addScaledVector(_right, p.strafeSign * Math.min(180, dist * 0.16))
          .normalize();
      } else {
        // High-speed breakaway arc away & laterally around player
        _desiredDir
          .copy(p.position)
          .sub(playerPos)
          .normalize()
          .addScaledVector(_right, p.strafeSign * 0.85)
          .addScaledVector(_up, 0.25)
          .normalize();
      }

      _lookPoint.copy(p.position).add(_desiredDir);
      _lookMat.lookAt(p.position, _lookPoint, _upAxis);
      _targetQuat.setFromRotationMatrix(_lookMat);
      p.quaternion.slerp(_targetQuat, 1 - Math.exp(-p.turnRate * dt)).normalize();

      const desiredSpeed =
        p.maneuverMode === 'breakaway'
          ? p.maxSpeed
          : dist > 1200
            ? p.maxSpeed * 1.1
            : dist > 450
              ? p.maxSpeed * 0.92
              : p.maxSpeed * 0.72;

      _forward.set(0, 0, -1).applyQuaternion(p.quaternion).normalize();
      _desiredVel.copy(_forward).multiplyScalar(desiredSpeed);
      p.velocity.lerp(_desiredVel, 1 - Math.exp(-3.2 * dt));
      p.position.addScaledVector(p.velocity, dt);

      // Fire red pulse lasers when in attack cone and range
      p.fireTimer -= dt;
      if (p.maneuverMode === 'attack' && dist < 1650 && dist > 110 && p.fireTimer <= 0) {
        const dirToPlayer = _toPlayer.clone().normalize();
        const alignDot = _forward.dot(dirToPlayer);
        if (alignDot > 0.88) {
          p.fireTimer = p.fireCooldown * (0.85 + Math.random() * 0.4);
          const lead = computeLeadInterceptPoint({
            shooterPos: p.position,
            targetPos: playerPos,
            targetVel: playerVel,
            projectileSpeedMps: ENEMY_BOLT_SPEED,
          });
          this.fireEnemyLaser(p, new THREE.Vector3(lead.x, lead.y, lead.z));
          onEnemyFire();
        }
      }
    }
  }

  public getActiveCount(): number {
    let count = 0;
    for (const p of this.pirates) {
      if (!p.destroyed) count++;
    }
    return count;
  }

  public reset(): void {
    for (const p of this.pirates) {
      this.group.remove(p.group);
    }
    this.pirates.length = 0;
    for (const b of this.enemyBolts) {
      b.active = false;
      b.mesh.visible = false;
    }
  }
}
