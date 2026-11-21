import * as THREE from 'three';
import { createSunCoronaTexture } from './LowPolyHelpers';

const DUST_COUNT = 260;
const DUST_BOX_SIZE = 220;
const DUST_HALF = DUST_BOX_SIZE / 2;

const HYPERSPACE_LINE_COUNT = 180;
const HYPERSPACE_DEPTH = 260;

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
const _negZ = new THREE.Vector3(0, 0, -1);

export class ParticleField {
  public readonly dustLines: THREE.LineSegments;
  public readonly hyperspaceLines: THREE.LineSegments;
  public readonly starPoints: THREE.Points;
  public readonly sunGroup: THREE.Group;
  public readonly burstMesh: THREE.InstancedMesh;

  private readonly dustOrigins: Float32Array;
  private readonly dustPositions: Float32Array;
  private readonly tunnelSeeds: Float32Array; // [radius, angle, zOffset, speedMult]
  private readonly tunnelPositions: Float32Array;
  private readonly tunnelMat: THREE.LineBasicMaterial;
  private readonly burstPool: BurstParticle[] = [];
  private burstCursor = 0;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly sunCoreMat: THREE.MeshBasicMaterial;
  private readonly sunSprite: THREE.Sprite;
  private readonly sunSpriteMat: THREE.SpriteMaterial;
  private readonly sunOuterSprite: THREE.Sprite;
  private readonly sunOuterSpriteMat: THREE.SpriteMaterial;
  private readonly dustMat: THREE.LineBasicMaterial;
  private readonly dustBaseColor = new THREE.Color(0xa5f3fc);
  private readonly dustCruiseColor = new THREE.Color(0x38bdf8);
  private timeAccum = 0;

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
    this.dustMat = new THREE.LineBasicMaterial({
      color: 0xa5f3fc,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.dustLines = new THREE.LineSegments(dustGeo, this.dustMat);
    this.dustLines.frustumCulled = false;
    scene.add(this.dustLines);

    // 1b. Hyperspace Tunnel Star-Lines (activated during 3s jump countdown)
    this.tunnelSeeds = new Float32Array(HYPERSPACE_LINE_COUNT * 4);
    this.tunnelPositions = new Float32Array(HYPERSPACE_LINE_COUNT * 6);
    for (let i = 0; i < HYPERSPACE_LINE_COUNT; i++) {
      const r = 7 + Math.random() * 44;
      const angle = Math.random() * Math.PI * 2;
      const z = -Math.random() * HYPERSPACE_DEPTH + 15;
      const speedMult = 0.75 + Math.random() * 0.7;
      this.tunnelSeeds[i * 4] = r;
      this.tunnelSeeds[i * 4 + 1] = angle;
      this.tunnelSeeds[i * 4 + 2] = z;
      this.tunnelSeeds[i * 4 + 3] = speedMult;
    }
    const tunnelGeo = new THREE.BufferGeometry();
    tunnelGeo.setAttribute('position', new THREE.BufferAttribute(this.tunnelPositions, 3));
    this.tunnelMat = new THREE.LineBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.hyperspaceLines = new THREE.LineSegments(tunnelGeo, this.tunnelMat);
    this.hyperspaceLines.frustumCulled = false;
    this.hyperspaceLines.visible = false;
    scene.add(this.hyperspaceLines);

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
      // Place starfield far beyond all planetary orbits (90km..118km < camera.far 160km)
      const r = 90000 + Math.random() * 28000;
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
      size: 3.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    });
    this.starPoints = new THREE.Points(starGeo, starMat);
    this.starPoints.frustumCulled = false;
    this.starPoints.renderOrder = -10;
    scene.add(this.starPoints);

    // 3. System-Center Procedural Sun Sphere + Dual-Layer Corona Glow Halo + Balanced Lighting Rig
    this.sunGroup = new THREE.Group();
    this.sunGroup.position.set(0, 0, 0);

    this.sunCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1, fog: false });
    const sunCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1400, 2), this.sunCoreMat);
    this.sunGroup.add(sunCore);

    const sunHaloTex = createSunCoronaTexture();
    this.sunSpriteMat = new THREE.SpriteMaterial({
      map: sunHaloTex,
      color: 0xffd188,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.sunSprite = new THREE.Sprite(this.sunSpriteMat);
    this.sunSprite.scale.set(5600, 5600, 1);
    this.sunGroup.add(this.sunSprite);

    this.sunOuterSpriteMat = new THREE.SpriteMaterial({
      map: sunHaloTex,
      color: 0xffd188,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.sunOuterSprite = new THREE.Sprite(this.sunOuterSpriteMat);
    this.sunOuterSprite.scale.set(11200, 11200, 1);
    this.sunGroup.add(this.sunOuterSprite);

    scene.add(this.sunGroup);

    // Warm Key DirectionalLight paired with cool blue-purple HemisphereLight & subtle AmbientLight
    this.sunLight = new THREE.DirectionalLight(0xffe7c2, 2.75);
    this.sunLight.position.set(0, 200, 1000);
    this.sunLight.castShadow = !isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 50;
    this.sunLight.shadow.camera.far = 2200;
    this.sunLight.shadow.camera.left = -450;
    this.sunLight.shadow.camera.right = 450;
    this.sunLight.shadow.camera.top = 450;
    this.sunLight.shadow.camera.bottom = -450;
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

  public readonly sunCoreRadius = 1400;
  public readonly sunScoopRadius = 3800;

  public getSunWorldPosition(): THREE.Vector3 {
    return this.sunGroup.position;
  }

  public setSunAppearance(coreHex: number, coronaHex: number, lightHex: number): void {
    this.sunCoreMat.color.setHex(coreHex);
    this.sunSpriteMat.color.setHex(coronaHex);
    this.sunOuterSpriteMat.color.setHex(coronaHex);
    this.sunLight.color.setHex(lightHex);
  }

  public updateSunLightFocus(focusPos: THREE.Vector3): void {
    // Aim directional light from the system-center Sun through focusPos so all planets & station facets get true terminator shading
    _relVel.copy(this.sunGroup.position).sub(focusPos);
    const len = _relVel.length();
    if (len > 1) {
      _relVel.divideScalar(len);
    } else {
      _relVel.set(0.5, 0.4, 0.7).normalize();
    }
    this.sunLight.target.position.copy(focusPos);
    this.sunLight.position.copy(focusPos).addScaledVector(_relVel, 950);
    this.sunLight.target.updateMatrixWorld();
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
    warpBoost = 0,
    cruiseBoost = 0
  ): void {
    this.timeAccum += dt;

    // Gentle living pulse on the stellar corona glow
    const pulse = 1 + Math.sin(this.timeAccum * 1.45) * 0.04;
    this.sunSprite.scale.set(5600 * pulse, 5600 * pulse, 1);
    const outerPulse = 1 + Math.cos(this.timeAccum * 0.95) * 0.06;
    this.sunOuterSprite.scale.set(11200 * outerPulse, 11200 * outerPulse, 1);
    this.sunOuterSpriteMat.opacity = 0.44 + Math.sin(this.timeAccum * 1.2) * 0.06;

    // Keep stars centered on ship
    this.starPoints.position.copy(shipPos);

    // Update wrapping space dust streaks relative to ship position (dramatically stretched in Cruise Drive)
    _relVel.copy(shipVelocity);
    const speed = _relVel.length();
    const normalStreak = Math.max(0.55, Math.min(18, speed * 0.075));
    const streakLen = normalStreak + cruiseBoost * 42 + warpBoost * 46;
    this.dustMat.opacity = 0.42 + cruiseBoost * 0.4;
    this.dustMat.color.copy(this.dustBaseColor).lerp(this.dustCruiseColor, cruiseBoost);

    if (warpBoost > 0.05 || cruiseBoost > 0.15) {
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

    // Update Hyperspace Tunnel streaking star-lines during countdown
    if (warpBoost > 0.01) {
      this.hyperspaceLines.visible = true;
      this.hyperspaceLines.position.copy(shipPos);
      this.hyperspaceLines.quaternion.setFromUnitVectors(_negZ, shipForward);
      this.tunnelMat.opacity = Math.min(0.95, 0.25 + warpBoost * 0.72);
      this.tunnelMat.color.setHex(warpBoost > 0.7 ? 0xf0f9ff : 0x7dd3fc);

      const tAttr = this.hyperspaceLines.geometry.attributes.position as THREE.BufferAttribute;
      const tArr = tAttr.array as Float32Array;
      const tunnelSpeed = 160 + warpBoost * warpBoost * 980;
      const lineLen = 10 + warpBoost * 92;

      for (let i = 0; i < HYPERSPACE_LINE_COUNT; i++) {
        const r = this.tunnelSeeds[i * 4];
        const ang = this.tunnelSeeds[i * 4 + 1];
        let z = this.tunnelSeeds[i * 4 + 2];
        const sMult = this.tunnelSeeds[i * 4 + 3];

        z += tunnelSpeed * sMult * dt;
        if (z > 24) {
          z -= HYPERSPACE_DEPTH;
        }
        this.tunnelSeeds[i * 4 + 2] = z;

        const radScale = 1 - warpBoost * 0.18;
        const x = Math.cos(ang) * r * radScale;
        const y = Math.sin(ang) * r * radScale;

        tArr[i * 6] = x;
        tArr[i * 6 + 1] = y;
        tArr[i * 6 + 2] = z;
        tArr[i * 6 + 3] = x * 1.03;
        tArr[i * 6 + 4] = y * 1.03;
        tArr[i * 6 + 5] = z - lineLen * sMult;
      }
      tAttr.needsUpdate = true;
    } else {
      this.hyperspaceLines.visible = false;
    }

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
