import { getCombatRankProgress } from './combat';
import type {
  CargoManifest,
  CombatRank,
  CommodityMarketItem,
  EconomyType,
  SalvageCommodityId,
  ShipUpgrades,
  StarSystem,
  TradingState,
} from './types';

export const INITIAL_CREDITS = 100.0;
export const INITIAL_CARGO_CAPACITY = 20;
export const INITIAL_FUEL_LY = 7.0;
export const MAX_FUEL_LY = 7.0;
export const FUEL_COST_PER_LY = 2.0;
export const HULL_REPAIR_COST_PER_POINT = 1.5;

export const CARGO_UPGRADE_MAX_TIER = 3;
export const CARGO_UPGRADE_INCREMENT = 15;
export const CARGO_UPGRADE_BASE_COST = 140;
export const CARGO_UPGRADE_STEP_COST = 120;

export const PULSE_LASER_MK2_COST = 220;
export const SHIELD_BOOSTER_COST = 180;
export const FUEL_SCOOP_COST = 160;
export const DISTRESS_JUMP_FEE = 25;

export function createDefaultUpgrades(): ShipUpgrades {
  return {
    cargoBayTier: 0,
    pulseLaserMk2: false,
    shieldBooster: false,
    fuelScoop: false,
  };
}

export function getCargoUpgradeCost(currentTier: number): number {
  return CARGO_UPGRADE_BASE_COST + currentTier * CARGO_UPGRADE_STEP_COST;
}

export function getMaxHullForUpgrades(upgrades: ShipUpgrades): number {
  return upgrades.shieldBooster ? 150 : 100;
}

export function getMaxShieldForUpgrades(upgrades: ShipUpgrades): number {
  return upgrades.shieldBooster ? 150 : 100;
}

const BASE_COMMODITIES: Omit<CommodityMarketItem, 'price' | 'stock' | 'trend'>[] = [
  { id: 'food', name: 'Food', unit: 't', basePrice: 16, category: 'Provisions' },
  { id: 'textiles', name: 'Textiles', unit: 't', basePrice: 22, category: 'Provisions' },
  { id: 'minerals', name: 'Minerals', unit: 't', basePrice: 28, category: 'Materials' },
  { id: 'alloys', name: 'Alloys', unit: 't', basePrice: 44, category: 'Materials' },
  { id: 'machinery', name: 'Machinery', unit: 't', basePrice: 68, category: 'Industrial' },
  { id: 'computers', name: 'Computers', unit: 't', basePrice: 96, category: 'High-Tech' },
  { id: 'luxury_goods', name: 'Luxury Goods', unit: 't', basePrice: 132, category: 'High-Tech' },
];

const ECONOMY_PRICE_FACTORS: Record<EconomyType, Record<string, number>> = {
  'Rich Agricultural': {
    food: 0.58,
    textiles: 0.68,
    minerals: 1.05,
    alloys: 1.15,
    machinery: 1.38,
    computers: 1.42,
    luxury_goods: 1.32,
  },
  'Poor Agricultural': {
    food: 0.72,
    textiles: 0.78,
    minerals: 1.12,
    alloys: 1.2,
    machinery: 1.32,
    computers: 1.35,
    luxury_goods: 1.18,
  },
  'Rich Industrial': {
    food: 1.42,
    textiles: 1.24,
    minerals: 1.26,
    alloys: 0.7,
    machinery: 0.62,
    computers: 0.78,
    luxury_goods: 1.12,
  },
  'Poor Industrial': {
    food: 1.34,
    textiles: 1.18,
    minerals: 1.16,
    alloys: 0.78,
    machinery: 0.74,
    computers: 0.92,
    luxury_goods: 1.08,
  },
  Mining: {
    food: 1.38,
    textiles: 1.28,
    minerals: 0.52,
    alloys: 0.74,
    machinery: 1.32,
    computers: 1.26,
    luxury_goods: 1.36,
  },
  'High-Tech': {
    food: 1.35,
    textiles: 1.22,
    minerals: 1.32,
    alloys: 1.14,
    machinery: 0.82,
    computers: 0.56,
    luxury_goods: 0.76,
  },
};

export function createStationMarket(
  system: Pick<StarSystem, 'index' | 'economy' | 'techLevel'>,
  marketTick = 1
): CommodityMarketItem[] {
  const factors = ECONOMY_PRICE_FACTORS[system.economy];
  return BASE_COMMODITIES.map((item, idx) => {
    const econMult = factors[item.id] ?? 1.0;
    const techDiscount =
      item.category === 'High-Tech' || item.category === 'Industrial'
        ? 1 - (system.techLevel - 6) * 0.018
        : 1 + (system.techLevel - 6) * 0.01;
    const wave = Math.sin((system.index + 1) * 1.9 + marketTick * 0.7 + idx * 2.1) * 0.07;
    const combined = Math.max(0.45, econMult * techDiscount + wave);
    const price = Math.max(6, Math.round(item.basePrice * combined * 10) / 10);

    const baseStock = combined < 0.85 ? 28 : combined > 1.2 ? 6 : 15;
    const stock = Math.max(
      2,
      Math.round(baseStock + Math.cos(system.index * 1.3 + idx * 1.7) * 5)
    );
    const trend: 'up' | 'down' | 'flat' =
      econMult > 1.12 ? 'up' : econMult < 0.88 ? 'down' : 'flat';

    return {
      ...item,
      price,
      stock,
      trend,
    };
  });
}

export function getCargoUsed(cargo: CargoManifest): number {
  return Object.values(cargo).reduce((sum, qty) => sum + Math.max(0, qty), 0);
}

export function createInitialTradingState(system: StarSystem): TradingState {
  const upgrades = createDefaultUpgrades();
  return {
    credits: INITIAL_CREDITS,
    cargoCapacity: INITIAL_CARGO_CAPACITY,
    cargo: {},
    avgCostBasis: {},
    fuel: INITIAL_FUEL_LY,
    maxFuel: MAX_FUEL_LY,
    hull: getMaxHullForUpgrades(upgrades),
    maxHull: getMaxHullForUpgrades(upgrades),
    pirateKills: 0,
    upgrades,
    systemId: system.id,
    systemName: system.name,
    economy: system.economy,
    techLevel: system.techLevel,
    market: createStationMarket(system, 1),
  };
}

export function buyCommodity(
  state: TradingState,
  commodityId: string,
  quantity = 1
): { state: TradingState; ok: boolean; error?: string } {
  if (quantity <= 0) return { state, ok: false, error: 'Invalid quantity' };
  const item = state.market.find((m) => m.id === commodityId);
  if (!item) return { state, ok: false, error: 'Commodity not listed' };
  if (item.stock < quantity) return { state, ok: false, error: 'Insufficient station stock' };

  const freeSpace = state.cargoCapacity - getCargoUsed(state.cargo);
  if (freeSpace < quantity) return { state, ok: false, error: 'Cargo hold full' };

  const totalCost = Math.round(item.price * quantity * 10) / 10;
  if (state.credits + 0.001 < totalCost) {
    return { state, ok: false, error: 'Insufficient credits' };
  }

  const prevOwned = state.cargo[commodityId] ?? 0;
  const prevAvg = state.avgCostBasis[commodityId] ?? item.price;
  const newQty = prevOwned + quantity;
  const weightedAvg =
    Math.round(((prevOwned * prevAvg + quantity * item.price) / newQty) * 10) / 10;

  const nextCargo: CargoManifest = {
    ...state.cargo,
    [commodityId]: newQty,
  };
  const nextBasis = {
    ...state.avgCostBasis,
    [commodityId]: weightedAvg,
  };
  const nextMarket = state.market.map((m) =>
    m.id === commodityId ? { ...m, stock: m.stock - quantity } : m
  );

  return {
    ok: true,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - totalCost) * 10) / 10),
      cargo: nextCargo,
      avgCostBasis: nextBasis,
      market: nextMarket,
    },
  };
}

export function getMaxBuyableQuantity(state: TradingState, commodityId: string): number {
  const item = state.market.find((m) => m.id === commodityId);
  if (!item || item.price <= 0) return 0;
  const freeSpace = Math.max(0, state.cargoCapacity - getCargoUsed(state.cargo));
  const affordable = Math.floor((state.credits + 0.001) / item.price);
  return Math.max(0, Math.min(item.stock, freeSpace, affordable));
}

export function buyMaxCommodity(
  state: TradingState,
  commodityId: string
): { state: TradingState; ok: boolean; quantityBought: number; error?: string } {
  const qty = getMaxBuyableQuantity(state, commodityId);
  if (qty <= 0) {
    return { state, ok: false, quantityBought: 0, error: 'Cannot buy more' };
  }
  const res = buyCommodity(state, commodityId, qty);
  return { ...res, quantityBought: res.ok ? qty : 0 };
}

export function sellCommodity(
  state: TradingState,
  commodityId: string,
  quantity = 1
): { state: TradingState; ok: boolean; revenue: number; netProfit: number; error?: string } {
  if (quantity <= 0) {
    return { state, ok: false, revenue: 0, netProfit: 0, error: 'Invalid quantity' };
  }
  const owned = state.cargo[commodityId] ?? 0;
  if (owned < quantity) {
    return { state, ok: false, revenue: 0, netProfit: 0, error: 'Not enough cargo in hold' };
  }

  const item = state.market.find((m) => m.id === commodityId);
  if (!item) {
    return { state, ok: false, revenue: 0, netProfit: 0, error: 'Commodity not traded here' };
  }

  const revenue = Math.round(item.price * quantity * 10) / 10;
  const costBasis = state.avgCostBasis[commodityId] ?? item.price;
  const netProfit = Math.round((item.price - costBasis) * quantity * 10) / 10;

  const remaining = owned - quantity;
  const nextCargo: CargoManifest = { ...state.cargo };
  const nextBasis = { ...state.avgCostBasis };
  if (remaining <= 0) {
    delete nextCargo[commodityId];
    delete nextBasis[commodityId];
  } else {
    nextCargo[commodityId] = remaining;
  }

  const nextMarket = state.market.map((m) =>
    m.id === commodityId ? { ...m, stock: m.stock + quantity } : m
  );

  return {
    ok: true,
    revenue,
    netProfit,
    state: {
      ...state,
      credits: Math.round((state.credits + revenue) * 10) / 10,
      cargo: nextCargo,
      avgCostBasis: nextBasis,
      market: nextMarket,
    },
  };
}

export function refuelShip(
  state: TradingState
): { state: TradingState; ok: boolean; addedLY: number; cost: number } {
  const missingLY = Math.max(0, Math.round((state.maxFuel - state.fuel) * 10) / 10);
  if (missingLY <= 0.05) {
    return { state, ok: false, addedLY: 0, cost: 0 };
  }
  const affordableLY = Math.floor((state.credits / FUEL_COST_PER_LY) * 10) / 10;
  const addedLY = Math.min(missingLY, affordableLY);
  if (addedLY <= 0.05) {
    return { state, ok: false, addedLY: 0, cost: 0 };
  }
  const cost = Math.round(addedLY * FUEL_COST_PER_LY * 10) / 10;
  return {
    ok: true,
    addedLY,
    cost,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - cost) * 10) / 10),
      fuel: Math.min(state.maxFuel, Math.round((state.fuel + addedLY) * 10) / 10),
    },
  };
}

export function repairHull(state: TradingState): { state: TradingState; ok: boolean; cost: number } {
  const missing = Math.max(0, state.maxHull - Math.round(state.hull));
  if (missing === 0) return { state, ok: false, cost: 0 };

  const affordablePoints = Math.min(
    missing,
    Math.floor(state.credits / HULL_REPAIR_COST_PER_POINT)
  );
  if (affordablePoints <= 0) return { state, ok: false, cost: 0 };

  const cost = Math.round(affordablePoints * HULL_REPAIR_COST_PER_POINT * 10) / 10;
  return {
    ok: true,
    cost,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - cost) * 10) / 10),
      hull: Math.min(state.maxHull, Math.round(state.hull) + affordablePoints),
    },
  };
}

export function purchaseCargoExtension(
  state: TradingState
): { state: TradingState; ok: boolean; cost: number; error?: string } {
  if (state.upgrades.cargoBayTier >= CARGO_UPGRADE_MAX_TIER) {
    return { state, ok: false, cost: 0, error: 'Cargo Bay at maximum tier' };
  }
  const cost = getCargoUpgradeCost(state.upgrades.cargoBayTier);
  if (state.credits + 0.001 < cost) {
    return { state, ok: false, cost, error: 'Insufficient credits' };
  }
  return {
    ok: true,
    cost,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - cost) * 10) / 10),
      cargoCapacity: state.cargoCapacity + CARGO_UPGRADE_INCREMENT,
      upgrades: {
        ...state.upgrades,
        cargoBayTier: state.upgrades.cargoBayTier + 1,
      },
    },
  };
}

export function purchasePulseLaserMk2(
  state: TradingState
): { state: TradingState; ok: boolean; error?: string } {
  if (state.upgrades.pulseLaserMk2) {
    return { state, ok: false, error: 'Already installed' };
  }
  if (state.credits + 0.001 < PULSE_LASER_MK2_COST) {
    return { state, ok: false, error: 'Insufficient credits' };
  }
  return {
    ok: true,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - PULSE_LASER_MK2_COST) * 10) / 10),
      upgrades: {
        ...state.upgrades,
        pulseLaserMk2: true,
      },
    },
  };
}

export function purchaseShieldBooster(
  state: TradingState
): { state: TradingState; ok: boolean; error?: string } {
  if (state.upgrades.shieldBooster) {
    return { state, ok: false, error: 'Already installed' };
  }
  if (state.credits + 0.001 < SHIELD_BOOSTER_COST) {
    return { state, ok: false, error: 'Insufficient credits' };
  }
  const nextUpgrades: ShipUpgrades = { ...state.upgrades, shieldBooster: true };
  const nextMaxHull = getMaxHullForUpgrades(nextUpgrades);
  return {
    ok: true,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - SHIELD_BOOSTER_COST) * 10) / 10),
      maxHull: nextMaxHull,
      hull: Math.min(nextMaxHull, Math.round(state.hull) + 50),
      upgrades: nextUpgrades,
    },
  };
}

export function purchaseFuelScoop(
  state: TradingState
): { state: TradingState; ok: boolean; error?: string } {
  if (state.upgrades.fuelScoop) {
    return { state, ok: false, error: 'Already installed' };
  }
  if (state.credits + 0.001 < FUEL_SCOOP_COST) {
    return { state, ok: false, error: 'Insufficient credits' };
  }
  return {
    ok: true,
    state: {
      ...state,
      credits: Math.max(0, Math.round((state.credits - FUEL_SCOOP_COST) * 10) / 10),
      upgrades: {
        ...state.upgrades,
        fuelScoop: true,
      },
    },
  };
}

export function applyEmergencyDistressJump(
  state: TradingState,
  rescueSystem: StarSystem
): { state: TradingState; feePaid: number; emergencyLoanUsed: boolean } {
  const canPayFee = state.credits >= DISTRESS_JUMP_FEE;
  const feePaid = canPayFee ? DISTRESS_JUMP_FEE : Math.round(state.credits * 10) / 10;
  const nextCredits = canPayFee ? Math.round((state.credits - feePaid) * 10) / 10 : 15.0;

  return {
    feePaid,
    emergencyLoanUsed: !canPayFee,
    state: {
      ...state,
      credits: nextCredits,
      fuel: Math.max(state.fuel, 2.0),
      systemId: rescueSystem.id,
      systemName: rescueSystem.name,
      economy: rescueSystem.economy,
      techLevel: rescueSystem.techLevel,
      market: createStationMarket(rescueSystem, 1),
    },
  };
}

const SALVAGE_MAP: Record<
  SalvageCommodityId,
  { marketId: string; displayName: string }
> = {
  palladium: { marketId: 'minerals', displayName: 'Minerals' },
  titanium: { marketId: 'minerals', displayName: 'Minerals' },
  platinum: { marketId: 'alloys', displayName: 'Alloys' },
  alloys: { marketId: 'alloys', displayName: 'Alloys' },
  machinery: { marketId: 'machinery', displayName: 'Machinery' },
  luxury_goods: { marketId: 'luxury_goods', displayName: 'Luxury Goods' },
};

export function collectSalvageOre(
  state: TradingState,
  oreKind: SalvageCommodityId,
  units = 1,
  bountyCredits = 12.0
): { state: TradingState; addedUnits: number; creditsAwarded: number; commodityName: string } {
  const mapped = SALVAGE_MAP[oreKind];
  const commodityId = mapped.marketId;
  const commodityName = mapped.displayName;
  const freeSpace = Math.max(0, state.cargoCapacity - getCargoUsed(state.cargo));
  const addedUnits = Math.min(freeSpace, units);
  const nextCargo: CargoManifest =
    addedUnits > 0
      ? { ...state.cargo, [commodityId]: (state.cargo[commodityId] ?? 0) + addedUnits }
      : state.cargo;
  const nextBasis =
    addedUnits > 0 && !(commodityId in state.avgCostBasis)
      ? { ...state.avgCostBasis, [commodityId]: 0 }
      : state.avgCostBasis;

  return {
    addedUnits,
    creditsAwarded: bountyCredits,
    commodityName,
    state: {
      ...state,
      credits: Math.round((state.credits + bountyCredits) * 10) / 10,
      cargo: nextCargo,
      avgCostBasis: nextBasis,
    },
  };
}

export function awardPirateBounty(
  state: TradingState,
  bountyCredits: number
): {
  state: TradingState;
  previousRank: CombatRank;
  newRank: CombatRank;
  promoted: boolean;
} {
  const prevProgress = getCombatRankProgress(state.pirateKills);
  const nextKills = state.pirateKills + 1;
  const nextProgress = getCombatRankProgress(nextKills);
  return {
    previousRank: prevProgress.rank,
    newRank: nextProgress.rank,
    promoted: nextProgress.rank !== prevProgress.rank,
    state: {
      ...state,
      credits: Math.round((state.credits + bountyCredits) * 10) / 10,
      pirateKills: nextKills,
    },
  };
}

export function applyEscapePodEjection(state: TradingState): {
  state: TradingState;
  lostCargoTons: number;
} {
  const lostCargoTons = getCargoUsed(state.cargo);
  return {
    lostCargoTons,
    state: {
      ...state,
      hull: state.maxHull,
      cargo: {},
      avgCostBasis: {},
    },
  };
}

export interface SystemCommodityHint {
  id: string;
  name: string;
  estimatedPrice: number;
  factor: number;
}

export interface CargoRouteQuote {
  id: string;
  name: string;
  quantity: number;
  avgCost: number | null;
  estimatedPrice: number;
  deltaPerUnit: number;
  totalDelta: number;
  verdict: 'profit' | 'loss' | 'even' | 'salvage';
}

export interface SystemTradeHints {
  bestExports: SystemCommodityHint[];
  highDemand: SystemCommodityHint[];
  cargoQuotes: CargoRouteQuote[];
}

export function getSystemTradeHints(
  system: Pick<StarSystem, 'index' | 'economy' | 'techLevel'>,
  cargo: CargoManifest = {},
  avgCostBasis: Record<string, number> = {}
): SystemTradeHints {
  const factors = ECONOMY_PRICE_FACTORS[system.economy];
  const market = createStationMarket(system, 1);

  const enriched: SystemCommodityHint[] = market.map((item) => ({
    id: item.id,
    name: item.name,
    estimatedPrice: item.price,
    factor: factors[item.id] ?? 1.0,
  }));

  const bestExports = enriched
    .filter((item) => item.factor < 0.9)
    .sort((a, b) => a.factor - b.factor)
    .slice(0, 3);

  const highDemand = enriched
    .filter((item) => item.factor > 1.12)
    .sort((a, b) => b.factor - a.factor)
    .slice(0, 3);

  const cargoQuotes: CargoRouteQuote[] = Object.entries(cargo)
    .filter(([, qty]) => typeof qty === 'number' && qty > 0)
    .map(([id, rawQty]) => {
      const quantity = Math.floor(rawQty);
      const marketItem = market.find((m) => m.id === id);
      const baseItem = BASE_COMMODITIES.find((b) => b.id === id);
      const name = marketItem?.name ?? baseItem?.name ?? id;
      const estimatedPrice = marketItem?.price ?? baseItem?.basePrice ?? 0;

      const rawBasis = avgCostBasis[id];
      const hasPaidCost = typeof rawBasis === 'number' && Number.isFinite(rawBasis) && rawBasis > 0;
      const avgCost = hasPaidCost ? Math.round(rawBasis * 10) / 10 : null;

      if (avgCost === null) {
        const totalDelta = Math.round(estimatedPrice * quantity * 10) / 10;
        return {
          id,
          name,
          quantity,
          avgCost: null,
          estimatedPrice,
          deltaPerUnit: estimatedPrice,
          totalDelta,
          verdict: 'salvage' as const,
        };
      }

      const deltaPerUnit = Math.round((estimatedPrice - avgCost) * 10) / 10;
      const totalDelta = Math.round(deltaPerUnit * quantity * 10) / 10;
      const verdict: CargoRouteQuote['verdict'] =
        deltaPerUnit >= 0.5 ? 'profit' : deltaPerUnit <= -0.5 ? 'loss' : 'even';

      return {
        id,
        name,
        quantity,
        avgCost,
        estimatedPrice,
        deltaPerUnit,
        totalDelta,
        verdict,
      };
    })
    .sort((a, b) => b.totalDelta - a.totalDelta);

  return {
    bestExports,
    highDemand,
    cargoQuotes,
  };
}

