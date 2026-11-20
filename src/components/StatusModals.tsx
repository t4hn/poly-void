import React from 'react';
import type { HudSnapshot } from '../game/types';

interface PauseModalProps {
  onResume: () => void;
  onRestart: () => void;
  onTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  onResume,
  onRestart,
  onTitle,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-[#050811]/78">
      <div
        role="dialog"
        aria-label="Flight Paused"
        className="w-full max-w-sm bg-[#0b1220] border border-sky-400/35 p-6 text-slate-100"
      >
        <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-sky-400">
          FLIGHT COMPUTER STANDBY
        </div>
        <h2 className="text-2xl font-bold tracking-wide mt-1 mb-5">Paused</h2>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-[0.16em] cursor-pointer"
          >
            Resume Flight
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full py-2.5 bg-[#090d16] border border-slate-500/40 hover:border-sky-400/60 text-slate-200 font-mono-tech text-xs uppercase tracking-[0.16em] cursor-pointer"
          >
            Restart Sector
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="w-full py-2.5 bg-[#090d16] border border-slate-600/40 hover:border-slate-400 text-slate-400 hover:text-slate-200 font-mono-tech text-xs uppercase tracking-[0.16em] cursor-pointer"
          >
            Return to Title
          </button>
        </div>
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
        className="w-full max-w-md bg-[#0b1220] border border-rose-400/45 p-6 text-slate-100"
      >
        <div className="font-mono-tech text-[11px] tracking-[0.22em] uppercase text-rose-400">
          CRITICAL TELEMETRY LOST
        </div>
        <h2 className="text-2xl font-bold tracking-wide mt-1 mb-4">Hull Breached</h2>

        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="p-3 bg-[#090d16] border border-slate-700/70">
            <div className="font-mono-tech text-[10px] uppercase text-slate-400">Credits</div>
            <div className="font-mono-tech text-base font-bold text-amber-300 mt-0.5">
              {hud.credits.toFixed(1)} Cr
            </div>
          </div>
          <div className="p-3 bg-[#090d16] border border-slate-700/70">
            <div className="font-mono-tech text-[10px] uppercase text-slate-400">Cleared</div>
            <div className="font-mono-tech text-base font-bold text-sky-300 mt-0.5">
              {hud.asteroidsCleared}
            </div>
          </div>
          <div className="p-3 bg-[#090d16] border border-slate-700/70">
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
            className="flex-1 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-mono-tech text-xs font-bold uppercase tracking-[0.16em] cursor-pointer"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={onTitle}
            className="px-4 py-2.5 bg-[#090d16] border border-slate-500/40 hover:border-slate-300 text-slate-300 font-mono-tech text-xs uppercase tracking-[0.16em] cursor-pointer"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
};
