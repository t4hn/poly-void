import React from 'react';

interface TitleOverlayProps {
  invertPitch: boolean;
  savedSummary?: { systemName: string; credits: number; cargoUsed: number } | null;
  onToggleInvertPitch: () => void;
  onResetSave?: () => void;
  onLaunch: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  invertPitch,
  savedSummary,
  onToggleInvertPitch,
  onResetSave,
  onLaunch,
}) => {
  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-8 md:p-14">
      {/* Top-left subtle sector identifier */}
      <div className="flex items-center justify-between">
        <div className="font-mono-tech text-[11px] tracking-[0.26em] uppercase text-[var(--hud-accent-soft)]/80">
          SECTOR 04 // {savedSummary ? `${savedSummary.systemName.toUpperCase()} CORRIDOR` : 'LAVE CORRIDOR'}
        </div>
        <a
          href="/coriolis-frontier-standalone.html"
          download="coriolis-frontier-standalone.html"
          className="pointer-events-auto rounded-md font-mono-tech text-[11px] tracking-[0.16em] uppercase px-3 py-1.5 border border-slate-500/35 bg-[#090d16]/80 text-slate-300 hud-btn-ghost transition-colors"
        >
          Export Single HTML
        </a>
      </div>

      {/* Main Title Lockup over calm left negative space */}
      <div className="max-w-lg my-auto">
        <div className="mb-5">
          <svg
            viewBox="0 0 380 112"
            className="w-full max-w-[380px] h-auto"
            aria-label="Coriolis Frontier"
          >
            {/* Hexagonal Coriolis Station Emblem */}
            <g transform="translate(46, 56)">
              <polygon
                points="0,-36 31,-18 31,18 0,36 -31,18 -31,-18"
                fill="var(--hud-surface)"
                stroke="var(--hud-accent)"
                strokeWidth="2"
              />
              <polygon
                points="0,-24 21,-12 21,12 0,24 -21,12 -21,-12"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="1.2"
                strokeOpacity="0.6"
              />
              {/* Docking Slot Aperture */}
              <rect
                x="-11"
                y="-5"
                width="22"
                height="10"
                fill="#090d16"
                stroke="#f59e0b"
                strokeWidth="1.6"
              />
              <line x1="-11" y1="0" x2="-4" y2="0" stroke="var(--hud-accent)" strokeWidth="1.5" />
              <line x1="4" y1="0" x2="11" y2="0" stroke="var(--hud-accent)" strokeWidth="1.5" />
              {/* Solar Wing Struts */}
              <line x1="-31" y1="0" x2="-44" y2="0" stroke="#64748b" strokeWidth="2" />
              <line x1="31" y1="0" x2="44" y2="0" stroke="#64748b" strokeWidth="2" />
            </g>

            {/* Geometric Wordmark */}
            <text
              x="104"
              y="50"
              fill="#f8fafc"
              fontSize="30"
              fontWeight="700"
              letterSpacing="4"
              fontFamily="Space Grotesk, sans-serif"
            >
              CORIOLIS
            </text>
            <text
              x="106"
              y="76"
              fill="var(--hud-accent)"
              fontSize="16"
              fontWeight="600"
              letterSpacing="8"
              fontFamily="JetBrains Mono, monospace"
            >
              FRONTIER
            </text>
            <line
              x1="106"
              y1="88"
              x2="348"
              y2="88"
              stroke="var(--hud-accent)"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
          </svg>
        </div>

        <p className="rounded-r-lg text-slate-200 text-sm md:text-base leading-relaxed mb-5 max-w-md [text-shadow:0_2px_12px_rgba(9,13,22,0.98),0_0_24px_rgba(9,13,22,0.95)] bg-[#090d16]/55 px-3 py-2 border-l-2 border-[var(--hud-accent)]">
          Pilot an orbital interceptor across low-poly deep space, fracture ore-bearing
          asteroids, and align with the rotating Coriolis bay for station trade.
        </p>

        {savedSummary && (
          <div
            data-testid="saved-log-banner"
            className="mb-5 rounded-lg px-3 py-2 bg-[#090d16]/85 border border-emerald-400/45 font-mono-tech text-xs text-emerald-200 max-w-md"
          >
            COMMANDER LOG RESTORED: {savedSummary.systemName} · {savedSummary.credits.toFixed(1)} Cr ·{' '}
            {savedSummary.cargoUsed}t cargo
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pointer-events-auto">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onLaunch();
            }}
            className="rounded-md px-7 py-3 hud-btn-primary border font-bold tracking-[0.18em] text-sm uppercase transition-colors cursor-pointer"
          >
            {savedSummary ? 'Continue' : 'Launch'}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleInvertPitch();
            }}
            aria-pressed={invertPitch}
            className={`rounded-md px-4 py-3 font-mono-tech text-xs tracking-[0.14em] uppercase border transition-colors cursor-pointer ${
              invertPitch
                ? 'bg-amber-500/20 border-amber-400/70 text-amber-200'
                : 'bg-[#090d16]/80 border-slate-500/40 text-slate-300 hud-btn-ghost'
            }`}
          >
            Pitch: {invertPitch ? 'Inverted' : 'Standard'}
          </button>

          {savedSummary && onResetSave && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onResetSave();
              }}
              className="rounded-md px-4 py-3 font-mono-tech text-xs tracking-[0.14em] uppercase border bg-[#090d16]/80 border-slate-600/50 text-slate-400 hover:border-rose-400/60 hover:text-rose-200 transition-colors cursor-pointer"
            >
              Reset Save
            </button>
          )}
        </div>
      </div>

      {/* Single flat borderless bottom control hint line */}
      <div className="font-mono-tech text-xs tracking-[0.14em] text-slate-300/95 [text-shadow:0_2px_10px_rgba(9,13,22,0.98)]">
        Mouse Steer · LMB/Space Lasers · V Mouse Toggle · W/S Pitch · A/D Roll · Q/E Yaw · Wheel/Shift/Ctrl Throttle · J Cruise · T Target · C Auto-Dock · M Map · Esc Pause
      </div>
    </div>
  );
};
