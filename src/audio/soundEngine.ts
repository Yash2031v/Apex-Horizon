// 100% Procedural Web Audio API Racing Synthesizer (Zero External Audio Files)
// Reuses persistent audio nodes & shared noise buffer for 60 FPS zero-allocation performance.

class RacingSoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private masterVolume: number = 0.75; // 0.0 to 1.0 user volume slider
  private isRunning: boolean = false;

  private masterGain: GainNode | null = null;
  private sharedNoiseBuffer: AudioBuffer | null = null;

  // Engine Synthesizer Nodes
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Tyre Squeal Loop Nodes (Turning Hard / Scrubbing / Sliding)
  private tireNoiseNode: AudioBufferSourceNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;

  // Off-Track Gravel Loop Nodes (Rough Low-Pass Noise)
  private gravelNoiseNode: AudioBufferSourceNode | null = null;
  private gravelFilter: BiquadFilterNode | null = null;
  private gravelGain: GainNode | null = null;

  // Nitro Boost Turbine Nodes
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
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.masterVolume * 0.38;
      this.masterGain.connect(this.ctx.destination);

      // Shared 2-second white/pink noise buffer reused by tyre squeal, gravel loop, and impact bursts
      const bufferSize = this.ctx.sampleRate * 2;
      this.sharedNoiseBuffer = this.ctx.createBuffer(
        1,
        bufferSize,
        this.ctx.sampleRate
      );
      const output = this.sharedNoiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      // 1. Engine Synthesizer (V10 dual harmonic oscillators)
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

      // 2. Tyre Squeal Loop (Bandpass filtered noise)
      this.tireNoiseNode = this.ctx.createBufferSource();
      this.tireNoiseNode.buffer = this.sharedNoiseBuffer;
      this.tireNoiseNode.loop = true;

      this.tireFilter = this.ctx.createBiquadFilter();
      this.tireFilter.type = 'bandpass';
      this.tireFilter.frequency.value = 1150;
      this.tireFilter.Q.value = 6.2;

      this.tireGain = this.ctx.createGain();
      this.tireGain.gain.value = 0;

      this.tireNoiseNode.connect(this.tireFilter);
      this.tireFilter.connect(this.tireGain);
      this.tireGain.connect(this.masterGain);
      this.tireNoiseNode.start();

      // 3. Off-Track Gravel Loop (Rough low-pass filtered noise)
      this.gravelNoiseNode = this.ctx.createBufferSource();
      this.gravelNoiseNode.buffer = this.sharedNoiseBuffer;
      this.gravelNoiseNode.loop = true;
      this.gravelNoiseNode.playbackRate.value = 0.65;

      this.gravelFilter = this.ctx.createBiquadFilter();
      this.gravelFilter.type = 'lowpass';
      this.gravelFilter.frequency.value = 420;
      this.gravelFilter.Q.value = 2.4;

      this.gravelGain = this.ctx.createGain();
      this.gravelGain.gain.value = 0;

      this.gravelNoiseNode.connect(this.gravelFilter);
      this.gravelFilter.connect(this.gravelGain);
      this.gravelGain.connect(this.masterGain);
      this.gravelNoiseNode.start();

      // 4. Nitro Boost Turbine Oscillator
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
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : this.masterVolume * 0.38,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(
        this.masterVolume * 0.38,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public updateTelemetry(
    rpm: number,
    throttle: number,
    squealIntensity: number, // 0..1 combined from tyre scrub, drift, or spin slide
    gravelIntensity: number, // 0..1 when driving off-track on gravel
    isBoosting: boolean,
    isPaused: boolean
  ): void {
    if (!this.ctx || !this.isRunning) return;
    const now = this.ctx.currentTime;

    if (isPaused || this.isMuted) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.05);
      this.tireGain?.gain.setTargetAtTime(0, now, 0.05);
      this.gravelGain?.gain.setTargetAtTime(0, now, 0.05);
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

    // Tyre squeal fade in/out when turning hard at high speed, scrubbing, or sliding
    const clampedSqueal = Math.max(0, Math.min(1, squealIntensity));
    const targetTireGain = clampedSqueal * 0.22;
    this.tireGain?.gain.setTargetAtTime(targetTireGain, now, 0.045);
    if (clampedSqueal > 0.02 && this.tireFilter) {
      this.tireFilter.frequency.setTargetAtTime(
        980 + normalizedRpm * 420 + clampedSqueal * 320,
        now,
        0.05
      );
    }

    // Off-track rough low-pass gravel noise loop
    const clampedGravel = Math.max(0, Math.min(1, gravelIntensity));
    this.gravelGain?.gain.setTargetAtTime(clampedGravel * 0.28, now, 0.05);
    if (clampedGravel > 0.02 && this.gravelFilter) {
      this.gravelFilter.frequency.setTargetAtTime(
        310 + clampedGravel * 260,
        now,
        0.05
      );
    }

    // Nitro boost turbine
    const targetNitroGain = isBoosting ? 0.15 : 0.0;
    this.nitroGain?.gain.setTargetAtTime(targetNitroGain, now, 0.04);
    if (isBoosting && this.nitroOsc) {
      this.nitroOsc.frequency.setTargetAtTime(
        210 + normalizedRpm * 190,
        now,
        0.04
      );
    }
  }

  /**
   * Car-to-Car Collision Sound: Short noise burst + low thump, scaled in volume & pitch by impact speed.
   */
  public playCarCollision(impactNormalized: number): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const intensity = Math.max(0.15, Math.min(1.0, impactNormalized));
      const duration = 0.14 + intensity * 0.18;

      // 1. Low body thump oscillator
      const thumpOsc = this.ctx.createOscillator();
      const thumpGain = this.ctx.createGain();
      thumpOsc.type = 'triangle';
      const startPitch = 95 + intensity * 65;
      thumpOsc.frequency.setValueAtTime(startPitch, now);
      thumpOsc.frequency.exponentialRampToValueAtTime(28, now + duration);

      thumpGain.gain.setValueAtTime(0.18 + intensity * 0.42, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      thumpOsc.connect(thumpGain);
      thumpGain.connect(this.masterGain);
      thumpOsc.start(now);
      thumpOsc.stop(now + duration);

      // 2. Metallic crunch / shell noise burst
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(520 + intensity * 680, now);
      filter.Q.setValueAtTime(1.8, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.12 + intensity * 0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.85);

      noiseSrc.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noiseSrc.start(now, Math.random() * 1.2, duration);
    } catch {
      // Ignore
    }
  }

  /**
   * Wall / Guardrail Barrier Hit: Duller low thud + metallic guardrail scrape.
   */
  public playWallHit(impactNormalized: number): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const intensity = Math.max(0.15, Math.min(1.0, impactNormalized));
      const scrapeDur = 0.22 + intensity * 0.2;

      // 1. Dull barrier thud
      const thudOsc = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(75 + intensity * 30, now);
      thudOsc.frequency.exponentialRampToValueAtTime(24, now + 0.18);

      thudGain.gain.setValueAtTime(0.2 + intensity * 0.32, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      thudOsc.connect(thudGain);
      thudGain.connect(this.masterGain);
      thudOsc.start(now);
      thudOsc.stop(now + 0.19);

      // 2. Guardrail metallic scrape
      const scrapeSrc = this.ctx.createBufferSource();
      scrapeSrc.buffer = this.sharedNoiseBuffer;
      const scrapeFilter = this.ctx.createBiquadFilter();
      scrapeFilter.type = 'bandpass';
      scrapeFilter.frequency.setValueAtTime(820 + intensity * 380, now);
      scrapeFilter.Q.setValueAtTime(4.2, now);

      const scrapeGain = this.ctx.createGain();
      scrapeGain.gain.setValueAtTime(0.08 + intensity * 0.22, now);
      scrapeGain.gain.exponentialRampToValueAtTime(0.001, now + scrapeDur);

      scrapeSrc.connect(scrapeFilter);
      scrapeFilter.connect(scrapeGain);
      scrapeGain.connect(this.masterGain);
      scrapeSrc.start(now, Math.random() * 1.0, scrapeDur);
    } catch {
      // Ignore
    }
  }

  public playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'sine'
  ): void {
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

  /**
   * Machine Gun Tracer Shot: Crisp punchy arcade pulse + short high-pass noise snap.
   */
  public playMachineGunShot(heatRatio: number = 0): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      const basePitch = 210 + heatRatio * 90;
      osc.frequency.setValueAtTime(basePitch, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.055);

      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.06);

      const snapSrc = this.ctx.createBufferSource();
      snapSrc.buffer = this.sharedNoiseBuffer;
      const snapFilter = this.ctx.createBiquadFilter();
      snapFilter.type = 'bandpass';
      snapFilter.frequency.setValueAtTime(1600, now);
      snapFilter.Q.setValueAtTime(2.2, now);

      const snapGain = this.ctx.createGain();
      snapGain.gain.setValueAtTime(0.14, now);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

      snapSrc.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(this.masterGain);
      snapSrc.start(now, Math.random() * 1.4, 0.05);
    } catch {
      // Ignore
    }
  }

  /**
   * Homing Missile Launch: Whoosh noise sweep + rising/falling rocket ignition tone.
   */
  public playMissileLaunch(): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const dur = 0.42;

      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(380, now);
      filter.frequency.exponentialRampToValueAtTime(1450, now + 0.16);
      filter.frequency.exponentialRampToValueAtTime(520, now + dur);
      filter.Q.setValueAtTime(2.6, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noiseSrc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noiseSrc.start(now, Math.random() * 1.0, dur);

      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(310, now + 0.12);
      osc.frequency.exponentialRampToValueAtTime(85, now + dur);

      oscGain.gain.setValueAtTime(0.18, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + dur);
    } catch {
      // Ignore
    }
  }

  /**
   * Target Hit Marker Ping: Crisp metallic confirmation chime.
   */
  public playHitConfirm(): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, now);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.055);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch {
      // Ignore
    }
  }

  /**
   * Car Elimination Explosion: Deep sub-bass boom + filtered fireball roar.
   */
  public playExplosion(): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const dur = 0.68;

      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(115, now);
      subOsc.frequency.exponentialRampToValueAtTime(22, now + dur);

      subGain.gain.setValueAtTime(0.48, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      subOsc.connect(subGain);
      subGain.connect(this.masterGain);
      subOsc.start(now);
      subOsc.stop(now + dur);

      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(920, now);
      filter.frequency.exponentialRampToValueAtTime(140, now + dur);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.38, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noiseSrc.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noiseSrc.start(now, Math.random() * 0.8, dur);
    } catch {
      // Ignore
    }
  }

  /**
   * Minecraft-Style Blocky Hit Sound: Short low thump with a quick crisp noise burst.
   */
  public playBlockyHit(isHeavyMissile: boolean = false): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const dur = isHeavyMissile ? 0.16 : 0.11;

      // 1. Low blocky thump oscillator
      const thumpOsc = this.ctx.createOscillator();
      const thumpGain = this.ctx.createGain();
      thumpOsc.type = 'triangle';
      thumpOsc.frequency.setValueAtTime(isHeavyMissile ? 145 : 175, now);
      thumpOsc.frequency.exponentialRampToValueAtTime(
        isHeavyMissile ? 42 : 58,
        now + dur
      );

      thumpGain.gain.setValueAtTime(isHeavyMissile ? 0.34 : 0.24, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      thumpOsc.connect(thumpGain);
      thumpGain.connect(this.masterGain);
      thumpOsc.start(now);
      thumpOsc.stop(now + dur + 0.01);

      // 2. Quick noise burst
      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = this.sharedNoiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(isHeavyMissile ? 920 : 1280, now);
      filter.Q.setValueAtTime(2.4, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(isHeavyMissile ? 0.26 : 0.18, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.75);

      noiseSrc.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noiseSrc.start(now, Math.random() * 1.2, dur);
    } catch {
      // Ignore
    }
  }

  /**
   * Player Hurt Sound: Higher-pitched blocky hurt crunch + low thump + quick noise burst.
   */
  public playPlayerHurt(isHeavy: boolean = false): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const dur = isHeavy ? 0.18 : 0.13;

      // Higher-pitched retro hurt pitch drop
      const hurtOsc = this.ctx.createOscillator();
      const hurtGain = this.ctx.createGain();
      hurtOsc.type = 'square';
      hurtOsc.frequency.setValueAtTime(isHeavy ? 540 : 620, now);
      hurtOsc.frequency.setValueAtTime(isHeavy ? 380 : 440, now + 0.04);
      hurtOsc.frequency.exponentialRampToValueAtTime(195, now + dur);

      hurtGain.gain.setValueAtTime(0.16, now);
      hurtGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      hurtOsc.connect(hurtGain);
      hurtGain.connect(this.masterGain);
      hurtOsc.start(now);
      hurtOsc.stop(now + dur + 0.01);

      // Accompanying low thump + noise burst
      this.playBlockyHit(isHeavy);
    } catch {
      // Ignore
    }
  }

  /**
   * Progressive Car Damage Stage "Break" Sound (at 75%, 50%, and 25% HP):
   * Crisp Minecraft-style block crack/shatter crunch.
   */
  public playDamageStageBreak(stage: number = 1): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain || !this.sharedNoiseBuffer) return;

    try {
      const now = this.ctx.currentTime;
      const baseFreq = stage === 3 ? 240 : stage === 2 ? 310 : 380;

      for (let g = 0; g < 3; g++) {
        const offset = g * 0.042;
        const grainDur = 0.075;

        // Blocky square crackle grain
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(baseFreq - g * 48, now + offset);
        osc.frequency.exponentialRampToValueAtTime(75, now + offset + grainDur);

        gain.gain.setValueAtTime(0.18, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + grainDur);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now + offset);
        osc.stop(now + offset + grainDur + 0.01);

        // Crisp noise crunch grain
        const noiseSrc = this.ctx.createBufferSource();
        noiseSrc.buffer = this.sharedNoiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(880 + g * 280, now + offset);
        filter.Q.setValueAtTime(3.0, now + offset);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(0.22, now + offset);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + offset + grainDur);

        noiseSrc.connect(filter);
        filter.connect(nGain);
        nGain.connect(this.masterGain);
        noiseSrc.start(now + offset, Math.random() * 1.1, grainDur);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Floating Track Pickup Collected: Rising crystalline synth arpeggio for Repair (+30 HP) or Ammo (+Missiles).
   */
  public playPickup(type: 'repair' | 'ammo'): void {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const notes =
        type === 'repair' ? [523.25, 659.25, 783.99, 1046.5] : [440, 587.33, 880];

      notes.forEach((freq, idx) => {
        if (!this.ctx || !this.masterGain) return;
        const start = now + idx * 0.048;
        const dur = 0.14;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type === 'repair' ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(start);
        osc.stop(start + dur + 0.01);
      });
    } catch {
      // Ignore
    }
  }
}

export const soundEngine = new RacingSoundEngine();


