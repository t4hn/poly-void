import * as THREE from 'three';
import { attachFacetOutlines, createFlatMaterial } from './LowPolyHelpers';
import type { AsteroidClusterSpec } from './systemLayout';
import type { EconomyType, SalvageCommodityId } from './types';

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
  commodityId: SalvageCommodityId;
  units: number;
  bountyCredits: number;
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

export interface AsteroidSystemStyle {
  baseColorHex: number;
  radius: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  collisionRadius: number;
  roughness: number;
  metalness: number;
}

export function computeSystemAsteroidStyle(
  systemSeed: number,
  economy: EconomyType,
  asteroidIndex: number,
  paletteBaseHex: number
): AsteroidSystemStyle {
  const hashA = Math.abs(Math.sin(systemSeed * 12.9898 + asteroidIndex * 78.233)) % 1;
  const hashB = Math.abs(Math.cos(systemSeed * 45.164 + asteroidIndex * 19.37)) % 1;
  const hashC = Math.abs(Math.sin(systemSeed * 93.71 + asteroidIndex * 31.17)) % 1;

  // Economy-biased hue & mineral tint shifts so each star system has a distinct rock belt look
  const color = new THREE.Color(paletteBaseHex);
  let hueShift = ((systemSeed % 11) - 5) * 0.012 + (hashA - 0.5) * 0.05;
  let satShift = (hashB - 0.45) * 0.14;
  let lightShift = (hashC - 0.5) * 0.12;

  if (economy === 'Mining') {
    hueShift -= 0.03;
    satShift += 0.12;
  } else if (economy === 'High-Tech') {
    hueShift += 0.04;
    lightShift += 0.04;
  } else if (economy === 'Rich Agricultural' || economy === 'Poor Agricultural') {
    hueShift += 0.025;
    satShift += 0.05;
  }

  color.offsetHSL(hueShift, satShift, lightShift);

  const sizeBias = economy === 'Mining' ? 1.15 : economy === 'High-Tech' ? 0.92 : 1.0;
  const radius = Math.round((11 + hashA * 26) * sizeBias);
  const scaleX = 0.8 + hashB * 0.44;
  const scaleY = 0.78 + hashC * 0.42;
  const scaleZ = 0.8 + ((hashA + hashC) * 0.5) * 0.42;
  const maxAxis = Math.max(scaleX, scaleY, scaleZ);

  return {
    baseColorHex: color.getHex(),
    radius,
    scaleX,
    scaleY,
    scaleZ,
    collisionRadius: Math.round(radius * maxAxis),
    roughness: Math.max(0.55, Math.min(0.95, 0.78 + (hashB - 0.5) * 0.2)),
    metalness: economy === 'Mining' ? 0.28 : 0.15 + hashC * 0.1,
  };
}

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
  private readonly cargoPodMat = createFlatMaterial(0xf59e0b, {
    roughness: 0.28,
    metalness: 0.65,
    emissive: 0xd97706,
    emissiveIntensity: 0.95,
  });
  private canisterCounter = 0;

  constructor(
    clusters: AsteroidClusterSpec[],
    seedOffset = 0,
    economy: EconomyType = 'Rich Agricultural'
  ) {
    this.populate(clusters, seedOffset, economy);
  }

  public reset(
    clusters: AsteroidClusterSpec[],
    seedOffset = 0,
    economy: EconomyType = 'Rich Agricultural'
  ): void {
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
    this.populate(clusters, seedOffset, economy);
  }

  private populate(
    clusters: AsteroidClusterSpec[],
    seedOffset = 0,
    economy: EconomyType = 'Rich Agricultural'
  ): void {
    let globalIndex = 0;
    for (const cluster of clusters) {
      for (let i = 0; i < cluster.asteroidCount; i++) {
        const idx = globalIndex++;
        const seed = idx * 17.31 + 3.7 + cluster.seed * 0.71 + seedOffset * 41.7;
        const theta = (i / cluster.asteroidCount) * Math.PI * 2 + Math.sin(seed) * 0.65;
        const radialFrac = 0.18 + Math.abs(Math.cos(seed * 1.43)) * 0.82;
        const ringDist = cluster.radius * radialFrac;
        const yOffset = Math.sin(seed * 2.13) * cluster.radius * 0.28;

        const x = cluster.position.x + Math.cos(theta) * ringDist;
        const y = cluster.position.y + yOffset;
        const z = cluster.position.z + Math.sin(theta) * ringDist;

        const palette = ASTEROID_PALETTES[(idx + seedOffset) % ASTEROID_PALETTES.length];
        const style = computeSystemAsteroidStyle(seedOffset, economy, idx, palette.color);
        const geo = createFacetedRockGeometry(style.radius, seed);
        const mat = createFlatMaterial(style.baseColorHex, {
          roughness: style.roughness,
          metalness: style.metalness,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.scale.set(style.scaleX, style.scaleY, style.scaleZ);
        mesh.rotation.set(seed, seed * 0.6, seed * 1.2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        attachFacetOutlines(mesh, 0x050811, 14, 0.85);
        this.group.add(mesh);

        const maxHp = Math.round(style.collisionRadius * 2.2);
        this.asteroids.push({
          id: `ast-${idx}`,
          name: palette.label,
          mesh,
          material: mat,
          baseEmissive: 0x000000,
          radius: style.collisionRadius,
          hp: maxHp,
          maxHp,
          spinAxis: new THREE.Vector3(
            Math.sin(seed),
            Math.cos(seed * 1.3),
            Math.sin(seed * 0.7)
          ).normalize(),
          spinSpeed: 0.12 + ((idx + seedOffset) % 5) * 0.05,
          hitFlashTimer: 0,
          oreType: palette.oreType,
          destroyed: false,
        });
      }
    }
  }

  public spawnCanister(
    pos: THREE.Vector3,
    commodityId: SalvageCommodityId,
    units = 1,
    bountyCredits = 12.0
  ): void {
    const isPirateCargo =
      commodityId === 'alloys' ||
      commodityId === 'machinery' ||
      commodityId === 'luxury_goods';
    const mat = isPirateCargo ? this.cargoPodMat : this.canisterMat;

    const cg = new THREE.Group();
    const body = new THREE.Mesh(this.canisterBodyGeo, mat);
    attachFacetOutlines(body, isPirateCargo ? 0x451a03 : 0x052e22, 15, 0.85);
    cg.add(body);

    const topCap = new THREE.Mesh(this.canisterCapGeo, mat);
    topCap.position.y = 4.6;
    cg.add(topCap);

    const botCap = new THREE.Mesh(this.canisterCapGeo, mat);
    botCap.position.y = -4.6;
    botCap.rotation.z = Math.PI;
    cg.add(botCap);

    cg.position.copy(pos);
    this.group.add(cg);

    const labelMap: Record<SalvageCommodityId, string> = {
      palladium: 'PALLADIUM ORE POD',
      titanium: 'TITANIUM ORE POD',
      platinum: 'PLATINUM ORE POD',
      alloys: 'CARGO POD: ALLOYS',
      machinery: 'CARGO POD: MACHINERY',
      luxury_goods: 'CARGO POD: LUXURY GOODS',
    };

    this.canisters.push({
      id: `can-${++this.canisterCounter}`,
      name: labelMap[commodityId],
      commodityId,
      units,
      bountyCredits,
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
