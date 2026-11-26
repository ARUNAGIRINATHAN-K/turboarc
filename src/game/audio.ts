/**
 * Zero-asset procedural Web Audio synthesizer for engine RPM, tyre screech,
 * countdown tones, and collision impacts.
 */
export class RacingAudio {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private screechGain: GainNode | null = null;
  private muted = false;
  private started = false;

  unlock(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      // Engine harmonic oscillator + sub-harmonic
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 65;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 32.5;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(ctx.destination);
      osc1.start();
      osc2.start();

      // Bandpass filtered white noise for tyre drift screech
      const bufSize = ctx.sampleRate * 1.5;
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1450;
      bp.Q.value = 4.2;

      const screechGain = ctx.createGain();
      screechGain.gain.value = 0;

      noiseSrc.connect(bp);
      bp.connect(screechGain);
      screechGain.connect(ctx.destination);
      noiseSrc.start();

      this.engineOsc = osc1;
      this.engineSubOsc = osc2;
      this.engineGain = engineGain;
      this.screechGain = screechGain;
      this.started = true;
    } catch {
      // Ignore Web Audio errors in headless environments
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.silenceLoops();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  silenceLoops(): void {
    if (!this.ctx || !this.engineGain || !this.screechGain) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, now, 0.04);
    this.screechGain.gain.setTargetAtTime(0, now, 0.04);
  }

  update(speedKmh: number, throttle: number, driftIntensity: number, active: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineSubOsc || !this.engineGain || !this.screechGain) return;
    const now = this.ctx.currentTime;
    if (this.muted || !active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.05);
      this.screechGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    // Simulated 5-speed gearbox RPM curve
    const normSpeed = Math.min(1, speedKmh / 250);
    const gearSaw = (normSpeed * 4.2) % 1;
    const rpm = 0.25 + 0.55 * gearSaw + 0.2 * normSpeed + throttle * 0.14;
    const freq = 52 + rpm * 135;

    this.engineOsc.frequency.setTargetAtTime(freq, now, 0.04);
    this.engineSubOsc.frequency.setTargetAtTime(freq * 0.5, now, 0.04);
    this.engineGain.gain.setTargetAtTime(0.045 + throttle * 0.035, now, 0.05);

    const screechVol = driftIntensity > 0.12 ? Math.min(0.075, driftIntensity * 0.075) : 0;
    this.screechGain.gain.setTargetAtTime(screechVol, now, 0.04);
  }

  playBeep(high: boolean): void {
    if (this.muted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = high ? 880 : 440;
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (high ? 0.32 : 0.16));
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch {
      // Ignore
    }
  }

  playImpact(intensity: number): void {
    if (this.muted || !this.ctx || intensity < 0.08) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
      gain.gain.setValueAtTime(Math.min(0.18, intensity * 0.16), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {
      // Ignore
    }
  }

  dispose(): void {
    this.silenceLoops();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
