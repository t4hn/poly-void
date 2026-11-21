import { computeEngineAudioParams } from './flightMath';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineOscGain: GainNode | null = null;
  private engineNoiseSource: AudioBufferSourceNode | null = null;
  private engineNoiseFilter: BiquadFilterNode | null = null;
  private engineNoiseGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private longNoiseBuffer: AudioBuffer | null = null;
  private activeChargeStops: Array<() => void> = [];

  private muted = false;
  private volume = 0.75;

  public isMuted(): boolean {
    return this.muted;
  }

  public getVolume(): number {
    return this.volume;
  }

  private getEffectiveMasterGain(): number {
    return this.muted ? 0 : this.volume * 0.44;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.getEffectiveMasterGain(),
        this.ctx.currentTime,
        0.03
      );
    }
    if (muted) {
      this.updateThruster(0, false);
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, Math.round(volume * 20) / 20));
    if (this.volume === 0) {
      this.muted = true;
    } else if (this.muted && this.volume > 0) {
      this.muted = false;
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.getEffectiveMasterGain(),
        this.ctx.currentTime,
        0.03
      );
    }
  }

  private scheduleCleanup(node: AudioScheduledSourceNode, nodesToDisconnect: AudioNode[]): void {
    node.onended = () => {
      for (const n of nodesToDisconnect) {
        try {
          n.disconnect();
        } catch {
          // ignore already disconnected nodes
        }
      }
    };
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.getEffectiveMasterGain();

        // Dynamics compressor prevents audio clipping during rapid Mk II fire + explosions
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -14;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.12;

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);

        const sampleRate = this.ctx.sampleRate;

        // Short noise buffer for impacts, explosions & hyperspace arrival whoosh
        const shortBuf = this.ctx.createBuffer(1, Math.floor(sampleRate * 1.1), sampleRate);
        const shortData = shortBuf.getChannelData(0);
        for (let i = 0; i < shortData.length; i++) {
          shortData[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = shortBuf;

        // Smooth brown-ish filtered noise buffer for continuous thruster rumble
        const longBuf = this.ctx.createBuffer(1, Math.floor(sampleRate * 2.0), sampleRate);
        const longData = longBuf.getChannelData(0);
        let lastOut = 0;
        for (let i = 0; i < longData.length; i++) {
          const white = Math.random() * 2 - 1;
          lastOut = (lastOut + 0.045 * white) / 1.045;
          longData[i] = Math.max(-1, Math.min(1, lastOut * 2.8));
        }
        this.longNoiseBuffer = longBuf;

        // Continuous dynamic engine hum (low oscillator + sub-harmonic + filtered noise rumble)
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'triangle';
        this.engineOsc.frequency.value = 46;

        this.engineSubOsc = this.ctx.createOscillator();
        this.engineSubOsc.type = 'sine';
        this.engineSubOsc.frequency.value = 23;

        const engineToneFilter = this.ctx.createBiquadFilter();
        engineToneFilter.type = 'lowpass';
        engineToneFilter.frequency.value = 175;

        this.engineOscGain = this.ctx.createGain();
        this.engineOscGain.gain.value = 0;

        this.engineOsc.connect(engineToneFilter);
        this.engineSubOsc.connect(engineToneFilter);
        engineToneFilter.connect(this.engineOscGain);
        this.engineOscGain.connect(this.masterGain);
        this.engineOsc.start();
        this.engineSubOsc.start();

        this.engineNoiseSource = this.ctx.createBufferSource();
        this.engineNoiseSource.buffer = this.longNoiseBuffer;
        this.engineNoiseSource.loop = true;

        this.engineNoiseFilter = this.ctx.createBiquadFilter();
        this.engineNoiseFilter.type = 'lowpass';
        this.engineNoiseFilter.frequency.value = 110;
        this.engineNoiseFilter.Q.value = 1.1;

        this.engineNoiseGain = this.ctx.createGain();
        this.engineNoiseGain.gain.value = 0;

        this.engineNoiseSource.connect(this.engineNoiseFilter);
        this.engineNoiseFilter.connect(this.engineNoiseGain);
        this.engineNoiseGain.connect(this.masterGain);
        this.engineNoiseSource.start();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  public updateThruster(absThrottle: number, active: boolean, cruiseFactor = 0): void {
    if (
      !this.ctx ||
      !this.engineOsc ||
      !this.engineSubOsc ||
      !this.engineOscGain ||
      !this.engineNoiseFilter ||
      !this.engineNoiseGain
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const params = computeEngineAudioParams(absThrottle, active, this.muted, cruiseFactor);
    this.engineOscGain.gain.setTargetAtTime(params.gain, now, 0.08);
    this.engineOsc.frequency.setTargetAtTime(params.oscFreqHz, now, 0.08);
    this.engineSubOsc.frequency.setTargetAtTime(params.oscFreqHz * 0.5, now, 0.08);
    this.engineNoiseGain.gain.setTargetAtTime(params.noiseGain, now, 0.09);
    this.engineNoiseFilter.frequency.setTargetAtTime(params.noiseFilterHz, now, 0.09);
  }

  public playCruiseEngage(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.34);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(1800, now + 0.34);

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, filter, gain]);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playCruiseDisengage(massLocked = false): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = massLocked ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(massLocked ? 320 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.32);

    gain.gain.setValueAtTime(massLocked ? 0.16 : 0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, gain]);
    osc.start(now);
    osc.stop(now + 0.36);

    if (massLocked) {
      // Subtle warning chime pair for mass-lock safety drop
      [587.33, 440].forEach((freq, idx) => {
        if (!this.ctx || !this.masterGain) return;
        const wOsc = this.ctx.createOscillator();
        const wGain = this.ctx.createGain();
        const t = now + idx * 0.085;
        wOsc.type = 'sine';
        wOsc.frequency.setValueAtTime(freq, t);
        wGain.gain.setValueAtTime(0.08, t);
        wGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        wOsc.connect(wGain);
        wGain.connect(this.masterGain);
        this.scheduleCleanup(wOsc, [wOsc, wGain]);
        wOsc.start(t);
        wOsc.stop(t + 0.15);
      });
    }
  }

  public playLaser(mk2 = false): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const jitter = 0.93 + Math.random() * 0.14;

    if (mk2) {
      // Deeper, heavier Pulse Laser Mk II dual-oscillator synth pew
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(540 * jitter, now);
      osc.frequency.exponentialRampToValueAtTime(78 * jitter, now + 0.16);

      sub.type = 'triangle';
      sub.frequency.setValueAtTime(270 * jitter, now);
      sub.frequency.exponentialRampToValueAtTime(48 * jitter, now + 0.17);

      filter.type = 'lowpass';
      filter.Q.value = 3.2;
      filter.frequency.setValueAtTime(1950, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + 0.16);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      this.scheduleCleanup(osc, [osc, sub, filter, gain]);
      osc.start(now);
      sub.start(now);
      osc.stop(now + 0.18);
      sub.stop(now + 0.18);
      return;
    }

    // Crisp Mk I retro-sci-fi frequency-swept synth pew
    const osc = this.ctx.createOscillator();
    const click = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(820 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(145 * jitter, now + 0.13);

    click.type = 'triangle';
    click.frequency.setValueAtTime(1260 * jitter, now);
    click.frequency.exponentialRampToValueAtTime(280 * jitter, now + 0.06);

    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    click.connect(gain);
    gain.connect(this.masterGain);

    this.scheduleCleanup(osc, [osc, click, gain]);
    osc.start(now);
    click.start(now);
    osc.stop(now + 0.15);
    click.stop(now + 0.08);
  }

  public playImpact(heavy = false): void {
    if (this.muted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 540 : 980, now);
    filter.frequency.exponentialRampToValueAtTime(85, now + (heavy ? 0.35 : 0.14));

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.34 : 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.36 : 0.15));

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(src, [src, filter, gain]);
    src.start(now);
    src.stop(now + (heavy ? 0.38 : 0.16));
  }

  public playExplosion(): void {
    if (this.muted || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(680, now);
    filter.frequency.exponentialRampToValueAtTime(55, now + 0.46);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.47);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(src, [src, filter, gain]);
    src.start(now);
    src.stop(now + 0.49);

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(115, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.36);
    subGain.gain.setValueAtTime(0.28, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.37);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    this.scheduleCleanup(sub, [sub, subGain]);
    sub.start(now);
    sub.stop(now + 0.39);
  }

  public playPickup(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  public playDock(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Warm harmonic major-9th chord chime (A3, C#4, E4, G#4, B4)
    const freqs = [220, 277.18, 329.63, 415.3, 493.88];
    const chordFilter = this.ctx.createBiquadFilter();
    chordFilter.type = 'lowpass';
    chordFilter.frequency.setValueAtTime(1400, now);
    chordFilter.connect(this.masterGain);

    freqs.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      const t = now + idx * 0.065;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
      osc.connect(gain);
      gain.connect(chordFilter);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
          if (idx === freqs.length - 1) chordFilter.disconnect();
        } catch {
          // ignore
        }
      };
      osc.start(t);
      osc.stop(t + 0.75);
    });
  }

  public playUiBlip(variant: 'select' | 'tab' | 'confirm' = 'select'): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    if (variant === 'tab') {
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.045);
      gain.gain.setValueAtTime(0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + 0.08);
      return;
    }

    if (variant === 'confirm') {
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.setValueAtTime(987.77, now + 0.045);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(now);
      osc.stop(now + 0.14);
      return;
    }

    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 0.04);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, gain]);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playTrade(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1174.66, now + 0.05);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, gain]);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playAutoDock(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25].forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(t);
      osc.stop(t + 0.19);
    });
  }

  public playProximityWarning(urgent = false): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const pulses = urgent ? [784, 988] : [620];
    pulses.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.09;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(urgent ? 0.095 : 0.07, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  }

  public stopHyperspaceCharge(): void {
    for (const stopFn of this.activeChargeStops) {
      stopFn();
    }
    this.activeChargeStops = [];
  }

  public playHyperspaceCharge(): void {
    this.stopHyperspaceCharge();
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(86, now);
    osc1.frequency.exponentialRampToValueAtTime(640, now + 2.9);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(129, now);
    osc2.frequency.exponentialRampToValueAtTime(960, now + 2.9);

    filter.type = 'lowpass';
    filter.Q.value = 3.5;
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 2.9);

    gain.gain.setValueAtTime(0.03, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 2.75);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.98);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    this.scheduleCleanup(osc1, [osc1, osc2, filter, gain]);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 3.0);
    osc2.stop(now + 3.0);

    // Rising filtered noise shimmer during hyperspace tunnel buildup
    let stopNoise = () => {};
    if (this.longNoiseBuffer) {
      const nSrc = this.ctx.createBufferSource();
      nSrc.buffer = this.longNoiseBuffer;
      nSrc.loop = true;
      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.Q.value = 2.0;
      nFilter.frequency.setValueAtTime(280, now);
      nFilter.frequency.exponentialRampToValueAtTime(2100, now + 2.9);
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.01, now);
      nGain.gain.linearRampToValueAtTime(0.11, now + 2.8);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 2.98);

      nSrc.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.masterGain);
      this.scheduleCleanup(nSrc, [nSrc, nFilter, nGain]);
      nSrc.start(now);
      nSrc.stop(now + 3.0);
      stopNoise = () => {
        try {
          nSrc.stop();
        } catch {
          // ignore
        }
      };
    }

    this.activeChargeStops.push(() => {
      try {
        osc1.stop();
        osc2.stop();
      } catch {
        // ignore
      }
      stopNoise();
    });
  }

  public playHyperspaceBoom(): void {
    this.stopHyperspaceCharge();
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // Deep sub-bass arrival boom
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(210, now);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.72);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    this.scheduleCleanup(sub, [sub, subGain]);
    sub.start(now);
    sub.stop(now + 0.77);

    // Sweeping filtered arrival whoosh
    if (this.noiseBuffer) {
      const whoosh = this.ctx.createBufferSource();
      whoosh.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.85;
      filter.frequency.setValueAtTime(2600, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + 0.88);

      const whooshGain = this.ctx.createGain();
      whooshGain.gain.setValueAtTime(0.24, now);
      whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

      whoosh.connect(filter);
      filter.connect(whooshGain);
      whooshGain.connect(this.masterGain);
      this.scheduleCleanup(whoosh, [whoosh, filter, whooshGain]);
      whoosh.start(now);
      whoosh.stop(now + 0.92);
    }
  }

  public playUpgrade(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const freqs = [392.0, 523.25, 659.25, 783.99];
    freqs.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  public playFuelScoopPulse(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, gain]);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playEnemyLaser(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const jitter = 0.92 + Math.random() * 0.16;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(460 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(115 * jitter, now + 0.12);
    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, gain]);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playBountyChime(promoted = false): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = promoted ? [523.25, 659.25, 783.99, 1046.5] : [587.33, 880, 1174.66];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.065;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.13, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.masterGain);
      this.scheduleCleanup(osc, [osc, gain]);
      osc.start(t);
      osc.stop(t + 0.21);
    });
  }

  public playEscapePod(): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.55);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    osc.connect(gain);
    gain.connect(this.masterGain);
    this.scheduleCleanup(osc, [osc, gain]);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  public dispose(): void {
    this.stopHyperspaceCharge();
    if (this.engineOsc) {
      try {
        this.engineOsc.stop();
      } catch {
        // ignore
      }
    }
    if (this.engineSubOsc) {
      try {
        this.engineSubOsc.stop();
      } catch {
        // ignore
      }
    }
    if (this.engineNoiseSource) {
      try {
        this.engineNoiseSource.stop();
      } catch {
        // ignore
      }
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }
}
