export type TrackTheme = 'canyon' | 'midnight' | 'alpine';

export type CameraMode = 'chase' | 'hood' | 'aerial';

export type RaceStatus = 'ready' | 'countdown' | 'racing' | 'paused' | 'finished';

export type CombatDifficulty = 'easy' | 'normal' | 'hard';

export interface CarLivery {
  id: string;
  name: string;
  code: string;
  primaryHex: string;
  secondaryHex: string;
  accentHex: string;
  rimHex: string;
  metalness: number;
  roughness: number;
  clearcoat: number;
}

export interface TrackConfig {
  id: TrackTheme;
  name: string;
  location: string;
  lengthKm: string;
  skyHex: string;
  fogHex: string;
  fogDensity: number;
  groundHex: string;
  sunColorHex: string;
  sunIntensity: number;
  hemiSkyHex: string;
  hemiGroundHex: string;
  hemiIntensity: number;
  curbPrimaryHex: string;
  curbSecondaryHex: string;
  headlightsActive: boolean;
}

export interface RivalCarState {
  id: string;
  driverName: string;
  teamCode: string;
  livery: CarLivery;
  trackDistance: number; // total distance traveled along spline
  lateralOffset: number; // -roadHalfWidth to +roadHalfWidth
  targetLateral: number;
  speed: number; // m/s
  baseMaxSpeed: number;
  lap: number;
  gapSeconds: number;
  hp: number;
  maxHp: number;
  isEliminated: boolean;
  respawnTimer: number;
  hitSlowTimer: number;
  hitFlashTimer: number;
  aiFireCooldown: number;
  aiBurstRemaining: number;
  aiReloadTimer: number;
}

export interface KillFeedItem {
  id: string;
  message: string;
  timestamp: number;
  isPlayerKill: boolean;
}

export interface RivalScreenOverlay {
  id: string;
  driverName: string;
  hp: number;
  maxHp: number;
  screenX: number; // 0..100vw percentage
  screenY: number; // 0..100vh percentage
  visible: boolean;
  isLockedTarget: boolean;
  distanceMeters: number;
}

export interface RaceTelemetry {
  status: RaceStatus;
  countdownValue: number;
  speedKmh: number;
  rpm: number; // 1000 to 9000
  gear: string; // 'R', 'N', '1'..'6'
  nitro: number; // 0 to 100
  isBoosting: boolean;
  isDrifting: boolean;
  isTyreScrubbing: boolean;
  isSliding: boolean;
  isSlipstreaming: boolean;
  isOffTrack: boolean;
  scoreEventLabel: string | null;
  lap: number;
  totalLaps: number;
  position: number;
  totalCars: number;
  currentLapTimeMs: number;
  bestLapTimeMs: number | null;
  lastLapTimeMs: number | null;
  sectorIndex: number; // 0, 1, 2
  driftScore: number;
  currentDriftPoints: number;
  lapProgress: number; // 0 to 1
  // Combat Telemetry
  combatMode: boolean;
  combatDifficulty: CombatDifficulty;
  permanentElimination: boolean;
  activeRivalsCount: number;
  playerHp: number;
  playerMaxHp: number;
  isPlayerDestroyed: boolean;
  playerRespawnTimer: number;
  isPlayerInvulnerable: boolean;
  mgHeat: number; // 0 to 100
  mgOverheated: boolean;
  missileAmmo: number;
  missileMaxAmmo: number;
  missileCooldown: number;
  kills: number;
  killFeed: KillFeedItem[];
  crosshairScreen: { x: number; y: number; visible: boolean; hasLock: boolean };
  rivalOverlays: RivalScreenOverlay[];
  standings: {
    id: string;
    driverName: string;
    teamCode: string;
    isPlayer: boolean;
    position: number;
    gapSeconds: number;
    colorHex: string;
    trackDistance: number;
    lateralOffset: number;
  }[];
}

export const CAR_LIVERIES: CarLivery[] = [
  {
    id: 'rosso-corsa',
    name: 'Rosso Scuderia',
    code: 'RSC',
    primaryHex: '#E11D48',
    secondaryHex: '#0F172A',
    accentHex: '#F59E0B',
    rimHex: '#E2E8F0',
    metalness: 0.82,
    roughness: 0.18,
    clearcoat: 1.0,
  },
  {
    id: 'solar-amber',
    name: 'Papaya Works GT',
    code: 'PWK',
    primaryHex: '#F59E0B',
    secondaryHex: '#090D16',
    accentHex: '#38BDF8',
    rimHex: '#CBD5E1',
    metalness: 0.78,
    roughness: 0.22,
    clearcoat: 1.0,
  },
  {
    id: 'cyber-cyan',
    name: 'Cobalt Aero',
    code: 'CBA',
    primaryHex: '#06B6D4',
    secondaryHex: '#0F172A',
    accentHex: '#F43F5E',
    rimHex: '#F8FAFC',
    metalness: 0.88,
    roughness: 0.15,
    clearcoat: 1.0,
  },
  {
    id: 'stealth-titanium',
    name: 'Phantom Matte',
    code: 'PHM',
    primaryHex: '#334155',
    secondaryHex: '#090D16',
    accentHex: '#10B981',
    rimHex: '#94A3B8',
    metalness: 0.92,
    roughness: 0.36,
    clearcoat: 0.4,
  },
  {
    id: 'emerald-gt',
    name: 'Verde Endurance',
    code: 'VRD',
    primaryHex: '#059669',
    secondaryHex: '#0A0F1A',
    accentHex: '#FBBF24',
    rimHex: '#E2E8F0',
    metalness: 0.85,
    roughness: 0.18,
    clearcoat: 1.0,
  },
];

export const TRACK_CONFIGS: Record<TrackTheme, TrackConfig> = {
  canyon: {
    id: 'canyon',
    name: 'Red Rock Canyon GP',
    location: 'Nevada Sector · 2.4 km',
    lengthKm: '2.40 km',
    skyHex: '#2A1233',
    fogHex: '#D96B52',
    fogDensity: 0.00135,
    groundHex: '#8C4227',
    sunColorHex: '#FF9E5E',
    sunIntensity: 3.6,
    hemiSkyHex: '#FFAE73',
    hemiGroundHex: '#3D1E24',
    hemiIntensity: 1.25,
    curbPrimaryHex: '#EF4444',
    curbSecondaryHex: '#F8FAFC',
    headlightsActive: false,
  },
  midnight: {
    id: 'midnight',
    name: 'Wangan Midnight Loop',
    location: 'Tokyo Bay · 2.4 km',
    lengthKm: '2.40 km',
    skyHex: '#060913',
    fogHex: '#080D1A',
    fogDensity: 0.0032,
    groundHex: '#0B101B',
    sunColorHex: '#60A5FA',
    sunIntensity: 1.4,
    hemiSkyHex: '#1E3A8A',
    hemiGroundHex: '#090D16',
    hemiIntensity: 0.85,
    curbPrimaryHex: '#06B6D4',
    curbSecondaryHex: '#F8FAFC',
    headlightsActive: true,
  },
  alpine: {
    id: 'alpine',
    name: 'Bernese Oberland Ring',
    location: 'Swiss Alps · 2.4 km',
    lengthKm: '2.40 km',
    skyHex: '#1B2A3A',
    fogHex: '#213345',
    fogDensity: 0.0025,
    groundHex: '#1A2B23',
    sunColorHex: '#FFFBEB',
    sunIntensity: 3.4,
    hemiSkyHex: '#93C5FD',
    hemiGroundHex: '#1E293B',
    hemiIntensity: 1.25,
    curbPrimaryHex: '#EF4444',
    curbSecondaryHex: '#F8FAFC',
    headlightsActive: false,
  },
};
