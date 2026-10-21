import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Play,
  Pause,
  Trophy,
  Gauge,
  Compass,
  Camera,
  Keyboard,
  Crosshair,
  ShieldAlert,
  Flame,
  X,
} from 'lucide-react';
import {
  CameraMode,
  CAR_LIVERIES,
  CarLivery,
  CombatDifficulty,
  RaceStatus,
  RaceTelemetry,
  TRACK_CONFIGS,
  TrackTheme,
} from './types/racing';
import { RacingCanvas, TouchDriveControls } from './components/RacingCanvas';
import { TrackMinimap } from './components/TrackMinimap';
import { soundEngine } from './audio/soundEngine';

function formatLapTime(ms: number | null): string {
  if (ms === null || ms <= 0) return '--:--.---';
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}.${String(millis).padStart(3, '0')}`;
}

const INITIAL_TELEMETRY: RaceTelemetry = {
  status: 'ready',
  countdownValue: 3,
  speedKmh: 0,
  rpm: 1150,
  gear: 'N',
  nitro: 100,
  isBoosting: false,
  isDrifting: false,
  isTyreScrubbing: false,
  isSliding: false,
  isSlipstreaming: false,
  isOffTrack: false,
  scoreEventLabel: null,
  lap: 1,
  totalLaps: 3,
  position: 1,
  totalCars: 6,
  currentLapTimeMs: 0,
  bestLapTimeMs: null,
  lastLapTimeMs: null,
  sectorIndex: 0,
  driftScore: 0,
  currentDriftPoints: 0,
  lapProgress: 0,
  combatMode: true,
  combatDifficulty: 'normal',
  permanentElimination: false,
  activeRivalsCount: 5,
  playerHp: 100,
  playerMaxHp: 100,
  isPlayerDestroyed: false,
  playerRespawnTimer: 0,
  isPlayerInvulnerable: false,
  mgHeat: 0,
  mgOverheated: false,
  missileAmmo: 6,
  missileMaxAmmo: 6,
  missileCooldown: 0,
  kills: 0,
  killFeed: [],
  crosshairScreen: { x: 50, y: 48, visible: false, hasLock: false },
  rivalOverlays: [],
  standings: [],
};

export default function App() {
  const [trackTheme, setTrackTheme] = useState<TrackTheme>('canyon');
  const [livery, setLivery] = useState<CarLivery>(CAR_LIVERIES[0]);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [raceStatus, setRaceStatus] = useState<RaceStatus>('ready');
  const [combatMode, setCombatMode] = useState<boolean>(true);
  const [combatDifficulty, setCombatDifficulty] =
    useState<CombatDifficulty>('normal');
  const [permanentElimination, setPermanentElimination] =
    useState<boolean>(false);
  const [totalLaps, setTotalLaps] = useState<number>(3);
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [telemetry, setTelemetry] = useState<RaceTelemetry>(INITIAL_TELEMETRY);

  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [masterVolume, setMasterVolume] = useState<number>(0.75);
  const [activeModal, setActiveModal] = useState<
    'standings' | 'controls' | null
  >(null);

  const touchControlsRef = useRef<TouchDriveControls>({
    throttle: false,
    brake: false,
    left: false,
    right: false,
    nitro: false,
    fireMg: false,
    fireMissile: false,
  });

  const handleStartOrToggleRace = useCallback(() => {
    soundEngine.init();
    if (raceStatus === 'ready') {
      setRaceStatus('countdown');
    } else if (raceStatus === 'racing') {
      setRaceStatus('paused');
    } else if (raceStatus === 'paused') {
      setRaceStatus('racing');
    } else if (raceStatus === 'finished') {
      setResetSignal((prev) => prev + 1);
      setRaceStatus('countdown');
    }
  }, [raceStatus]);

  const handleResetRace = useCallback(() => {
    soundEngine.init();
    setResetSignal((prev) => prev + 1);
    setRaceStatus('countdown');
    setActiveModal(null);
  }, []);

  const handleToggleMute = useCallback(() => {
    soundEngine.init();
    setIsMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      return next;
    });
  }, []);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      soundEngine.init();
      const val = parseFloat(e.target.value);
      setMasterVolume(val);
      soundEngine.setMasterVolume(val);
      if (val > 0 && isMuted) {
        setIsMuted(false);
        soundEngine.setMuted(false);
      }
    },
    [isMuted]
  );

  const handleCycleTrack = useCallback(() => {
    const order: TrackTheme[] = ['canyon', 'midnight', 'alpine'];
    const nextIdx = (order.indexOf(trackTheme) + 1) % order.length;
    setTrackTheme(order[nextIdx]);
  }, [trackTheme]);

  // Global keyboard shortcuts for HUD dock collapse (H), Mute (M), Camera cycle (C), Pause (P / Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setIsDockCollapsed((prev) => !prev);
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      } else if (e.code === 'KeyC') {
        setCameraMode((prev) =>
          prev === 'chase' ? 'hood' : prev === 'hood' ? 'aerial' : 'chase'
        );
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        setRaceStatus((prev) =>
          prev === 'racing' ? 'paused' : prev === 'paused' ? 'racing' : prev
        );
      } else if (
        (e.code === 'Enter' || e.code === 'KeyW' || e.code === 'ArrowUp') &&
        raceStatus === 'ready'
      ) {
        soundEngine.init();
        setRaceStatus('countdown');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [raceStatus, handleToggleMute]);

  const setTouchInput = (key: keyof TouchDriveControls, value: boolean) => {
    soundEngine.init();
    touchControlsRef.current[key] = value;
    if (value && raceStatus === 'ready') {
      setRaceStatus('countdown');
    }
  };

  const currentTrackConfig = TRACK_CONFIGS[trackTheme];
  const rpmRatio = Math.min(1, Math.max(0, (telemetry.rpm - 1000) / 8000));
  const isRedline = telemetry.rpm >= 7800;
  const playerHpRatio = Math.max(
    0,
    Math.min(1, telemetry.playerHp / Math.max(1, telemetry.playerMaxHp))
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#080A0F] text-[#F8FAFC] flex flex-col">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="relative z-20 flex items-center justify-between gap-8 px-6 py-3 bg-[#080A0F]/95 border-b border-white/10 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveModal(null);
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Apex Horizon
        </a>

        {/* Zone 2: 4 concise single-line text navigation links (including Combat Mode Toggle) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={handleCycleTrack}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Switch Circuit
          </button>
          <button
            type="button"
            onClick={() => setCombatMode((prev) => !prev)}
            className={`hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              combatMode ? 'text-rose-400 font-semibold' : 'hover:text-white'
            }`}
          >
            Combat Mode: {combatMode ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveModal((prev) =>
                prev === 'standings' ? null : 'standings'
              )
            }
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Live Standings
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveModal((prev) =>
                prev === 'controls' ? null : 'controls'
              )
            }
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Driving Controls
          </button>
        </nav>

        {/* Zone 3: 1 Primary CTA Button */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleStartOrToggleRace}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {raceStatus === 'ready'
              ? 'Start Race'
              : raceStatus === 'countdown'
                ? `Grid Launch (${telemetry.countdownValue})`
                : raceStatus === 'racing'
                  ? 'Pause Race'
                  : raceStatus === 'paused'
                    ? 'Resume Race'
                    : 'Race Again'}
          </button>
        </div>
      </header>

      {/* FULL-VIEWPORT 3D SCENE CONTAINER */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <RacingCanvas
          trackTheme={trackTheme}
          livery={livery}
          cameraMode={cameraMode}
          raceStatus={raceStatus}
          combatMode={combatMode}
          combatDifficulty={combatDifficulty}
          permanentElimination={permanentElimination}
          totalLaps={totalLaps}
          resetSignal={resetSignal}
          touchControlsRef={touchControlsRef}
          onTelemetryUpdate={setTelemetry}
          onStatusChange={setRaceStatus}
        />

        {/* 2D SCREEN-PROJECTED TARGETING CROSSHAIR & RIVAL TARGET BOXES / HEALTH BARS */}
        {combatMode && raceStatus === 'racing' && (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {/* Small Crosshair Ahead of the Car */}
            {telemetry.crosshairScreen.visible && (
              <div
                style={{
                  left: `${telemetry.crosshairScreen.x}%`,
                  top: `${telemetry.crosshairScreen.y}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-75"
              >
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                    telemetry.crosshairScreen.hasLock
                      ? 'border-rose-500 bg-rose-500/15 scale-110 shadow-[0_0_10px_rgba(244,63,94,0.65)]'
                      : 'border-amber-300/65 bg-black/15'
                  }`}
                >
                  <div
                    className={`w-1 h-1 rounded-full ${
                      telemetry.crosshairScreen.hasLock
                        ? 'bg-rose-400'
                        : 'bg-amber-300'
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Compact Rival Health Bars & Red Target Lock Box (100 HP max, scaled so car is unobstructed) */}
            {telemetry.rivalOverlays.map((rv) => {
              if (!rv.visible) return null;
              const hpPct = Math.max(0, Math.min(100, (rv.hp / rv.maxHp) * 100));
              const distScale = Math.max(
                0.62,
                Math.min(0.95, 28 / Math.max(18, rv.distanceMeters))
              );
              return (
                <div
                  key={rv.id}
                  style={{
                    left: `${rv.screenX}%`,
                    top: `${rv.screenY}%`,
                    transform: `translate(-50%, -100%) scale(${distScale.toFixed(2)})`,
                  }}
                  className="absolute origin-bottom flex flex-col items-center transition-all duration-75"
                >
                  {/* Compact Health Bar Above Each AI Car (100 HP) */}
                  <div className="px-1 py-0.5 rounded bg-[#090D16]/80 border border-white/15 flex flex-col items-center gap-0.5 shadow-sm">
                    <div className="flex items-center gap-1 text-[8px] font-mono-tabular leading-none">
                      <span
                        className={
                          rv.isLockedTarget
                            ? 'text-rose-400 font-bold'
                            : 'text-slate-200 font-medium'
                        }
                      >
                        {rv.driverName.split(' ')[0]}
                      </span>
                      <span className="text-slate-300">{rv.hp}</span>
                    </div>
                    <div className="w-11 h-1 rounded-full bg-white/15 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-75 ${
                          hpPct > 50
                            ? 'bg-emerald-400'
                            : hpPct > 30
                              ? 'bg-amber-400'
                              : 'bg-rose-500'
                        }`}
                        style={{ width: `${hpPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Compact Red Target Lock Bracket when Rival is in the 8° Crosshair Cone */}
                  {rv.isLockedTarget && (
                    <div className="mt-0.5 w-10 h-6 border border-rose-500/90 rounded-xs shadow-[0_0_8px_rgba(244,63,94,0.55)] relative flex items-end justify-center">
                      <span className="text-[7px] font-mono-tabular font-bold uppercase tracking-tight text-rose-200 bg-rose-950/85 px-1 rounded-xs leading-tight">
                        {rv.distanceMeters}m
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TOP-LEFT COMBAT HUD PANEL & KILL FEED (Safe Left Inset + Max-Width, No Overlapping Labels) */}
        {combatMode && (
          <aside
            aria-label="Combat Weapons and Armor Telemetry"
            className="pointer-events-none absolute top-16 left-5 sm:left-6 pl-1 z-10 w-64 max-w-[calc(100vw-2.5rem)] flex flex-col gap-2 select-none"
          >
            <div className="pointer-events-auto rounded-xl bg-[#0B0F19]/92 border border-white/15 p-3.5 shadow-xl space-y-2.5">
              {/* Header: Combat Status & Kill Count */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-1.5">
                <span className="text-[10px] font-display font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5 shrink-0">
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  Combat Systems
                </span>
                <span className="text-[11px] font-mono-tabular font-bold text-amber-400 shrink-0">
                  Kills: {telemetry.kills}
                </span>
              </div>

              {/* Player Hull Health Bar (100 HP) */}
              <div className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[10px] font-mono-tabular">
                  <span className="text-slate-300 font-medium">Armor Integrity</span>
                  <span
                    className={
                      telemetry.isPlayerDestroyed
                        ? 'text-rose-400 font-bold'
                        : telemetry.isPlayerInvulnerable
                          ? 'text-cyan-300 font-bold'
                          : telemetry.playerHp <= 30
                            ? 'text-rose-400 font-bold'
                            : 'text-emerald-400 font-semibold'
                    }
                  >
                    {telemetry.isPlayerDestroyed
                      ? `RESPAWN ${telemetry.playerRespawnTimer}s`
                      : telemetry.isPlayerInvulnerable
                        ? `SHIELDED · ${telemetry.playerHp} HP`
                        : `${telemetry.playerHp} / ${telemetry.playerMaxHp} HP`}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      telemetry.playerHp > 50
                        ? 'bg-emerald-400'
                        : telemetry.playerHp > 30
                          ? 'bg-amber-400'
                          : 'bg-rose-500'
                    }`}
                    style={{ width: `${playerHpRatio * 100}%` }}
                  />
                </div>
              </div>

              {/* Machine Gun Heat Bar (Separate sub-line + flex-wrap so "Vulcan MG" and "HEAT" never overlap) */}
              <div className="space-y-1 pt-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] font-mono-tabular">
                  <span className="text-slate-200 font-semibold flex items-center gap-1.5 shrink-0">
                    <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    Vulcan MG
                  </span>
                  <span
                    className={`shrink-0 ${
                      telemetry.mgOverheated
                        ? 'text-rose-400 font-bold'
                        : 'text-amber-300 font-semibold'
                    }`}
                  >
                    {telemetry.mgOverheated
                      ? 'OVERHEATED'
                      : `${telemetry.mgHeat}% HEAT`}
                  </span>
                </div>
                <div className="text-[9px] font-mono-tabular text-slate-400 leading-none">
                  Fire: Space / Left Click
                </div>
                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      telemetry.mgOverheated
                        ? 'bg-rose-500'
                        : telemetry.mgHeat > 75
                          ? 'bg-amber-400'
                          : 'bg-yellow-300'
                    }`}
                    style={{ width: `${telemetry.mgHeat}%` }}
                  />
                </div>
              </div>

              {/* Homing Missile Ammo Counter */}
              <div className="pt-0.5 space-y-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-mono-tabular">
                  <span className="text-slate-200 font-semibold shrink-0">
                    Homing Missiles
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {Array.from({ length: telemetry.missileMaxAmmo }).map(
                      (_, idx) => (
                        <span
                          key={idx}
                          className={`w-2 h-3.5 rounded-xs transition-colors ${
                            idx < telemetry.missileAmmo
                              ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]'
                              : 'bg-white/10'
                          }`}
                        />
                      )
                    )}
                    <span className="ml-1 text-white font-bold">
                      {telemetry.missileAmmo}/{telemetry.missileMaxAmmo}
                    </span>
                  </div>
                </div>
                <div className="text-[9px] font-mono-tabular text-slate-400 leading-none">
                  Launch: F / Right Click
                </div>
              </div>

              {/* AI Combat Difficulty (Easy / Normal / Hard) & Permanent Elimination Toggle */}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono-tabular">
                  <span className="text-slate-400 shrink-0">AI Difficulty</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {(['easy', 'normal', 'hard'] as CombatDifficulty[]).map(
                      (diff) => (
                        <button
                          key={diff}
                          type="button"
                          onClick={() => setCombatDifficulty(diff)}
                          className={`px-1.5 py-0.5 rounded uppercase font-semibold cursor-pointer transition-colors ${
                            combatDifficulty === diff
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-white/5 text-slate-400 hover:text-white'
                          }`}
                        >
                          {diff}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono-tabular">
                  <span className="text-slate-400">
                    Perm. Elim. ({telemetry.activeRivalsCount}/5 Alive)
                  </span>
                  <button
                    type="button"
                    onClick={() => setPermanentElimination((prev) => !prev)}
                    className={`px-2 py-0.5 rounded font-semibold cursor-pointer transition-colors shrink-0 ${
                      permanentElimination
                        ? 'bg-rose-500/30 border border-rose-400/50 text-rose-200'
                        : 'bg-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    {permanentElimination ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>

            {/* Kill Feed Messages ("ELIMINATED ...") */}
            {telemetry.killFeed.length > 0 && (
              <div className="space-y-1">
                {telemetry.killFeed.map((item) => (
                  <div
                    key={item.id}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono-tabular font-semibold shadow-lg ${
                      item.isPlayerKill
                        ? 'bg-emerald-950/90 border-emerald-400/40 text-emerald-300'
                        : 'bg-rose-950/90 border-rose-400/40 text-rose-300'
                    }`}
                  >
                    {item.message}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}

        {/* REAL-TIME TRACK MINIMAP OVERLAY (TOP-RIGHT CORNER) */}
        <TrackMinimap
          telemetry={telemetry}
          trackTheme={trackTheme}
          livery={livery}
        />

        {/* MINIMAL TOP-CENTER TELEMETRY BAR (Zero-Pill Unboxed Metadata with · Separators) */}
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10 w-full max-w-4xl px-4 flex flex-col items-center gap-1.5">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-5 py-2 rounded-lg bg-[#0B0F19]/90 border border-white/12 text-xs text-slate-300 shadow-lg">
            <span className="font-display font-semibold text-white whitespace-nowrap">
              {currentTrackConfig.name}
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular whitespace-nowrap">
              Position{' '}
              <strong className="text-amber-400 font-bold">
                P{telemetry.position}
              </strong>{' '}
              / {telemetry.totalCars}
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular whitespace-nowrap">
              Lap{' '}
              <strong className="text-white font-bold">{telemetry.lap}</strong>{' '}
              / {telemetry.totalLaps}
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular whitespace-nowrap">
              Lap Time{' '}
              <strong className="text-white">
                {formatLapTime(telemetry.currentLapTimeMs)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular whitespace-nowrap">
              Best{' '}
              <strong className="text-cyan-400">
                {formatLapTime(telemetry.bestLapTimeMs)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono-tabular whitespace-nowrap">
              Apex Score{' '}
              <strong className="text-emerald-400">
                {telemetry.driftScore.toLocaleString()}
              </strong>
            </span>
          </div>

          {/* Dynamic Semantic Driving & Combat Feedback Banner */}
          {(telemetry.isBoosting ||
            telemetry.isDrifting ||
            telemetry.isTyreScrubbing ||
            telemetry.isSliding ||
            telemetry.isSlipstreaming ||
            telemetry.isOffTrack ||
            telemetry.isPlayerDestroyed ||
            Boolean(telemetry.scoreEventLabel)) && (
            <div className="px-3.5 py-1 rounded bg-[#0B0F19]/90 border border-white/15 text-xs font-medium tracking-wide flex flex-wrap items-center justify-center gap-3">
              {telemetry.isPlayerDestroyed && (
                <span className="text-rose-400 font-bold flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  CAR DESTROYED — RESPAWNING IN {telemetry.playerRespawnTimer}s
                </span>
              )}
              {telemetry.scoreEventLabel && (
                <span
                  className={`font-semibold font-mono-tabular ${
                    telemetry.scoreEventLabel.includes('-') ||
                    telemetry.scoreEventLabel.includes('OVERHEAT')
                      ? 'text-rose-400'
                      : 'text-emerald-300'
                  }`}
                >
                  {telemetry.scoreEventLabel}
                </span>
              )}
              {telemetry.isBoosting && (
                <span className="text-cyan-300 font-semibold">
                  Nitro Boost Active (+58 KM/H)
                </span>
              )}
              {telemetry.isSlipstreaming && (
                <span className="text-emerald-300 font-semibold">
                  Slipstream Draft Zone (Aero Drag Reduced)
                </span>
              )}
              {telemetry.isDrifting && (
                <span className="text-amber-300 font-semibold font-mono-tabular">
                  Apex Drift +{telemetry.currentDriftPoints} PTS
                </span>
              )}
              {telemetry.isSliding && (
                <span className="text-rose-300 font-semibold">
                  Slide — High Slip Drag
                </span>
              )}
              {!telemetry.isSliding && telemetry.isTyreScrubbing && (
                <span className="text-amber-300 font-semibold">
                  Tyre Scrub — Cornering Speed Bleed
                </span>
              )}
              {telemetry.isOffTrack && (
                <span className="text-rose-400 font-semibold">
                  Off-Track Gravel Surface — Traction Reduced (Press R to Re-Center)
                </span>
              )}
            </div>
          )}
        </div>

        {/* CENTER OVERLAY FOR READY / COUNTDOWN / PAUSED / FINISHED */}
        {raceStatus === 'ready' && (
          <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center z-10 px-4">
            <div className="pointer-events-auto max-w-xl w-full rounded-xl bg-[#0B0F19]/92 border border-white/15 p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-center sm:text-left">
                <p className="text-xs text-amber-400 font-medium">
                  Starting Grid Ready · {currentTrackConfig.location}
                </p>
                <h1 className="font-display text-xl font-bold text-white">
                  {livery.name} · {combatMode ? 'Combat Race Mode' : 'Pure Race Mode'}
                </h1>
                <p className="text-xs text-slate-300">
                  Steer with <strong className="text-white">W/A/S/D</strong>,{' '}
                  <strong className="text-white">Left Shift</strong> for Nitro
                  Boost.{' '}
                  {combatMode && (
                    <>
                      Fire Machine Gun with{' '}
                      <strong className="text-amber-300">Space / Left Click</strong>{' '}
                      and Homing Missiles with{' '}
                      <strong className="text-rose-400">F / Right Click</strong>.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={handleStartOrToggleRace}
                className="px-5 py-2.5 text-sm font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Launch Grid</span>
              </button>
            </div>
          </div>
        )}

        {raceStatus === 'countdown' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
            <div className="px-8 py-5 rounded-2xl bg-[#0B0F19]/92 border border-white/15 text-center shadow-2xl">
              <p className="text-xs font-medium text-slate-400 mb-1">
                Watch Gantry Lights
              </p>
              <div className="font-display text-6xl font-bold text-amber-400 font-mono-tabular">
                {telemetry.countdownValue}
              </div>
            </div>
          </div>
        )}

        {raceStatus === 'paused' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65 p-4">
            <div className="max-w-md w-full rounded-xl bg-[#0B0F19] border border-white/15 p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h2 className="font-display text-xl font-bold text-white">
                  Session Paused
                </h2>
                <span className="text-xs text-slate-400 font-mono-tabular">
                  Lap {telemetry.lap} of {telemetry.totalLaps}
                </span>
              </div>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span>Current Position</span>
                  <span className="font-mono-tabular font-semibold text-amber-400">
                    P{telemetry.position} / {telemetry.totalCars}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span>Combat Mode</span>
                  <button
                    type="button"
                    onClick={() => setCombatMode((prev) => !prev)}
                    className={`px-2.5 py-0.5 rounded font-semibold cursor-pointer ${
                      combatMode
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-white/10 text-slate-300'
                    }`}
                  >
                    {combatMode ? 'Active (Weapons Enabled)' : 'Off (Pure Race)'}
                  </button>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span>Current Lap Time</span>
                  <span className="font-mono-tabular text-white">
                    {formatLapTime(telemetry.currentLapTimeMs)}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Best Lap Time</span>
                  <span className="font-mono-tabular text-cyan-400">
                    {formatLapTime(telemetry.bestLapTimeMs)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRaceStatus('racing')}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap cursor-pointer"
                >
                  Resume Session
                </button>
                <button
                  type="button"
                  onClick={handleResetRace}
                  className="py-2.5 px-4 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors whitespace-nowrap cursor-pointer"
                >
                  Restart Grid
                </button>
              </div>
            </div>
          </div>
        )}

        {raceStatus === 'finished' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
            <div className="max-w-lg w-full rounded-xl bg-[#0B0F19] border border-white/15 p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs text-amber-400 font-medium">
                    Checkered Flag · {currentTrackConfig.name}
                  </p>
                  <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2 mt-0.5">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <span>
                      Finished P{telemetry.position} Overall
                    </span>
                  </h2>
                </div>
                <div className="text-right font-mono-tabular">
                  <div className="text-xs text-slate-400">Best Lap</div>
                  <div className="text-sm font-bold text-cyan-400">
                    {formatLapTime(telemetry.bestLapTimeMs)}
                  </div>
                </div>
              </div>

              {/* Final Classification Table */}
              <div className="space-y-1.5">
                {telemetry.standings.map((row) => (
                  <div
                    key={row.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono-tabular ${
                      row.isPlayer
                        ? 'bg-amber-400/15 border border-amber-400/40 text-white font-semibold'
                        : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-5 text-slate-400">
                        P{row.position}
                      </span>
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: row.colorHex }}
                      />
                      <span className="font-sans">{row.driverName}</span>
                      <span className="text-slate-500">· {row.teamCode}</span>
                    </div>
                    <span>
                      {row.position === 1
                        ? 'Leader'
                        : `+${row.gapSeconds.toFixed(2)}s`}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 gap-3">
                <button
                  type="button"
                  onClick={handleCycleTrack}
                  className="py-2.5 px-4 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors whitespace-nowrap cursor-pointer"
                >
                  Next Circuit
                </button>
                <button
                  type="button"
                  onClick={handleResetRace}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap cursor-pointer"
                >
                  Race Again
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: LIVE STANDINGS OR CONTROLS HELP */}
        {activeModal && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 w-full max-w-md px-4">
            <div className="rounded-xl bg-[#0B0F19]/96 border border-white/15 p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="font-display text-base font-bold text-white">
                  {activeModal === 'standings'
                    ? 'Live Circuit Classification'
                    : 'Simulator Controls & Combat'}
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  aria-label="Close panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {activeModal === 'standings' ? (
                <div className="space-y-2">
                  {telemetry.standings.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono-tabular ${
                        item.isPlayer
                          ? 'bg-amber-400/15 border border-amber-400/40 text-white font-semibold'
                          : 'bg-white/5 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 text-slate-400">
                          P{item.position}
                        </span>
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: item.colorHex }}
                        />
                        <span className="font-sans">{item.driverName}</span>
                      </div>
                      <span>
                        {item.position === 1
                          ? 'Interval'
                          : `+${item.gapSeconds.toFixed(2)}s`}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 flex items-center justify-between text-xs text-slate-400 border-t border-white/10">
                    <span>Race Distance</span>
                    <div className="flex items-center gap-1.5">
                      {[3, 5, 10].map((laps) => (
                        <button
                          key={laps}
                          type="button"
                          onClick={() => setTotalLaps(laps)}
                          className={`px-2.5 py-1 rounded text-xs font-mono-tabular cursor-pointer ${
                            totalLaps === laps
                              ? 'bg-amber-400 text-slate-950 font-bold'
                              : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          {laps} Laps
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Accelerate / Brake</span>
                    <span className="font-mono-tabular text-white">
                      W / S or Up / Down Arrows
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Steer Left / Right</span>
                    <span className="font-mono-tabular text-white">
                      A / D or Left / Right Arrows
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Machine Gun (4 HP)</span>
                    <span className="font-mono-tabular text-amber-400">
                      Space or Left Mouse Button
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Homing Missile (35 HP)</span>
                    <span className="font-mono-tabular text-rose-400">
                      F Key or Right Mouse Button
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Nitro Boost Turbine</span>
                    <span className="font-mono-tabular text-cyan-400">
                      Left Shift (or Space in Pure Race)
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Mute / Unmute Audio</span>
                    <span className="font-mono-tabular text-white">M Key</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/5">
                    <span className="text-slate-400">Cycle Camera View</span>
                    <span className="font-mono-tabular text-white">C Key</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Re-Center / Hide Dock</span>
                    <span className="font-mono-tabular text-white">
                      R Key / H Key
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK */}
        <div
          style={{
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'min(960px, 96vw)',
          }}
          className="fixed z-20 w-full flex flex-col items-center pointer-events-none"
        >
          {/* Collapse / Expand Cinema Zen Mode Toggle Tab */}
          <button
            type="button"
            onClick={() => setIsDockCollapsed((prev) => !prev)}
            className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1 rounded-t-lg bg-[#0B0F19] border border-b-0 border-white/15 text-[11px] font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isDockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
                <span>Show Telemetry & Controls (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
                <span>Hide Controls · Cinema Mode (H)</span>
              </>
            )}
          </button>

          {/* Main Dock Container */}
          {!isDockCollapsed && (
            <div className="pointer-events-auto w-full rounded-xl bg-[#0B0F19]/95 border border-white/15 px-4 py-3 shadow-2xl flex flex-col gap-3">
              {/* Row 1: Speedometer + RPM/Nitro Bars + Touch Driving & Weapon Pedals */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Digital Speedometer & Gear Indicator */}
                <div className="flex items-center gap-3.5 shrink-0">
                  <div className="w-11 h-11 rounded-lg bg-white/5 border border-white/10 flex flex-col items-center justify-center">
                    <span className="text-[10px] text-slate-400 leading-none">
                      GEAR
                    </span>
                    <span
                      className={`font-display text-xl font-bold leading-tight font-mono-tabular ${
                        isRedline ? 'text-rose-400' : 'text-amber-400'
                      }`}
                    >
                      {telemetry.gear}
                    </span>
                  </div>

                  <div className="min-w-[116px]">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-display text-3xl font-bold tracking-tight text-white font-mono-tabular">
                        {telemetry.speedKmh}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-400">
                        KM/H
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono-tabular">
                      <span>{telemetry.rpm.toLocaleString()} RPM</span>
                      {(telemetry.isSliding || telemetry.isTyreScrubbing) && (
                        <span
                          className={`font-semibold ${
                            telemetry.isSliding
                              ? 'text-rose-400'
                              : 'text-amber-400'
                          }`}
                        >
                          · {telemetry.isSliding ? 'Slide' : 'Tyre Scrub'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* RPM & Nitro Telemetry Bars */}
                <div className="flex-1 min-w-[170px] max-w-xs space-y-2">
                  {/* Tachometer Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono-tabular">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Gauge className="w-3 h-3 text-amber-400" />
                        Tachometer
                      </span>
                      <span
                        className={
                          telemetry.isSliding
                            ? 'text-rose-400 font-bold'
                            : telemetry.isTyreScrubbing
                              ? 'text-amber-400 font-semibold'
                              : isRedline
                                ? 'text-rose-400 font-bold'
                                : 'text-slate-300'
                        }
                      >
                        {telemetry.isSliding
                          ? 'SLIDE'
                          : telemetry.isTyreScrubbing
                            ? 'TYRE SCRUB'
                            : isRedline
                              ? 'SHIFT REDLINE'
                              : 'OPTIMAL POWER'}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full transition-transform duration-75 origin-left ${
                          isRedline
                            ? 'bg-rose-500'
                            : rpmRatio > 0.72
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                        }`}
                        style={{ transform: `scaleX(${rpmRatio})` }}
                      />
                    </div>
                  </div>

                  {/* Nitro Boost Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono-tabular">
                      <span className="text-slate-400">Nitro Reserve</span>
                      <span className="text-cyan-400 font-semibold">
                        {telemetry.nitro}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-transform duration-75 origin-left"
                        style={{
                          transform: `scaleX(${telemetry.nitro / 100})`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* On-Screen Interactive Steering, Throttle, Brake, Nitro & Combat Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onPointerDown={() => setTouchInput('left', true)}
                    onPointerUp={() => setTouchInput('left', false)}
                    onPointerLeave={() => setTouchInput('left', false)}
                    className="px-2.5 py-2 rounded-lg bg-white/8 hover:bg-white/15 active:bg-amber-400 active:text-slate-950 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => setTouchInput('right', true)}
                    onPointerUp={() => setTouchInput('right', false)}
                    onPointerLeave={() => setTouchInput('right', false)}
                    className="px-2.5 py-2 rounded-lg bg-white/8 hover:bg-white/15 active:bg-amber-400 active:text-slate-950 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => setTouchInput('brake', true)}
                    onPointerUp={() => setTouchInput('brake', false)}
                    onPointerLeave={() => setTouchInput('brake', false)}
                    className="px-2.5 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-xs font-semibold text-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Brake
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => setTouchInput('throttle', true)}
                    onPointerUp={() => setTouchInput('throttle', false)}
                    onPointerLeave={() => setTouchInput('throttle', false)}
                    className="px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-xs font-semibold text-emerald-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Throttle
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => {
                      setTouchInput('throttle', true);
                      setTouchInput('nitro', true);
                    }}
                    onPointerUp={() => {
                      setTouchInput('throttle', false);
                      setTouchInput('nitro', false);
                    }}
                    onPointerLeave={() => {
                      setTouchInput('throttle', false);
                      setTouchInput('nitro', false);
                    }}
                    className="px-2.5 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/35 border border-cyan-400/40 text-xs font-semibold text-cyan-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Nitro
                  </button>
                  {combatMode && (
                    <>
                      <button
                        type="button"
                        onPointerDown={() => setTouchInput('fireMg', true)}
                        onPointerUp={() => setTouchInput('fireMg', false)}
                        onPointerLeave={() => setTouchInput('fireMg', false)}
                        className="px-2.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-xs font-semibold text-amber-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        MG
                      </button>
                      <button
                        type="button"
                        onPointerDown={() => setTouchInput('fireMissile', true)}
                        onPointerUp={() => setTouchInput('fireMissile', false)}
                        onPointerLeave={() =>
                          setTouchInput('fireMissile', false)
                        }
                        className="px-2.5 py-2 rounded-lg bg-rose-500/25 hover:bg-rose-500/40 border border-rose-400/50 text-xs font-semibold text-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Missile ({telemetry.missileAmmo})
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Hairline Divider */}
              <div className="h-px w-full bg-white/10" />

              {/* Row 2: Livery Swatches, Combat Toggle, Track Environment, Camera View, and Audio Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                {/* Livery Paint Swatches */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 whitespace-nowrap">
                    Livery:
                  </span>
                  <div className="flex items-center gap-1.5">
                    {CAR_LIVERIES.map((item) => {
                      const active = item.id === livery.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setLivery(item)}
                          title={item.name}
                          className={`w-6 h-6 rounded-md border transition-transform cursor-pointer ${
                            active
                              ? 'border-white scale-110 ring-2 ring-amber-400/50'
                              : 'border-white/20 opacity-80 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: item.primaryHex }}
                          aria-label={`Select ${item.name} livery`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Combat Mode, AI Difficulty & Permanent Elimination Controls */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCombatMode((prev) => !prev)}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                      combatMode
                        ? 'bg-rose-500/20 border-rose-500/45 text-rose-300'
                        : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>{combatMode ? 'Combat: ON' : 'Pure Race'}</span>
                  </button>

                  {combatMode && (
                    <button
                      type="button"
                      onClick={() =>
                        setCombatDifficulty((prev) =>
                          prev === 'easy'
                            ? 'normal'
                            : prev === 'normal'
                              ? 'hard'
                              : 'easy'
                        )
                      }
                      className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono-tabular text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer uppercase"
                      title="Cycle AI Combat Difficulty (Easy / Normal / Hard)"
                    >
                      AI: {combatDifficulty}
                    </button>
                  )}

                  {combatMode && (
                    <button
                      type="button"
                      onClick={() => setPermanentElimination((prev) => !prev)}
                      className={`px-2 py-1.5 rounded-lg border text-xs font-mono-tabular transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        permanentElimination
                          ? 'bg-rose-500/25 border-rose-400/50 text-rose-200 font-semibold'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                      }`}
                      title="Toggle Permanent Rival Elimination (no respawn)"
                    >
                      Perm. Elim: {permanentElimination ? 'ON' : 'OFF'}
                    </button>
                  )}
                </div>

                {/* Track Environment Segmented Selector */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10 shrink-0">
                  <Compass className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1" />
                  {(['canyon', 'midnight', 'alpine'] as TrackTheme[]).map(
                    (themeKey) => (
                      <button
                        key={themeKey}
                        type="button"
                        onClick={() => setTrackTheme(themeKey)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          trackTheme === themeKey
                            ? 'bg-amber-400 text-slate-950 font-semibold'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {themeKey === 'canyon'
                          ? 'Canyon GP'
                          : themeKey === 'midnight'
                            ? 'Midnight Bay'
                            : 'Alpine Ring'}
                      </button>
                    )
                  )}
                </div>

                {/* Camera Mode Segmented Selector */}
                <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10 shrink-0">
                  <Camera className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1" />
                  {(['chase', 'hood', 'aerial'] as CameraMode[]).map((cam) => (
                    <button
                      key={cam}
                      type="button"
                      onClick={() => setCameraMode(cam)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer capitalize ${
                        cameraMode === cam
                          ? 'bg-white text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {cam} Cam
                    </button>
                  ))}
                </div>

                {/* Audio (Mute Button + Master Volume Slider) & Quick Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                    <button
                      type="button"
                      onClick={handleToggleMute}
                      className="p-1 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      title={
                        isMuted
                          ? 'Unmute Audio (M)'
                          : 'Mute Audio (M)'
                      }
                      aria-label={
                        isMuted
                          ? 'Unmute Audio (M)'
                          : 'Mute Audio (M)'
                      }
                    >
                      {isMuted || masterVolume === 0 ? (
                        <VolumeX className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-emerald-400" />
                      )}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={isMuted ? 0 : masterVolume}
                      onChange={handleVolumeChange}
                      aria-label="Master Volume"
                      title={`Master Volume: ${Math.round((isMuted ? 0 : masterVolume) * 100)}%`}
                      className="w-16 h-1.5 accent-amber-400 bg-white/15 rounded-lg cursor-pointer"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveModal((prev) =>
                        prev === 'controls' ? null : 'controls'
                      )
                    }
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Keyboard Shortcuts"
                    aria-label="Keyboard Shortcuts"
                  >
                    <Keyboard className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleResetRace}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Reset Race Grid"
                    aria-label="Reset Race Grid"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  {raceStatus === 'racing' && (
                    <button
                      type="button"
                      onClick={() => setRaceStatus('paused')}
                      className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                      title="Pause Race"
                      aria-label="Pause Race"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
