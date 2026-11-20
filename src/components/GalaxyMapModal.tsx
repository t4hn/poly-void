import React from 'react';
import { MAX_JUMP_RANGE_LY, canJumpToSystem, distanceLY } from '../game/galaxy';
import type { StarSystem } from '../game/types';

interface GalaxyMapModalProps {
  systems: StarSystem[];
  currentSystem: StarSystem;
  selectedSystem: StarSystem | null;
  fuel: number;
  maxFuel: number;
  isDocked: boolean;
  onSelectSystem: (system: StarSystem) => void;
  onInitiateJump: () => void;
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
  systems,
  currentSystem,
  selectedSystem,
  fuel,
  maxFuel,
  isDocked,
  onSelectSystem,
  onInitiateJump,
  onClose,
}) => {
  const inspected = selectedSystem ?? currentSystem;
  const jumpCheck = canJumpToSystem(currentSystem, inspected, fuel, maxFuel);

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
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#050811]/86">
      <div
        role="dialog"
        aria-label="Galactic Chart"
        className="w-full max-w-5xl bg-[#090f1d] border border-sky-400/40 text-slate-100 p-5 md:p-6 max-h-[94vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3.5 border-b border-slate-700/70">
          <div>
            <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-sky-400">
              ASTROGATION CHART // {systems.length} SYSTEMS MAPPED
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-wide text-slate-50 mt-0.5">
              Sector Galactic Map
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 bg-[#060a14] border border-slate-700/80 font-mono-tech text-xs">
              <span className="text-slate-400 mr-2">FUEL:</span>
              <span className="text-sky-300 font-bold">
                {fuel.toFixed(1)} / {maxFuel.toFixed(1)} LY
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#0b1324] border border-slate-500/50 hover:border-sky-400 text-slate-200 font-mono-tech text-xs uppercase tracking-[0.14em] cursor-pointer"
            >
              Close [M]
            </button>
          </div>
        </div>

        {/* Main Chart + Info Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4">
          {/* Interactive 2D Star Chart */}
          <div className="lg:col-span-8 bg-[#050811] border border-slate-700/80 relative overflow-hidden">
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
                fill="rgba(56, 189, 248, 0.045)"
                stroke="#38bdf8"
                strokeOpacity="0.65"
                strokeWidth="1.4"
                strokeDasharray="6 4"
              />
              <text
                x={cx}
                y={cy - maxRangeRadiusPx - 6}
                textAnchor="middle"
                fill="#7dd3fc"
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
                        stroke="#38bdf8"
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
            <div className="p-4 bg-[#060a14] border border-sky-400/30">
              <div className="flex items-center justify-between">
                <span className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-sky-400">
                  {inspected.id === currentSystem.id ? 'Current System' : 'Target System'}
                </span>
                <span
                  className="inline-block w-3 h-3 border border-slate-900"
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
                  <span className="text-slate-400">Tech Level</span>
                  <span className="text-sky-300 font-semibold">TL {inspected.techLevel} / 12</span>
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
                        ? 'text-sky-300'
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
                  className="w-full py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-[0.16em] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isDocked ? 'Undock To Jump' : 'Initiate Jump [H]'}
                </button>
              </div>
            </div>

            {/* Quick-Select Reachable Systems */}
            <div className="p-3.5 bg-[#060a14] border border-slate-700/70 flex-1">
              <div className="font-mono-tech text-[10px] tracking-[0.18em] uppercase text-slate-400 mb-2">
                Systems Within {MAX_JUMP_RANGE_LY.toFixed(1)} LY ({reachableNeighbors.length})
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-800/80">
                {reachableNeighbors.map(({ system, dist }) => {
                  const isSel = selectedSystem?.id === system.id;
                  const affordable = dist <= fuel + 0.001;
                  return (
                    <button
                      key={system.id}
                      type="button"
                      onClick={() => onSelectSystem(system)}
                      className={`w-full px-2.5 py-2 flex items-center justify-between text-left font-mono-tech text-xs transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-sky-500/20 text-amber-200'
                          : 'hover:bg-slate-800/60 text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="font-semibold">{system.name}</div>
                        <div className="text-[10px] text-slate-400">{system.economy}</div>
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
    </div>
  );
};
