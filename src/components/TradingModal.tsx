import React, { useState } from 'react';
import { deriveSystemSecurityLevel, getCombatRankProgress } from '../game/combat';
import {
  CARGO_UPGRADE_INCREMENT,
  CARGO_UPGRADE_MAX_TIER,
  FUEL_COST_PER_LY,
  FUEL_SCOOP_COST,
  HULL_REPAIR_COST_PER_POINT,
  PULSE_LASER_MK2_COST,
  SHIELD_BOOSTER_COST,
  getCargoUpgradeCost,
  getCargoUsed,
  getMaxBuyableQuantity,
} from '../game/trading';
import type { TradingState } from '../game/types';
import { FadeOverlay } from './FadeOverlay';

export type StationTab = 'market' | 'shipyard' | 'refuel' | 'status';

export interface SaleToast {
  id: number;
  commodityName: string;
  quantity: number;
  revenue: number;
  netProfit: number;
}

interface TradingModalProps {
  open: boolean;
  trading: TradingState;
  tradeFeedback: string | null;
  saleToast: SaleToast | null;
  lastSavedAt: number | null;
  onTabSwitch?: () => void;
  onBuy: (commodityId: string, qty: number) => void;
  onBuyMax: (commodityId: string) => void;
  onSell: (commodityId: string, qty: number) => void;
  onRefuel: () => void;
  onRepairHull: () => void;
  onUpgradeCargo: () => void;
  onUpgradePulseLaser: () => void;
  onUpgradeShieldBooster: () => void;
  onUpgradeFuelScoop: () => void;
  onSaveGame: () => void;
  onResetGame: () => void;
  onUndock: () => void;
}

export const TradingModal: React.FC<TradingModalProps> = ({
  open,
  trading,
  tradeFeedback,
  saleToast,
  lastSavedAt,
  onTabSwitch,
  onBuy,
  onBuyMax,
  onSell,
  onRefuel,
  onRepairHull,
  onUpgradeCargo,
  onUpgradePulseLaser,
  onUpgradeShieldBooster,
  onUpgradeFuelScoop,
  onSaveGame,
  onResetGame,
  onUndock,
}) => {
  const [activeTab, setActiveTab] = useState<StationTab>('market');
  const [confirmReset, setConfirmReset] = useState(false);

  const cargoUsed = getCargoUsed(trading.cargo);
  const cargoFree = trading.cargoCapacity - cargoUsed;
  const missingHull = Math.max(0, trading.maxHull - Math.round(trading.hull));
  const repairFullCost = Math.round(missingHull * HULL_REPAIR_COST_PER_POINT * 10) / 10;

  const missingFuel = Math.max(0, Math.round((trading.maxFuel - trading.fuel) * 10) / 10);
  const refuelFullCost = Math.round(missingFuel * FUEL_COST_PER_LY * 10) / 10;
  const canRefuel = missingFuel > 0.05 && trading.credits >= 0.2;

  const cargoTier = trading.upgrades.cargoBayTier;
  const cargoMaxed = cargoTier >= CARGO_UPGRADE_MAX_TIER;
  const nextCargoCost = getCargoUpgradeCost(cargoTier);
  const systemSecurity = deriveSystemSecurityLevel(trading.economy, trading.techLevel);
  const rankProgress = getCombatRankProgress(trading.pirateKills);

  const tabs: Array<{ id: StationTab; label: string }> = [
    { id: 'market', label: 'Commodity Market' },
    { id: 'shipyard', label: 'Shipyard / Outfitting' },
    { id: 'refuel', label: 'Fuel / Refuel' },
    { id: 'status', label: 'Status' },
  ];

  return (
    <FadeOverlay open={open} zIndexClass="z-30">
      <div
        role="dialog"
        aria-label="Station Concourse Commodity Market"
        className="w-full max-w-5xl rounded-xl bg-[#0b1220] border hud-modal text-slate-100 p-4 sm:p-5 max-h-[95vh] flex flex-col relative"
      >
        {/* Profit / Cash-Out Toast Notification */}
        {saleToast && (
          <div
            data-testid="sale-profit-toast"
            className={`mb-3 rounded-lg px-4 py-2.5 border flex flex-wrap items-center justify-between gap-2 font-mono-tech text-xs ${
              saleToast.netProfit > 0
                ? 'bg-emerald-500/18 border-emerald-400/70 text-emerald-100'
                : 'hud-btn-active'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="rounded-sm px-1.5 py-0.5 bg-emerald-400 text-slate-950 font-bold text-[10px] uppercase tracking-wider">
                CASH-OUT
              </span>
              <span className="font-semibold">
                Sold {saleToast.quantity}t {saleToast.commodityName} for +{saleToast.revenue.toFixed(1)} Cr
              </span>
            </div>
            <div
              className={`font-bold ${
                saleToast.netProfit > 0
                  ? 'text-emerald-300'
                  : saleToast.netProfit < 0
                    ? 'text-rose-300'
                    : 'text-slate-300'
              }`}
            >
              {saleToast.netProfit > 0
                ? `+${saleToast.netProfit.toFixed(1)} Cr Net Profit`
                : saleToast.netProfit < 0
                  ? `${saleToast.netProfit.toFixed(1)} Cr Net Loss`
                  : 'Salvage / Break-Even'}
            </div>
          </div>
        )}

        {/* Station Concourse Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3.5 border-b border-slate-700/70">
          <div>
            <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-[var(--hud-accent)]">
              DOCKED // {trading.systemName.toUpperCase()} ORBITAL — STATION CONCOURSE
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <h2 className="text-xl md:text-2xl font-bold tracking-wide text-slate-50">
                Station Concourse
              </h2>
              <span className="rounded-md px-2.5 py-0.5 bg-amber-500/15 border border-amber-400/40 font-mono-tech text-[11px] uppercase tracking-wider text-amber-200">
                {trading.economy} · TL {trading.techLevel}
              </span>
              <span
                className={`rounded-md px-2.5 py-0.5 border font-mono-tech text-[11px] uppercase tracking-wider ${
                  systemSecurity === 'High Security'
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                    : systemSecurity === 'Anarchy'
                      ? 'bg-rose-500/15 border-rose-400/45 text-rose-200'
                      : 'hud-btn-active'
                }`}
              >
                {systemSecurity}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-5">
            <div className="text-right">
              <div className="font-mono-tech text-[10px] uppercase tracking-widest text-slate-400">
                Credits
              </div>
              <div
                data-testid="concourse-credits"
                className="font-mono-tech text-lg font-bold text-amber-300"
              >
                {trading.credits.toFixed(1)} Cr
              </div>
            </div>
            <button
              type="button"
              onClick={onUndock}
              className="rounded-md px-5 py-2.5 border hud-btn-primary font-mono-tech text-xs font-bold uppercase tracking-[0.16em] cursor-pointer whitespace-nowrap min-h-[40px] transition-colors"
            >
              Launch Ship
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Station Concourse Sections"
          className="flex flex-wrap gap-1.5 mt-3.5 pb-3 border-b border-slate-800"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (activeTab !== tab.id) {
                    onTabSwitch?.();
                    setActiveTab(tab.id);
                  }
                }}
                className={`rounded-md px-3.5 py-2 font-mono-tech text-xs uppercase tracking-wider border transition-colors cursor-pointer min-h-[38px] whitespace-nowrap ${
                  active
                    ? 'hud-btn-active font-bold'
                    : 'bg-[#090d16]/75 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {tradeFeedback && !saleToast && (
          <div className="mt-3 rounded-lg px-3 py-1.5 hud-btn-active border font-mono-tech text-xs">
            {tradeFeedback}
          </div>
        )}

        {/* Scrollable Tab Body */}
        <div className="flex-1 overflow-y-auto mt-4 pr-0.5">
          {activeTab === 'market' && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="font-mono-tech text-xs uppercase tracking-[0.18em] text-slate-400">
                  {trading.systemName} Exchange Board
                </span>
                <span className="font-mono-tech text-[11px] text-slate-400">
                  Hold:{' '}
                  <span className="text-[var(--hud-accent-soft)] font-semibold">
                    {cargoUsed}/{trading.cargoCapacity}t
                  </span>
                </span>
              </div>

              <div className="rounded-lg overflow-hidden border border-slate-700/70 divide-y divide-slate-800/90">
                {trading.market.map((item) => {
                  const owned = trading.cargo[item.id] ?? 0;
                  const avgCost = trading.avgCostBasis[item.id];
                  const maxBuyable = getMaxBuyableQuantity(trading, item.id);
                  const canBuyOne =
                    item.stock > 0 && cargoFree > 0 && trading.credits + 0.001 >= item.price;
                  const canSell = owned > 0;

                  return (
                    <div
                      key={item.id}
                      data-commodity={item.id}
                      className="grid grid-cols-12 items-center gap-2 px-3 py-1.5 sm:py-2 text-sm bg-[#090d16]/75"
                    >
                      <div className="col-span-5 sm:col-span-3">
                        <div className="font-semibold text-slate-100">{item.name}</div>
                        <div className="font-mono-tech text-[10px] uppercase text-slate-400">
                          Stock {item.stock}t
                        </div>
                      </div>

                      <div className="col-span-4 sm:col-span-2 text-right font-mono-tech">
                        <div className="text-amber-300 font-semibold">{item.price.toFixed(1)} Cr</div>
                        <div className="text-[10px] text-slate-400">
                          {item.trend === 'up'
                            ? '▲ HIGH'
                            : item.trend === 'down'
                              ? '▼ LOW'
                              : '— AVG'}
                        </div>
                      </div>

                      <div className="col-span-3 sm:col-span-2 text-right font-mono-tech text-xs text-slate-300">
                        <div>
                          Hold: <span className="text-[var(--hud-accent-soft)] font-semibold">{owned}t</span>
                        </div>
                        {owned > 0 && typeof avgCost === 'number' && avgCost > 0 && (
                          <div className="text-[10px] text-slate-400">Avg {avgCost.toFixed(1)}</div>
                        )}
                      </div>

                      <div className="col-span-12 sm:col-span-5 flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={!canBuyOne}
                          aria-label={`Buy 1 ${item.name}`}
                          onClick={() => onBuy(item.id, 1)}
                          className="rounded-md px-2.5 py-1.5 min-h-[34px] font-mono-tech text-[11px] whitespace-nowrap border hud-btn-active disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          +1
                        </button>
                        <button
                          type="button"
                          disabled={maxBuyable <= 0}
                          aria-label={`Buy Max ${item.name}`}
                          onClick={() => onBuyMax(item.id)}
                          className="rounded-md px-2.5 py-1.5 min-h-[34px] font-mono-tech text-[11px] whitespace-nowrap bg-[#0b1220] border border-[var(--hud-border)] text-[var(--hud-accent-soft)] hud-btn-ghost disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          Buy Max
                        </button>
                        <button
                          type="button"
                          disabled={!canSell}
                          aria-label={`Sell 1 ${item.name}`}
                          onClick={() => onSell(item.id, 1)}
                          className="rounded-md px-2.5 py-1.5 min-h-[34px] font-mono-tech text-[11px] whitespace-nowrap bg-amber-500/20 border border-amber-400/50 text-amber-200 hover:bg-amber-500/35 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          disabled={!canSell}
                          aria-label={`Sell All ${item.name}`}
                          onClick={() => onSell(item.id, owned)}
                          className="rounded-md px-2.5 py-1.5 min-h-[34px] font-mono-tech text-[11px] whitespace-nowrap bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/35 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Sell All
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'shipyard' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono-tech text-xs uppercase tracking-[0.18em] text-slate-400">
                  Orbital Outfitting &amp; Permanent Ship Modules
                </span>
                <span className="font-mono-tech text-[11px] text-amber-300">
                  Balance: {trading.credits.toFixed(1)} Cr
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* 1. Cargo Bay Extension */}
                <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-100">Cargo Bay Extension</h3>
                      <span className="rounded-md px-2 py-0.5 border hud-btn-active font-mono-tech text-[10px] uppercase">
                        Tier {cargoTier} / {CARGO_UPGRADE_MAX_TIER}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Expands internal cargo racks by +{CARGO_UPGRADE_INCREMENT} Tons per tier.
                      Current capacity: <span className="text-slate-200">{trading.cargoCapacity}t</span>.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={cargoMaxed || trading.credits + 0.001 < nextCargoCost}
                    onClick={onUpgradeCargo}
                    className="w-full rounded-md py-2.5 px-3 min-h-[38px] border hud-btn-active font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    {cargoMaxed
                      ? 'Max Tier Installed (65t)'
                      : `Install +${CARGO_UPGRADE_INCREMENT}t Rack (${nextCargoCost.toFixed(1)} Cr)`}
                  </button>
                </div>

                {/* 2. Pulse Laser Mk II */}
                <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-100">Pulse Laser Mk II</h3>
                      <span
                        className={`rounded-md px-2 py-0.5 border font-mono-tech text-[10px] uppercase ${
                          trading.upgrades.pulseLaserMk2
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                            : 'bg-slate-800 border-slate-600 text-slate-400'
                        }`}
                      >
                        {trading.upgrades.pulseLaserMk2 ? 'Installed' : 'Available'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      High-velocity twin amber pulse cannons delivering 2x hull fracture damage and
                      70% faster cyclic fire rate with lower thermal buildup.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      trading.upgrades.pulseLaserMk2 ||
                      trading.credits + 0.001 < PULSE_LASER_MK2_COST
                    }
                    onClick={onUpgradePulseLaser}
                    className="w-full rounded-md py-2.5 px-3 min-h-[38px] bg-amber-500/20 border border-amber-400/55 text-amber-100 hover:bg-amber-500/35 font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {trading.upgrades.pulseLaserMk2
                      ? 'Pulse Laser Mk II Active'
                      : `Install Pulse Laser Mk II (${PULSE_LASER_MK2_COST.toFixed(1)} Cr)`}
                  </button>
                </div>

                {/* 3. Shield Booster */}
                <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-100">Shield Booster</h3>
                      <span
                        className={`rounded-md px-2 py-0.5 border font-mono-tech text-[10px] uppercase ${
                          trading.upgrades.shieldBooster
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                            : 'bg-slate-800 border-slate-600 text-slate-400'
                        }`}
                      >
                        {trading.upgrades.shieldBooster ? 'Installed' : 'Available'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Reinforces capacitor cells and hull plating, raising maximum shield and hull
                      integrity by +50% (to 150%) with boosted regeneration.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      trading.upgrades.shieldBooster ||
                      trading.credits + 0.001 < SHIELD_BOOSTER_COST
                    }
                    onClick={onUpgradeShieldBooster}
                    className="w-full rounded-md py-2.5 px-3 min-h-[38px] bg-emerald-500/20 border border-emerald-400/55 text-emerald-100 hover:bg-emerald-500/35 font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {trading.upgrades.shieldBooster
                      ? 'Shield Booster Active (150%)'
                      : `Install Shield Booster (${SHIELD_BOOSTER_COST.toFixed(1)} Cr)`}
                  </button>
                </div>

                {/* 4. Fuel Scoop */}
                <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-slate-100">Fuel Scoop</h3>
                      <span
                        className={`rounded-md px-2 py-0.5 border font-mono-tech text-[10px] uppercase ${
                          trading.upgrades.fuelScoop
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                            : 'bg-slate-800 border-slate-600 text-slate-400'
                        }`}
                      >
                        {trading.upgrades.fuelScoop ? 'Installed' : 'Available'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Magnetic plasma intake allowing free hyperspace fuel harvesting when skimming
                      close to any star&apos;s corona in space.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      trading.upgrades.fuelScoop || trading.credits + 0.001 < FUEL_SCOOP_COST
                    }
                    onClick={onUpgradeFuelScoop}
                    className="w-full rounded-md py-2.5 px-3 min-h-[38px] border hud-btn-active font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    {trading.upgrades.fuelScoop
                      ? 'Solar Fuel Scoop Active'
                      : `Install Fuel Scoop (${FUEL_SCOOP_COST.toFixed(1)} Cr)`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'refuel' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80 flex flex-col justify-between gap-4">
                <div>
                  <div className="font-mono-tech text-xs uppercase tracking-[0.18em] text-amber-300 mb-2">
                    Hyperspace Fuel Tank
                  </div>
                  <div className="flex justify-between font-mono-tech text-sm mb-1.5">
                    <span className="text-slate-300">Current Reserve</span>
                    <span className="text-amber-300 font-bold">
                      {trading.fuel.toFixed(1)} / {trading.maxFuel.toFixed(1)} LY
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-amber-400 rounded-full"
                      style={{
                        width: `${Math.min(100, (trading.fuel / trading.maxFuel) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Station hydrogen fuel costs {FUEL_COST_PER_LY.toFixed(1)} Cr per Light-Year.
                    {trading.upgrades.fuelScoop
                      ? ' Your installed Fuel Scoop can also skim free fuel near any star corona.'
                      : ' Install a Fuel Scoop in the Shipyard to harvest fuel from stars.'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!canRefuel}
                  onClick={onRefuel}
                  className="w-full rounded-md py-2.5 px-4 min-h-[40px] bg-amber-500/22 border border-amber-400/60 text-amber-100 hover:bg-amber-500/35 font-mono-tech text-xs font-semibold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {missingFuel <= 0.05
                    ? 'Fuel Full (7.0 LY)'
                    : `Refuel Ship (+${missingFuel.toFixed(1)} LY · ${refuelFullCost.toFixed(1)} Cr)`}
                </button>
              </div>

              <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80 flex flex-col justify-between gap-4">
                <div>
                  <div className="font-mono-tech text-xs uppercase tracking-[0.18em] text-emerald-300 mb-2">
                    Hull &amp; Armor Plating
                  </div>
                  <div className="flex justify-between font-mono-tech text-sm mb-1.5">
                    <span className="text-slate-300">Hull Integrity</span>
                    <span className="text-emerald-300 font-bold">
                      {Math.round(trading.hull)} / {trading.maxHull}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{
                        width: `${Math.min(100, (trading.hull / trading.maxHull) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Orbital dockyard nano-welding repairs micro-fractures at{' '}
                    {HULL_REPAIR_COST_PER_POINT.toFixed(1)} Cr per integrity point.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={missingHull === 0 || trading.credits < HULL_REPAIR_COST_PER_POINT}
                  onClick={onRepairHull}
                  className="w-full rounded-md py-2.5 px-4 min-h-[40px] bg-emerald-500/22 border border-emerald-400/60 text-emerald-100 hover:bg-emerald-500/35 font-mono-tech text-xs font-semibold uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {missingHull === 0
                    ? `Hull at ${trading.maxHull}%`
                    : `Repair Hull (${repairFullCost.toFixed(1)} Cr)`}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'status' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80">
                <div className="font-mono-tech text-xs uppercase tracking-[0.18em] text-[var(--hud-accent-soft)] mb-3">
                  Ship Specifications &amp; Modules
                </div>
                <div className="space-y-2 font-mono-tech text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current System</span>
                    <span className="text-slate-100 font-semibold">
                      {trading.systemName} ({trading.economy})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cargo Capacity</span>
                    <span className="text-[var(--hud-accent-soft)] font-semibold">
                      {cargoUsed} / {trading.cargoCapacity} t (Tier {cargoTier})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Primary Armament</span>
                    <span className="text-amber-300 font-semibold">
                      {trading.upgrades.pulseLaserMk2 ? 'Pulse Laser Mk II' : 'Pulse Laser Mk I'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Shield &amp; Hull Rating</span>
                    <span className="text-emerald-300 font-semibold">
                      {trading.upgrades.shieldBooster ? 'Boosted (150%)' : 'Standard (100%)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">System Security</span>
                    <span
                      className={`font-semibold ${
                        systemSecurity === 'High Security'
                          ? 'text-emerald-300'
                          : systemSecurity === 'Anarchy'
                            ? 'text-rose-300'
                            : 'text-amber-300'
                      }`}
                    >
                      {systemSecurity}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fuel Scoop</span>
                    <span
                      className={
                        trading.upgrades.fuelScoop ? 'text-emerald-300 font-semibold' : 'text-slate-500'
                      }
                    >
                      {trading.upgrades.fuelScoop ? 'Installed' : 'Not Installed'}
                    </span>
                  </div>
                </div>

                {/* Pilot Combat Rank & Bounty Record */}
                <div
                  data-testid="status-combat-rank"
                  className="mt-4 pt-3.5 border-t border-slate-800 space-y-2 font-mono-tech text-xs"
                >
                  <div className="font-mono-tech text-xs uppercase tracking-[0.18em] text-rose-300">
                    Pilot Combat Rating
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-400">Current Rank</span>
                    <span className="text-amber-300 font-bold uppercase">{rankProgress.rank}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-400">Confirmed Kills</span>
                    <span className="text-slate-100 font-semibold">{rankProgress.kills}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>
                        {rankProgress.nextRank
                          ? `Next: ${rankProgress.nextRank} (${rankProgress.nextThreshold} kills)`
                          : 'Maximum Elite Rating Achieved'}
                      </span>
                      <span>{rankProgress.progressPct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${rankProgress.progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg p-4 bg-[#090d16]/85 border border-slate-700/80">
                <div className="font-mono-tech text-xs uppercase tracking-[0.18em] text-amber-300 mb-3">
                  Cargo Hold Manifest ({cargoUsed} / {trading.cargoCapacity}t)
                </div>
                {cargoUsed === 0 ? (
                  <p className="font-mono-tech text-xs text-slate-400">
                    Cargo hold is currently empty. Purchase low-priced exports in the Commodity Market.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800 font-mono-tech text-xs">
                    {Object.entries(trading.cargo)
                      .filter(([, qty]) => qty > 0)
                      .map(([id, qty]) => {
                        const item = trading.market.find((m) => m.id === id);
                        const avg = trading.avgCostBasis[id];
                        return (
                          <div key={id} className="py-1.5 flex justify-between">
                            <span className="text-slate-200">{item?.name ?? id}</span>
                            <span className="text-[var(--hud-accent-soft)]">
                              {qty}t {avg ? `(paid ${avg.toFixed(1)} Cr/t)` : ''}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Subtle Station Footer: Save / Reset State Controls */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono-tech text-[11px] text-slate-400">
            {lastSavedAt
              ? `Auto-save active · Last saved ${new Date(lastSavedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}`
              : 'Auto-save ready'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveGame}
              className="rounded-md px-3 py-1.5 min-h-[34px] bg-[#090d16] border border-slate-600/60 hud-btn-ghost text-slate-300 font-mono-tech text-[11px] uppercase tracking-wider transition-colors cursor-pointer"
            >
              Save Game
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="rounded-md px-3 py-1.5 min-h-[34px] bg-[#090d16] border border-slate-700 hover:border-rose-400/70 text-slate-400 hover:text-rose-200 font-mono-tech text-[11px] uppercase tracking-wider cursor-pointer"
              >
                Reset Game
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReset(false);
                    onResetGame();
                  }}
                  className="rounded-md px-3 py-1.5 min-h-[34px] bg-rose-500/25 border border-rose-400 text-rose-100 font-mono-tech text-[11px] uppercase tracking-wider cursor-pointer"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md px-2.5 py-1.5 min-h-[34px] bg-[#090d16] border border-slate-600 text-slate-400 font-mono-tech text-[11px] uppercase cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </FadeOverlay>
  );
};
