import type { ArcadePhase } from '@/components/arcade/ArcadeGameShell';
import type { NormalizedLandmark } from '@/lib/games/neon-slash/types';
import type { ScoreboardMode } from '@/lib/games/shared/scoreboard';

export type { NormalizedLandmark };
export type PlayerId = 'p1' | 'p2';
export type SorcererPhase = ArcadePhase;
export type SorcererMode = ScoreboardMode;

export type SpellKind = 'none' | 'lightning' | 'shield' | 'crit';
export type ActiveSpell = Exclude<SpellKind, 'none'>;

export interface SorcererPlayerState {
  hp: number;
  maxHp: number;
  score: number;
  wins: number;
  combo: number;
  maxCombo: number;
  activeSpell: SpellKind;
  chargeProgress: number; // 0..1 while holding Fist (crit)
  shieldActiveTimer: number; // visual shield aura
  hitFlashTimer: number;
  handCenterNorm: { x: number; y: number } | null;
  calloutText: string;
  calloutColor: string;
  calloutLife: number;
}

export interface MagicEffect {
  id: number;
  kind: 'bolt' | 'meteor' | 'reflect' | 'clash_ring';
  from: PlayerId;
  to: PlayerId;
  color: string;
  life: number;
  maxLife: number;
  seed: number;
}

export interface SorcererGameState {
  phase: SorcererPhase;
  mode: SorcererMode;
  timeRemaining: number;
  elapsed: number;
  clashCooldown: number;
  clashInterval: number;
  botDecisionTimer: number;
  botSpell: ActiveSpell;
  p1: SorcererPlayerState;
  p2: SorcererPlayerState;
  effects: MagicEffect[];
  nextEffectId: number;
  screenShake: number;
  hitstopTimer: number;
  lastTickSecond: number;
}

export interface SorcererEndSummary {
  winner: PlayerId | 'draw';
  mode: SorcererMode;
  p1: SorcererPlayerState;
  p2: SorcererPlayerState;
}
