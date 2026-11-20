import * as THREE from 'three';
import { createSunCoronaTexture } from './LowPolyHelpers';

const DUST_COUNT = 260;
const DUST_BOX_SIZE = 220;
const DUST_HALF = DUST_BOX_SIZE / 2;

const EXPLOSION_POOL_SIZE = 160;

interface BurstParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

const _dummy = new THREE.Object3D();
const _relVel = new THREE.Vector3();

export class ParticleField {
  public readonly dustLines: THREE.LineSegments;
  public readonly starPoints: THREE.Points;
  public readonly sunGroup: THREE.Group;
  public readonly burstMesh: THREE.InstancedMesh;

  private readonly dustOrigins: Float32Array;
  private readonly dustPositions: Float32Array;
  private readonly burstPool: BurstParticle[] = [];
  private burstCursor = 0;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly sunCoreMat: THREE.MeshBasicMaterial;
  private readonly sunSpriteMat: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene, isSoftwareGl: boolean) {
    // 1. Space Dust Streaks wrapping around player ship
    this.dustOrigins = new Float32Array(DUST_COUNT * 3);
    this.dustPositions = new Float32Array(DUST_COUNT * 6);

    for (let i = 0; i < DUST_COUNT; i++) {
      const x = (Math.random() - 0.5) * DUST_BOX_SIZE;
      const y = (Math.random() - 0.5) * DUST_BOX_SIZE;
      const z = (Math.random() - 0.5) * DUST_BOX_SIZE;
      this.dustOrigins[i * 3] = x;
      this.dustOrigins[i * 3 + 1] = y;
      this.dustOrigins[i * 3 + 2] = z;

      this.dustPositions[i * 6] = x;
      this.dustPositions[i * 6 + 1] = y;
      this.dustPositions[i * 6 + 2] = z;
      this.dustPositions[i * 6 + 3] = x;
      this.dustPositions[i * 6 + 4] = y;
      this.dustPositions[i * 6 + 5] = z + 0.5;
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3));
    const dustMat = new THREE.LineBasicMaterial({
      color: 0xa5f3fc,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.dustLines = new THREE.LineSegments(dustGeo, dustMat);
    this.dustLines.frustumCulled = false;
    scene.add(this.dustLines);

    // 2. Distant Twinkling Starfield Sphere
    const starCount = 1400;
    const starPos = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const palette = [
      new THREE.Color(0xe2e8f0),
      new THREE.Color(0xbae6fd),
      new THREE.Color(0xfef08a),
      new THREE.Color(0xc7d2fe),
    ];

    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 2400 + Math.random() * 600;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3 + 2] = r * Math.cos(phi);

      const c = palette[i % palette.length];
      const brightness = 0.45 + Math.random() * 0.55;
      starColors[i * 3] = c.r * brightness;
      starColors[i * 3 + 1] = c.g * brightness;
      starColors[i * 3 + 2] = c.b * brightness;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 3.8,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      fog: false,
    });
    this.starPoints = new THREE.Points(starGeo, starMat);
    this.starPoints.frustumCulled = false;
    scene.add(this.starPoints);

    // 3. Distant Procedural Sun Sphere + Corona + Balanced Lighting Rig
    this.sunGroup = new THREE.Group();
    const sunDir = new THREE.Vector3(0.62, 0.36, -0.69).normalize();
    const sunPos = sunDir.clone().multiplyScalar(2200);
    this.sunGroup.position.copy(sunPos);

    this.sunCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1, fog: false });
    const sunCore = new THREE.Mesh(new THREE.IcosahedronGeometry(125, 2), this.sunCoreMat);
    this.sunGroup.add(sunCore);

    const sunHaloTex = createSunCoronaTexture();
    this.sunSpriteMat = new THREE.SpriteMaterial({
      map: sunHaloTex,
      color: 0xffd188,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sunSprite = new THREE.Sprite(this.sunSpriteMat);
    sunSprite.scale.set(780, 780, 1);
    this.sunGroup.add(sunSprite);
    scene.add(this.sunGroup);

    // Warm Key DirectionalLight paired with cool blue-purple HemisphereLight & subtle AmbientLight
    this.sunLight = new THREE.DirectionalLight(0xffe7c2, 2.7);
    this.sunLight.position.copy(sunDir.clone().multiplyScalar(900));
    this.sunLight.castShadow = !isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 50;
    this.sunLight.shadow.camera.far = 1800;
    this.sunLight.shadow.camera.left = -350;
    this.sunLight.shadow.camera.right = 350;
    this.sunLight.shadow.camera.top = 350;
    this.sunLight.shadow.camera.bottom = -350;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    const hemiLight = new THREE.HemisphereLight(0x4f78c8, 0x16122c, 0.95);
    scene.add(hemiLight);

    const ambientFill = new THREE.AmbientLight(0x28365e, 0.55);
    scene.add(ambientFill);

    // 4. Zero-GC Pooled Explosion / Debris Particles (InstancedMesh)
    const burstGeo = new THREE.OctahedronGeometry(1.1, 0);
    const burstMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.2,
      flatShading: true,
      emissive: 0xff7b29,
      emissiveIntensity: 0.65,
    });
    this.burstMesh = new THREE.InstancedMesh(burstGeo, burstMat, EXPLOSION_POOL_SIZE);
    this.burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.burstMesh.frustumCulled = false;

    for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
      this.burstPool.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        scale: 0,
        color: new THREE.Color(0xfbbf24),
      });
      _dummy.position.set(0, 0, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.burstMesh.setMatrixAt(i, _dummy.matrix);
      this.burstMesh.setColorAt(i, new THREE.Color(0xfbbf24));
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;
    if (this.burstMesh.instanceColor) this.burstMesh.instanceColor.needsUpdate = true;
    scene.add(this.burstMesh);
  }

  public setSunAppearance(coreHex: number, coronaHex: number, lightHex: number): void {
    this.sunCoreMat.color.setHex(coreHex);
    this.sunSpriteMat.color.setHex(coronaHex);
    this.sunLight.color.setHex(lightHex);
  }

  public spawnBurst(
    origin: THREE.Vector3,
    count: number,
    speed: number,
    colorHex: number,
    baseScale = 1.2
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.burstPool[this.burstCursor];
      this.burstCursor = (this.burstCursor + 1) % EXPLOSION_POOL_SIZE;
      slot.active = true;
      slot.pos.copy(origin);
      slot.vel
        .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.9));
      slot.life = 0;
      slot.maxLife = 0.35 + Math.random() * 0.45;
      slot.scale = baseScale * (0.65 + Math.random() * 0.8);
      slot.color.setHex(colorHex);
      this.burstMesh.setColorAt(
        (this.burstCursor - 1 + EXPLOSION_POOL_SIZE) % EXPLOSION_POOL_SIZE,
        slot.color
      );
    }
    if (this.burstMesh.instanceColor) this.burstMesh.instanceColor.needsUpdate = true;
  }

  public update(
    dt: number,
    shipPos: THREE.Vector3,
    shipVelocity: THREE.Vector3,
    shipForward: THREE.Vector3,
    warpBoost = 0
  ): void {
    // Keep stars centered on ship
    this.starPoints.position.copy(shipPos);

    // Update wrapping space dust streaks relative to ship position
    _relVel.copy(shipVelocity);
    const speed = _relVel.length();
    // Streak tail extends opposite to ship travel direction, elongating during hyperspace charge
    const streakLen = Math.max(0.55, Math.min(20, speed * 0.08)) + warpBoost * 42;
    if (warpBoost > 0.05) {
      _relVel.copy(shipForward).multiplyScalar(-streakLen);
    } else if (speed > 1) {
      _relVel.normalize().multiplyScalar(-streakLen);
    } else {
      _relVel.copy(shipForward).multiplyScalar(-0.6);
    }

    const posAttr = this.dustLines.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < DUST_COUNT; i++) {
      const ox = this.dustOrigins[i * 3];
      const oy = this.dustOrigins[i * 3 + 1];
      const oz = this.dustOrigins[i * 3 + 2];

      // Wrap relative offset into [-DUST_HALF, DUST_HALF] around shipPos
      let rx = ((ox - shipPos.x) % DUST_BOX_SIZE + DUST_BOX_SIZE) % DUST_BOX_SIZE;
      if (rx > DUST_HALF) rx -= DUST_BOX_SIZE;
      let ry = ((oy - shipPos.y) % DUST_BOX_SIZE + DUST_BOX_SIZE) % DUST_BOX_SIZE;
      if (ry > DUST_HALF) ry -= DUST_BOX_SIZE;
      let rz = ((oz - shipPos.z) % DUST_BOX_SIZE + DUST_BOX_SIZE) % DUST_BOX_SIZE;
      if (rz > DUST_HALF) rz -= DUST_BOX_SIZE;

      const wx = shipPos.x + rx;
      const wy = shipPos.y + ry;
      const wz = shipPos.z + rz;

      arr[i * 6] = wx;
      arr[i * 6 + 1] = wy;
      arr[i * 6 + 2] = wz;
      arr[i * 6 + 3] = wx + _relVel.x;
      arr[i * 6 + 4] = wy + _relVel.y;
      arr[i * 6 + 5] = wz + _relVel.z;
    }
    posAttr.needsUpdate = true;

    // Update pooled burst particles
    let anyBurstChanged = false;
    for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
      const p = this.burstPool[i];
      if (!p.active) continue;
      anyBurstChanged = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.burstMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      const t = 1 - p.life / p.maxLife;
      _dummy.position.copy(p.pos);
      _dummy.rotation.set(p.life * 6, p.life * 4, 0);
      _dummy.scale.setScalar(p.scale * t);
      _dummy.updateMatrix();
      this.burstMesh.setMatrixAt(i, _dummy.matrix);
    }
    if (anyBurstChanged) {
      this.burstMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
