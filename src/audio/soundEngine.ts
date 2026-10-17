// 100% Procedural Web Audio API Racing Synthesizer (Zero External Audio Files)

class RacingSoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isRunning: boolean = false;

  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private tireNoiseNode: AudioBufferSourceNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;

  private nitroOsc: OscillatorNode | null = null;
  private nitroGain: GainNode | null = null;

  public init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : 0.28;
      this.masterGain.connect(this.ctx.destination);

      // Engine Synthesizer (V10 dual harmonic)
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineFilter.Q.value = 3.5;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.value = 55;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 110;

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();

      // Tire Screech / Drift Noise Generator
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.tireNoiseNode = this.ctx.createBufferSource();
      this.tireNoiseNode.buffer = noiseBuffer;
      this.tireNoiseNode.loop = true;

      this.tireFilter = this.ctx.createBiquadFilter();
      this.tireFilter.type = 'bandpass';
      this.tireFilter.frequency.value = 1150;
      this.tireFilter.Q.value = 6.0;

      this.tireGain = this.ctx.createGain();
      this.tireGain.gain.value = 0;

      this.tireNoiseNode.connect(this.tireFilter);
      this.tireFilter.connect(this.tireGain);
      this.tireGain.connect(this.masterGain);
      this.tireNoiseNode.start();

      // Nitro Boost Turbine Oscillator
      this.nitroOsc = this.ctx.createOscillator();
      this.nitroOsc.type = 'sawtooth';
      this.nitroOsc.frequency.value = 180;

      this.nitroGain = this.ctx.createGain();
      this.nitroGain.gain.value = 0;

      this.nitroOsc.connect(this.nitroGain);
      this.nitroGain.connect(this.masterGain);
      this.nitroOsc.start();

      this.isRunning = true;
    } catch {
      // Ignore Web Audio errors in restricted environments
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.28, this.ctx.currentTime, 0.04);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public updateTelemetry(
    rpm: number,
    throttle: number,
    isDrifting: boolean,
    isBoosting: boolean,
    isPaused: boolean
  ): void {
    if (!this.ctx || !this.isRunning) return;
    const now = this.ctx.currentTime;

    if (isPaused || this.isMuted) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.05);
      this.tireGain?.gain.setTargetAtTime(0, now, 0.05);
      this.nitroGain?.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const normalizedRpm = Math.max(0, Math.min(1, (rpm - 1000) / 8000));
    const baseFreq = 42 + normalizedRpm * 165;

    this.engineOsc1?.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2?.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.03);

    const filterFreq = 220 + normalizedRpm * 1400 + throttle * 450;
    this.engineFilter?.frequency.setTargetAtTime(filterFreq, now, 0.04);

    const targetEngineGain = 0.16 + normalizedRpm * 0.18 + throttle * 0.08;
    this.engineGain?.gain.setTargetAtTime(targetEngineGain, now, 0.04);

    // Tire screech on drift
    const targetTireGain = isDrifting ? 0.14 : 0.0;
    this.tireGain?.gain.setTargetAtTime(targetTireGain, now, 0.05);
    if (isDrifting && this.tireFilter) {
      this.tireFilter.frequency.setTargetAtTime(1000 + normalizedRpm * 450, now, 0.05);
    }

    // Nitro turbine
    const targetNitroGain = isBoosting ? 0.15 : 0.0;
    this.nitroGain?.gain.setTargetAtTime(targetNitroGain, now, 0.04);
    if (isBoosting && this.nitroOsc) {
      this.nitroOsc.frequency.setTargetAtTime(210 + normalizedRpm * 190, now, 0.04);
    }
  }

  public playTone(freq: number, durationSec: number, type: OscillatorType = 'sine'): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + durationSec);
    } catch {
      // Ignore
    }
  }

  public playCountdownBeep(isGo: boolean): void {
    this.playTone(isGo ? 880 : 440, isGo ? 0.38 : 0.16, 'triangle');
  }

  public playLapComplete(): void {
    this.playTone(587.33, 0.12, 'triangle');
    setTimeout(() => this.playTone(880, 0.25, 'triangle'), 110);
  }
}

export const soundEngine = new RacingSoundEngine();
