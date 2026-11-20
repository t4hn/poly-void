import type { DockingAlignment, RadarBlip, TargetKind, Vec3Like } from './types';

export const THROTTLE_MIN = -0.35;
export const THROTTLE_MAX = 1.0;
export const DOCKING_SAFE_SPEED_MPS = 85;
export const DOCKING_APPROACH_RANGE_M = 600;
export const DOCKING_BAY_CAPTURE_RADIUS_M = 74;
export const AUTO_DOCK_MAX_RANGE_M = 2000;

export function clampThrottle(value: number): number {
  return Math.max(THROTTLE_MIN, Math.min(THROTTLE_MAX, value));
}

export function stepThrottle(
  current: number,
  deltaInput: number,
  dt: number,
  rate = 0.65
): number {
  if (deltaInput === 0) return current;
  const next = current + deltaInput * rate * dt;
  // Snap cleanly across 0 when decelerating from positive to negative
  if (current > 0 && next < 0 && Math.abs(current) < 0.08) {
    return 0;
  }
  return clampThrottle(next);
}

export function computePitchSign(invertPitch: boolean): number {
  // Default: W pitches nose DOWN (-1 around local X), S pitches nose UP (+1)
  // Inverted: W pitches nose UP (+1), S pitches nose DOWN (-1)
  return invertPitch ? 1 : -1;
}

export function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * alpha;
}

export function formatDistance(distanceMeters: number): string {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

export function evaluateDockingAlignment(params: {
  shipPos: Vec3Like;
  shipForward: Vec3Like;
  shipSpeedMps: number;
  bayPos: Vec3Like;
  bayOutwardNormal: Vec3Like;
}): DockingAlignment {
  const { shipPos, shipForward, shipSpeedMps, bayPos, bayOutwardNormal } = params;

  const dx = shipPos.x - bayPos.x;
  const dy = shipPos.y - bayPos.y;
  const dz = shipPos.z - bayPos.z;
  const distanceMeters = Math.hypot(dx, dy, dz);

  // Project ship displacement onto bay outward normal
  const normalLen = Math.hypot(bayOutwardNormal.x, bayOutwardNormal.y, bayOutwardNormal.z) || 1;
  const nx = bayOutwardNormal.x / normalLen;
  const ny = bayOutwardNormal.y / normalLen;
  const nz = bayOutwardNormal.z / normalLen;

  const alongNormal = dx * nx + dy * ny + dz * nz;
  const perpX = dx - alongNormal * nx;
  const perpY = dy - alongNormal * ny;
  const perpZ = dz - alongNormal * nz;
  const lateralOffset = Math.hypot(perpX, perpY, perpZ);

  // Corridor angle: angle between bay outward normal and vector from bay to ship
  const distSafe = distanceMeters || 1;
  const dirDot = Math.max(-1, Math.min(1, alongNormal / distSafe));
  const corridorAngleDeg = (Math.acos(dirDot) * 180) / Math.PI;

  // Ship facing angle relative to -bayOutwardNormal (looking INTO the bay)
  const fwdLen = Math.hypot(shipForward.x, shipForward.y, shipForward.z) || 1;
  const fx = shipForward.x / fwdLen;
  const fy = shipForward.y / fwdLen;
  const fz = shipForward.z / fwdLen;
  const facingDot = Math.max(-1, Math.min(1, -(fx * nx + fy * ny + fz * nz)));
  const facingAngleDeg = (Math.acos(facingDot) * 180) / Math.PI;

  const isSpeedSafe = shipSpeedMps <= DOCKING_SAFE_SPEED_MPS;
  const isCorridorAligned =
    alongNormal > -40 && corridorAngleDeg <= 46 && lateralOffset <= Math.max(64, distanceMeters * 0.55);
  const isOrientationAligned = facingAngleDeg <= 55;
  const inApproachRange = distanceMeters <= DOCKING_APPROACH_RANGE_M;

  const isInsideBay =
    distanceMeters <= DOCKING_BAY_CAPTURE_RADIUS_M &&
    lateralOffset <= 48 &&
    alongNormal > -45 &&
    alongNormal < 56;

  const isReadyToDock =
    inApproachRange && isCorridorAligned && isOrientationAligned && isSpeedSafe;

  let statusLabel = 'STANDBY — APPROACH BAY';
  if (isInsideBay && isSpeedSafe) {
    statusLabel = 'BAY CAPTURE — DOCKING';
  } else if (isInsideBay && !isSpeedSafe) {
    statusLabel = 'REDUCE SPEED TO DOCK';
  } else if (isReadyToDock) {
    statusLabel = 'CORRIDOR ALIGNED — ENTER BAY';
  } else if (inApproachRange && isCorridorAligned && !isSpeedSafe) {
    statusLabel = `SLOW DOWN <= ${DOCKING_SAFE_SPEED_MPS} M/S`;
  } else if (inApproachRange && !isCorridorAligned) {
    statusLabel = 'ALIGN WITH CYAN BEACONS';
  } else if (distanceMeters <= 1200) {
    statusLabel = 'APPROACH CORRIDOR OPEN';
  }

  return {
    distanceMeters,
    speedMps: shipSpeedMps,
    lateralOffset,
    facingAngleDeg,
    corridorAngleDeg,
    isSpeedSafe,
    isCorridorAligned,
    isOrientationAligned,
    isReadyToDock,
    isInsideBay,
    statusLabel,
  };
}

/**
 * Projects a world-space target into the player ship's local radar frame.
 * Right (+X), Up (+Y), Forward (-Z in Three.js ship local coordinates).
 */
export function projectToRadarBlip(params: {
  id: string;
  kind: TargetKind;
  worldOffset: Vec3Like;
  shipRight: Vec3Like;
  shipUp: Vec3Like;
  shipForward: Vec3Like;
  radarRange: number;
}): RadarBlip {
  const { id, kind, worldOffset, shipRight, shipUp, shipForward, radarRange } = params;
  const localRight =
    worldOffset.x * shipRight.x + worldOffset.y * shipRight.y + worldOffset.z * shipRight.z;
  const localUp =
    worldOffset.x * shipUp.x + worldOffset.y * shipUp.y + worldOffset.z * shipUp.z;
  const localForward =
    worldOffset.x * shipForward.x + worldOffset.y * shipForward.y + worldOffset.z * shipForward.z;

  // Map horizontal plane (right, forward) onto unit disc, clamping outside range to perimeter
  const horizDist = Math.hypot(localRight, localForward);
  const maxR = Math.max(1, radarRange);
  let rx = localRight / maxR;
  let rz = -localForward / maxR; // -forward => top of radar disc is ahead (-Y in canvas)
  const normHoriz = Math.hypot(rx, rz);
  if (normHoriz > 1) {
    rx /= normHoriz;
    rz /= normHoriz;
  }

  const ry = Math.max(-1, Math.min(1, localUp / (maxR * 0.65)));
  void horizDist;

  return { id, kind, rx, rz, ry };
}

export function computeCollisionDamage(impactSpeed: number, massFactor = 1): number {
  if (impactSpeed < 12) return 0;
  return Math.round((impactSpeed - 10) * 0.45 * massFactor);
}
