export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraMode = 'cockpit' | 'chase';

export type TargetKind = 'station' | 'bay' | 'asteroid' | 'canister';

export type EconomyType =
  | 'Rich Industrial'
  | 'Poor Industrial'
  | 'Rich Agricultural'
  | 'Poor Agricultural'
  | 'Mining'
  | 'High-Tech';

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
  inhabitants: string;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
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
  hull: number; // 0 to 100
  maxHull: number;
  shield: number; // 0 to 100
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
  selectedJumpSystemName: string | null;
  selectedJumpDistanceLY: number | null;
  canJumpSelected: boolean;
  autoDockActive: boolean;
  canAutoDock: boolean;
  hyperspaceCountdown: number | null; // 3.0 down to 0
  hyperspaceFlash: number; // 0 to 1
  asteroidsCleared: number;
  distanceFlownKm: number;
  invertPitch: boolean;
  cameraMode: CameraMode;
  muted: boolean;
  target: TargetInfo | null;
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
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  systemId: string;
  systemName: string;
  economy: EconomyType;
  techLevel: number;
  market: CommodityMarketItem[];
}
