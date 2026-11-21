export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraMode = 'cockpit' | 'chase';

export type HudThemeId = 'cobalt' | 'amber' | 'emerald' | 'crimson' | 'violet';

export type SecurityLevel = 'High Security' | 'Medium Security' | 'Anarchy';

export type CombatRank =
  | 'Harmless'
  | 'Mostly Harmless'
  | 'Poor'
  | 'Average'
  | 'Above Average'
  | 'Competent'
  | 'Dangerous'
  | 'Deadly'
  | 'ELITE';

export type TargetKind =
  | 'station'
  | 'bay'
  | 'planet'
  | 'star'
  | 'asteroid_belt'
  | 'asteroid'
  | 'canister'
  | 'shuttle'
  | 'pirate';

export type PlanetArchetype = 'terrestrial' | 'arid' | 'volcanic' | 'gas_giant';

export type EconomyType =
  | 'Rich Industrial'
  | 'Poor Industrial'
  | 'Rich Agricultural'
  | 'Poor Agricultural'
  | 'Mining'
  | 'High-Tech';

export type SalvageCommodityId =
  | 'palladium'
  | 'titanium'
  | 'platinum'
  | 'alloys'
  | 'machinery'
  | 'luxury_goods';

export interface ShipUpgrades {
  cargoBayTier: number;
  pulseLaserMk2: boolean;
  shieldBooster: boolean;
  fuelScoop: boolean;
}

export interface StarSystem {
  id: string;
  index: number;
  name: string;
  x: number; // light years
  y: number; // light years
  sunColorHex: number;
  sunCoronaHex: number;
  sunLightHex: number;
  sunCssColor: string;
  techLevel: number; // 1..12
  economy: EconomyType;
  securityLevel: SecurityLevel;
  inhabitants: string;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface NavWaypointSummary {
  id: string;
  name: string;
  kind: 'station' | 'planet' | 'star' | 'asteroid_belt' | 'pirate';
  distanceMeters: number;
  subtitle: string;
}

export interface DockingAlignment {
  distanceMeters: number;
  speedMps: number;
  lateralOffset: number;
  facingAngleDeg: number;
  corridorAngleDeg: number;
  isSpeedSafe: boolean;
  isCorridorAligned: boolean;
  isOrientationAligned: boolean;
  isReadyToDock: boolean;
  isInsideBay: boolean;
  statusLabel: string;
}

export interface TargetInfo {
  id: string;
  name: string;
  kind: TargetKind;
  distanceMeters: number;
  bearingDot: number;
  screenX: number;
  screenY: number;
  onScreen: boolean;
  edgeX: number;
  edgeY: number;
  edgeAngleDeg: number;
  hullPct?: number;
  shieldPct?: number;
  bountyCr?: number;
  leadScreenX?: number;
  leadScreenY?: number;
  leadOnScreen?: boolean;
}

export interface ScreenHostileMarker {
  id: string;
  name: string;
  distanceMeters: number;
  screenX: number;
  screenY: number;
  hullPct: number;
  shieldPct: number;
  isLocked: boolean;
}

export interface RadarBlip {
  id: string;
  kind: TargetKind;
  rx: number;
  rz: number;
  ry: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  isDocked: boolean;
  speedMps: number;
  maxSpeedMps: number;
  throttle: number; // -0.35 to 1.0
  cruiseActive: boolean;
  canEngageCruise: boolean;
  massLockBodyName: string | null;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  weaponHeat: number; // 0 to 1
  credits: number;
  cargoUsed: number;
  cargoCapacity: number;
  fuel: number; // 0 to 7.0 LY
  maxFuel: number;
  currentSystemId: string;
  currentSystemName: string;
  currentSystemEconomy: EconomyType;
  currentSystemSecurity: SecurityLevel;
  selectedJumpSystemName: string | null;
  selectedJumpDistanceLY: number | null;
  canJumpSelected: boolean;
  autoDockActive: boolean;
  canAutoDock: boolean;
  hyperspaceCountdown: number | null; // 3.0 down to 0
  hyperspaceFlash: number; // 0 to 1
  isScoopingFuel: boolean;
  sunDistanceMeters: number;
  upgrades: ShipUpgrades;
  asteroidsCleared: number;
  pirateKills: number;
  combatRank: CombatRank;
  activePirateCount: number;
  hostileMarkers: ScreenHostileMarker[];
  distanceFlownKm: number;
  invertPitch: boolean;
  mouseSteerEnabled: boolean;
  mouseSteerActive: boolean;
  gimbalLocked: boolean;
  cameraMode: CameraMode;
  muted: boolean;
  volume: number;
  voiceEnabled: boolean;
  target: TargetInfo | null;
  waypoints: NavWaypointSummary[];
  lockedWaypointId: string;
  docking: DockingAlignment;
  alertMessage: string | null;
}

export interface CommodityMarketItem {
  id: string;
  name: string;
  unit: string;
  basePrice: number;
  price: number;
  stock: number;
  category: 'Provisions' | 'Materials' | 'Industrial' | 'High-Tech';
  trend: 'up' | 'down' | 'flat';
}

export type CargoManifest = Record<string, number>;

export interface TradingState {
  credits: number;
  cargoCapacity: number;
  cargo: CargoManifest;
  avgCostBasis: Record<string, number>;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  pirateKills: number;
  upgrades: ShipUpgrades;
  systemId: string;
  systemName: string;
  economy: EconomyType;
  techLevel: number;
  market: CommodityMarketItem[];
}
