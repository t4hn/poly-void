import React from 'react';
import {
  CARGO_UPGRADE_COST,
  CARGO_UPGRADE_INCREMENT,
  FUEL_COST_PER_LY,
  HULL_REPAIR_COST_PER_POINT,
  getCargoUsed,
  getMaxBuyableQuantity,
} from '../game/trading';
import type { TradingState } from '../game/types';

interface TradingModalProps {
  trading: TradingState;
  tradeFeedback: string | null;
  onBuy: (commodityId: string, qty: number) => void;
  onBuyMax: (commodityId: string) => void;
  onSell: (commodityId: string, qty: number) => void;
  onRefuel: () => void;
  onRepairHull: () => void;
  onUpgradeCargo: () => void;
  onUndock: () => void;
}

export const TradingModal: React.FC<TradingModalProps> = ({
  trading,
  tradeFeedback,
  onBuy,
  onBuyMax,
  onSell,
  onRefuel,
  onRepairHull,
  onUpgradeCargo,
  onUndock,
}) => {
  const cargoUsed = getCargoUsed(trading.cargo);
  const cargoFree = trading.cargoCapacity - cargoUsed;
  const missingHull = Math.max(0, trading.maxHull - Math.round(trading.hull));
  const repairFullCost = Math.round(missingHull * HULL_REPAIR_COST_PER_POINT * 10) / 10;

  const missingFuel = Math.max(0, Math.round((trading.maxFuel - trading.fuel) * 10) / 10);
  const refuelFullCost = Math.round(missingFuel * FUEL_COST_PER_LY * 10) / 10;
  const canRefuel = missingFuel > 0.05 && trading.credits >= 0.2;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#050811]/85">
      <div
        role="dialog"
        aria-label="Station Concourse Commodity Market"
        className="w-full max-w-5xl bg-[#0b1220] border border-sky-400/35 text-slate-100 p-5 md:p-7 max-h-[94vh] overflow-y-auto"
      >
        {/* Station Concourse Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-700/70">
          <div>
            <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-sky-400">
              DOCKED // {trading.systemName.toUpperCase()} ORBITAL — STATION CONCOURSE
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <h2 className="text-xl md:text-2xl font-bold tracking-wide text-slate-50">
                Commodity Market &amp; Hangar Services
              </h2>
              <span className="px-2.5 py-0.5 bg-amber-500/15 border border-amber-400/40 font-mono-tech text-[11px] uppercase tracking-wider text-amber-200">
                {trading.economy} · TL {trading.techLevel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="text-right">
              <div className="font-mono-tech text-[10px] uppercase tracking-widest text-slate-400">
                Available Credits
              </div>
              <div className="font-mono-tech text-lg font-bold text-amber-300">
                {trading.credits.toFixed(1)} Cr
              </div>
            </div>
            <button
              type="button"
              onClick={onUndock}
              className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-[0.16em] cursor-pointer whitespace-nowrap"
            >
              Launch Ship
            </button>
          </div>
        </div>

        {tradeFeedback && (
          <div className="mt-3 px-3 py-1.5 bg-sky-500/12 border border-sky-400/40 font-mono-tech text-xs text-sky-200">
            {tradeFeedback}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-5">
          {/* Commodity Market Table */}
          <div className="lg:col-span-8">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-mono-tech text-xs uppercase tracking-[0.18em] text-slate-400">
                {trading.systemName} Exchange Board
              </span>
              <span className="font-mono-tech text-[11px] text-slate-400">
                Hold: <span className="text-sky-300 font-semibold">{cargoUsed}/{trading.cargoCapacity}t</span>
              </span>
            </div>

            <div className="border border-slate-700/70 divide-y divide-slate-800/90">
              {trading.market.map((item) => {
                const owned = trading.cargo[item.id] ?? 0;
                const maxBuyable = getMaxBuyableQuantity(trading, item.id);
                const canBuyOne =
                  item.stock > 0 && cargoFree > 0 && trading.credits + 0.001 >= item.price;
                const canSell = owned > 0;

                return (
                  <div
                    key={item.id}
                    data-commodity={item.id}
                    className="grid grid-cols-12 items-center gap-2 px-3 py-2.5 text-sm bg-[#090d16]/75"
                  >
                    <div className="col-span-4 sm:col-span-3">
                      <div className="font-semibold text-slate-100">{item.name}</div>
                      <div className="font-mono-tech text-[10px] uppercase text-slate-400">
                        Stock {item.stock}t
                      </div>
                    </div>

                    <div className="col-span-3 sm:col-span-2 text-right font-mono-tech">
                      <div className="text-amber-300 font-semibold">{item.price.toFixed(1)} Cr</div>
                      <div className="text-[10px] text-slate-400">
                        {item.trend === 'up'
                          ? '▲ HIGH'
                          : item.trend === 'down'
                            ? '▼ LOW'
                            : '— AVG'}
                      </div>
                    </div>

                    <div className="col-span-2 text-right font-mono-tech text-xs text-slate-300">
                      <span className="text-slate-400 hidden sm:inline">Hold: </span>
                      <span className="text-sky-300 font-semibold">{owned}t</span>
                    </div>

                    <div className="col-span-12 sm:col-span-5 flex items-center justify-end gap-1 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!canBuyOne}
                        aria-label={`Buy 1 ${item.name}`}
                        onClick={() => onBuy(item.id, 1)}
                        className="px-2 py-1 font-mono-tech text-[11px] whitespace-nowrap bg-sky-500/20 border border-sky-400/50 text-sky-200 hover:bg-sky-500/35 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        disabled={maxBuyable <= 0}
                        aria-label={`Buy Max ${item.name}`}
                        onClick={() => onBuyMax(item.id)}
                        className="px-2 py-1 font-mono-tech text-[11px] whitespace-nowrap bg-sky-500/12 border border-sky-400/40 text-sky-300 hover:bg-sky-500/28 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Buy Max
                      </button>
                      <button
                        type="button"
                        disabled={!canSell}
                        aria-label={`Sell 1 ${item.name}`}
                        onClick={() => onSell(item.id, 1)}
                        className="px-2 py-1 font-mono-tech text-[11px] whitespace-nowrap bg-amber-500/20 border border-amber-400/50 text-amber-200 hover:bg-amber-500/35 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        disabled={!canSell}
                        aria-label={`Sell All ${item.name}`}
                        onClick={() => onSell(item.id, owned)}
                        className="px-2 py-1 font-mono-tech text-[11px] whitespace-nowrap bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/35 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Sell All
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ship Hangar & Outfitting */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="p-4 bg-[#090d16]/85 border border-slate-700/70">
              <div className="font-mono-tech text-xs uppercase tracking-[0.18em] text-slate-400 mb-3">
                Starfighter Status
              </div>

              <div className="mb-3">
                <div className="flex justify-between font-mono-tech text-xs mb-1">
                  <span className="text-slate-300">Cargo Hold</span>
                  <span className="text-sky-300">
                    {cargoUsed} / {trading.cargoCapacity} t
                  </span>
                </div>
                <div className="h-2 bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-sky-400"
                    style={{
                      width: `${Math.min(100, (cargoUsed / trading.cargoCapacity) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mb-3">
                <div className="flex justify-between font-mono-tech text-xs mb-1">
                  <span className="text-slate-300">Hyperspace Fuel</span>
                  <span className="text-amber-300">
                    {trading.fuel.toFixed(1)} / {trading.maxFuel.toFixed(1)} LY
                  </span>
                </div>
                <div className="h-2 bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400"
                    style={{
                      width: `${Math.min(100, (trading.fuel / trading.maxFuel) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mb-4">
                <div className="flex justify-between font-mono-tech text-xs mb-1">
                  <span className="text-slate-300">Hull Integrity</span>
                  <span className="text-emerald-300">{Math.round(trading.hull)}%</span>
                </div>
                <div className="h-2 bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400"
                    style={{ width: `${Math.round(trading.hull)}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={!canRefuel}
                  onClick={onRefuel}
                  className="w-full py-2 px-3 bg-amber-500/18 border border-amber-400/50 text-amber-200 hover:bg-amber-500/30 font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {missingFuel <= 0.05
                    ? 'Fuel Full (7.0 LY)'
                    : `Refuel Ship (+${missingFuel.toFixed(1)} LY · ${refuelFullCost.toFixed(1)} Cr)`}
                </button>

                <button
                  type="button"
                  disabled={missingHull === 0 || trading.credits < HULL_REPAIR_COST_PER_POINT}
                  onClick={onRepairHull}
                  className="w-full py-2 px-3 bg-emerald-500/18 border border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30 font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {missingHull === 0
                    ? 'Hull at 100%'
                    : `Repair Hull (${repairFullCost.toFixed(1)} Cr)`}
                </button>

                <button
                  type="button"
                  disabled={trading.credits < CARGO_UPGRADE_COST}
                  onClick={onUpgradeCargo}
                  className="w-full py-2 px-3 bg-sky-500/18 border border-sky-400/50 text-sky-200 hover:bg-sky-500/30 font-mono-tech text-xs uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Expand Rack +{CARGO_UPGRADE_INCREMENT}t ({CARGO_UPGRADE_COST} Cr)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
