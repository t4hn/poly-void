import React, { useState } from 'react';
import { HUD_THEMES, HUD_THEME_IDS } from '../game/themes';
import type { HudSnapshot, HudThemeId } from '../game/types';

interface PauseModalProps {
  hud: HudSnapshot;
  hudTheme: HudThemeId;
  saveFeedback: string | null;
  onChangeHudTheme: (theme: HudThemeId) => void;
  onToggleMute: () => void;
  onChangeVolume: (volume: number) => void;
  onToggleVoice: () => void;
  onToggleMouseSteer: () => void;
  onToggleInvertPitch: () => void;
  onToggleCamera: () => void;
  onResume: () => void;
  onSaveGame: () => void;
  onRestart: () => void;
  onResetSave: () => void;
  onTitle: () => void;
}

const KEYBIND_COLUMNS: ReadonlyArray<{
  title: string;
  bindings: ReadonlyArray<{ keyLabel: string; action: string }>;
}> = [
  {
    title: 'Flight & Combat',
    bindings: [
      { keyLabel: 'Mouse Move', action: 'Virtual Joystick Pitch / Yaw' },
      { keyLabel: 'Left Click / Space', action: 'Fire Pulse Lasers' },
      { keyLabel: 'Scroll Wheel', action: 'Adjust Throttle ±5%' },
      { keyLabel: 'Shift / Ctrl', action: 'Throttle Up / Down' },
      { keyLabel: 'W / S', action: 'Pitch Nose Down / Up' },
      { keyLabel: 'A / D', action: 'Roll Left / Right' },
      { keyLabel: 'Q / E', action: 'Yaw Left / Right' },
      { keyLabel: 'X', action: 'All Stop (Zero Throttle)' },
      { keyLabel: 'T', action: 'Cycle Locked Target' },
    ],
  },
  {
    title: 'Navigation & Options',
    bindings: [
      { keyLabel: 'J', action: 'Engage / Drop Supercruise' },
      { keyLabel: 'C', action: 'Toggle Auto-Dock' },
      { keyLabel: 'F', action: 'Manual Dock (In Bay)' },
      { keyLabel: 'M', action: 'Open Galaxy Star Map' },
      { keyLabel: 'H', action: 'Hyperspace Jump' },
      { keyLabel: 'V', action: 'Toggle Mouse Steering' },
      { keyLabel: 'I', action: 'Toggle Invert Pitch' },
      { keyLabel: 'G', action: 'Cockpit / Chase Camera' },
      { keyLabel: 'N / Esc', action: 'Mute Audio / Resume' },
    ],
  },
];

export const PauseModal: React.FC<PauseModalProps> = ({
  hud,
  hudTheme,
  saveFeedback,
  onChangeHudTheme,
  onToggleMute,
  onChangeVolume,
  onToggleVoice,
  onToggleMouseSteer,
  onToggleInvertPitch,
  onToggleCamera,
  onResume,
  onSaveGame,
  onRestart,
  onResetSave,
  onTitle,
}) => {
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [confirmReset, setConfirmReset] = useState(false);
  const volumePct = hud.muted ? 0 : Math.round(hud.volume * 100);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#050811]/72 backdrop-blur-xs">
      <div
        role="dialog"
        aria-label={view === 'settings' ? 'Ship Settings' : 'Flight Paused'}
        data-testid="pause-options-modal"
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-[#0b1220]/92 backdrop-blur-md border hud-modal p-5 md:p-6 text-slate-100"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-700/70 pb-3 mb-4">
          <div>
            <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-[var(--hud-accent)]">
              {view === 'settings' ? 'SYSTEM CONFIGURATION' : 'FLIGHT COMPUTER STANDBY'}
            </div>
            <h2 className="text-2xl font-bold tracking-wide mt-0.5">
              {view === 'settings' ? 'Settings' : 'Pause Menu'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {view === 'settings' && (
              <button
                type="button"
                data-testid="pause-back-btn"
                onClick={() => setView('main')}
                className="rounded-md px-3 py-1.5 bg-[#090d16] border border-slate-600/70 hud-btn-ghost font-mono-tech text-[11px] uppercase tracking-wider text-slate-200 transition-colors cursor-pointer"
              >
                ← Back to Pause Menu
              </button>
            )}
            <div className="text-right font-mono-tech text-[11px] text-slate-400 uppercase tracking-wider">
              <div>{hud.currentSystemName}</div>
              <div className="text-[var(--hud-accent-soft)] mt-0.5">{hud.credits.toFixed(1)} Cr</div>
            </div>
          </div>
        </div>

        {saveFeedback && (
          <div className="mb-4 rounded-lg px-3 py-1.5 hud-btn-active border font-mono-tech text-xs">
            {saveFeedback}
          </div>
        )}

        {view === 'settings' ? (
          <section
            aria-label="Flight and Audio Settings"
            data-testid="pause-settings-panel"
            className="mb-5"
          >
            <div className="rounded-lg bg-[#090d16]/75 border border-slate-700/70 p-4 space-y-4">
              {/* Audio & Ship Computer Voice */}
              <div>
                <div className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-[var(--hud-accent-soft)] mb-2">
                  Audio &amp; Ship Computer
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    data-testid="pause-mute-btn"
                    onClick={onToggleMute}
                    className={`rounded-md flex items-center justify-between px-3 py-2.5 border font-mono-tech text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                      hud.muted
                        ? 'bg-rose-500/15 border-rose-400/60 text-rose-200'
                        : 'bg-[#0b1220] border-slate-600/60 text-slate-200 hud-btn-ghost'
                    }`}
                  >
                    <span className="text-slate-400">Audio [N]</span>
                    <span className="font-bold">{hud.muted ? 'Muted' : 'Active'}</span>
                  </button>

                  <label className="rounded-md flex flex-col justify-center gap-1.5 px-3 py-2 bg-[#0b1220] border border-slate-600/60 font-mono-tech text-xs">
                    <div className="flex items-center justify-between uppercase tracking-wider">
                      <span className="text-slate-400">Master Vol</span>
                      <span className="font-bold text-[var(--hud-accent-soft)]">{volumePct}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      aria-label="Master Volume"
                      data-testid="pause-volume-slider"
                      value={volumePct}
                      onChange={(e) => onChangeVolume(Number(e.currentTarget.value) / 100)}
                      className="w-full h-1.5 hud-slider cursor-pointer"
                    />
                  </label>

                  <button
                    type="button"
                    data-testid="pause-voice-btn"
                    aria-pressed={hud.voiceEnabled}
                    onClick={onToggleVoice}
                    className={`rounded-md flex items-center justify-between px-3 py-2.5 border font-mono-tech text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                      hud.voiceEnabled
                        ? 'hud-btn-active'
                        : 'bg-[#0b1220] border-slate-600/60 text-slate-300 hud-btn-ghost'
                    }`}
                  >
                    <span className="text-slate-400">Ship AI Voice</span>
                    <span className="font-bold">{hud.voiceEnabled ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
              </div>

              {/* Flight & Camera Controls */}
              <div>
                <div className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-[var(--hud-accent-soft)] mb-2">
                  Flight &amp; Camera
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    data-testid="pause-mouse-steer-btn"
                    onClick={onToggleMouseSteer}
                    className={`rounded-md flex items-center justify-between px-3 py-2.5 border font-mono-tech text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                      hud.mouseSteerEnabled
                        ? 'hud-btn-active'
                        : 'bg-[#0b1220] border-slate-600/60 text-slate-300 hud-btn-ghost'
                    }`}
                  >
                    <span className="text-slate-400">Mouse Steer [V]</span>
                    <span className="font-bold">{hud.mouseSteerEnabled ? 'ON' : 'OFF'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="pause-invert-pitch-btn"
                    onClick={onToggleInvertPitch}
                    className={`rounded-md flex items-center justify-between px-3 py-2.5 border font-mono-tech text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                      hud.invertPitch
                        ? 'bg-amber-500/20 border-amber-400/65 text-amber-200'
                        : 'bg-[#0b1220] border-slate-600/60 text-slate-200 hud-btn-ghost'
                    }`}
                  >
                    <span className="text-slate-400">Invert Pitch [I]</span>
                    <span className="font-bold">{hud.invertPitch ? 'Inverted' : 'Standard'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="pause-camera-btn"
                    onClick={onToggleCamera}
                    className="rounded-md flex items-center justify-between px-3 py-2.5 border bg-[#0b1220] border-slate-600/60 text-slate-200 hud-btn-ghost font-mono-tech text-xs uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    <span className="text-slate-400">Camera [G]</span>
                    <span className="font-bold text-[var(--hud-accent-soft)]">
                      {hud.cameraMode === 'cockpit' ? 'Cockpit' : 'Chase'}
                    </span>
                  </button>
                </div>
              </div>

              {/* UI Color Theme Selector */}
              <div className="rounded-md bg-[#0b1220] border border-slate-600/60 px-3.5 py-3">
                <div className="flex items-center justify-between font-mono-tech text-[11px] uppercase tracking-wider mb-2.5">
                  <span className="text-slate-400">UI Color Theme</span>
                  <span
                    data-testid="pause-active-theme-label"
                    className="font-bold text-[var(--hud-accent-soft)]"
                  >
                    {HUD_THEMES[hudTheme].label}
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="UI Color Theme"
                  className="grid grid-cols-2 sm:grid-cols-5 gap-2"
                >
                  {HUD_THEME_IDS.map((id) => {
                    const def = HUD_THEMES[id];
                    const active = hudTheme === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`pause-theme-${id}`}
                        aria-pressed={active}
                        onClick={() => onChangeHudTheme(id)}
                        className={`rounded-md flex items-center gap-2 px-2.5 py-2 border font-mono-tech text-[11px] uppercase tracking-wider transition-colors cursor-pointer ${
                          active
                            ? 'hud-btn-active font-bold'
                            : 'bg-[#090d16] border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/30"
                          style={{
                            backgroundColor: def.accentHex,
                            boxShadow: active ? `0 0 8px ${def.accentHex}` : undefined,
                          }}
                        />
                        <span className="truncate">{def.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">
              <button
                type="button"
                data-testid="pause-settings-back-btn"
                onClick={() => setView('main')}
                className="rounded-md py-3 bg-[#090d16] border border-slate-500/60 hud-btn-ghost text-slate-200 font-mono-tech text-xs font-bold uppercase tracking-[0.16em] transition-colors cursor-pointer"
              >
                Back to Pause Menu
              </button>
              <button
                type="button"
                data-testid="pause-resume-btn"
                onClick={onResume}
                className="rounded-md py-3 border hud-btn-primary font-mono-tech text-xs font-bold uppercase tracking-[0.2em] transition-colors cursor-pointer"
              >
                RESUME FLIGHT [ESC]
              </button>
            </div>
          </section>
        ) : (
          <>
            {/* Controls & Keybindings Reference */}
            <section
              aria-label="Controls and Keybindings Reference"
              data-testid="pause-controls-reference"
              className="mb-5"
            >
              <div className="font-mono-tech text-[10px] tracking-[0.2em] uppercase text-[var(--hud-accent-soft)] mb-2">
                Controls &amp; Keybindings Reference
              </div>
              <div className="rounded-lg grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#090d16]/75 border border-slate-700/70 p-4">
                {KEYBIND_COLUMNS.map((col) => (
                  <div key={col.title}>
                    <div className="font-mono-tech text-[10px] tracking-[0.16em] uppercase text-slate-400 border-b border-slate-700/60 pb-1 mb-2">
                      {col.title}
                    </div>
                    <div className="space-y-1.5 font-mono-tech text-[11px]">
                      {col.bindings.map((b) => (
                        <div key={b.keyLabel} className="flex items-center justify-between gap-3">
                          <span className="rounded-md px-1.5 py-0.5 bg-[#0b1220] border border-slate-600/60 text-[var(--hud-accent-soft)] shrink-0">
                            {b.keyLabel}
                          </span>
                          <span className="text-slate-300 text-right">{b.action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Primary Actions: Settings + Save + Sector Management */}
            <div className="grid grid-cols-2 gap-2.5 mb-2.5">
              <button
                type="button"
                data-testid="pause-open-settings-btn"
                onClick={() => setView('settings')}
                className="rounded-md py-2.5 border hud-btn-active font-mono-tech text-xs font-bold uppercase tracking-[0.16em] transition-colors cursor-pointer"
              >
                Settings
              </button>
              <button
                type="button"
                onClick={onSaveGame}
                className="rounded-md py-2.5 bg-[#090d16] border border-emerald-400/50 hover:bg-emerald-500/15 text-emerald-200 font-mono-tech text-xs font-bold uppercase tracking-[0.16em] transition-colors cursor-pointer"
              >
                Save Game
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                type="button"
                onClick={onRestart}
                className="rounded-md py-2 bg-[#090d16] border border-slate-500/45 hud-btn-ghost text-slate-200 font-mono-tech text-[11px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                Restart Sector
              </button>

              {!confirmReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="rounded-md py-2 bg-[#090d16] border border-slate-600/50 hover:border-rose-400/65 text-slate-400 hover:text-rose-200 font-mono-tech text-[11px] uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Reset Save
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmReset(false);
                      onResetSave();
                    }}
                    className="rounded-md py-2 bg-rose-500/25 border border-rose-400 text-rose-100 font-mono-tech text-[10px] uppercase tracking-wider cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="rounded-md py-2 bg-[#090d16] border border-slate-600 text-slate-300 font-mono-tech text-[10px] uppercase tracking-wider cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onTitle}
                className="rounded-md py-2 bg-[#090d16] border border-slate-600/50 hover:border-slate-400 text-slate-300 hover:text-slate-100 font-mono-tech text-[11px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                Return to Title
              </button>
            </div>

            {/* Prominent Resume CTA */}
            <button
              type="button"
              data-testid="pause-resume-btn"
              onClick={onResume}
              className="w-full rounded-md py-3 border hud-btn-primary font-mono-tech text-xs font-bold uppercase tracking-[0.2em] transition-colors cursor-pointer"
            >
              RESUME FLIGHT [ESC]
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface GameOverModalProps {
  hud: HudSnapshot;
  onTryAgain: () => void;
  onTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  hud,
  onTryAgain,
  onTitle,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#050811]/82">
      <div
        role="dialog"
        aria-label="Hull Breached"
        className="w-full max-w-md rounded-xl bg-[#0b1220] border border-rose-400/45 p-6 text-slate-100"
      >
        <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-rose-400">
          CRITICAL TELEMETRY LOST
        </div>
        <h2 className="text-2xl font-bold tracking-wide mt-1 mb-4">Hull Breached</h2>

        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="rounded-lg p-3 bg-[#090d16] border border-slate-700/70">
            <div className="font-mono-tech text-[10px] uppercase text-slate-400">Credits</div>
            <div className="font-mono-tech text-base font-bold text-amber-300 mt-0.5">
              {hud.credits.toFixed(1)} Cr
            </div>
          </div>
          <div className="rounded-lg p-3 bg-[#090d16] border border-slate-700/70">
            <div className="font-mono-tech text-[10px] uppercase text-slate-400">Cleared</div>
            <div className="font-mono-tech text-base font-bold text-[var(--hud-accent-soft)] mt-0.5">
              {hud.asteroidsCleared}
            </div>
          </div>
          <div className="rounded-lg p-3 bg-[#090d16] border border-slate-700/70">
            <div className="font-mono-tech text-[10px] uppercase text-slate-400">Flown</div>
            <div className="font-mono-tech text-base font-bold text-slate-100 mt-0.5">
              {hud.distanceFlownKm.toFixed(1)} km
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onTryAgain}
            className="flex-1 rounded-md py-2.5 border hud-btn-primary font-mono-tech text-xs font-bold uppercase tracking-[0.16em] cursor-pointer"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="rounded-md px-4 py-2.5 bg-[#090d16] border border-slate-500/40 hover:border-slate-300 text-slate-300 font-mono-tech text-xs uppercase tracking-[0.16em] cursor-pointer"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
};

interface EscapePodModalProps {
  systemName: string;
  lostCargoTons: number;
  credits: number;
  combatRank: string;
  onContinue: () => void;
}

export const EscapePodModal: React.FC<EscapePodModalProps> = ({
  systemName,
  lostCargoTons,
  credits,
  combatRank,
  onContinue,
}) => {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#050811]/86">
      <div
        role="dialog"
        aria-label="Escape Pod Recovered"
        data-testid="escape-pod-modal"
        className="w-full max-w-md rounded-xl bg-[#0b1220] border border-amber-400/55 p-6 text-slate-100"
      >
        <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-amber-300">
          HULL CRITICAL // ESCAPE POD EJECTION
        </div>
        <h2 className="text-2xl font-bold tracking-wide mt-1 mb-2">
          Recovered at {systemName} Orbital
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed mb-4">
          Your ship&apos;s automatic Escape Pod detached before hull collapse and was towed safely
          into {systemName} Orbital&apos;s docking bay. Ship upgrades, credits, and combat rank
          remain intact; unsold cargo in the main hold was lost.
        </p>

        <div className="grid grid-cols-3 gap-2.5 mb-5 font-mono-tech">
          <div className="rounded-lg p-3 bg-[#090d16] border border-slate-700/70">
            <div className="text-[10px] uppercase text-slate-400">Cargo Lost</div>
            <div className="text-sm font-bold text-rose-300 mt-0.5">{lostCargoTons}t</div>
          </div>
          <div className="rounded-lg p-3 bg-[#090d16] border border-slate-700/70">
            <div className="text-[10px] uppercase text-slate-400">Credits Safe</div>
            <div className="text-sm font-bold text-amber-300 mt-0.5">{credits.toFixed(1)} Cr</div>
          </div>
          <div className="rounded-lg p-3 bg-[#090d16] border border-slate-700/70">
            <div className="text-[10px] uppercase text-slate-400">Combat Rank</div>
            <div className="text-sm font-bold text-[var(--hud-accent-soft)] mt-0.5 truncate">
              {combatRank}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-md py-2.5 border hud-btn-primary font-mono-tech text-xs font-bold uppercase tracking-[0.16em] cursor-pointer"
        >
          Enter Station Concourse
        </button>
      </div>
    </div>
  );
};

