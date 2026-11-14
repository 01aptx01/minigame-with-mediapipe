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
