interface ToneOptions {
  type: OscillatorType;
  startFreq: number;
  endFreq?: number;
  gainPeak: number;
  durationSec: number;
  delaySec?: number;
}

export class ArcadeAudioEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone({
    type,
    startFreq,
    endFreq,
    gainPeak,
    durationSec,
    delaySec = 0,
  }: ToneOptions) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, start);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + durationSec);
    }

    gain.gain.setValueAtTime(gainPeak, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationSec + 0.015);
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playSlice(multiplier: number) {
    const baseFreq = 420 + Math.min(multiplier, 5) * 95;
    this.playTone({
      type: 'triangle',
      startFreq: baseFreq,
      endFreq: baseFreq * 1.65,
      gainPeak: 0.14,
      durationSec: 0.13,
    });
  }

  public playPoseMatch(combo: number, overdrive: boolean) {
    const root = overdrive ? 587.33 : 440 + Math.min(combo, 5) * 55;
    [root, root * 1.25, root * 1.5].forEach((freq, idx) => {
      this.playTone({
        type: 'triangle',
        startFreq: freq,
        gainPeak: 0.14,
        durationSec: 0.18,
        delaySec: idx * 0.045,
      });
    });
  }

  public playOverdriveStart() {
    this.playTone({
      type: 'sawtooth',
      startFreq: 220,
      endFreq: 880,
      gainPeak: 0.14,
      durationSec: 0.35,
    });
  }

  public playSabotage() {
    this.playTone({
      type: 'sawtooth',
      startFreq: 640,
      endFreq: 160,
      gainPeak: 0.16,
      durationSec: 0.29,
    });
  }

  public playPenalty(isHeavy: boolean) {
    this.playTone({
      type: 'sawtooth',
      startFreq: isHeavy ? 130 : 210,
      endFreq: isHeavy ? 45 : 95,
      gainPeak: isHeavy ? 0.22 : 0.14,
      durationSec: isHeavy ? 0.29 : 0.19,
    });
  }

  public playCountdownTick() {
    this.playTone({
      type: 'sine',
      startFreq: 880,
      gainPeak: 0.08,
      durationSec: 0.08,
    });
  }

  public playLaserDodge(combo: number) {
    const freq = 520 + Math.min(combo, 8) * 40;
    this.playTone({
      type: 'sine',
      startFreq: freq,
      endFreq: freq * 1.4,
      gainPeak: 0.09,
      durationSec: 0.1,
    });
  }

  public playEdmBeatStep(stepIndex: number, overdrive: boolean) {
    const step = stepIndex % 16;
    // Four-on-the-floor EDM Kick on 0, 4, 8, 12
    if (step % 4 === 0) {
      this.playTone({
        type: 'sine',
        startFreq: overdrive ? 145 : 130,
        endFreq: 42,
        gainPeak: 0.16,
        durationSec: 0.13,
      });
    }
    // Off-beat synth bass on 2, 6, 10, 14
    if (step % 4 === 2) {
      const bassNotes = overdrive ? [110, 130.81, 146.83, 164.81] : [98, 110, 123.47, 130.81];
      const note = bassNotes[Math.floor(step / 4) % bassNotes.length];
      this.playTone({
        type: 'sawtooth',
        startFreq: note,
        endFreq: note * 0.96,
        gainPeak: 0.055,
        durationSec: 0.11,
      });
    }
    // Energetic synth arp pluck on every 2nd step
    if (step % 2 === 0) {
      const arp = overdrive
        ? [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 880]
        : [392, 493.88, 587.33, 783.99, 587.33, 493.88, 440, 659.25];
      this.playTone({
        type: 'triangle',
        startFreq: arp[(step / 2) % arp.length],
        gainPeak: 0.04,
        durationSec: 0.08,
      });
    }
  }

  public playSpellCast(spell: 'lightning' | 'shield' | 'crit') {
    if (spell === 'lightning') {
      this.playTone({
        type: 'sawtooth',
        startFreq: 920,
        endFreq: 280,
        gainPeak: 0.14,
        durationSec: 0.16,
      });
    } else if (spell === 'shield') {
      this.playTone({
        type: 'sine',
        startFreq: 330,
        endFreq: 660,
        gainPeak: 0.13,
        durationSec: 0.2,
      });
    } else {
      this.playTone({
        type: 'triangle',
        startFreq: 180,
        endFreq: 740,
        gainPeak: 0.18,
        durationSec: 0.24,
      });
    }
  }

  public playSpellReflect() {
    this.playTone({
      type: 'triangle',
      startFreq: 520,
      endFreq: 1180,
      gainPeak: 0.15,
      durationSec: 0.18,
    });
  }

  public playMunch(combo: number, fever: boolean) {
    const base = fever ? 620 : 380 + Math.min(combo, 6) * 45;
    this.playTone({
      type: 'triangle',
      startFreq: base,
      endFreq: base * 1.45,
      gainPeak: 0.14,
      durationSec: 0.09,
    });
    this.playTone({
      type: 'sine',
      startFreq: base * 1.5,
      endFreq: base * 1.9,
      gainPeak: 0.08,
      durationSec: 0.08,
      delaySec: 0.045,
    });
  }

  public playBombDeflect() {
    this.playTone({
      type: 'square',
      startFreq: 260,
      endFreq: 420,
      gainPeak: 0.09,
      durationSec: 0.08,
    });
  }

  public playRoundEnd() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      this.playTone({
        type: 'triangle',
        startFreq: freq,
        gainPeak: 0.12,
        durationSec: 0.28,
        delaySec: idx * 0.08,
      });
    });
  }
}
