import * as THREE from 'three';
import { attachFacetOutlines, createFlatMaterial } from './LowPolyHelpers';
import type { PlanetSpec, SystemLayoutPlan } from './systemLayout';

interface PlanetRuntime {
  spec: PlanetSpec;
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  moonPivot: THREE.Group | null;
  moonMesh: THREE.Mesh | null;
  spinSpeed: number;
}

interface ShuttleRuntime {
  group: THREE.Group;
  center: THREE.Vector3;
  radiusA: number;
  radiusB: number;
  tiltY: number;
  phase: number;
  angularSpeed: number;
  prevPos: THREE.Vector3;
  trailMesh: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
}

const _nextPos = new THREE.Vector3();
const _lookAhead = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _lookMat = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();

function createPlanetMesh(spec: PlanetSpec): {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  disposables: Array<{ dispose: () => void }>;
} {
  const disposables: Array<{ dispose: () => void }> = [];
  const group = new THREE.Group();
  group.position.set(spec.position.x, spec.position.y, spec.position.z);

  const detail = 3;
  const geo = new THREE.IcosahedronGeometry(spec.radius, detail);
  // Convert to non-indexed so every triangle gets crisp flat-shaded per-facet colors!
  const flatGeo = geo.index ? geo.toNonIndexed() : geo;
  if (flatGeo !== geo) geo.dispose();

  const posAttr = flatGeo.attributes.position as THREE.BufferAttribute;
  const vertCount = posAttr.count;
  const colors = new Float32Array(vertCount * 3);

  const cPrimary = new THREE.Color(spec.primaryColorHex);
  const cSecondary = new THREE.Color(spec.secondaryColorHex);
  const cAccent = new THREE.Color(spec.accentColorHex);
  const tmpColor = new THREE.Color();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const center = new THREE.Vector3();

  const elevationAt = (nx: number, ny: number, nz: number): number => {
    const s = spec.seed * 0.137;
    const n1 = Math.sin(nx * 3.1 + s) * Math.cos(ny * 2.7 - s * 0.6) * Math.sin(nz * 3.4 + s * 0.4);
    const n2 = Math.sin(nx * 6.7 - s * 1.4) * Math.cos(nz * 5.9 + s * 0.8) * 0.45;
    return n1 + n2;
  };

  const vertexScaleAt = (v: THREE.Vector3): number => {
    if (spec.archetype === 'gas_giant') return 1;
    const len = v.length() || 1;
    const n = elevationAt(v.x / len, v.y / len, v.z / len);
    if (spec.archetype === 'terrestrial') {
      return n > 0.08 ? 1 + Math.min(0.036, (n - 0.08) * 0.05) : 1;
    }
    if (spec.archetype === 'volcanic') {
      return n < -0.18 ? 0.968 : 1 + Math.max(0, n) * 0.03;
    }
    return 1 + n * 0.034;
  };

  for (let i = 0; i < vertCount; i += 3) {
    va.fromBufferAttribute(posAttr, i);
    vb.fromBufferAttribute(posAttr, i + 1);
    vc.fromBufferAttribute(posAttr, i + 2);
    center.copy(va).add(vb).add(vc).multiplyScalar(1 / 3).normalize();

    const lat = Math.abs(center.y);
    const n = elevationAt(center.x, center.y, center.z);

    if (spec.archetype !== 'gas_giant') {
      va.multiplyScalar(vertexScaleAt(va));
      vb.multiplyScalar(vertexScaleAt(vb));
      vc.multiplyScalar(vertexScaleAt(vc));
      posAttr.setXYZ(i, va.x, va.y, va.z);
      posAttr.setXYZ(i + 1, vb.x, vb.y, vb.z);
      posAttr.setXYZ(i + 2, vc.x, vc.y, vc.z);
    }

    if (spec.archetype === 'terrestrial') {
      if (lat > 0.82) {
        tmpColor.copy(cAccent);
      } else if (n > 0.08) {
        tmpColor.copy(cSecondary).lerp(cAccent, Math.max(0, (n - 0.45) * 0.55));
      } else {
        tmpColor.copy(cPrimary);
      }
    } else if (spec.archetype === 'volcanic') {
      if (n < -0.18) {
        tmpColor.copy(cAccent);
      } else {
        tmpColor.copy(n > 0.25 ? cSecondary : cPrimary);
      }
    } else if (spec.archetype === 'gas_giant') {
      const band = Math.sin(center.y * 11.5 + n * 0.65);
      if (band > 0.35) {
        tmpColor.copy(cAccent);
      } else if (band < -0.25) {
        tmpColor.copy(cSecondary);
      } else {
        tmpColor.copy(cPrimary);
      }
    } else {
      tmpColor.copy(n > 0.22 ? cAccent : n < -0.15 ? cSecondary : cPrimary);
    }

    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = tmpColor.r;
      colors[(i + k) * 3 + 1] = tmpColor.g;
      colors[(i + k) * 3 + 2] = tmpColor.b;
    }
  }

  flatGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flatGeo.computeVertexNormals();
  flatGeo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: spec.archetype === 'gas_giant' ? 0.72 : 0.84,
    metalness: 0.08,
    fog: false,
  });

  const bodyMesh = new THREE.Mesh(flatGeo, mat);
  if (spec.archetype === 'gas_giant') {
    bodyMesh.scale.set(1, 0.91, 1);
  }
  bodyMesh.receiveShadow = true;
  attachFacetOutlines(bodyMesh, 0x050811, 24, 0.16);
  group.add(bodyMesh);
  disposables.push(flatGeo, mat);

  // Glowing molten core underneath volcanic rifts
  if (spec.archetype === 'volcanic') {
    const magmaGeo = new THREE.IcosahedronGeometry(spec.radius * 0.978, 2);
    const magmaMat = new THREE.MeshBasicMaterial({
      color: spec.accentColorHex,
      fog: false,
    });
    const magmaMesh = new THREE.Mesh(magmaGeo, magmaMat);
    group.add(magmaMesh);
    disposables.push(magmaGeo, magmaMat);
  }

  // Subtle atmospheric rim halo shell
  const atmoGeo = new THREE.IcosahedronGeometry(spec.radius * 1.055, 2);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: spec.atmosphereColorHex,
    transparent: true,
    opacity: spec.archetype === 'terrestrial' ? 0.16 : 0.11,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
  if (spec.archetype === 'gas_giant') {
    atmoMesh.scale.set(1, 0.91, 1);
  }
  group.add(atmoMesh);
  disposables.push(atmoGeo, atmoMat);

  // Flat-shaded concentric ring meshes for ringed gas giants
  if (spec.hasRings) {
    const ringGroup = new THREE.Group();
    ringGroup.rotation.x = Math.PI / 2 + spec.ringTiltX;
    ringGroup.rotation.z = spec.ringTiltZ;

    const span = spec.ringOuterRadius - spec.ringInnerRadius;
    const bands = [
      { inner: spec.ringInnerRadius, outer: spec.ringInnerRadius + span * 0.34, color: spec.ringColorB, opacity: 0.78 },
      { inner: spec.ringInnerRadius + span * 0.4, outer: spec.ringInnerRadius + span * 0.78, color: spec.ringColorA, opacity: 0.86 },
      { inner: spec.ringInnerRadius + span * 0.84, outer: spec.ringOuterRadius, color: spec.ringColorB, opacity: 0.56 },
    ];

    for (const band of bands) {
      const rGeo = new THREE.RingGeometry(band.inner, band.outer, 28, 1);
      const rMat = new THREE.MeshStandardMaterial({
        color: band.color,
        flatShading: true,
        roughness: 0.78,
        metalness: 0.15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: band.opacity,
        fog: false,
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      attachFacetOutlines(rMesh, 0x050811, 20, 0.42);
      ringGroup.add(rMesh);
      disposables.push(rGeo, rMat);
    }

    group.add(ringGroup);
  }

  return { group, bodyMesh, disposables };
}

export class PlanetSystem {
  public readonly group = new THREE.Group();
  public planets: PlanetRuntime[] = [];
  public navBeaconGroup: THREE.Group | null = null;
  public shuttles: ShuttleRuntime[] = [];

  private beaconStrobeMat: THREE.MeshStandardMaterial | null = null;
  private beaconRingMat: THREE.MeshStandardMaterial | null = null;
  private disposables: Array<{ dispose: () => void }> = [];
  private elapsed = 0;

  constructor(layout: SystemLayoutPlan) {
    this.reset(layout);
  }

  public reset(layout: SystemLayoutPlan): void {
    // Clean up previous meshes & geometries/materials
    for (const p of this.planets) {
      this.group.remove(p.group);
    }
    if (this.navBeaconGroup) {
      this.group.remove(this.navBeaconGroup);
      this.navBeaconGroup = null;
    }
    for (const s of this.shuttles) {
      this.group.remove(s.group);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.planets = [];
    this.shuttles = [];
    this.disposables = [];
    this.beaconStrobeMat = null;
    this.beaconRingMat = null;

    // 1. Build 1..3 procedural low-poly planets (+ moons & rings)
    for (const spec of layout.planets) {
      const built = createPlanetMesh(spec);
      let moonPivot: THREE.Group | null = null;
      let moonMesh: THREE.Mesh | null = null;

      if (spec.hasMoon) {
        moonPivot = new THREE.Group();
        moonPivot.rotation.z = 0.22;
        const mGeo = new THREE.IcosahedronGeometry(spec.moonRadius, 2);
        const mMat = createFlatMaterial(spec.moonColorHex, {
          roughness: 0.9,
          metalness: 0.1,
        });
        mMat.fog = false;
        moonMesh = new THREE.Mesh(mGeo, mMat);
        moonMesh.position.set(spec.moonOrbitRadius, 120, 0);
        attachFacetOutlines(moonMesh, 0x050811, 18, 0.4);
        moonPivot.add(moonMesh);
        built.group.add(moonPivot);
        this.disposables.push(mGeo, mMat);
      }

      this.group.add(built.group);
      this.disposables.push(...built.disposables);
      this.planets.push({
        spec,
        group: built.group,
        bodyMesh: built.bodyMesh,
        moonPivot,
        moonMesh,
        spinSpeed: spec.archetype === 'gas_giant' ? 0.018 : 0.011,
      });
    }

    // 2. Build Blinking Nav Beacon Buoy near the Station approach corridor
    this.buildNavBeacon(layout.navBeaconPosition);

    // 3. Build 3 peaceful NPC Cargo Shuttles on orbital trade loops near the Station
    this.buildCargoShuttles(layout);
  }

  private buildNavBeacon(pos: { x: number; y: number; z: number }): void {
    const beacon = new THREE.Group();
    beacon.position.set(pos.x, pos.y, pos.z);

    const hullGeo = new THREE.CylinderGeometry(5.5, 5.5, 16, 8);
    const hullMat = createFlatMaterial(0x334155, { roughness: 0.5, metalness: 0.65 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    attachFacetOutlines(hull, 0x050811, 15, 0.85);
    beacon.add(hull);

    const collarGeo = new THREE.TorusGeometry(8.5, 1.3, 6, 8);
    this.beaconRingMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.5,
      roughness: 0.3,
      flatShading: true,
    });
    const collar = new THREE.Mesh(collarGeo, this.beaconRingMat);
    collar.rotation.x = Math.PI / 2;
    beacon.add(collar);

    const finGeo = new THREE.BoxGeometry(22, 1.2, 4.5);
    const finMat = createFlatMaterial(0x1e3a5f, { roughness: 0.35, metalness: 0.7 });
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.rotation.y = (i * Math.PI) / 2;
      attachFacetOutlines(fin, 0x050811, 15, 0.8);
      beacon.add(fin);
    }

    const mastGeo = new THREE.CylinderGeometry(0.8, 1.8, 22, 6);
    const mast = new THREE.Mesh(mastGeo, hullMat);
    mast.position.y = 16;
    beacon.add(mast);

    const strobeGeo = new THREE.OctahedronGeometry(4.2, 0);
    this.beaconStrobeMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.8,
      roughness: 0.2,
      flatShading: true,
    });
    const strobe = new THREE.Mesh(strobeGeo, this.beaconStrobeMat);
    strobe.position.y = 28;
    beacon.add(strobe);

    this.disposables.push(
      hullGeo,
      hullMat,
      collarGeo,
      this.beaconRingMat,
      finGeo,
      finMat,
      mastGeo,
      strobeGeo,
      this.beaconStrobeMat
    );
    this.navBeaconGroup = beacon;
    this.group.add(beacon);
  }

  private buildCargoShuttles(layout: SystemLayoutPlan): void {
    const bodyGeo = new THREE.BoxGeometry(7.2, 5.2, 18);
    const prowGeo = new THREE.ConeGeometry(4.6, 8.5, 4);
    prowGeo.rotateX(-Math.PI / 2);
    prowGeo.rotateZ(Math.PI / 4);
    const wingGeo = new THREE.BoxGeometry(19, 1.2, 6.2);
    const podGeo = new THREE.CylinderGeometry(1.6, 1.9, 9, 6);
    podGeo.rotateX(Math.PI / 2);
    const trailGeo = new THREE.ConeGeometry(1.4, 28, 6);
    trailGeo.rotateX(Math.PI / 2);

    const hullColors = [0x94a3b8, 0xcbd5e1, 0xd97706];
    const trimColors = [0x0284c7, 0x10b981, 0xf59e0b];

    const stationPos = new THREE.Vector3(
      layout.stationPosition.x,
      layout.stationPosition.y,
      layout.stationPosition.z
    );
    const facing = new THREE.Vector3(
      layout.stationBayFacing.x,
      layout.stationBayFacing.y,
      layout.stationBayFacing.z
    );

    this.disposables.push(bodyGeo, prowGeo, wingGeo, podGeo, trailGeo);

    for (let i = 0; i < 3; i++) {
      const shuttle = new THREE.Group();
      const hullMat = createFlatMaterial(hullColors[i], { roughness: 0.65, metalness: 0.35 });
      const accentMat = createFlatMaterial(trimColors[i], { roughness: 0.4, metalness: 0.6 });
      const trailMat = new THREE.MeshBasicMaterial({
        color: i === 2 ? 0xfbbf24 : 0x38bdf8,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const body = new THREE.Mesh(bodyGeo, hullMat);
      attachFacetOutlines(body, 0x050811, 15, 0.8);
      shuttle.add(body);

      const prow = new THREE.Mesh(prowGeo, accentMat);
      prow.position.z = -12.5;
      attachFacetOutlines(prow, 0x050811, 15, 0.8);
      shuttle.add(prow);

      const wing = new THREE.Mesh(wingGeo, accentMat);
      wing.position.set(0, -0.5, 2.5);
      attachFacetOutlines(wing, 0x050811, 15, 0.8);
      shuttle.add(wing);

      [-7.6, 7.6].forEach((px) => {
        const pod = new THREE.Mesh(podGeo, hullMat);
        pod.position.set(px, -0.4, 3.5);
        attachFacetOutlines(pod, 0x050811, 15, 0.75);
        shuttle.add(pod);

        const trail = new THREE.Mesh(trailGeo, trailMat);
        trail.position.set(px, -0.4, 21.5);
        shuttle.add(trail);
      });

      const centerTrail = new THREE.Mesh(trailGeo, trailMat);
      centerTrail.position.set(0, 0, 22);
      centerTrail.scale.set(1.2, 1.2, 1.35);
      shuttle.add(centerTrail);

      const center = stationPos.clone().addScaledVector(facing, 420 + i * 240);
      const radiusA = 360 + i * 190;
      const radiusB = 260 + i * 145;
      const tiltY = (i - 1) * 0.24;
      const phase = i * 2.1;
      const angularSpeed = (i % 2 === 0 ? 1 : -1) * (0.095 - i * 0.015);

      shuttle.position.set(
        center.x + Math.cos(phase) * radiusA,
        center.y + Math.sin(phase * 2) * 85,
        center.z + Math.sin(phase) * radiusB
      );

      this.disposables.push(hullMat, accentMat, trailMat);
      this.group.add(shuttle);

      this.shuttles.push({
        group: shuttle,
        center,
        radiusA,
        radiusB,
        tiltY,
        phase,
        angularSpeed,
        prevPos: shuttle.position.clone(),
        trailMesh: centerTrail,
        trailMat,
      });
    }
  }

  public update(dt: number): void {
    this.elapsed += dt;

    for (const p of this.planets) {
      p.bodyMesh.rotation.y += p.spinSpeed * dt;
      if (p.moonPivot && p.moonMesh) {
        p.moonPivot.rotation.y += p.spec.moonOrbitSpeed * dt;
        p.moonMesh.rotation.y += 0.05 * dt;
      }
    }

    if (this.navBeaconGroup && this.beaconStrobeMat && this.beaconRingMat) {
      this.navBeaconGroup.rotation.y += 0.45 * dt;
      const blink = Math.sin(this.elapsed * 5.2) > 0.25;
      this.beaconStrobeMat.emissiveIntensity = blink ? 3.6 : 0.25;
      this.beaconRingMat.emissiveIntensity = 1.1 + 0.65 * Math.sin(this.elapsed * 2.8);
    }

    for (let i = 0; i < this.shuttles.length; i++) {
      const s = this.shuttles[i];
      s.phase += s.angularSpeed * dt;
      const cos = Math.cos(s.phase);
      const sin = Math.sin(s.phase);
      _nextPos.set(
        s.center.x + cos * s.radiusA,
        s.center.y + Math.sin(s.phase * 2) * 90 + cos * s.radiusA * s.tiltY,
        s.center.z + sin * s.radiusB
      );

      // Compute forward tangent for shuttle nose orientation
      _tangent.copy(_nextPos).sub(s.prevPos);
      if (_tangent.lengthSq() > 0.0001) {
        _tangent.normalize();
        _lookAhead.copy(_nextPos).add(_tangent);
        _lookMat.lookAt(_nextPos, _lookAhead, _up);
        _targetQuat.setFromRotationMatrix(_lookMat);
        s.group.quaternion.slerp(_targetQuat, 1 - Math.exp(-6 * dt));
      }
      s.prevPos.copy(_nextPos);
      s.group.position.copy(_nextPos);

      const flicker = 0.88 + Math.sin(this.elapsed * 18 + i * 2) * 0.14;
      s.trailMesh.scale.set(1.15, 1.15, 1.3 * flicker);
      s.trailMat.opacity = 0.58 + Math.sin(this.elapsed * 14 + i) * 0.16;
    }
  }
}
