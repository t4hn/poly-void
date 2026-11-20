import React, { useState } from 'react';
import { formatDistance } from '../game/flightMath';
import type { HudSnapshot } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  radarCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onToggleInvertPitch: () => void;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onDockNow: () => void;
  onToggleAutoDock: () => void;
  onToggleStarMap: () => void;
  onTriggerJump: () => void;
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy + r * Math.sin(rad(endDeg));
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  radarCanvasRef,
  onToggleInvertPitch,
  onToggleCamera,
  onToggleMute,
  onPause,
  onDockNow,
  onToggleAutoDock,
  onToggleStarMap,
  onTriggerJump,
}) => {
  const [showControls, setShowControls] = useState(true);

  const throttlePct = Math.round(hud.throttle * 100);
  const hullPct = Math.round((hud.hull / hud.maxHull) * 100);
  const shieldPct = Math.round((hud.shield / hud.maxShield) * 100);

  const throttleZeroDeg = 148;
  const throttleTopDeg = 230;
  const throttleRevDeg = 130;
  const throttleEndDeg =
    hud.throttle >= 0
      ? throttleZeroDeg + hud.throttle * (throttleTopDeg - throttleZeroDeg)
      : throttleZeroDeg - (Math.abs(hud.throttle) / 0.35) * (throttleZeroDeg - throttleRevDeg);

  const hullStartDeg = 48;
  const hullMaxDeg = -48;
  const hullEndDeg = hullStartDeg + (hullPct / 100) * (hullMaxDeg - hullStartDeg);
  const shieldEndDeg = hullStartDeg + (shieldPct / 100) * (hullMaxDeg - hullStartDeg);

  const target = hud.target;
  const docking = hud.docking;
  const showDockButton = docking.isReadyToDock && docking.distanceMeters <= 180;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Hyperspace Screen-Flash Overlay */}
      {hud.hyperspaceFlash > 0.01 && (
        <div
          className="fixed inset-0 z-40 pointer-events-none bg-sky-100"
          style={{ opacity: Math.min(1, hud.hyperspaceFlash) }}
        />
      )}

      {/* Subtle World-Space Target Lock Bracket */}
      {target && target.onScreen && (
        <div
          style={{
            left: `${target.screenX}%`,
            top: `${target.screenY}%`,
            transform: 'translate(-50%, -50%)',
          }}
          className="fixed pointer-events-none"
        >
          <div
            className={`w-10 h-10 border relative ${
              target.kind === 'bay'
                ? 'border-sky-400/80'
                : target.kind === 'canister'
                  ? 'border-emerald-400/85'
                  : 'border-amber-400/75'
            }`}
            style={{
              clipPath:
                'polygon(0 0, 28% 0, 28% 2px, 2px 2px, 2px 28%, 0 28%, 0 72%, 2px 72%, 2px 98%, 28% 98%, 28% 100%, 0 100%, 72% 100%, 72% 98%, 98% 98%, 98% 72%, 100% 72%, 100% 100%, 100% 0, 72% 0, 72% 2px, 98% 2px, 98% 28%, 100% 28%)',
            }}
          />
          <div className="font-mono-tech text-[10px] tracking-wider text-sky-200/90 whitespace-nowrap text-center mt-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {formatDistance(target.distanceMeters)}
          </div>
        </div>
      )}

      {/* Center Reticle + Curved SVG Arc Gauges */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        aria-label="Flight Reticle"
      >
        <svg viewBox="0 0 240 200" className="w-[240px] h-[200px] overflow-visible">
          <path
            d={describeArc(120, 100, 74, 130, 230)}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="4"
            strokeLinecap="butt"
          />
          <path
            d={describeArc(120, 100, 74, -48, 48)}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="4"
            strokeLinecap="butt"
          />

          {Math.abs(hud.throttle) > 0.01 && (
            <path
              d={
                hud.throttle >= 0
                  ? describeArc(120, 100, 74, throttleZeroDeg, throttleEndDeg)
                  : describeArc(120, 100, 74, throttleEndDeg, throttleZeroDeg)
              }
              fill="none"
              stroke={hud.throttle >= 0 ? '#38bdf8' : '#f59e0b'}
              strokeWidth="4.5"
              strokeLinecap="butt"
            />
          )}

          <line
            x1={120 + 68 * Math.cos((throttleZeroDeg * Math.PI) / 180)}
            y1={100 + 68 * Math.sin((throttleZeroDeg * Math.PI) / 180)}
            x2={120 + 80 * Math.cos((throttleZeroDeg * Math.PI) / 180)}
            y2={100 + 80 * Math.sin((throttleZeroDeg * Math.PI) / 180)}
            stroke="#e2e8f0"
            strokeWidth="1.5"
          />

          {hullPct > 0 && (
            <path
              d={describeArc(120, 100, 74, hullEndDeg, hullStartDeg)}
              fill="none"
              stroke={hullPct > 55 ? '#34d399' : hullPct > 25 ? '#fbbf24' : '#f87171'}
              strokeWidth="4.5"
              strokeLinecap="butt"
            />
          )}
          {shieldPct > 0 && (
            <path
              d={describeArc(120, 100, 82, shieldEndDeg, hullStartDeg)}
              fill="none"
              stroke="#38bdf8"
              strokeOpacity="0.8"
              strokeWidth="2.2"
              strokeLinecap="butt"
            />
          )}

          <circle
            cx="120"
            cy="100"
            r="14"
            fill="none"
            stroke="rgba(56, 189, 248, 0.55)"
            strokeWidth="1.2"
          />
          <line x1="98" y1="100" x2="111" y2="100" stroke="#e2e8f0" strokeWidth="1.4" />
          <line x1="129" y1="100" x2="142" y2="100" stroke="#e2e8f0" strokeWidth="1.4" />
          <line x1="120" y1="78" x2="120" y2="91" stroke="#e2e8f0" strokeWidth="1.4" />
          <line x1="120" y1="109" x2="120" y2="122" stroke="#e2e8f0" strokeWidth="1.4" />
          <circle cx="120" cy="100" r="1.5" fill="#38bdf8" />

          <text
            x="24"
            y="96"
            textAnchor="end"
            fill="#f1f5f9"
            stroke="#090d16"
            strokeWidth="3.5"
            paintOrder="stroke fill"
            fontSize="13"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {Math.round(hud.speedMps)}
          </text>
          <text
            x="24"
            y="109"
            textAnchor="end"
            fill="#7dd3fc"
            stroke="#090d16"
            strokeWidth="3"
            paintOrder="stroke fill"
            fontSize="9"
            fontWeight="600"
            letterSpacing="1.2"
            fontFamily="JetBrains Mono, monospace"
          >
            {throttlePct < 0 ? `REV ${throttlePct}%` : `THR ${throttlePct}%`}
          </text>

          <text
            x="216"
            y="96"
            textAnchor="start"
            fill="#f1f5f9"
            stroke="#090d16"
            strokeWidth="3.5"
            paintOrder="stroke fill"
            fontSize="13"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {hullPct}%
          </text>
          <text
            x="216"
            y="109"
            textAnchor="start"
            fill="#34d399"
            stroke="#090d16"
            strokeWidth="3"
            paintOrder="stroke fill"
            fontSize="9"
            fontWeight="600"
            letterSpacing="1.2"
            fontFamily="JetBrains Mono, monospace"
          >
            SHD {shieldPct}%
          </text>
        </svg>
      </div>

      {/* Hyperspace Countdown Banner (top-center clear zone) */}
      {hud.hyperspaceCountdown !== null && (
        <div
          data-testid="hyperspace-countdown"
          className="fixed top-4 left-1/2 -translate-x-1/2 px-5 py-2 bg-[#060a14]/92 border border-sky-400/75 text-center max-w-[360px]"
        >
          <div className="font-mono-tech text-[10px] tracking-[0.22em] uppercase text-sky-300 truncate">
            HYPERSPACE JUMP → {hud.selectedJumpSystemName?.toUpperCase() ?? 'DESTINATION'}
          </div>
          <div className="font-mono-tech text-lg font-bold text-amber-300 mt-0.5">
            T-{Math.max(0, hud.hyperspaceCountdown).toFixed(1)}s
          </div>
        </div>
      )}

      {/* Transient Alert Banner (top-center clear zone) */}
      {hud.alertMessage && hud.hyperspaceCountdown === null && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-[#090d16]/88 border border-amber-400/50 font-mono-tech text-xs tracking-[0.14em] uppercase text-amber-200 whitespace-nowrap max-w-[380px] truncate">
          {hud.alertMessage}
        </div>
      )}

      {/* Top-Left Compact Telemetry & Action Bar */}
      <div className="fixed top-4 left-4 flex flex-col gap-1.5 pointer-events-auto w-[360px] max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#090d16]/80 border border-sky-400/25">
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              System
            </div>
            <div
              data-testid="hud-system-name"
              className="font-mono-tech text-sm font-bold text-sky-300"
            >
              {hud.currentSystemName}
            </div>
          </div>
          <div className="h-7 w-px bg-slate-600/40" />
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              Credits
            </div>
            <div
              data-testid="hud-credits"
              className="font-mono-tech text-sm font-bold text-amber-300"
            >
              {hud.credits.toFixed(1)} Cr
            </div>
          </div>
          <div className="h-7 w-px bg-slate-600/40" />
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              Cargo
            </div>
            <div data-testid="hud-cargo" className="font-mono-tech text-sm font-bold text-slate-100">
              {hud.cargoUsed}/{hud.cargoCapacity}t
            </div>
          </div>
          <div className="h-7 w-px bg-slate-600/40" />
          <div>
            <div className="font-mono-tech text-[10px] tracking-[0.16em] text-slate-400 uppercase">
              Fuel
            </div>
            <div data-testid="hud-fuel" className="font-mono-tech text-sm font-bold text-emerald-300">
              {hud.fuel.toFixed(1)} LY
            </div>
          </div>
        </div>

        {/* Navigation & Cockpit Action Buttons (cleanly bounded within 360px) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleAutoDock();
            }}
            aria-label="Toggle Auto-Dock"
            className={`px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap ${
              hud.autoDockActive
                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                : hud.canAutoDock
                  ? 'bg-sky-500/20 border-sky-400/65 text-sky-200 hover:bg-sky-500/35'
                  : 'bg-[#090d16]/75 border-slate-600/40 text-slate-400'
            }`}
          >
            {hud.autoDockActive ? 'Auto-Docking [C]' : 'Auto-Dock [C]'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleStarMap();
            }}
            aria-label="Open Star Map"
            className="px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider bg-[#090d16]/80 border border-sky-400/45 text-sky-200 hover:bg-sky-500/20 transition-colors cursor-pointer whitespace-nowrap"
          >
            Star Map [M]
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onTriggerJump();
            }}
            aria-label="Hyperspace Jump"
            className={`px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap ${
              hud.canJumpSelected
                ? 'bg-amber-500/20 border-amber-400/70 text-amber-200 hover:bg-amber-500/35'
                : 'bg-[#090d16]/75 border-slate-500/35 text-slate-300 hover:border-sky-400/50'
            }`}
          >
            {hud.selectedJumpSystemName
              ? `Jump → ${hud.selectedJumpSystemName} [H]`
              : 'Jump [H]'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleInvertPitch();
            }}
            aria-label="Toggle Inverted Pitch"
            className={`px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap ${
              hud.invertPitch
                ? 'bg-amber-500/20 border-amber-400/65 text-amber-200'
                : 'bg-[#090d16]/75 border-slate-500/35 text-slate-300 hover:border-sky-400/50'
            }`}
          >
            Pitch [I]: {hud.invertPitch ? 'INV' : 'STD'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleCamera();
            }}
            aria-label="Toggle Camera View"
            className="px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider bg-[#090d16]/75 border border-slate-500/35 text-slate-300 hover:border-sky-400/50 transition-colors cursor-pointer whitespace-nowrap"
          >
            Cam [V]: {hud.cameraMode === 'cockpit' ? 'Cockpit' : 'Chase'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={hud.muted ? 'Unmute Audio' : 'Mute Audio'}
            className="px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider bg-[#090d16]/75 border border-slate-500/35 text-slate-300 hover:border-sky-400/50 transition-colors cursor-pointer whitespace-nowrap"
          >
            {hud.muted ? 'Muted [N]' : 'Audio [N]'}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            aria-label="Pause Game"
            className="px-2 py-1 font-mono-tech text-[11px] uppercase tracking-wider bg-[#090d16]/75 border border-slate-500/35 text-slate-300 hover:border-sky-400/50 transition-colors cursor-pointer whitespace-nowrap"
          >
            Pause [Esc]
          </button>
        </div>
      </div>

      {/* Top-Right Target Info & Docking Alignment Box */}
      <div className="fixed top-4 right-4 w-64 px-3.5 py-2.5 bg-[#090d16]/80 border border-sky-400/25">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-sky-300/80">
            Target Lock
          </span>
          <span className="font-mono-tech text-[10px] uppercase tracking-wider text-slate-400">
            {target ? target.kind : 'NONE'}
          </span>
        </div>

        <div className="font-mono-tech text-sm font-semibold text-slate-100 truncate">
          {target ? target.name : 'NO TARGET'}
        </div>

        <div className="flex items-baseline justify-between mt-1.5">
          <span className="font-mono-tech text-xs text-slate-400">RANGE</span>
          <span className="font-mono-tech text-sm font-bold text-sky-300">
            {target ? formatDistance(target.distanceMeters) : '--'}
          </span>
        </div>

        <div className="mt-2 pt-2 border-t border-slate-700/60">
          <div className="flex items-center justify-between text-[10px] font-mono-tech tracking-wider text-slate-400 uppercase mb-1">
            <span>Docking Bay</span>
            <span>{formatDistance(docking.distanceMeters)}</span>
          </div>
          <div
            className={`font-mono-tech text-[11px] font-semibold tracking-wide ${
              hud.autoDockActive
                ? 'text-emerald-300'
                : docking.isReadyToDock
                  ? 'text-emerald-300'
                  : docking.isCorridorAligned
                    ? 'text-amber-300'
                    : 'text-sky-200/80'
            }`}
          >
            {hud.autoDockActive ? 'AUTOPILOT ALIGNING TO BAY' : docking.statusLabel}
          </div>

          {showDockButton && !hud.autoDockActive && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onDockNow();
              }}
              className="pointer-events-auto mt-2 w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              Dock Now [F]
            </button>
          )}
        </div>
      </div>

      {/* Bottom-Center 3D Holographic Scanner */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
        <div className="px-3 pt-1.5 pb-1 bg-[#090d16]/75 border border-sky-400/25">
          <canvas
            ref={radarCanvasRef}
            data-testid="radar-canvas"
            className="w-[264px] h-[148px] block"
          />
          <div className="flex items-center justify-between font-mono-tech text-[9px] tracking-[0.18em] text-sky-300/75 uppercase mt-0.5 px-1">
            <span className="text-sky-400">■ Station</span>
            <span className="text-amber-300">● Rock</span>
            <span className="text-emerald-300">● Ore</span>
          </div>
        </div>
      </div>

      {/* Bottom-Left Dismissible Flight Controls Pill */}
      <div className="fixed bottom-4 left-4 pointer-events-auto">
        {showControls ? (
          <div className="bg-[#090d16]/80 border border-slate-500/35 px-3 py-2.5 max-w-[268px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono-tech text-[10px] tracking-[0.18em] uppercase text-sky-300">
                Flight Controls
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setShowControls(false);
                }}
                aria-label="Hide Flight Controls"
                className="font-mono-tech text-[10px] text-slate-400 hover:text-slate-100 uppercase cursor-pointer"
              >
                Hide
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono-tech text-[11px] text-slate-300">
              <span>W / S · A / D</span>
              <span className="text-slate-400">Pitch / Roll</span>
              <span>Q / E</span>
              <span className="text-slate-400">Yaw</span>
              <span>Shift / Ctrl</span>
              <span className="text-slate-400">Throttle ±</span>
              <span>Space / X</span>
              <span className="text-slate-400">Lasers / Stop</span>
              <span>C / F</span>
              <span className="text-slate-400">Auto-Dock / Dock</span>
              <span>M / H</span>
              <span className="text-slate-400">Star Map / Jump</span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              setShowControls(true);
            }}
            className="px-3 py-1.5 bg-[#090d16]/80 border border-slate-500/35 font-mono-tech text-[11px] uppercase tracking-wider text-slate-300 hover:border-sky-400/50 cursor-pointer"
          >
            Controls
          </button>
        )}
      </div>
    </div>
  );
};
