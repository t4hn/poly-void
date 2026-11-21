import React from 'react';
import {
  MAX_JUMP_RANGE_LY,
  canJumpToSystem,
  distanceLY,
  findDistressRescueSystem,
  hasReachableNeighbor,
} from '../game/galaxy';
import { DISTRESS_JUMP_FEE, getSystemTradeHints } from '../game/trading';
import type { CargoManifest, StarSystem } from '../game/types';
import { FadeOverlay } from './FadeOverlay';

interface GalaxyMapModalProps {
  open: boolean;
  systems: StarSystem[];
  currentSystem: StarSystem;
  selectedSystem: StarSystem | null;
  fuel: number;
  maxFuel: number;
  credits: number;
  cargo?: CargoManifest;
  avgCostBasis?: Record<string, number>;
  isDocked: boolean;
  onSelectSystem: (system: StarSystem) => void;
  onInitiateJump: () => void;
  onDistressJump: (rescueSystem: StarSystem) => void;
  onClose: () => void;
}

const SVG_W = 720;
const SVG_H = 540;
const PAD = 38;
const SECTOR_W = 28;
const SECTOR_H = 22;

function toSvgX(x: number): number {
  return PAD + (x / SECTOR_W) * (SVG_W - PAD * 2);
}

function toSvgY(y: number): number {
  return PAD + (y / SECTOR_H) * (SVG_H - PAD * 2);
}

const LY_PX = (SVG_W - PAD * 2) / SECTOR_W;

export const GalaxyMapModal: React.FC<GalaxyMapModalProps> = ({
  open,
  systems,
  currentSystem,
  selectedSystem,
  fuel,
  maxFuel,
  credits,
  cargo = {},
  avgCostBasis = {},
  isDocked,
  onSelectSystem,
  onInitiateJump,
  onDistressJump,
  onClose,
}) => {
  const inspected = selectedSystem ?? currentSystem;
  const jumpCheck = canJumpToSystem(currentSystem, inspected, fuel, maxFuel);
  const tradeHints = getSystemTradeHints(inspected, cargo, avgCostBasis);
  const isStranded = !hasReachableNeighbor(currentSystem, systems, fuel, maxFuel);
  const distressTarget = isStranded ? findDistressRescueSystem(currentSystem, systems, maxFuel) : null;

  const reachableNeighbors = systems
    .filter((s) => s.id !== currentSystem.id)
    .map((s) => ({
      system: s,
      dist: Math.round(distanceLY(currentSystem, s) * 10) / 10,
    }))
    .filter((entry) => entry.dist <= MAX_JUMP_RANGE_LY)
    .sort((a, b) => a.dist - b.dist);

  const cx = toSvgX(currentSystem.x);
  const cy = toSvgY(currentSystem.y);
  const maxRangeRadiusPx = MAX_JUMP_RANGE_LY * LY_PX;
  const fuelRangeRadiusPx = Math.min(MAX_JUMP_RANGE_LY, fuel) * LY_PX;

  return (
    <FadeOverlay open={open} zIndexClass="z-30">
      <div
        role="dialog"
        aria-label="Galactic Chart"
        className="w-full max-w-5xl rounded-xl bg-[#090f1d] border hud-modal text-slate-100 p-5 md:p-6 max-h-[94vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3.5 border-b border-slate-700/70">
          <div>
            <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-[var(--hud-accent)]">
              ASTROGATION CHART // {systems.length} SYSTEMS MAPPED
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-wide text-slate-50 mt-0.5">
              Sector Galactic Map
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="rounded-md px-3 py-1.5 bg-[#060a14] border border-slate-700/80 font-mono-tech text-xs">
              <span className="text-slate-400 mr-2">FUEL:</span>
              <span className="text-[var(--hud-accent-soft)] font-bold">
                {fuel.toFixed(1)} / {maxFuel.toFixed(1)} LY
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 bg-[#0b1324] border border-slate-500/50 text-slate-200 hud-btn-ghost font-mono-tech text-xs uppercase tracking-[0.14em] transition-colors cursor-pointer"
            >
              Close [M]
            </button>
          </div>
        </div>

        {/* Main Chart + Info Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4">
          {/* Interactive 2D Star Chart */}
          <div className="lg:col-span-8 rounded-lg bg-[#050811] border border-slate-700/80 relative overflow-hidden">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full h-auto block select-none"
              aria-label="64-System Sector Map"
            >
              {/* Coordinate Grid */}
              {[0, 4, 8, 12, 16, 20, 24, 28].map((gx) => {
                const px = toSvgX(gx);
                return (
                  <line
                    key={`gx-${gx}`}
                    x1={px}
                    y1={PAD}
                    x2={px}
                    y2={SVG_H - PAD}
                    stroke="#1e293b"
                    strokeWidth="0.7"
                    strokeDasharray="2 4"
                  />
                );
              })}
              {[0, 4, 8, 12, 16, 20].map((gy) => {
                const py = toSvgY(gy);
                return (
                  <line
                    key={`gy-${gy}`}
                    x1={PAD}
                    y1={py}
                    x2={SVG_W - PAD}
                    y2={py}
                    stroke="#1e293b"
                    strokeWidth="0.7"
                    strokeDasharray="2 4"
                  />
                );
              })}

              {/* 7.0 LY Max Jump Range Circle */}
              <circle
                cx={cx}
                cy={cy}
                r={maxRangeRadiusPx}
                fill="rgba(var(--hud-accent-rgb), 0.05)"
                stroke="var(--hud-accent)"
                strokeOpacity="0.65"
                strokeWidth="1.4"
                strokeDasharray="6 4"
              />
              <text
                x={cx}
                y={cy - maxRangeRadiusPx - 6}
                textAnchor="middle"
                fill="var(--hud-accent-soft)"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                7.0 LY MAX JUMP RANGE
              </text>

              {/* Current Fuel Reach Circle (when lower than 7.0 LY) */}
              {fuel < maxFuel - 0.05 && fuel > 0.1 && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={fuelRangeRadiusPx}
                  fill="none"
                  stroke="#fbbf24"
                  strokeOpacity="0.7"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
              )}

              {/* Route Vector Line to Selected System */}
              {selectedSystem && selectedSystem.id !== currentSystem.id && (
                <line
                  x1={cx}
                  y1={cy}
                  x2={toSvgX(selectedSystem.x)}
                  y2={toSvgY(selectedSystem.y)}
                  stroke={jumpCheck.ok ? '#34d399' : '#f87171'}
                  strokeWidth="1.6"
                  strokeDasharray={jumpCheck.ok ? undefined : '4 4'}
                />
              )}

              {/* 64 Star Nodes */}
              {systems.map((sys) => {
                const sx = toSvgX(sys.x);
                const sy = toSvgY(sys.y);
                const isCurrent = sys.id === currentSystem.id;
                const isSelected = selectedSystem?.id === sys.id;
                const dist = distanceLY(currentSystem, sys);
                const inMaxRange = dist <= MAX_JUMP_RANGE_LY;
                const canReach = !isCurrent && dist <= Math.min(MAX_JUMP_RANGE_LY, fuel + 0.001);

                return (
                  <g
                    key={sys.id}
                    role="button"
                    tabIndex={0}
                    data-system-id={sys.id}
                    data-system-name={sys.name}
                    data-reachable={canReach ? 'true' : 'false'}
                    aria-label={`${sys.name} (${sys.economy}, ${dist.toFixed(1)} LY)`}
                    onClick={() => onSelectSystem(sys)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectSystem(sys);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    {/* Invisible generous click hit target */}
                    <circle cx={sx} cy={sy} r="12" fill="transparent" />

                    {/* Current System Marker */}
                    {isCurrent && (
                      <polygon
                        points={`${sx},${sy - 11} ${sx + 11},${sy} ${sx},${sy + 11} ${sx - 11},${sy}`}
                        fill="none"
                        stroke="var(--hud-accent)"
                        strokeWidth="1.6"
                      />
                    )}

                    {/* Selected System Reticle */}
                    {isSelected && (
                      <circle
                        cx={sx}
                        cy={sy}
                        r="10"
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth="1.8"
                      />
                    )}

                    {/* Star Core */}
                    <circle
                      cx={sx}
                      cy={sy}
                      r={isCurrent || isSelected ? 4.6 : inMaxRange ? 3.8 : 2.9}
                      fill={sys.sunCssColor}
                      fillOpacity={inMaxRange || isCurrent || isSelected ? 1 : 0.7}
                      stroke="#050811"
                      strokeWidth="1"
                    />

                    {/* Label for current, selected, or nearby systems */}
                    {(isCurrent || isSelected || inMaxRange) && (
                      <text
                        x={sx}
                        y={sy + 15}
                        textAnchor="middle"
                        fill={
                          isSelected
                            ? '#fde68a'
                            : isCurrent
                              ? '#7dd3fc'
                              : canReach
                                ? '#cbd5e1'
                                : '#64748b'
                        }
                        fontSize={isCurrent || isSelected ? '10.5' : '9.5'}
                        fontWeight={isCurrent || isSelected ? '700' : '500'}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {sys.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Right Panel: Selected System Card + Reachable Targets */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="rounded-lg p-4 bg-[#060a14] border hud-panel">
              <div className="flex items-center justify-between">
                <span className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-[var(--hud-accent)]">
                  {inspected.id === currentSystem.id ? 'Current System' : 'Target System'}
                </span>
                <span
                  className="inline-block w-3 h-3 rounded-full border border-slate-900"
                  style={{ backgroundColor: inspected.sunCssColor }}
                />
              </div>

              <h3 className="text-xl font-bold text-slate-50 mt-1">{inspected.name}</h3>

              <div className="mt-3 space-y-1.5 font-mono-tech text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Economy</span>
                  <span className="text-amber-300 font-semibold">{inspected.economy}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Security</span>
                  <span
                    data-testid="map-system-security"
                    className={`font-semibold ${
                      inspected.securityLevel === 'High Security'
                        ? 'text-emerald-300'
                        : inspected.securityLevel === 'Anarchy'
                          ? 'text-rose-300'
                          : 'text-amber-300'
                    }`}
                  >
                    {inspected.securityLevel}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tech Level</span>
                  <span className="text-[var(--hud-accent-soft)] font-semibold">
                    TL {inspected.techLevel} / 12
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Inhabitants</span>
                  <span className="text-slate-200">{inspected.inhabitants}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Distance</span>
                  <span className="text-slate-100 font-semibold">
                    {inspected.id === currentSystem.id
                      ? '0.0 LY'
                      : `${jumpCheck.distance.toFixed(1)} LY`}
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800">
                <div
                  className={`font-mono-tech text-[11px] uppercase tracking-wider mb-2.5 ${
                    jumpCheck.ok
                      ? 'text-emerald-300'
                      : inspected.id === currentSystem.id
                        ? 'text-[var(--hud-accent-soft)]'
                        : 'text-rose-300'
                  }`}
                >
                  {jumpCheck.ok
                    ? `ROUTE LOCKED — ${jumpCheck.distance.toFixed(1)} LY FUEL COST`
                    : jumpCheck.reason}
                </div>

                <button
                  type="button"
                  disabled={!jumpCheck.ok || isDocked}
                  onClick={onInitiateJump}
                  className="w-full rounded-md py-2.5 border hud-btn-primary font-mono-tech text-xs font-bold uppercase tracking-[0.16em] disabled:cursor-not-allowed cursor-pointer transition-colors"
                >
                  {isDocked ? 'Undock To Jump' : 'Initiate Jump [H]'}
                </button>
              </div>
            </div>

            {/* Economy Trade Route Hints & Held Cargo Outlook */}
            <div
              data-testid="map-trade-hints"
              className="rounded-lg p-3.5 bg-[#060a14] border border-slate-700/80 space-y-2.5 font-mono-tech text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.18em] uppercase text-[var(--hud-accent)]">
                  Trade Route Hints
                </span>
                <span className="text-[10px] text-slate-400">
                  Est. Local Prices
                </span>
              </div>

              <div className="space-y-1.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-300/90 mb-1">
                    Best Exports (Buy Low)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tradeHints.bestExports.map((item) => (
                      <span
                        key={item.id}
                        className="rounded px-2 py-0.5 bg-emerald-500/12 border border-emerald-400/35 text-emerald-200 text-[11px]"
                      >
                        {item.name} ~{item.estimatedPrice.toFixed(1)}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-amber-300/90 mb-1">
                    High Demand (Sell High)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tradeHints.highDemand.map((item) => (
                      <span
                        key={item.id}
                        className="rounded px-2 py-0.5 bg-amber-500/12 border border-amber-400/35 text-amber-200 text-[11px]"
                      >
                        {item.name} ~{item.estimatedPrice.toFixed(1)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {tradeHints.cargoQuotes.length > 0 && (
                <div
                  data-testid="map-cargo-quotes"
                  className="pt-2 border-t border-slate-800 space-y-1.5"
                >
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Your Cargo Here
                  </div>
                  {tradeHints.cargoQuotes.map((quote) => {
                    const isProfit = quote.verdict === 'profit' || quote.verdict === 'salvage';
                    const isLoss = quote.verdict === 'loss';
                    return (
                      <div
                        key={quote.id}
                        data-cargo-quote={quote.id}
                        data-verdict={quote.verdict}
                        className={`rounded px-2.5 py-1.5 border flex items-center justify-between gap-2 ${
                          isProfit
                            ? 'bg-emerald-500/12 border-emerald-400/45 text-emerald-100'
                            : isLoss
                              ? 'bg-rose-500/12 border-rose-400/45 text-rose-100'
                              : 'bg-slate-800/50 border-slate-700 text-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {quote.name} ({quote.quantity}t)
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {quote.avgCost !== null
                              ? `Paid ${quote.avgCost.toFixed(1)} → ~${quote.estimatedPrice.toFixed(1)} Cr`
                              : `Salvage → ~${quote.estimatedPrice.toFixed(1)} Cr`}
                          </div>
                        </div>
                        <div
                          className={`text-right shrink-0 font-bold text-[11px] ${
                            isProfit
                              ? 'text-emerald-300'
                              : isLoss
                                ? 'text-rose-300'
                                : 'text-slate-300'
                          }`}
                        >
                          {quote.verdict === 'salvage' ? (
                            <>+{quote.totalDelta.toFixed(1)} Cr</>
                          ) : (
                            <>
                              {quote.deltaPerUnit > 0 ? '+' : ''}
                              {quote.deltaPerUnit.toFixed(1)}/t
                              <div className="text-[10px] font-normal">
                                ({quote.totalDelta > 0 ? '+' : ''}
                                {quote.totalDelta.toFixed(1)} Cr)
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {isStranded && distressTarget && !isDocked && (
              <div
                data-testid="distress-jump-card"
                className="rounded-lg p-3.5 bg-amber-500/12 border border-amber-400/65"
              >
                <div className="font-mono-tech text-[10px] tracking-[0.18em] uppercase text-amber-300 font-bold">
                  LOW FUEL // DISTRESS BEACON READY
                </div>
                <p className="font-mono-tech text-[11px] text-slate-200 mt-1 leading-relaxed">
                  Insufficient fuel for standard hyperspace. Request an emergency guild tow to{' '}
                  <span className="text-amber-200 font-semibold">{distressTarget.system.name}</span>{' '}
                  ({distressTarget.system.economy}, {distressTarget.distance.toFixed(1)} LY) with
                  2.0 LY reserve.
                </p>
                <div className="font-mono-tech text-[10px] text-amber-200/90 mt-1">
                  {credits >= DISTRESS_JUMP_FEE
                    ? `Rescue Fee: ${DISTRESS_JUMP_FEE.toFixed(1)} Cr`
                    : 'Emergency Guild Credit Loan Activated (No Soft-Lock)'}
                </div>
                <button
                  type="button"
                  onClick={() => onDistressJump(distressTarget.system)}
                  className="mt-2.5 w-full rounded-md py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Emergency Distress Jump
                </button>
              </div>
            )}

            {/* Quick-Select Reachable Systems */}
            <div className="rounded-lg p-3.5 bg-[#060a14] border border-slate-700/70 flex-1">
              <div className="font-mono-tech text-[10px] tracking-[0.18em] uppercase text-slate-400 mb-2">
                Systems Within {MAX_JUMP_RANGE_LY.toFixed(1)} LY ({reachableNeighbors.length})
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                {reachableNeighbors.map(({ system, dist }) => {
                  const isSel = selectedSystem?.id === system.id;
                  const affordable = dist <= fuel + 0.001;
                  return (
                    <button
                      key={system.id}
                      type="button"
                      onClick={() => onSelectSystem(system)}
                      className={`w-full rounded-md px-2.5 py-2 flex items-center justify-between text-left font-mono-tech text-xs transition-colors border cursor-pointer ${
                        isSel
                          ? 'hud-btn-active font-semibold'
                          : 'border-transparent hover:bg-slate-800/60 text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="font-semibold">{system.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {system.economy} ·{' '}
                          <span
                            className={
                              system.securityLevel === 'High Security'
                                ? 'text-emerald-300'
                                : system.securityLevel === 'Anarchy'
                                  ? 'text-rose-300'
                                  : 'text-amber-300'
                            }
                          >
                            {system.securityLevel}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-semibold ${
                          affordable ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {dist.toFixed(1)} LY
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </FadeOverlay>
  );
};
