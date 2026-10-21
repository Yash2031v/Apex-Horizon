export type TrackTheme = 'canyon' | 'midnight' | 'alpine';

export type CameraMode = 'chase' | 'hood' | 'aerial';

export type RaceStatus = 'ready' | 'countdown' | 'racing' | 'paused' | 'finished';

export type CombatDifficulty = 'easy' | 'normal' | 'hard';

export type CarBodyVariant = 'coupe' | 'widebody' | 'race';

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
  variant?: CarBodyVariant;
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
    id: 'pearl-white',
    name: 'Pearl White GT',
    code: 'PWT',
    primaryHex: '#E8E8EC',
    secondaryHex: '#0F141D',
    accentHex: '#DC2626',
    rimHex: '#E2E8F0',
    metalness: 0.18,
    roughness: 0.2,
    clearcoat: 1.0,
    variant: 'coupe',
  },
  {
    id: 'rosso-corsa',
    name: 'Crimson Widebody',
    code: 'CRM',
    primaryHex: '#E11D48',
    secondaryHex: '#0F141D',
    accentHex: '#F59E0B',
    rimHex: '#E2E8F0',
    metalness: 0.52,
    roughness: 0.18,
    clearcoat: 1.0,
    variant: 'widebody',
  },
  {
    id: 'cobalt-blue',
    name: 'Cobalt Track Spec',
    code: 'CBL',
    primaryHex: '#2563EB',
    secondaryHex: '#0F141D',
    accentHex: '#38BDF8',
    rimHex: '#F1F5F9',
    metalness: 0.58,
    roughness: 0.17,
    clearcoat: 1.0,
    variant: 'race',
  },
  {
    id: 'obsidian-black',
    name: 'Obsidian Widebody',
    code: 'OBS',
    primaryHex: '#141821',
    secondaryHex: '#090D14',
    accentHex: '#EF4444',
    rimHex: '#CBD5E1',
    metalness: 0.68,
    roughness: 0.18,
    clearcoat: 1.0,
    variant: 'widebody',
  },
  {
    id: 'solar-orange',
    name: 'Solar Race GT',
    code: 'SLR',
    primaryHex: '#F97316',
    secondaryHex: '#090D16',
    accentHex: '#FACC15',
    rimHex: '#E2E8F0',
    metalness: 0.48,
    roughness: 0.19,
    clearcoat: 1.0,
    variant: 'race',
  },
  {
    id: 'liquid-silver',
    name: 'Liquid Silver Coupe',
    code: 'SLV',
    primaryHex: '#CBD5E1',
    secondaryHex: '#0A0F1A',
    accentHex: '#DC2626',
    rimHex: '#F8FAFC',
    metalness: 0.78,
    roughness: 0.17,
    clearcoat: 1.0,
    variant: 'coupe',
  },
];

export const TRACK_CONFIGS: Record<TrackTheme, TrackConfig> = {
  canyon: {
    id: 'canyon',
    name: 'Red Rock Canyon GP',
    location: 'Nevada Sector · 2.4 km',
    lengthKm: '2.40 km',
    skyHex: '#D96B43',
    fogHex: '#C85A48',
    fogDensity: 0.0014,
    groundHex: '#8C4F2B',
    sunColorHex: '#FF9E6D',
    sunIntensity: 1.65,
    hemiSkyHex: '#C084FC',
    hemiGroundHex: '#33243B',
    hemiIntensity: 0.65,
    curbPrimaryHex: '#B91C1C',
    curbSecondaryHex: '#D6D3CD',
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
    sunIntensity: 1.15,
    hemiSkyHex: '#1E3A8A',
    hemiGroundHex: '#090D16',
    hemiIntensity: 0.6,
    curbPrimaryHex: '#0284C7',
    curbSecondaryHex: '#CBD5E1',
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
    sunIntensity: 1.85,
    hemiSkyHex: '#93C5FD',
    hemiGroundHex: '#1E293B',
    hemiIntensity: 0.72,
    curbPrimaryHex: '#B91C1C',
    curbSecondaryHex: '#D4D8DF',
    headlightsActive: false,
  },
};

