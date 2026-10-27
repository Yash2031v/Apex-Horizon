import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { soundEngine } from './soundEngine';

describe('RacingSoundEngine', () => {
    let mockAudioContext: any;

    beforeEach(() => {
        mockAudioContext = {
            state: 'running',
            resume: mock(() => Promise.resolve()),
            createGain: mock(() => ({
                gain: { value: 0, setTargetAtTime: mock(), setValueAtTime: mock(), exponentialRampToValueAtTime: mock() },
                connect: mock()
            })),
            createBuffer: mock((channels: number, length: number, sampleRate: number) => ({
                getChannelData: mock(() => new Float32Array(length))
            })),
            createBiquadFilter: mock(() => ({
                type: 'lowpass',
                frequency: { value: 0, setTargetAtTime: mock(), setValueAtTime: mock(), exponentialRampToValueAtTime: mock() },
                Q: { value: 0, setValueAtTime: mock() },
                connect: mock()
            })),
            createOscillator: mock(() => ({
                type: 'sine',
                frequency: { value: 0, setTargetAtTime: mock(), setValueAtTime: mock(), exponentialRampToValueAtTime: mock() },
                connect: mock(),
                start: mock(),
                stop: mock()
            })),
            createBufferSource: mock(() => ({
                buffer: null,
                loop: false,
                playbackRate: { value: 1 },
                connect: mock(),
                start: mock(),
                stop: mock()
            })),
            sampleRate: 44100,
            currentTime: 0,
            destination: {}
        };

        (globalThis as any).window = {
            AudioContext: mock(() => mockAudioContext)
        };

        const engine = soundEngine as any;
        engine.ctx = null;
        engine.isRunning = false;
        engine.isMuted = false;
        engine.masterVolume = 0.75;
    });

    it('initializes correctly with mocked AudioContext', () => {
        soundEngine.init();
        const engine = soundEngine as any;
        expect(engine.ctx).not.toBeNull();
        expect(engine.isRunning).toBe(true);
    });

    it('toggles mute state correctly', () => {
        soundEngine.init();

        soundEngine.setMuted(true);
        expect(soundEngine.getMuted()).toBe(true);

        soundEngine.setMuted(false);
        expect(soundEngine.getMuted()).toBe(false);
    });

    it('updates master volume within bounds', () => {
        soundEngine.init();

        soundEngine.setMasterVolume(0.5);
        expect(soundEngine.getMasterVolume()).toBe(0.5);

        soundEngine.setMasterVolume(1.5); // Should clamp to 1
        expect(soundEngine.getMasterVolume()).toBe(1.0);

        soundEngine.setMasterVolume(-0.5); // Should clamp to 0
        expect(soundEngine.getMasterVolume()).toBe(0.0);
    });

    it('updates telemetry without errors', () => {
        soundEngine.init();
        expect(() => {
            soundEngine.updateTelemetry(5000, 1.0, 0.5, 0.2, true, false);
        }).not.toThrow();
    });

    it('handles sounds', () => {
        soundEngine.init();
        expect(() => soundEngine.playTone(440, 1, 'sine')).not.toThrow();
        expect(() => soundEngine.playCarCollision(0.5)).not.toThrow();
        expect(() => soundEngine.playWallHit(0.5)).not.toThrow();
        expect(() => soundEngine.playCountdownBeep(true)).not.toThrow();
        expect(() => soundEngine.playLapComplete()).not.toThrow();
        expect(() => soundEngine.playMachineGunShot(0.5)).not.toThrow();
        expect(() => soundEngine.playMissileLaunch()).not.toThrow();
        expect(() => soundEngine.playHitConfirm()).not.toThrow();
        expect(() => soundEngine.playExplosion()).not.toThrow();
        expect(() => soundEngine.playBlockyHit(true)).not.toThrow();
        expect(() => soundEngine.playPlayerHurt(true)).not.toThrow();
        expect(() => soundEngine.playDamageStageBreak(2)).not.toThrow();
        expect(() => soundEngine.playPickup('repair')).not.toThrow();
    });
});
