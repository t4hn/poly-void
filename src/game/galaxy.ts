import { deriveSystemSecurityLevel } from './combat';
import type { EconomyType, StarSystem } from './types';

export const MAX_JUMP_RANGE_LY = 7.0;
export const SECTOR_SYSTEM_COUNT = 64;

const SYSTEM_NAMES = [
  'Lave', 'Leesti', 'Zaonce', 'Diso', 'Riedquat', 'Tionisla', 'Orerve', 'Uszaa',
  'Quator', 'Orrere', 'Reorte', 'Teorge', 'Ceesxe', 'Xexedi', 'Isinor', 'Biarge',
  'Arque', 'Esuseku', 'Quphi', 'CD-51 102', 'Aona', 'Bemaera', 'Errius', 'Tibedied',
  'Atriso', 'Gerege', 'Zaatxe', 'Diusreza', 'Veis', 'Onrira', 'Anle', 'Rareri',
  'Ensoreus', 'Inera', 'Aronar', 'Larat', 'Esesla', 'Maesin', 'Sori', 'Cebetela',
  'Teraed', 'Uscela', 'Vebege', 'Xeaqu', 'Zediso', 'Azaqu', 'Isleta', 'Quince',
  'Solis', 'Vespera', 'Kestrel', 'Hyperion', 'Cygnus IX', 'Draconis', 'Ceres', 'Valhalla',
  'Meridian', 'Nautilus', 'Altair Prime', 'Lyra Gate', 'Ophiuchi', 'Kaelen', 'Vela Reach', 'Terminus',
];

const ECONOMIES: EconomyType[] = [
  'Rich Agricultural',
  'Rich Industrial',
  'High-Tech',
  'Mining',
  'Poor Agricultural',
  'Poor Industrial',
];

const SUN_PALETTES = [
  { core: 0xfff3d1, corona: 0xffd188, light: 0xffe7c2, css: '#ffd97d' }, // Yellow-Gold G-type
  { core: 0xe0f2fe, corona: 0x7dd3fc, light: 0xdbeafe, css: '#7dd3fc' }, // Blue-White A-type
  { core: 0xffedd5, corona: 0xfb923c, light: 0xfed7aa, css: '#fb923c' }, // Amber K-type
  { core: 0xfee2e2, corona: 0xf87171, light: 0xfecaca, css: '#f87171' }, // Crimson M-type
  { core: 0xfef9c3, corona: 0xfde047, light: 0xfef08a, css: '#fde047' }, // Bright F-type
  { core: 0xd1fae5, corona: 0x5eead4, light: 0xccfbf1, css: '#5eead4' }, // Teal White Dwarf
];

const INHABITANTS = [
  'Human Colonials',
  'Orbital Guilds',
  'Free Traders Union',
  'Mining Consortium',
  'Cybernetic Collective',
  'Agrarian League',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function distanceLY(a: Pick<StarSystem, 'x' | 'y'>, b: Pick<StarSystem, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function canJumpToSystem(
  from: StarSystem,
  to: StarSystem,
  fuelLY: number,
  maxRangeLY = MAX_JUMP_RANGE_LY
): { ok: boolean; distance: number; reason?: string } {
  if (from.id === to.id) {
    return { ok: false, distance: 0, reason: 'CURRENT SYSTEM' };
  }
  const dist = Math.round(distanceLY(from, to) * 10) / 10;
  if (dist > maxRangeLY) {
    return { ok: false, distance: dist, reason: `OUT OF ${maxRangeLY.toFixed(1)} LY RANGE` };
  }
  if (dist > fuelLY + 0.001) {
    return { ok: false, distance: dist, reason: 'INSUFFICIENT FUEL' };
  }
  return { ok: true, distance: dist };
}

export function hasReachableNeighbor(
  current: StarSystem,
  systems: StarSystem[],
  fuelLY: number,
  maxRangeLY = MAX_JUMP_RANGE_LY
): boolean {
  return systems.some((s) => canJumpToSystem(current, s, fuelLY, maxRangeLY).ok);
}

export function findDistressRescueSystem(
  current: StarSystem,
  systems: StarSystem[],
  maxRangeLY = MAX_JUMP_RANGE_LY
): { system: StarSystem; distance: number } | null {
  const candidates = systems
    .filter((s) => s.id !== current.id)
    .map((s) => ({
      system: s,
      distance: Math.round(distanceLY(current, s) * 10) / 10,
    }))
    .filter((entry) => entry.distance <= maxRangeLY);

  if (candidates.length === 0) {
    const anyNeighbor = systems
      .filter((s) => s.id !== current.id)
      .map((s) => ({
        system: s,
        distance: Math.round(distanceLY(current, s) * 10) / 10,
      }))
      .sort((a, b) => a.distance - b.distance);
    return anyNeighbor[0] ?? null;
  }

  // Prefer a nearby low-tech / frontier agricultural or industrial world within range
  const lowTech = candidates
    .filter((c) => c.system.techLevel <= 6 || c.system.economy.startsWith('Poor'))
    .sort((a, b) => a.distance - b.distance);

  if (lowTech.length > 0) {
    return lowTech[0];
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0];
}

export function generateGalaxySector(seed = 1984): StarSystem[] {
  const rand = mulberry32(seed);
  const systems: StarSystem[] = [];

  for (let i = 0; i < SECTOR_SYSTEM_COUNT; i++) {
    let x = 0;
    let y = 0;

    if (i === 0) {
      // Lave sits near the center of the chart so many jump routes fan out in every direction
      x = 14.0;
      y = 11.0;
    } else if (i <= 7) {
      // Guarantee a rich ring of reachable neighbors within 2.5 - 6.4 LY of Lave
      const ang = ((i - 1) / 7) * Math.PI * 2 + (rand() - 0.5) * 0.35;
      const dist = 2.6 + rand() * 3.7;
      x = 14.0 + Math.cos(ang) * dist;
      y = 11.0 + Math.sin(ang) * dist;
    } else {
      // Spread remaining systems across a 28 x 22 LY sector with minimum spacing
      let placed = false;
      for (let attempt = 0; attempt < 25 && !placed; attempt++) {
        const cx = 1.4 + rand() * 25.2;
        const cy = 1.4 + rand() * 19.2;
        const tooClose = systems.some((s) => Math.hypot(s.x - cx, s.y - cy) < 1.65);
        if (!tooClose || attempt === 24) {
          x = cx;
          y = cy;
          placed = true;
        }
      }
    }

    const economy: EconomyType =
      i === 0
        ? 'Rich Agricultural'
        : i === 1
          ? 'Rich Industrial'
          : i === 2
            ? 'High-Tech'
            : i === 3
              ? 'Mining'
              : ECONOMIES[Math.floor(rand() * ECONOMIES.length)];

    let techLevel = 2 + Math.floor(rand() * 9);
    if (economy === 'High-Tech') techLevel = 9 + Math.floor(rand() * 4);
    else if (economy === 'Rich Industrial') techLevel = 7 + Math.floor(rand() * 4);
    else if (economy === 'Poor Agricultural') techLevel = 1 + Math.floor(rand() * 4);

    const sun =
      i === 0
        ? SUN_PALETTES[0]
        : SUN_PALETTES[Math.floor(rand() * SUN_PALETTES.length)];

    systems.push({
      id: `sys-${i}`,
      index: i,
      name: SYSTEM_NAMES[i] ?? `Sector-${i}`,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      sunColorHex: sun.core,
      sunCoronaHex: sun.corona,
      sunLightHex: sun.light,
      sunCssColor: sun.css,
      techLevel: Math.min(12, Math.max(1, techLevel)),
      economy,
      securityLevel: deriveSystemSecurityLevel(economy, Math.min(12, Math.max(1, techLevel))),
      inhabitants: INHABITANTS[i % INHABITANTS.length],
    });
  }

  return systems;
}
