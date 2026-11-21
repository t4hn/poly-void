import type { DockingAlignment, RadarBlip, TargetKind, Vec3Like } from './types';

export const THROTTLE_MIN = -0.35;
export const THROTTLE_MAX = 1.0;
export const BASE_MAX_SPEED_MPS = 240;
export const CRUISE_SPEED_MULTIPLIER = 16;
export const CRUISE_MAX_SPEED_MPS = BASE_MAX_SPEED_MPS * CRUISE_SPEED_MULTIPLIER; // 3840 m/s (~25km in ~8-10s)
export const MASS_LOCK_CLEARANCE_M = 3000;
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

export const SCROLL_THROTTLE_STEP = 0.05;

export function applyScrollThrottleStep(
  current: number,
  deltaY: number,
  step = SCROLL_THROTTLE_STEP
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return clampThrottle(current);
  }
  // Scroll up (deltaY < 0) increases throttle; scroll down (deltaY > 0) decreases throttle
  const direction = deltaY < 0 ? 1 : -1;
  const next = current + direction * step;
  // Snap cleanly to 0% when stepping across zero from either side
  if ((current > 0.001 && next < 0) || (current < -0.001 && next > 0)) {
    return 0;
  }
  return clampThrottle(Math.round(next * 1000) / 1000);
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
  if (distanceMeters >= 10000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
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

export interface EngineAudioParams {
  gain: number;
  noiseGain: number;
  oscFreqHz: number;
  noiseFilterHz: number;
}

export function computeEngineAudioParams(
  absThrottle: number,
  active: boolean,
  muted: boolean,
  cruiseFactor = 0
): EngineAudioParams {
  const t = Math.max(0, Math.min(1, absThrottle));
  const c = Math.max(0, Math.min(1, cruiseFactor));
  if (!active || muted) {
    return {
      gain: 0,
      noiseGain: 0,
      oscFreqHz: 46,
      noiseFilterHz: 110,
    };
  }
  return {
    gain: 0.018 + t * 0.075 + c * 0.065,
    noiseGain: 0.008 + t * 0.048 + c * 0.052,
    oscFreqHz: 46 + t * 68 + c * 74,
    noiseFilterHz: 110 + t * 320 + c * 560,
  };
}

export interface MassLockBody {
  id: string;
  name: string;
  kind: TargetKind;
  position: Vec3Like;
  surfaceRadius: number;
  lockClearance?: number;
}

export interface MassLockStatus {
  locked: boolean;
  blockingBodyName: string | null;
  blockingBodyKind: TargetKind | null;
  clearanceMeters: number;
}

export function evaluateMassLock(
  shipPos: Vec3Like,
  bodies: MassLockBody[]
): MassLockStatus {
  let closestClearance = Infinity;
  let blockingBody: MassLockBody | null = null;

  for (const body of bodies) {
    const dist = Math.hypot(
      shipPos.x - body.position.x,
      shipPos.y - body.position.y,
      shipPos.z - body.position.z
    );
    const clearance = dist - body.surfaceRadius;
    const threshold = body.lockClearance ?? MASS_LOCK_CLEARANCE_M;
    if (clearance <= threshold && clearance < closestClearance) {
      closestClearance = clearance;
      blockingBody = body;
    }
  }

  return {
    locked: blockingBody !== null,
    blockingBodyName: blockingBody?.name ?? null,
    blockingBodyKind: blockingBody?.kind ?? null,
    clearanceMeters: closestClearance,
  };
}

export interface TargetIndicatorProjection {
  onScreen: boolean;
  screenX: number;
  screenY: number;
  edgeX: number;
  edgeY: number;
  edgeAngleDeg: number;
  bearingDot: number;
}

export function projectTargetIndicator(params: {
  worldOffset: Vec3Like;
  shipRight: Vec3Like;
  shipUp: Vec3Like;
  shipForward: Vec3Like;
  ndcX: number;
  ndcY: number;
  ndcZ: number;
}): TargetIndicatorProjection {
  const { worldOffset, shipRight, shipUp, shipForward, ndcX, ndcY, ndcZ } = params;
  const dist = Math.hypot(worldOffset.x, worldOffset.y, worldOffset.z) || 1;
  const dx = worldOffset.x / dist;
  const dy = worldOffset.y / dist;
  const dz = worldOffset.z / dist;

  const localRight = dx * shipRight.x + dy * shipRight.y + dz * shipRight.z;
  const localUp = dx * shipUp.x + dy * shipUp.y + dz * shipUp.z;
  const bearingDot = dx * shipForward.x + dy * shipForward.y + dz * shipForward.z;

  const onScreen =
    bearingDot > 0.05 &&
    ndcZ >= -1 &&
    ndcZ <= 1 &&
    Math.abs(ndcX) <= 0.9 &&
    Math.abs(ndcY) <= 0.88;

  const screenX = (ndcX * 0.5 + 0.5) * 100;
  const screenY = (-ndcY * 0.5 + 0.5) * 100;

  // Ship-local directional vector for robust off-screen / behind-ship arrow placement
  let dirX = localRight;
  let dirY = localUp;
  const planarLen = Math.hypot(dirX, dirY);
  if (planarLen < 0.0001) {
    // Target is straight behind or dead ahead
    dirX = 0;
    dirY = bearingDot >= 0 ? 1 : -1;
  } else {
    dirX /= planarLen;
    dirY /= planarLen;
  }

  // Place arrow along safe interior HUD perimeter (X: 24..76%, Y: 14..78%) so it never collides with corner HUD cards or bottom radar
  // Screen Y increases downward while localUp increases upward.
  const halfW = 26;
  const halfH = 32;
  const scaleX = Math.abs(dirX) > 0.001 ? halfW / Math.abs(dirX) : Infinity;
  const scaleY = Math.abs(dirY) > 0.001 ? halfH / Math.abs(dirY) : Infinity;
  const t = Math.min(scaleX, scaleY);

  const edgeX = Math.max(24, Math.min(76, 50 + dirX * t));
  const edgeY = Math.max(14, Math.min(78, 46 - dirY * t));
  // 0deg points UP (dirX=0, dirY=1)
  const edgeAngleDeg = (Math.atan2(dirX, dirY) * 180) / Math.PI;

  return {
    onScreen,
    screenX,
    screenY,
    edgeX,
    edgeY,
    edgeAngleDeg,
    bearingDot,
  };
}

export interface ProximityWarningResult {
  active: boolean;
  urgent: boolean;
  kind: 'asteroid' | 'station-speed' | 'none';
  message: string | null;
}

export function evaluateProximityWarning(params: {
  shipSpeedMps: number;
  nearestAsteroidClearanceM: number;
  nearestAsteroidClosingMps: number;
  stationDistanceM: number;
  stationCollisionRadiusM: number;
  docking: DockingAlignment;
}): ProximityWarningResult {
  const {
    shipSpeedMps,
    nearestAsteroidClearanceM,
    nearestAsteroidClosingMps,
    stationDistanceM,
    stationCollisionRadiusM,
    docking,
  } = params;

  if (
    nearestAsteroidClearanceM < 24 ||
    (nearestAsteroidClearanceM < 58 && nearestAsteroidClosingMps > 22)
  ) {
    return {
      active: true,
      urgent: nearestAsteroidClearanceM < 26,
      kind: 'asteroid',
      message: 'PROXIMITY ALERT — ASTEROID CLEARANCE',
    };
  }

  const approachingFastToBay =
    docking.distanceMeters < 340 &&
    !docking.isSpeedSafe &&
    shipSpeedMps > DOCKING_SAFE_SPEED_MPS + 12;

  const grazingStationHull =
    stationDistanceM < stationCollisionRadiusM + 58 &&
    !docking.isCorridorAligned &&
    shipSpeedMps > 45;

  if (approachingFastToBay || grazingStationHull) {
    return {
      active: true,
      urgent: docking.distanceMeters < 170 || stationDistanceM < stationCollisionRadiusM + 26,
      kind: 'station-speed',
      message: approachingFastToBay
        ? 'APPROACH SPEED HIGH — REDUCE THROTTLE'
        : 'PROXIMITY ALERT — STATION SUPERSTRUCTURE',
    };
  }

  return {
    active: false,
    urgent: false,
    kind: 'none',
    message: null,
  };
}

export const MOUSE_DEADZONE_PX = 28;
export const MOUSE_MAX_RADIUS_PX = 260;

export interface MouseSteerResult {
  pitch: number;
  yaw: number;
  normX: number;
  normY: number;
  magnitude: number;
  inDeadzone: boolean;
}

/**
 * Converts cursor offset (in pixels from viewport center) into smooth virtual-joystick
 * pitch and yaw commands.
 * Cursor UP (offsetY < 0) -> positive pitch (nose UP toward cursor).
 * Cursor LEFT (offsetX < 0) -> positive yaw (nose LEFT toward cursor).
 */
export function computeMouseSteerAxes(
  offsetX: number,
  offsetY: number,
  deadzonePx = MOUSE_DEADZONE_PX,
  maxRadiusPx = MOUSE_MAX_RADIUS_PX
): MouseSteerResult {
  const dist = Math.hypot(offsetX, offsetY);
  if (dist <= deadzonePx || maxRadiusPx <= deadzonePx || dist < 0.0001) {
    return {
      pitch: 0,
      yaw: 0,
      normX: 0,
      normY: 0,
      magnitude: 0,
      inDeadzone: true,
    };
  }

  const span = maxRadiusPx - deadzonePx;
  const effectiveDist = Math.min(dist, maxRadiusPx) - deadzonePx;
  const magnitude = Math.max(0, Math.min(1, effectiveDist / span));

  const dirX = offsetX / dist;
  const dirY = offsetY / dist;

  return {
    pitch: -dirY * magnitude,
    yaw: -dirX * magnitude,
    normX: dirX * magnitude,
    normY: dirY * magnitude,
    magnitude,
    inDeadzone: false,
  };
}
