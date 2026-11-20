import * as THREE from 'three';
import { attachFacetOutlines, createFlatMaterial } from './LowPolyHelpers';

export interface AsteroidEntity {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseEmissive: number;
  radius: number;
  hp: number;
  maxHp: number;
  spinAxis: THREE.Vector3;
  spinSpeed: number;
  hitFlashTimer: number;
  oreType: 'palladium' | 'titanium' | 'platinum';
  destroyed: boolean;
}

export interface OreCanister {
  id: string;
  name: string;
  commodityId: 'palladium' | 'titanium' | 'platinum';
  mesh: THREE.Group;
  position: THREE.Vector3;
  vel: THREE.Vector3;
  collected: boolean;
}

function createFacetedRockGeometry(radius: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    const n =
      Math.sin(dir.x * 4.1 + seed) * 0.16 +
      Math.cos(dir.y * 5.3 - seed * 1.7) * 0.14 +
      Math.sin(dir.z * 3.7 + seed * 2.3) * 0.12;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const ASTEROID_PALETTES: Array<{
  color: number;
  oreType: 'palladium' | 'titanium' | 'platinum';
  label: string;
}> = [
  { color: 0x5c6473, oreType: 'titanium', label: 'SILICATE ASTEROID' },
  { color: 0x6e5a4f, oreType: 'palladium', label: 'FERRIC ASTEROID' },
  { color: 0x64748b, oreType: 'platinum', label: 'CARBONACEOUS ROCK' },
];

export class AsteroidField {
  public readonly group = new THREE.Group();
  public readonly asteroids: AsteroidEntity[] = [];
  public readonly canisters: OreCanister[] = [];

  private readonly canisterBodyGeo = new THREE.CylinderGeometry(3.2, 3.2, 7.5, 6);
  private readonly canisterCapGeo = new THREE.CylinderGeometry(2.2, 3.2, 1.8, 6);
  private readonly canisterMat = createFlatMaterial(0x10b981, {
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0x059669,
    emissiveIntensity: 0.9,
  });
  private canisterCounter = 0;

  constructor(stationPos: THREE.Vector3) {
    this.populate(stationPos);
  }

  public reset(stationPos: THREE.Vector3, seedOffset = 0): void {
    for (const a of this.asteroids) {
      this.group.remove(a.mesh);
      a.mesh.geometry.dispose();
      a.material.dispose();
    }
    for (const c of this.canisters) {
      this.group.remove(c.mesh);
    }
    this.asteroids.length = 0;
    this.canisters.length = 0;
    this.populate(stationPos, seedOffset);
  }

  private populate(stationPos: THREE.Vector3, seedOffset = 0): void {
    // Deterministic seeded asteroid scatter around the station & flight sector
    // Keep the spawn-to-station corridor (x~0, y~0, z in [-580, 120]) clear of obstacles
    const count = 30;
    for (let i = 0; i < count; i++) {
      const seed = i * 17.31 + 3.7 + seedOffset * 41.7;
      const angle = (i / count) * Math.PI * 2 + Math.sin(seed) * 0.45;
      const ringDist = 250 + (((i + seedOffset * 3) * 89) % 440);
      const yOffset = Math.sin(seed * 1.9) * 190;

      const x = stationPos.x + Math.cos(angle) * ringDist;
      const y = stationPos.y + yOffset;
      const z = stationPos.z + Math.sin(angle) * ringDist * 0.95 + 140;

      // Ensure clear spawn lane & clear station body
      if (Math.hypot(x, y) < 85 && z > -600 && z < 160) continue;
      if (Math.hypot(x - stationPos.x, y - stationPos.y, z - stationPos.z) < 260) continue;

      const radius = 14 + ((i * 7) % 24);
      const palette = ASTEROID_PALETTES[i % ASTEROID_PALETTES.length];
      const geo = createFacetedRockGeometry(radius, seed);
      const mat = createFlatMaterial(palette.color, {
        roughness: 0.85,
        metalness: 0.15,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(seed, seed * 0.6, seed * 1.2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      attachFacetOutlines(mesh, 0x050811, 14, 0.85);
      this.group.add(mesh);

      const maxHp = Math.round(radius * 2.2);
      this.asteroids.push({
        id: `ast-${i}`,
        name: palette.label,
        mesh,
        material: mat,
        baseEmissive: 0x000000,
        radius,
        hp: maxHp,
        maxHp,
        spinAxis: new THREE.Vector3(
          Math.sin(seed),
          Math.cos(seed * 1.3),
          Math.sin(seed * 0.7)
        ).normalize(),
        spinSpeed: 0.12 + (i % 5) * 0.05,
        hitFlashTimer: 0,
        oreType: palette.oreType,
        destroyed: false,
      });
    }
  }

  public spawnCanister(
    pos: THREE.Vector3,
    commodityId: 'palladium' | 'titanium' | 'platinum'
  ): void {
    const cg = new THREE.Group();
    const body = new THREE.Mesh(this.canisterBodyGeo, this.canisterMat);
    attachFacetOutlines(body, 0x052e22, 15, 0.85);
    cg.add(body);

    const topCap = new THREE.Mesh(this.canisterCapGeo, this.canisterMat);
    topCap.position.y = 4.6;
    cg.add(topCap);

    const botCap = new THREE.Mesh(this.canisterCapGeo, this.canisterMat);
    botCap.position.y = -4.6;
    botCap.rotation.z = Math.PI;
    cg.add(botCap);

    cg.position.copy(pos);
    this.group.add(cg);

    const labelMap: Record<typeof commodityId, string> = {
      palladium: 'PALLADIUM ORE POD',
      titanium: 'TITANIUM ORE POD',
      platinum: 'PLATINUM ORE POD',
    };

    this.canisters.push({
      id: `can-${++this.canisterCounter}`,
      name: labelMap[commodityId],
      commodityId,
      mesh: cg,
      position: cg.position,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      ),
      collected: false,
    });
  }

  public damageAsteroid(asteroid: AsteroidEntity, amount: number): boolean {
    if (asteroid.destroyed) return false;
    asteroid.hp -= amount;
    asteroid.hitFlashTimer = 0.06;
    asteroid.material.emissive.setHex(0xfef08a);
    asteroid.material.emissiveIntensity = 1.4;

    if (asteroid.hp <= 0) {
      asteroid.destroyed = true;
      asteroid.mesh.visible = false;
      this.spawnCanister(asteroid.mesh.position, asteroid.oreType);
      return true;
    }
    return false;
  }

  public update(dt: number): void {
    for (const a of this.asteroids) {
      if (a.destroyed) continue;
      a.mesh.rotateOnAxis(a.spinAxis, a.spinSpeed * dt);
      if (a.hitFlashTimer > 0) {
        a.hitFlashTimer -= dt;
        if (a.hitFlashTimer <= 0) {
          a.material.emissive.setHex(a.baseEmissive);
          a.material.emissiveIntensity = 1;
        }
      }
    }

    for (const c of this.canisters) {
      if (c.collected) continue;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.vel.multiplyScalar(Math.max(0, 1 - 0.4 * dt));
      c.mesh.rotation.y += 1.6 * dt;
      c.mesh.rotation.x += 0.9 * dt;
    }
  }
}
