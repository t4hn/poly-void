import type { CombatRank, EconomyType, SecurityLevel, Vec3Like } from './types';

export const COMBAT_RANK_LADDER: ReadonlyArray<{ rank: CombatRank; minKills: number }> = [
  { rank: 'Harmless', minKills: 0 },
  { rank: 'Mostly Harmless', minKills: 1 },
  { rank: 'Poor', minKills: 3 },
  { rank: 'Average', minKills: 6 },
  { rank: 'Above Average', minKills: 10 },
  { rank: 'Competent', minKills: 16 },
  { rank: 'Dangerous', minKills: 24 },
  { rank: 'Deadly', minKills: 36 },
  { rank: 'ELITE', minKills: 50 },
];

export interface CombatRankProgress {
  rank: CombatRank;
  kills: number;
  nextRank: CombatRank | null;
  nextThreshold: number | null;
  progressPct: number;
}

export function getCombatRankProgress(killsRaw: number): CombatRankProgress {
  const kills = Math.max(0, Math.floor(killsRaw));
  let idx = 0;
  for (let i = 0; i < COMBAT_RANK_LADDER.length; i++) {
    if (kills >= COMBAT_RANK_LADDER[i].minKills) {
      idx = i;
    }
  }
  const current = COMBAT_RANK_LADDER[idx];
  const next = COMBAT_RANK_LADDER[idx + 1] ?? null;
  if (!next) {
    return {
      rank: current.rank,
      kills,
      nextRank: null,
      nextThreshold: null,
      progressPct: 100,
    };
  }
  const span = Math.max(1, next.minKills - current.minKills);
  const progressPct = Math.min(100, Math.round(((kills - current.minKills) / span) * 100));
  return {
    rank: current.rank,
    kills,
    nextRank: next.rank,
    nextThreshold: next.minKills,
    progressPct,
  };
}

/**
 * Assigns a fixed, deterministic security rating strictly from system economy and tech level.
 * Never depends on player cargo, credits, or equipment.
 */
export function deriveSystemSecurityLevel(
  economy: EconomyType,
  techLevel: number
): SecurityLevel {
  if (economy === 'High-Tech' || (economy === 'Rich Industrial' && techLevel >= 9)) {
    return 'High Security';
  }
  if (
    economy === 'Mining' ||
    economy === 'Poor Industrial' ||
    (economy === 'Poor Agricultural' && techLevel <= 3)
  ) {
    return 'Anarchy';
  }
  return 'Medium Security';
}

export interface PirateSpawnRateConfig {
  maxActivePirates: number;
  checkIntervalSec: number;
  spawnProbabilityPerCheck: number;
  cruiseMultiplier: number;
}

/**
 * Pure security-only pirate spawn rates.
 * High Security = 0% spawn probability under all conditions.
 */
export function getSecuritySpawnConfig(securityLevel: SecurityLevel): PirateSpawnRateConfig {
  if (securityLevel === 'High Security') {
    return {
      maxActivePirates: 0,
      checkIntervalSec: 12,
      spawnProbabilityPerCheck: 0,
      cruiseMultiplier: 0,
    };
  }
  if (securityLevel === 'Medium Security') {
    return {
      maxActivePirates: 1,
      checkIntervalSec: 9.5,
      spawnProbabilityPerCheck: 0.28,
      cruiseMultiplier: 1.65,
    };
  }
  // Anarchy / Lawless systems
  return {
    maxActivePirates: 2,
    checkIntervalSec: 6.5,
    spawnProbabilityPerCheck: 0.62,
    cruiseMultiplier: 1.45,
  };
}

export const PIRATE_COOLDOWN_MIN_SEC = 45;
export const PIRATE_COOLDOWN_MAX_SEC = 60;

/**
 * Computes mandatory post-encounter / post-kill cooldown between 45 and 60 seconds
 * so the player has time to scoop cargo and recharge shields.
 */
export function computePostEncounterCooldownSec(randomRoll = Math.random()): number {
  const t = Math.max(0, Math.min(1, randomRoll));
  return PIRATE_COOLDOWN_MIN_SEC + t * (PIRATE_COOLDOWN_MAX_SEC - PIRATE_COOLDOWN_MIN_SEC);
}

/**
 * Determines whether a pirate patrol/ambush should spawn on a periodic security check.
 * Strictly ignores player cargo/items and uses only system security rating + spatial state.
 */
export function evaluateSecurityPirateSpawn(params: {
  securityLevel: SecurityLevel;
  activePirateCount: number;
  stationDistanceMeters: number;
  isCruising: boolean;
  randomRoll: number;
  spawnCooldownRemainingSec?: number;
}): boolean {
  const {
    securityLevel,
    activePirateCount,
    stationDistanceMeters,
    isCruising,
    randomRoll,
    spawnCooldownRemainingSec = 0,
  } = params;
  if (spawnCooldownRemainingSec > 0) {
    return false;
  }
  const cfg = getSecuritySpawnConfig(securityLevel);
  if (cfg.spawnProbabilityPerCheck <= 0 || cfg.maxActivePirates <= 0) {
    return false;
  }
  if (activePirateCount >= cfg.maxActivePirates) {
    return false;
  }
  // Safe orbital no-fire zone immediately outside Coriolis station bay (< 2.6 km)
  if (stationDistanceMeters < 2600) {
    return false;
  }
  const effectiveProb = Math.min(
    0.92,
    cfg.spawnProbabilityPerCheck * (isCruising ? cfg.cruiseMultiplier : 1)
  );
  return randomRoll < effectiveProb;
}

/**
 * Computes first-order lead intercept point for firing pulse lasers at a moving target.
 */
export function computeLeadInterceptPoint(params: {
  shooterPos: Vec3Like;
  targetPos: Vec3Like;
  targetVel: Vec3Like;
  projectileSpeedMps: number;
}): Vec3Like {
  const { shooterPos, targetPos, targetVel, projectileSpeedMps } = params;
  const dx = targetPos.x - shooterPos.x;
  const dy = targetPos.y - shooterPos.y;
  const dz = targetPos.z - shooterPos.z;
  const dist = Math.hypot(dx, dy, dz);
  const speed = Math.max(100, projectileSpeedMps);
  const tof = Math.min(1.6, dist / speed);
  return {
    x: targetPos.x + targetVel.x * tof,
    y: targetPos.y + targetVel.y * tof,
    z: targetPos.z + targetVel.z * tof,
  };
}

export const GIMBAL_CONE_DEG = 5;
export const GIMBAL_CONE_RAD = (GIMBAL_CONE_DEG * Math.PI) / 180;

export interface GimbalAimResult {
  direction: Vec3Like;
  gimbalActive: boolean;
  angleDeg: number;
}

/**
 * Applies a subtle ~5 degree gimbal tracking cone toward a locked target's lead intercept point.
 * When the lead point falls within maxConeRad of the ship's forward vector, lasers subtly track it.
 */
export function computeGimbalAimDirection(params: {
  shooterPos: Vec3Like;
  shooterForward: Vec3Like;
  leadTargetPos: Vec3Like;
  maxConeRad?: number;
}): GimbalAimResult {
  const {
    shooterPos,
    shooterForward,
    leadTargetPos,
    maxConeRad = GIMBAL_CONE_RAD,
  } = params;

  const fwdLen = Math.hypot(shooterForward.x, shooterForward.y, shooterForward.z) || 1;
  const fx = shooterForward.x / fwdLen;
  const fy = shooterForward.y / fwdLen;
  const fz = shooterForward.z / fwdLen;

  const tx = leadTargetPos.x - shooterPos.x;
  const ty = leadTargetPos.y - shooterPos.y;
  const tz = leadTargetPos.z - shooterPos.z;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < 0.001) {
    return {
      direction: { x: fx, y: fy, z: fz },
      gimbalActive: false,
      angleDeg: 0,
    };
  }

  const dx = tx / tLen;
  const dy = ty / tLen;
  const dz = tz / tLen;

  const dot = Math.max(-1, Math.min(1, fx * dx + fy * dy + fz * dz));
  const angleRad = Math.acos(dot);
  const angleDeg = (angleRad * 180) / Math.PI;

  if (angleRad <= maxConeRad) {
    return {
      direction: { x: dx, y: dy, z: dz },
      gimbalActive: true,
      angleDeg,
    };
  }

  return {
    direction: { x: fx, y: fy, z: fz },
    gimbalActive: false,
    angleDeg,
  };
}

