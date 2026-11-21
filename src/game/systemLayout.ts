import type { EconomyType, PlanetArchetype, StarSystem, Vec3Like } from './types';

export interface PlanetSpec {
  id: string;
  name: string;
  archetype: PlanetArchetype;
  isPrimary: boolean;
  position: Vec3Like;
  radius: number;
  seed: number;
  primaryColorHex: number;
  secondaryColorHex: number;
  accentColorHex: number;
  atmosphereColorHex: number;
  hasMoon: boolean;
  moonRadius: number;
  moonOrbitRadius: number;
  moonOrbitSpeed: number;
  moonColorHex: number;
  hasRings: boolean;
  ringInnerRadius: number;
  ringOuterRadius: number;
  ringColorA: number;
  ringColorB: number;
  ringTiltX: number;
  ringTiltZ: number;
}

export interface AsteroidClusterSpec {
  id: string;
  name: string;
  position: Vec3Like;
  radius: number;
  asteroidCount: number;
  seed: number;
}

export interface SystemLayoutPlan {
  systemId: string;
  sunPosition: Vec3Like;
  sunRadius: number;
  sunThermalRadius: number;
  sunScoopRadius: number;
  arrivalPosition: Vec3Like;
  arrivalLookTarget: Vec3Like;
  stationPosition: Vec3Like;
  stationBayFacing: Vec3Like;
  navBeaconPosition: Vec3Like;
  planets: PlanetSpec[];
  asteroidClusters: AsteroidClusterSpec[];
}

function seededRand(seed: number): () => number {
  let a = (seed + 198417) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickPalette(archetype: PlanetArchetype, rand: () => number) {
  if (archetype === 'terrestrial') {
    const oceanShades = [0x164e78, 0x1e4d7b, 0x155e75];
    const landShades = [0x3b7a57, 0x4d7c42, 0x6b8e4e];
    return {
      primary: oceanShades[Math.floor(rand() * oceanShades.length)],
      secondary: landShades[Math.floor(rand() * landShades.length)],
      accent: 0xdbeafe, // polar ice / highlands
      atmosphere: 0x38bdf8,
    };
  }
  if (archetype === 'volcanic') {
    return {
      primary: 0x262129, // dark basalt
      secondary: 0x443238, // ash ridges
      accent: 0xf97316, // molten magma fissures
      atmosphere: 0xfb923c,
    };
  }
  if (archetype === 'gas_giant') {
    const warm = rand() > 0.45;
    return warm
      ? {
          primary: 0xc28e5c,
          secondary: 0x9a5b3c,
          accent: 0xe6ccb2,
          atmosphere: 0xfbbf24,
        }
      : {
          primary: 0x4e7a9e,
          secondary: 0x355373,
          accent: 0xa5d8ff,
          atmosphere: 0x7dd3fc,
        };
  }
  // arid
  const rust = rand() > 0.5;
  return rust
    ? {
        primary: 0x9c5a3c,
        secondary: 0x6f3e2b,
        accent: 0xd4a373,
        atmosphere: 0xf59e0b,
      }
    : {
        primary: 0x7d7468,
        secondary: 0x575047,
        accent: 0xb0a899,
        atmosphere: 0x94a3b8,
      };
}

function isAgriOrHighTech(economy: EconomyType): boolean {
  return (
    economy === 'Rich Agricultural' ||
    economy === 'Poor Agricultural' ||
    economy === 'High-Tech'
  );
}

export function generateSystemLayout(system: StarSystem): SystemLayoutPlan {
  const rand = seededRand(system.index * 7919 + system.techLevel * 131);

  const sunPosition: Vec3Like = { x: 0, y: 0, z: 0 };
  const sunRadius = 1400;
  const sunThermalRadius = 1750;
  const sunScoopRadius = 3800;

  // Always 1 to 3 planets; starter system (Lave) and major hubs get 3 planets
  const planetCount =
    system.index === 0
      ? 3
      : system.index === 1 || system.index === 2
        ? 3
        : 1 + Math.floor(rand() * 3);

  const agriTech = isAgriOrHighTech(system.economy);

  // Primary planet placed ~38 km from the Sun
  const primaryDistFromSun = 37000 + rand() * 3500;
  const primaryAngle = (system.index * 1.37 + rand() * 0.6) % (Math.PI * 2);
  const primaryY = (rand() - 0.5) * 1800;
  const primaryPos: Vec3Like = {
    x: Math.cos(primaryAngle) * primaryDistFromSun,
    y: primaryY,
    z: Math.sin(primaryAngle) * primaryDistFromSun,
  };

  let primaryArchetype: PlanetArchetype;
  if (agriTech) {
    primaryArchetype = 'terrestrial';
  } else if (system.economy === 'Mining') {
    primaryArchetype = rand() > 0.45 ? 'volcanic' : 'arid';
  } else {
    primaryArchetype = rand() > 0.55 ? 'arid' : rand() > 0.5 ? 'volcanic' : 'gas_giant';
  }

  const primaryRadius =
    primaryArchetype === 'gas_giant'
      ? 2900 + Math.round(rand() * 500)
      : 1950 + Math.round(rand() * 450);

  // Hyperspace arrival point ~25,000m from the primary planet, angled ~50 deg from sun line for crisp terminator lighting
  const arrivalAngle = primaryAngle + Math.PI * 0.72 + (rand() - 0.5) * 0.25;
  const arrivalDistFromPlanet = 25000;
  const arrivalPosition: Vec3Like = {
    x: primaryPos.x + Math.cos(arrivalAngle) * arrivalDistFromPlanet,
    y: primaryPos.y + 420,
    z: primaryPos.z + Math.sin(arrivalAngle) * arrivalDistFromPlanet,
  };

  // Vector from primary planet back toward arrival point
  const toArrX = (arrivalPosition.x - primaryPos.x) / arrivalDistFromPlanet;
  const toArrY = (arrivalPosition.y - primaryPos.y) / arrivalDistFromPlanet;
  const toArrZ = (arrivalPosition.z - primaryPos.z) / arrivalDistFromPlanet;

  // Slightly offset station orbit laterally (~16 deg) so the huge planet looms beside/behind the station
  const rightX = -toArrZ;
  const rightZ = toArrX;
  const stationOrbitRadius = primaryRadius + 1750;
  const stationPosition: Vec3Like = {
    x: primaryPos.x + (toArrX * 0.94 + rightX * 0.34) * stationOrbitRadius,
    y: primaryPos.y + toArrY * stationOrbitRadius + 240,
    z: primaryPos.z + (toArrZ * 0.94 + rightZ * 0.34) * stationOrbitRadius,
  };

  // Station +Z docking bay faces toward the arrival approach lane
  const bayDx = arrivalPosition.x - stationPosition.x;
  const bayDy = arrivalPosition.y - stationPosition.y;
  const bayDz = arrivalPosition.z - stationPosition.z;
  const bayLen = Math.hypot(bayDx, bayDy, bayDz) || 1;
  const stationBayFacing: Vec3Like = {
    x: bayDx / bayLen,
    y: bayDy / bayLen,
    z: bayDz / bayLen,
  };

  // Blinking Nav Beacon buoy anchored 540m off the station approach lane (offset slightly right/up)
  const navBeaconPosition: Vec3Like = {
    x: stationPosition.x + stationBayFacing.x * 540 + rightX * 95,
    y: stationPosition.y + stationBayFacing.y * 540 + 48,
    z: stationPosition.z + stationBayFacing.z * 540 + rightZ * 95,
  };

  const planets: PlanetSpec[] = [];
  const primaryPalette = pickPalette(primaryArchetype, rand);
  const primaryHasMoon = agriTech || rand() > 0.55;

  planets.push({
    id: 'planet-0',
    name: `${system.name} Prime`,
    archetype: primaryArchetype,
    isPrimary: true,
    position: primaryPos,
    radius: primaryRadius,
    seed: system.index * 37 + 11,
    primaryColorHex: primaryPalette.primary,
    secondaryColorHex: primaryPalette.secondary,
    accentColorHex: primaryPalette.accent,
    atmosphereColorHex: primaryPalette.atmosphere,
    hasMoon: primaryHasMoon,
    moonRadius: Math.round(primaryRadius * 0.21),
    moonOrbitRadius: Math.round(primaryRadius * 2.25),
    moonOrbitSpeed: 0.055,
    moonColorHex: 0x94a3b8,
    hasRings: primaryArchetype === 'gas_giant',
    ringInnerRadius: primaryRadius * 1.38,
    ringOuterRadius: primaryRadius * 2.18,
    ringColorA: primaryPalette.accent,
    ringColorB: primaryPalette.secondary,
    ringTiltX: 0.38,
    ringTiltZ: 0.18,
  });

  // Outer planets (indices 1..2)
  const roman = ['II', 'III'];
  for (let p = 1; p < planetCount; p++) {
    const orbitDist = primaryDistFromSun + p * 17500 + rand() * 5500;
    // Keep planet II in the forward/lateral hemisphere relative to arrival so it's easy to cruise to
    const angleOffset = p === 1 ? 0.52 : -0.68;
    const ang = primaryAngle + angleOffset + (rand() - 0.5) * 0.2;
    const pos: Vec3Like = {
      x: Math.cos(ang) * orbitDist,
      y: (rand() - 0.5) * 2600,
      z: Math.sin(ang) * orbitDist,
    };

    let archetype: PlanetArchetype;
    if (p === 1) {
      archetype = agriTech ? 'gas_giant' : rand() > 0.35 ? 'gas_giant' : 'volcanic';
    } else {
      archetype = rand() > 0.5 ? 'arid' : 'volcanic';
    }

    const radius =
      archetype === 'gas_giant'
        ? 3000 + Math.round(rand() * 750)
        : 1550 + Math.round(rand() * 480);

    const pal = pickPalette(archetype, rand);
    const hasRings = archetype === 'gas_giant';
    const hasMoon = !hasRings && rand() > 0.45;

    planets.push({
      id: `planet-${p}`,
      name: `${system.name} ${roman[p - 1] ?? p + 1}`,
      archetype,
      isPrimary: false,
      position: pos,
      radius,
      seed: system.index * 53 + p * 97,
      primaryColorHex: pal.primary,
      secondaryColorHex: pal.secondary,
      accentColorHex: pal.accent,
      atmosphereColorHex: pal.atmosphere,
      hasMoon,
      moonRadius: Math.round(radius * 0.24),
      moonOrbitRadius: Math.round(radius * 2.15),
      moonOrbitSpeed: 0.07,
      moonColorHex: 0x7c7469,
      hasRings,
      ringInnerRadius: radius * 1.42,
      ringOuterRadius: radius * 2.35,
      ringColorA: pal.accent,
      ringColorB: pal.primary,
      ringTiltX: 0.32 + rand() * 0.22,
      ringTiltZ: -0.22 + rand() * 0.44,
    });
  }

  // Distinct Asteroid Belt clusters placed near an outer planet/moon or dedicated orbital belt (>= 12km from arrival)
  const asteroidClusters: AsteroidClusterSpec[] = [];
  if (planets.length >= 2) {
    const outerPlanet = planets[1];
    const beltOffsetAng = primaryAngle + 1.05;
    const beltDist = outerPlanet.radius + 5400;
    asteroidClusters.push({
      id: 'belt-0',
      name: `${outerPlanet.name} Mining Belt`,
      position: {
        x: outerPlanet.position.x + Math.cos(beltOffsetAng) * beltDist,
        y: outerPlanet.position.y + 320,
        z: outerPlanet.position.z + Math.sin(beltOffsetAng) * beltDist,
      },
      radius: 1350,
      asteroidCount: 22,
      seed: system.index * 101 + 7,
    });
  } else {
    // Single-planet system: place asteroid belt in a separate orbital arc 16km off to the side
    const beltAng = primaryAngle - 0.55;
    const beltOrbit = primaryDistFromSun * 0.85;
    asteroidClusters.push({
      id: 'belt-0',
      name: `${system.name} Ore Cluster`,
      position: {
        x: Math.cos(beltAng) * beltOrbit,
        y: -480,
        z: Math.sin(beltAng) * beltOrbit,
      },
      radius: 1350,
      asteroidCount: 24,
      seed: system.index * 101 + 7,
    });
  }

  if (planets.length >= 3) {
    const farPlanet = planets[2];
    const beltDist = farPlanet.radius + 4800;
    asteroidClusters.push({
      id: 'belt-1',
      name: `${farPlanet.name} Debris Field`,
      position: {
        x: farPlanet.position.x - Math.sin(primaryAngle) * beltDist,
        y: farPlanet.position.y - 260,
        z: farPlanet.position.z + Math.cos(primaryAngle) * beltDist,
      },
      radius: 1150,
      asteroidCount: 14,
      seed: system.index * 149 + 19,
    });
  }

  return {
    systemId: system.id,
    sunPosition,
    sunRadius,
    sunThermalRadius,
    sunScoopRadius,
    arrivalPosition,
    arrivalLookTarget: stationPosition,
    stationPosition,
    stationBayFacing,
    navBeaconPosition,
    planets,
    asteroidClusters,
  };
}
