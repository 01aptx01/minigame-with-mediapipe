import type {
  NormalizedLandmark as MediaPipeNormalizedLandmark,
  PoseLandmarkerResult as MediaPipePoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

export type PoseLandmarkerResult = MediaPipePoseLandmarkerResult;
export type NormalizedLandmark = MediaPipeNormalizedLandmark;

export type PlayerId = 'p1' | 'p2';
export type PoseGamePhase = 'title' | 'playing' | 'paused' | 'gameover';
export type PoseGameMode = '1v1' | 'solo';
export type PoseKind = 'star' | 't_pose' | 'tree' | 'superhero' | 'squat' | 'fakeout';
export type SabotageKind = 'fog' | 'mirror';

export type JointKey =
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee';

export interface JointTriplet {
  key: JointKey;
  a: number;
  b: number;
  c: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface PoseTemplate {
  kind: PoseKind;
  label: string;
  isFakeout: boolean;
  skeletonPoints: Record<number, Point2D>;
  targetAngles: Record<JointKey, number>;
}

export interface PosePlayerState {
  score: number;
  combo: number;
  maxCombo: number;
  posesMatched: number;
  fakeoutsHit: number;
  peakAccuracy: number;
  matchPercent: number;
  holdProgress: number;
  currentPose: PoseTemplate;
  fakeoutElapsed: number;
  sabotageKind: SabotageKind | null;
  sabotageRemaining: number;
  calloutText: string;
  calloutColor: string;
  calloutLife: number;
}

export interface MvpSnapshot {
  dataUrl: string;
  poseLabel: string;
  player: PlayerId;
  accuracy: number;
  points: number;
}

export interface PoseGameState {
  phase: PoseGamePhase;
  mode: PoseGameMode;
  timeRemaining: number;
  elapsed: number;
  overdrive: boolean;
  overdriveJustStarted: boolean;
  p1: PosePlayerState;
  p2: PosePlayerState;
  screenShake: number;
  lastTickSecond: number;
  bestScoreForMvp: number;
}

export interface PoseEndSummary {
  winner: PlayerId | 'draw' | 'solo';
  mode: PoseGameMode;
  p1: PosePlayerState;
  p2: PosePlayerState;
  mvpSnapshot: MvpSnapshot | null;
}
