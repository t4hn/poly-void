export const SHIP_COMPUTER_LINES = {
  supercruiseEngaged: 'Supercruise engaged',
  supercruiseDropped: 'Dropping from supercruise',
  pirateInterdiction: 'Warning: Mass-locked. Hostile contact detected',
  massLocked: 'Warning: Mass-locked',
  targetDestroyed: 'Target destroyed',
  shieldsOffline: 'Warning: Shields offline',
  hullCritical: 'Hull integrity critical',
  autoDockEngaged: 'Auto-dock engaged',
  dockingComplete: 'Docking complete',
  hyperspaceComplete: 'Hyperspace jump complete',
} as const;

export interface SpeechUtteranceLike {
  text: string;
  pitch: number;
  rate: number;
  volume: number;
  lang: string;
  voice?: SpeechSynthesisVoice | null;
}

export interface SpeechSynthLike {
  cancel(): void;
  speak(utterance: SpeechUtteranceLike): void;
  getVoices?(): SpeechSynthesisVoice[];
}

export type UtteranceFactory = (text: string) => SpeechUtteranceLike;

export function computeShipComputerVolume(
  voiceEnabled: boolean,
  muted: boolean,
  masterVolume: number
): number {
  if (!voiceEnabled || muted) return 0;
  if (!Number.isFinite(masterVolume) || masterVolume <= 0) return 0;
  return Math.max(0.05, Math.min(1, masterVolume));
}

export function evaluateShipDamageAlerts(params: {
  prevShield: number;
  nextShield: number;
  nextHull: number;
  maxHull: number;
  hullCriticalAlreadyAnnounced: boolean;
}): {
  shieldsJustOffline: boolean;
  hullJustCritical: boolean;
  nextHullCriticalAnnounced: boolean;
  spokenAlert: string | null;
} {
  const { prevShield, nextShield, nextHull, maxHull, hullCriticalAlreadyAnnounced } = params;
  const dead = nextHull <= 0;
  const shieldsJustOffline = !dead && prevShield > 0 && nextShield <= 0;
  const hullRatio = maxHull > 0 ? nextHull / maxHull : 0;
  const hullJustCritical = !dead && hullRatio <= 0.25 && !hullCriticalAlreadyAnnounced;

  let nextHullCriticalAnnounced = hullCriticalAlreadyAnnounced;
  if (dead || hullRatio > 0.35) {
    nextHullCriticalAnnounced = false;
  } else if (hullJustCritical) {
    nextHullCriticalAnnounced = true;
  }

  // Prioritize hull critical if both happen on the exact same impact
  let spokenAlert: string | null = null;
  if (hullJustCritical) {
    spokenAlert = SHIP_COMPUTER_LINES.hullCritical;
  } else if (shieldsJustOffline) {
    spokenAlert = SHIP_COMPUTER_LINES.shieldsOffline;
  }

  return {
    shieldsJustOffline,
    hullJustCritical,
    nextHullCriticalAnnounced,
    spokenAlert,
  };
}

function getDefaultSynth(): SpeechSynthLike | null {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
      return window.speechSynthesis as unknown as SpeechSynthLike;
    }
  } catch {
    return null;
  }
  return null;
}

function defaultCreateUtterance(text: string): SpeechUtteranceLike | null {
  try {
    if (typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function') {
      return new window.SpeechSynthesisUtterance(text) as unknown as SpeechUtteranceLike;
    }
  } catch {
    return null;
  }
  return null;
}

export class ShipComputer {
  private enabled = true;
  private muted = false;
  private masterVolume = 0.75;
  private lastSpokenText = '';
  private lastSpokenAt = 0;

  private readonly synthOverride?: SpeechSynthLike | null;
  private readonly utteranceFactory?: UtteranceFactory;

  constructor(options?: { synth?: SpeechSynthLike | null; createUtterance?: UtteranceFactory }) {
    this.synthOverride = options?.synth;
    this.utteranceFactory = options?.createUtterance;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  public setAudioState(muted: boolean, masterVolume: number): void {
    this.muted = muted;
    this.masterVolume = masterVolume;
    if (muted || masterVolume <= 0) {
      this.stop();
    }
  }

  private resolveSynth(): SpeechSynthLike | null {
    if (this.synthOverride !== undefined) {
      return this.synthOverride;
    }
    return getDefaultSynth();
  }

  private pickVoice(synth: SpeechSynthLike): SpeechSynthesisVoice | null {
    try {
      const voices = synth.getVoices?.() ?? [];
      if (voices.length === 0) return null;
      const preferred =
        voices.find(
          (v) =>
            /^en[-_]/i.test(v.lang) &&
            /google|samantha|daniel|alex|serena|victoria|zira|david|aria/i.test(v.name)
        ) ?? voices.find((v) => /^en/i.test(v.lang));
      return preferred ?? null;
    } catch {
      return null;
    }
  }

  public stop(): void {
    const synth = this.resolveSynth();
    if (!synth) return;
    try {
      synth.cancel();
    } catch {
      // ignore speech synthesis cancellation errors
    }
  }

  public speak(text: string, nowMs = Date.now()): boolean {
    const cleanText = text.trim();
    if (!cleanText) return false;

    const vol = computeShipComputerVolume(this.enabled, this.muted, this.masterVolume);
    if (vol <= 0) return false;

    // Prevent back-to-back duplicate repeats within 900ms
    if (cleanText === this.lastSpokenText && nowMs - this.lastSpokenAt < 900) {
      return false;
    }

    const synth = this.resolveSynth();
    if (!synth) return false;

    const utterance = this.utteranceFactory
      ? this.utteranceFactory(cleanText)
      : defaultCreateUtterance(cleanText);
    if (!utterance) return false;

    utterance.text = cleanText;
    utterance.pitch = 0.84;
    utterance.rate = 1.06;
    utterance.volume = vol;
    utterance.lang = 'en-US';

    const chosenVoice = this.pickVoice(synth);
    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }

    try {
      synth.cancel();
      synth.speak(utterance);
      this.lastSpokenText = cleanText;
      this.lastSpokenAt = nowMs;
      return true;
    } catch {
      return false;
    }
  }
}
