export type MuncherMode = '1v1' | 'solo';
export type MuncherPhase = 'title' | 'playing' | 'paused' | 'gameover';
export type PlayerId = 'p1' | 'p2';

export type FallingItemKind = 'burger' | 'ramen' | 'donut' | 'boba' | 'chili' | 'bomb';
export type ShameTrigger = 'wide_munch' | 'bomb_face';

export interface NormalizedFaceLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface FaceMouthAnalysis {
  zone: PlayerId;
  mouthX: number;
  mouthY: number;
  mouthWidthPx: number;
  mouthGapPx: number;
  mouthOpenRatio: number; // 0 (closed) .. 1 (wide open)
  isMouthOpen: boolean;
  headTiltRad: number;
  faceCenterX: number;
  faceCenterY: number;
  faceRadiusPx: number;
}

export interface FallingItem {
  id: number;
  kind: FallingItemKind;
  zone: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  rotation: number;
  vr: number;
  points: number;
  isBomb: boolean;
  active: boolean;
}

export interface MuncherPlayerState {
  score: number;
  combo: number;
  maxCombo: number;
  itemsMunched: number;
  bombsDeflected: number;
  bombsEaten: number;
  peakMouthPct: number;
  feverTimer: number;
  stunTimer: number;
  mouthXNorm: number; // 0..1 within zone
  mouthYNorm: number; // 0..1 within canvas height
  mouthOpenRatio: number; // 0..1
  isMouthOpen: boolean;
  headTiltRad: number;
  comboTimeout: number;
  calloutText: string;
  calloutColor: string;
  calloutLife: number;
}

export interface ShameSnapshot {
  dataUrl: string;
  player: PlayerId;
  trigger: ShameTrigger;
  caption: string;
  mouthPct: number;
  points: number;
  zoneX: number;
  zoneW: number;
}

export interface MuncherGameState {
  phase: MuncherPhase;
  mode: MuncherMode;
  timeRemaining: number;
  spawnTimer: number;
  nextItemId: number;
  screenShake: number;
  hitstopTimer: number;
  bestShameScore: number;
  items: FallingItem[];
  p1: MuncherPlayerState;
  p2: MuncherPlayerState;
}

export interface MuncherSimEvent {
  munchedBy: Array<{ player: PlayerId; kind: FallingItemKind; x: number; y: number; points: number; fever: boolean }>;
  deflectedBy: Array<{ player: PlayerId; x: number; y: number }>;
  bombedBy: Array<{ player: PlayerId; x: number; y: number }>;
  shameCandidate: {
    player: PlayerId;
    trigger: ShameTrigger;
    caption: string;
    mouthPct: number;
    points: number;
    priority: number;
  } | null;
  tickSecond: number | null;
  roundEnded: boolean;
}

export interface MuncherEndSummary {
  winner: PlayerId | 'draw' | 'solo';
  mode: MuncherMode;
  p1: MuncherPlayerState;
  p2: MuncherPlayerState;
  shameSnapshot: ShameSnapshot | null;
}
