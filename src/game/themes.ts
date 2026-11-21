import type { HudThemeId } from './types';

export interface HudThemeDefinition {
  id: HudThemeId;
  label: string;
  shortLabel: string;
  accentHex: string;
  accentRgb: string;
  accentSoftHex: string;
  accentBrightHex: string;
}

export const HUD_THEME_IDS: ReadonlyArray<HudThemeId> = [
  'cobalt',
  'amber',
  'emerald',
  'crimson',
  'violet',
];

export const HUD_THEMES: Record<HudThemeId, HudThemeDefinition> = {
  cobalt: {
    id: 'cobalt',
    label: 'Cobalt Cyan',
    shortLabel: 'Cobalt',
    accentHex: '#38bdf8',
    accentRgb: '56, 189, 248',
    accentSoftHex: '#7dd3fc',
    accentBrightHex: '#e0f2fe',
  },
  amber: {
    id: 'amber',
    label: 'Retro Amber',
    shortLabel: 'Amber',
    accentHex: '#f59e0b',
    accentRgb: '245, 158, 11',
    accentSoftHex: '#fcd34d',
    accentBrightHex: '#fef3c7',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Phosphor',
    shortLabel: 'Emerald',
    accentHex: '#10b981',
    accentRgb: '16, 185, 129',
    accentSoftHex: '#6ee7b7',
    accentBrightHex: '#d1fae5',
  },
  crimson: {
    id: 'crimson',
    label: 'Crimson Tactical',
    shortLabel: 'Crimson',
    accentHex: '#ef4444',
    accentRgb: '239, 68, 68',
    accentSoftHex: '#fca5a5',
    accentBrightHex: '#fee2e2',
  },
  violet: {
    id: 'violet',
    label: 'Solar Violet',
    shortLabel: 'Violet',
    accentHex: '#a855f7',
    accentRgb: '168, 85, 247',
    accentSoftHex: '#d8b4fe',
    accentBrightHex: '#f3e8ff',
  },
};

export function isHudThemeId(value: unknown): value is HudThemeId {
  return typeof value === 'string' && value in HUD_THEMES;
}

export function getHudTheme(id: HudThemeId): HudThemeDefinition {
  return HUD_THEMES[id] ?? HUD_THEMES.cobalt;
}

export function applyHudThemeToDocument(themeId: HudThemeId): HudThemeDefinition {
  const theme = getHudTheme(themeId);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.hudTheme = theme.id;
    root.style.setProperty('--hud-accent', theme.accentHex);
    root.style.setProperty('--hud-accent-rgb', theme.accentRgb);
    root.style.setProperty('--hud-accent-soft', theme.accentSoftHex);
    root.style.setProperty('--hud-accent-bright', theme.accentBrightHex);
    root.style.setProperty('--hud-border', `rgba(${theme.accentRgb}, 0.34)`);
    root.style.setProperty('--hud-border-strong', `rgba(${theme.accentRgb}, 0.72)`);
    root.style.setProperty('--hud-surface', `rgba(${theme.accentRgb}, 0.16)`);
    root.style.setProperty('--hud-surface-hover', `rgba(${theme.accentRgb}, 0.28)`);
    root.style.setProperty('--hud-glow', `rgba(${theme.accentRgb}, 0.45)`);
  }
  return theme;
}
