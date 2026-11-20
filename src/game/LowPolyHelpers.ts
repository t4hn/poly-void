import * as THREE from 'three';

export function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createFlatMaterial(
  color: THREE.ColorRepresentation,
  options?: {
    roughness?: number;
    metalness?: number;
    emissive?: THREE.ColorRepresentation;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    side?: THREE.Side;
  }
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: options?.roughness ?? 0.65,
    metalness: options?.metalness ?? 0.2,
    emissive: options?.emissive ?? 0x000000,
    emissiveIntensity: options?.emissiveIntensity ?? 1,
    transparent: options?.transparent ?? false,
    opacity: options?.opacity ?? 1,
    side: options?.side ?? THREE.FrontSide,
  });
}

const sharedLineMaterialCache = new Map<number, THREE.LineBasicMaterial>();

export function getEdgeLineMaterial(
  color = 0x050811,
  opacity = 0.78
): THREE.LineBasicMaterial {
  const key = (color << 8) | Math.round(opacity * 255);
  let mat = sharedLineMaterialCache.get(key);
  if (!mat) {
    mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: true,
    });
    sharedLineMaterialCache.set(key, mat);
  }
  return mat;
}

export function attachFacetOutlines(
  mesh: THREE.Mesh,
  color = 0x050811,
  thresholdAngle = 15,
  opacity = 0.78
): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(mesh.geometry, thresholdAngle);
  const lines = new THREE.LineSegments(edges, getEdgeLineMaterial(color, opacity));
  lines.raycast = () => {}; // never interfere with raycasting
  mesh.add(lines);
  return lines;
}

export function createSunCoronaTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, 4, cx, cx, cx);
    grad.addColorStop(0, 'rgba(255, 250, 232, 1.0)');
    grad.addColorStop(0.18, 'rgba(255, 218, 145, 0.85)');
    grad.addColorStop(0.45, 'rgba(255, 162, 82, 0.30)');
    grad.addColorStop(0.75, 'rgba(130, 100, 210, 0.08)');
    grad.addColorStop(1, 'rgba(9, 13, 22, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
