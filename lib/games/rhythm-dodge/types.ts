import type { NormalizedLandmark } from '@/lib/games/pose-match/types';
import type { ArcadePhase } from '@/components/arcade/ArcadeGameShell';
import type { ScoreboardMode } from '@/lib/games/shared/scoreboard';

export type { NormalizedLandmark };
export type PlayerId = 'p1' | 'p2';
export type DodgeGamePhase = ArcadePhase;
export type DodgeGameMode = ScoreboardMode;

export type LaserPattern = 'high_bar' | 'left_wall' | 'right_wall' | 'split_gate';
export type BodyStance = 'standing' | 'ducking' | 'lean_left' | 'lean_right';

export interface BodyBox {
  minX: number; // Normalized [0, 1] within player zone
  maxX: number;
  minY: number; // Normalized [0, 1] vertically
  maxY: number;
  centerX: number;
  centerY: number;
  stance: BodyStance;
  fromLivePose: boolean;
}

export interface LaserRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface LaserObstacle {
  id: number;
  zone: PlayerId;
  pattern: LaserPattern;
  label: string;
  rect: LaserRect;
  spawnTime: number;
  hitTime: number;
  z: number; // 1.0 (far horizon) -> 0.0 (player plane)
  resolved: boolean;
  wasHit: boolean;
  color: string;
}

export interface DodgePlayerState {
  hp: number;
  maxHp: number;
  score: number;
  combo: number;
  maxCombo: number;
  dodgedCount: number;
  hitsTaken: number;
  eliminated: boolean;
  invulnTimer: number;
  hitFlashTimer: number;
  bodyBox: BodyBox;
  calloutText: string;
  calloutColor: string;
  calloutLife: number;
}

export interface DodgeGameState {
  phase: DodgeGamePhase;
  mode: DodgeGameMode;
  timeRemaining: number;
  elapsed: number;
  bpm: number;
  beatPhase: number; // 0..1 continuous beat pulse
  lastBeatStep: number;
  overdrive: boolean;
  p1: DodgePlayerState;
  p2: DodgePlayerState;
  lasers: LaserObstacle[];
  nextLaserId: number;
  nextSpawnBeat: number;
  screenShake: number;
  hitstopTimer: number;
  lastTickSecond: number;
}

export interface DodgeEndSummary {
  winner: PlayerId | 'draw' | 'solo' | 'eliminated';
  mode: DodgeGameMode;
  survivedFullSong: boolean;
  p1: DodgePlayerState;
  p2: DodgePlayerState;
}
