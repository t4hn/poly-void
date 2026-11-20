import * as THREE from 'three';
import { attachFacetOutlines, createFlatMaterial } from './LowPolyHelpers';

const _bayWorldPos = new THREE.Vector3();
const _bayNormal = new THREE.Vector3();

export class Station {
  public readonly group: THREE.Group;
  public name = 'LAVE ORBITAL // CORIOLIS HUB';
  public readonly collisionRadius = 152;
  private readonly spinGroup: THREE.Group;
  private readonly bayAnchor: THREE.Object3D;
  private readonly beaconStrips: THREE.MeshStandardMaterial[] = [];
  private readonly strobeMeshes: THREE.MeshStandardMaterial[] = [];
  private readonly rotationSpeed = 0.14; // rad/s around Z axis
  private elapsed = 0;

  constructor(position = new THREE.Vector3(0, 0, -680)) {
    this.group = new THREE.Group();
    this.group.position.copy(position);

    this.spinGroup = new THREE.Group();
    this.group.add(this.spinGroup);

    const hullMat = createFlatMaterial(0x4a5568, { roughness: 0.72, metalness: 0.35 });
    const armorMat = createFlatMaterial(0x2d3748, { roughness: 0.55, metalness: 0.5 });
    const trimMat = createFlatMaterial(0x94a3b8, { roughness: 0.35, metalness: 0.75 });
    const darkInteriorMat = createFlatMaterial(0x0b111e, {
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const solarPanelMat = createFlatMaterial(0x1e3a5f, { roughness: 0.25, metalness: 0.75 });
    const cyanGlowMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x22d3ee,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.1,
      flatShading: true,
    });
    const amberGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.1,
      flatShading: true,
    });
    const windowGlowMat = new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
      roughness: 0.3,
      flatShading: true,
    });

    // 1. Main Hexagonal Core Body (Z-aligned)
    const coreGeo = new THREE.CylinderGeometry(124, 124, 190, 6, 1);
    coreGeo.rotateX(Math.PI / 2);
    const coreMesh = new THREE.Mesh(coreGeo, hullMat);
    coreMesh.castShadow = true;
    coreMesh.receiveShadow = true;
    attachFacetOutlines(coreMesh, 0x060a14, 15, 0.85);
    this.spinGroup.add(coreMesh);

    // 2. Rear Chamfered Cap & Thruster/Reactor Cone
    const rearCapGeo = new THREE.CylinderGeometry(124, 86, 46, 6, 1);
    rearCapGeo.rotateX(Math.PI / 2);
    const rearCap = new THREE.Mesh(rearCapGeo, armorMat);
    rearCap.position.z = -118;
    rearCap.castShadow = true;
    rearCap.receiveShadow = true;
    attachFacetOutlines(rearCap, 0x060a14, 15, 0.85);
    this.spinGroup.add(rearCap);

    const reactorRingGeo = new THREE.CylinderGeometry(42, 54, 24, 6, 1);
    reactorRingGeo.rotateX(Math.PI / 2);
    const reactorRing = new THREE.Mesh(reactorRingGeo, trimMat);
    reactorRing.position.z = -148;
    attachFacetOutlines(reactorRing, 0x060a14, 15, 0.8);
    this.spinGroup.add(reactorRing);

    const reactorCore = new THREE.Mesh(
      new THREE.CylinderGeometry(28, 28, 6, 6),
      cyanGlowMat
    );
    reactorCore.rotation.x = Math.PI / 2;
    reactorCore.position.z = -158;
    this.spinGroup.add(reactorCore);

    // 3. Front Chamfered Hexagonal Collar Framing the Recessed Docking Bay (+Z face)
    // We build a hollow hexagonal-framed front face using 4 thick armor slabs around the 54x28 bay opening
    const frontZ = 108;
    const frontRingGeo = new THREE.CylinderGeometry(96, 124, 34, 6, 1);
    frontRingGeo.rotateX(Math.PI / 2);
    const frontRing = new THREE.Mesh(frontRingGeo, armorMat);
    frontRing.position.z = 94;
    frontRing.castShadow = true;
    frontRing.receiveShadow = true;
    attachFacetOutlines(frontRing, 0x060a14, 15, 0.85);
    this.spinGroup.add(frontRing);

    // Armor bulkhead face plate around the carved docking slot (bay opening = width 52, height 26)
    // Built as a true hexagonal shape with a rectangular central cutout so corners align flush with frontRing
    const hexRadius = 97;
    const faceShape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      // Match CylinderGeometry(6) vertex orientation (vertex at top/bottom: angle = i * PI/3 + PI/6)
      const a = (i * Math.PI) / 3 + Math.PI / 6;
      const hx = Math.cos(a) * hexRadius;
      const hy = Math.sin(a) * hexRadius;
      if (i === 0) faceShape.moveTo(hx, hy);
      else faceShape.lineTo(hx, hy);
    }
    faceShape.closePath();

    const bayHole = new THREE.Path();
    bayHole.moveTo(-26, -13);
    bayHole.lineTo(26, -13);
    bayHole.lineTo(26, 13);
    bayHole.lineTo(-26, 13);
    bayHole.closePath();
    faceShape.holes.push(bayHole);

    const faceGeo = new THREE.ExtrudeGeometry(faceShape, {
      depth: 26,
      bevelEnabled: true,
      bevelThickness: 2.5,
      bevelSize: 2.5,
      bevelSegments: 1,
    });
    const frontBulkhead = new THREE.Mesh(faceGeo, armorMat);
    frontBulkhead.position.set(0, 0, frontZ - 12);
    frontBulkhead.castShadow = true;
    frontBulkhead.receiveShadow = true;
    attachFacetOutlines(frontBulkhead, 0x050912, 15, 0.9);
    this.spinGroup.add(frontBulkhead);

    // Recessed Dark Hangar Interior Tunnel (extends inward from z=122 down to z=45)
    const bayWalls: Array<[number, number, number, number, number, number]> = [
      [56, 2, 74, 0, 14, 88], // Ceiling
      [56, 2, 74, 0, -14, 88], // Floor
      [2, 28, 74, -27, 0, 88], // Left wall
      [2, 28, 74, 27, 0, 88], // Right wall
      [56, 28, 2, 0, 0, 51], // Back hangar bulkhead
    ];
    bayWalls.forEach(([w, h, d, x, y, z]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkInteriorMat);
      wall.position.set(x, y, z);
      this.spinGroup.add(wall);
    });

    // Glowing Docking Bay Entrance Rim (cyan top/bottom + amber side pylons)
    const topStrip = new THREE.Mesh(new THREE.BoxGeometry(52, 2.2, 3.2), cyanGlowMat);
    topStrip.position.set(0, 13.5, frontZ + 18.5);
    this.spinGroup.add(topStrip);

    const botStrip = new THREE.Mesh(new THREE.BoxGeometry(52, 2.2, 3.2), cyanGlowMat);
    botStrip.position.set(0, -13.5, frontZ + 18.5);
    this.spinGroup.add(botStrip);

    const leftStrip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 24, 3.2), amberGlowMat);
    leftStrip.position.set(-26.5, 0, frontZ + 18.5);
    this.spinGroup.add(leftStrip);

    const rightStrip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 24, 3.2), amberGlowMat);
    rightStrip.position.set(26.5, 0, frontZ + 18.5);
    this.spinGroup.add(rightStrip);

    // Interior Hangar Guide Strips & Backstop Beacon
    for (let i = 0; i < 3; i++) {
      const zPos = 112 - i * 22;
      const stripMat = cyanGlowMat.clone();
      this.beaconStrips.push(stripMat);
      const lRail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 12), stripMat);
      lRail.position.set(-22, -11.5, zPos);
      this.spinGroup.add(lRail);

      const rRail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 12), stripMat);
      rRail.position.set(22, -11.5, zPos);
      this.spinGroup.add(rRail);
    }

    const backDockCore = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 2), amberGlowMat);
    backDockCore.position.set(0, 0, 53);
    this.spinGroup.add(backDockCore);

    // Subtle PointLight illuminating the docking mouth (within budget: 1 station light)
    const bayLight = new THREE.PointLight(0x38bdf8, 420, 240, 1.5);
    bayLight.position.set(0, 0, frontZ + 28);
    this.spinGroup.add(bayLight);

    // Approach Corridor Guide Pylons extending outward along +Z
    for (let i = 0; i < 3; i++) {
      const zDist = frontZ + 36 + i * 32;
      const pylonMat = (i === 0 ? amberGlowMat : cyanGlowMat).clone();
      this.beaconStrips.push(pylonMat);

      const framePositions: Array<[number, number]> = [
        [-31, 15],
        [31, 15],
        [-31, -15],
        [31, -15],
      ];
      framePositions.forEach(([px, py]) => {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 8), trimMat);
        strut.position.set(px, py, zDist);
        attachFacetOutlines(strut, 0x050912, 15, 0.7);
        this.spinGroup.add(strut);

        const tip = new THREE.Mesh(new THREE.OctahedronGeometry(2.3, 0), pylonMat);
        tip.position.set(px, py, zDist + 5);
        this.spinGroup.add(tip);
      });
    }

    // Anchor at exact bay threshold for docking alignment calculation
    this.bayAnchor = new THREE.Object3D();
    this.bayAnchor.position.set(0, 0, frontZ + 14);
    this.spinGroup.add(this.bayAnchor);

    // 4. Equatorial Armor Ribs & Illuminated Habitat Viewports
    const ribGeo = new THREE.CylinderGeometry(132, 132, 14, 6, 1);
    ribGeo.rotateX(Math.PI / 2);
    [-46, 46].forEach((zPos) => {
      const rib = new THREE.Mesh(ribGeo, armorMat);
      rib.position.z = zPos;
      attachFacetOutlines(rib, 0x050912, 15, 0.85);
      this.spinGroup.add(rib);
    });

    // Habitat viewport bands along the 6 hexagonal faces
    for (let f = 0; f < 6; f++) {
      const angle = (f * Math.PI) / 3 + Math.PI / 6;
      const r = 109;
      const vx = Math.cos(angle) * r;
      const vy = Math.sin(angle) * r;
      const winBand = new THREE.Mesh(new THREE.BoxGeometry(48, 4, 8), windowGlowMat);
      winBand.position.set(vx, vy, 0);
      winBand.rotation.z = angle + Math.PI / 2;
      this.spinGroup.add(winBand);
    }

    // 5. Four Radial Industrial Solar Wing Arrays
    for (let w = 0; w < 4; w++) {
      const wingGroup = new THREE.Group();
      wingGroup.rotation.z = (w * Math.PI) / 2 + Math.PI / 4;

      // Structural boom truss
      const truss = new THREE.Mesh(new THREE.BoxGeometry(10, 128, 12), trimMat);
      truss.position.y = 182;
      truss.castShadow = true;
      attachFacetOutlines(truss, 0x050912, 15, 0.8);
      wingGroup.add(truss);

      // Wing end counterweight pod
      const pod = new THREE.Mesh(new THREE.BoxGeometry(20, 18, 20), armorMat);
      pod.position.y = 248;
      attachFacetOutlines(pod, 0x050912, 15, 0.85);
      wingGroup.add(pod);

      // Left & Right Photovoltaic Panels
      [-1, 1].forEach((side) => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(36, 98, 2.5), solarPanelMat);
        panel.position.set(side * 25, 184, 0);
        panel.rotation.y = side * 0.16;
        panel.castShadow = true;
        panel.receiveShadow = true;
        attachFacetOutlines(panel, 0x0a192f, 15, 0.85);
        wingGroup.add(panel);
      });

      this.spinGroup.add(wingGroup);
    }

    // 6. Communication Spires & Navigation Beacons on Top/Bottom Hex Faces
    [1, -1].forEach((dir) => {
      const spireBase = new THREE.Mesh(
        new THREE.CylinderGeometry(10, 18, 24, 6),
        armorMat
      );
      spireBase.position.set(0, dir * 124, -18);
      if (dir < 0) spireBase.rotation.z = Math.PI;
      attachFacetOutlines(spireBase, 0x050912, 15, 0.85);
      this.spinGroup.add(spireBase);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 5, 58, 6), trimMat);
      mast.position.set(0, dir * 158, -18);
      if (dir < 0) mast.rotation.z = Math.PI;
      attachFacetOutlines(mast, 0x050912, 15, 0.8);
      this.spinGroup.add(mast);

      const dish = new THREE.Mesh(new THREE.ConeGeometry(16, 8, 6), trimMat);
      dish.position.set(0, dir * 144, -8);
      dish.rotation.x = dir * 0.7;
      attachFacetOutlines(dish, 0x050912, 15, 0.8);
      this.spinGroup.add(dish);

      const strobeMat = (dir > 0 ? cyanGlowMat : amberGlowMat).clone();
      this.strobeMeshes.push(strobeMat);
      const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(4.5, 0), strobeMat);
      beacon.position.set(0, dir * 190, -18);
      this.spinGroup.add(beacon);
    });
  }

  public update(dt: number): void {
    this.elapsed += dt;
    this.spinGroup.rotation.z += this.rotationSpeed * dt;

    // Sequential approach beacon wave so docking corridor reads clearly from afar
    for (let i = 0; i < this.beaconStrips.length; i++) {
      const wave = 0.5 + 0.5 * Math.sin(this.elapsed * 4.5 - i * 0.85);
      this.beaconStrips[i].emissiveIntensity = 1.1 + wave * 1.9;
    }

    for (let i = 0; i < this.strobeMeshes.length; i++) {
      const pulse = Math.sin(this.elapsed * 3.2 + i * Math.PI) > 0.35 ? 2.8 : 0.4;
      this.strobeMeshes[i].emissiveIntensity = pulse;
    }
  }

  public getDockingBayWorldTransform(): {
    position: THREE.Vector3;
    outwardNormal: THREE.Vector3;
  } {
    this.group.updateMatrixWorld(true);
    this.bayAnchor.getWorldPosition(_bayWorldPos);
    _bayNormal.set(0, 0, 1).transformDirection(this.bayAnchor.matrixWorld).normalize();
    return {
      position: _bayWorldPos.clone(),
      outwardNormal: _bayNormal.clone(),
    };
  }
}
