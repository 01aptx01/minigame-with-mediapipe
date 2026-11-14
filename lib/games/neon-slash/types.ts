import type {
  HandLandmarkerResult as MediaPipeHandLandmarkerResult,
  NormalizedLandmark as MediaPipeNormalizedLandmark,
} from '@mediapipe/tasks-vision';

export type HandLandmarkerResult = MediaPipeHandLandmarkerResult;
export type NormalizedLandmark = MediaPipeNormalizedLandmark;

export type PlayerId = 'p1' | 'p2';

export type SlashGameMode = '1v1' | 'solo';

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type TargetKind = 'p1_gem' | 'p2_gem' | 'skull_bomb' | 'sabotage_orb';

export interface Target {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  angularVelocity: number;
  sliced: boolean;
  hitFlash: number;
  pulsePhase: number;
}

export interface SlicedHalf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  angularVelocity: number;
  color: string;
  kind: TargetKind;
  side: -1 | 1;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface BladeTrailPoint {
  x: number;
  y: number;
  time: number;
}

export interface HandBlade {
  handKey: string;
  player: PlayerId;
  points: BladeTrailPoint[];
  lastSeenTime: number;
}

export interface FloatingCallout {
  id: number;
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface PlayerStats {
  score: number;
  combo: number;
  maxCombo: number;
  multiplier: number;
  lastSliceElapsed: number;
  ownSlices: number;
  penaltyHits: number;
  sabotagesSent: number;
  sabotageRemaining: number;
}

export interface GameState {
  phase: GamePhase;
  mode: SlashGameMode;
  timeRemaining: number;
  elapsed: number;
  p1: PlayerStats;
  p2: PlayerStats;
  targets: Target[];
  slicedHalves: SlicedHalf[];
  callouts: FloatingCallout[];
  nextTargetId: number;
  nextCalloutId: number;
  spawnCooldown: number;
  hitstopTimer: number;
  screenShake: number;
  lastTickSecond: number;
}

export interface EndGameSummary {
  winner: PlayerId | 'draw' | 'solo';
  mode: SlashGameMode;
  p1: PlayerStats;
  p2: PlayerStats;
}
