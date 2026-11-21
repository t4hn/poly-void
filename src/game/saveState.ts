import {
  CARGO_UPGRADE_INCREMENT,
  CARGO_UPGRADE_MAX_TIER,
  INITIAL_CARGO_CAPACITY,
  MAX_FUEL_LY,
  createDefaultUpgrades,
  createStationMarket,
  getMaxHullForUpgrades,
} from './trading';
import { isHudThemeId } from './themes';
import type {
  CameraMode,
  CargoManifest,
  HudThemeId,
  ShipUpgrades,
  StarSystem,
  TradingState,
} from './types';

export const SAVE_STORAGE_KEY = 'coriolis_frontier_save_v1';
export const SETTINGS_STORAGE_KEY = 'coriolis_frontier_settings_v1';

export interface PilotSettings {
  muted: boolean;
  volume: number;
  voiceEnabled: boolean;
  mouseSteerEnabled: boolean;
  invertPitch: boolean;
  cameraMode: CameraMode;
  hudTheme: HudThemeId;
}

export const DEFAULT_PILOT_SETTINGS: PilotSettings = {
  muted: false,
  volume: 0.75,
  voiceEnabled: true,
  mouseSteerEnabled: true,
  invertPitch: false,
  cameraMode: 'cockpit',
  hudTheme: 'cobalt',
};

export interface SaveGameData {
  version: 1;
  savedAt: number;
  credits: number;
  cargoCapacity: number;
  cargo: CargoManifest;
  avgCostBasis: Record<string, number>;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  pirateKills?: number;
  upgrades: ShipUpgrades;
  systemId: string;
  systemCoords: { x: number; y: number };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function serializeSaveState(
  trading: TradingState,
  system: StarSystem,
  now = Date.now()
): SaveGameData {
  return {
    version: 1,
    savedAt: now,
    credits: Math.round(trading.credits * 10) / 10,
    cargoCapacity: trading.cargoCapacity,
    cargo: { ...trading.cargo },
    avgCostBasis: { ...trading.avgCostBasis },
    fuel: Math.round(trading.fuel * 10) / 10,
    maxFuel: trading.maxFuel,
    hull: Math.round(trading.hull),
    maxHull: trading.maxHull,
    pirateKills: Math.max(0, Math.floor(trading.pirateKills)),
    upgrades: { ...trading.upgrades },
    systemId: system.id,
    systemCoords: { x: system.x, y: system.y },
  };
}

function resolveSavedSystem(save: SaveGameData, sector: StarSystem[]): StarSystem {
  const byId = sector.find((s) => s.id === save.systemId);
  if (byId) return byId;

  if (
    save.systemCoords &&
    typeof save.systemCoords.x === 'number' &&
    typeof save.systemCoords.y === 'number'
  ) {
    let best = sector[0];
    let bestDist = Infinity;
    for (const s of sector) {
      const d = Math.hypot(s.x - save.systemCoords.x, s.y - save.systemCoords.y);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }
  return sector[0];
}

export function restoreTradingStateFromSave(
  raw: unknown,
  sector: StarSystem[]
): { trading: TradingState; system: StarSystem; savedAt: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<SaveGameData>;
  if (data.version !== 1 || typeof data.credits !== 'number' || !Number.isFinite(data.credits)) {
    return null;
  }

  const system = resolveSavedSystem(data as SaveGameData, sector);
  const rawUpgrades = (data.upgrades ?? {}) as Partial<ShipUpgrades>;
  const cargoBayTier = Math.max(
    0,
    Math.min(
      CARGO_UPGRADE_MAX_TIER,
      typeof rawUpgrades.cargoBayTier === 'number' ? Math.floor(rawUpgrades.cargoBayTier) : 0
    )
  );
  const upgrades: ShipUpgrades = {
    ...createDefaultUpgrades(),
    cargoBayTier,
    pulseLaserMk2: Boolean(rawUpgrades.pulseLaserMk2),
    shieldBooster: Boolean(rawUpgrades.shieldBooster),
    fuelScoop: Boolean(rawUpgrades.fuelScoop),
  };

  const expectedCap = INITIAL_CARGO_CAPACITY + cargoBayTier * CARGO_UPGRADE_INCREMENT;
  const cargoCapacity =
    typeof data.cargoCapacity === 'number' && data.cargoCapacity >= expectedCap
      ? Math.floor(data.cargoCapacity)
      : expectedCap;

  const cargo: CargoManifest = {};
  if (data.cargo && typeof data.cargo === 'object') {
    for (const [k, v] of Object.entries(data.cargo)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        cargo[k] = Math.floor(v);
      }
    }
  }

  const avgCostBasis: Record<string, number> = {};
  if (data.avgCostBasis && typeof data.avgCostBasis === 'object') {
    for (const [k, v] of Object.entries(data.avgCostBasis)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        avgCostBasis[k] = Math.round(v * 10) / 10;
      }
    }
  }

  const maxHull = getMaxHullForUpgrades(upgrades);
  const maxFuel = MAX_FUEL_LY;
  const fuel = Math.max(
    0,
    Math.min(maxFuel, typeof data.fuel === 'number' && Number.isFinite(data.fuel) ? data.fuel : maxFuel)
  );
  const hull = Math.max(
    1,
    Math.min(maxHull, typeof data.hull === 'number' && Number.isFinite(data.hull) ? data.hull : maxHull)
  );

  const pirateKills =
    typeof data.pirateKills === 'number' && Number.isFinite(data.pirateKills)
      ? Math.max(0, Math.floor(data.pirateKills))
      : 0;

  return {
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : Date.now(),
    system,
    trading: {
      credits: Math.max(0, Math.round(data.credits * 10) / 10),
      cargoCapacity,
      cargo,
      avgCostBasis,
      fuel: Math.round(fuel * 10) / 10,
      maxFuel,
      hull: Math.round(hull),
      maxHull,
      pirateKills,
      upgrades,
      systemId: system.id,
      systemName: system.name,
      economy: system.economy,
      techLevel: system.techLevel,
      market: createStationMarket(system, 1),
    },
  };
}

export function saveGameToStorage(
  trading: TradingState,
  system: StarSystem,
  storage: StorageLike | null = getDefaultStorage()
): SaveGameData | null {
  if (!storage) return null;
  const payload = serializeSaveState(trading, system);
  try {
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function loadGameFromStorage(
  sector: StarSystem[],
  storage: StorageLike | null = getDefaultStorage()
): { trading: TradingState; system: StarSystem; savedAt: number } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_STORAGE_KEY);
    if (!raw) return null;
    return restoreTradingStateFromSave(JSON.parse(raw), sector);
  } catch {
    return null;
  }
}

export function clearSavedGame(storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SAVE_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function sanitizePilotSettings(raw: unknown): PilotSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PILOT_SETTINGS };
  }
  const data = raw as Partial<PilotSettings>;
  const rawVolume =
    typeof data.volume === 'number' && Number.isFinite(data.volume)
      ? data.volume
      : DEFAULT_PILOT_SETTINGS.volume;
  const clampedVolume = Math.max(0, Math.min(1, Math.round(rawVolume * 20) / 20));
  return {
    muted: typeof data.muted === 'boolean' ? data.muted : DEFAULT_PILOT_SETTINGS.muted,
    volume: clampedVolume,
    voiceEnabled:
      typeof data.voiceEnabled === 'boolean'
        ? data.voiceEnabled
        : DEFAULT_PILOT_SETTINGS.voiceEnabled,
    mouseSteerEnabled:
      typeof data.mouseSteerEnabled === 'boolean'
        ? data.mouseSteerEnabled
        : DEFAULT_PILOT_SETTINGS.mouseSteerEnabled,
    invertPitch:
      typeof data.invertPitch === 'boolean'
        ? data.invertPitch
        : DEFAULT_PILOT_SETTINGS.invertPitch,
    cameraMode: data.cameraMode === 'chase' ? 'chase' : 'cockpit',
    hudTheme: isHudThemeId(data.hudTheme) ? data.hudTheme : DEFAULT_PILOT_SETTINGS.hudTheme,
  };
}

export function saveSettingsToStorage(
  settings: PilotSettings,
  storage: StorageLike | null = getDefaultStorage()
): PilotSettings | null {
  const sanitized = sanitizePilotSettings(settings);
  if (!storage) return null;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  } catch {
    return null;
  }
}

export function loadSettingsFromStorage(
  storage: StorageLike | null = getDefaultStorage()
): PilotSettings {
  if (!storage) return { ...DEFAULT_PILOT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PILOT_SETTINGS };
    return sanitizePilotSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PILOT_SETTINGS };
  }
}
