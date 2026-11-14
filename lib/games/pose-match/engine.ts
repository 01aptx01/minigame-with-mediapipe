import type {
  JointKey,
  JointTriplet,
  NormalizedLandmark,
  PlayerId,
  Point2D,
  PoseGameMode,
  PoseGamePhase,
  PoseGameState,
  PoseKind,
  PosePlayerState,
  PoseTemplate,
  SabotageKind,
} from './types';

export const POSE_ROUND_DURATION_SEC = 60;
export const OVERDRIVE_THRESHOLD_SEC = 15;
export const SABOTAGE_DURATION_SEC = 4.0;
export const MATCH_THRESHOLD_PERCENT = 80;
export const JOINT_TOLERANCE_DEG = 30;
export const FAKEOUT_TRIGGER_HOLD_SEC = 0.65;
export const FAKEOUT_DODGE_TIMEOUT_SEC = 3.5;

export const KEY_JOINTS: JointTriplet[] = [
  { key: 'left_shoulder', a: 23, b: 11, c: 13 },
  { key: 'right_shoulder', a: 24, b: 12, c: 14 },
  { key: 'left_elbow', a: 11, b: 13, c: 15 },
  { key: 'right_elbow', a: 12, b: 14, c: 16 },
  { key: 'left_hip', a: 11, b: 23, c: 25 },
  { key: 'right_hip', a: 12, b: 24, c: 26 },
  { key: 'left_knee', a: 23, b: 25, c: 27 },
  { key: 'right_knee', a: 24, b: 26, c: 28 },
];

export const POSE_SKELETON_SEGMENTS: Array<[number, number]> = [
  [11, 12], // shoulders
  [11, 23], // left torso
  [12, 24], // right torso
  [23, 24], // hips
  [11, 13],
  [13, 15], // left arm
  [12, 14],
  [14, 16], // right arm
  [23, 25],
  [25, 27], // left leg
  [24, 26],
  [26, 28], // right leg
];

export function computeJointAngleDeg(a: Point2D, b: Point2D, c: Point2D): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);

  if (mag1 < 1e-5 || mag2 < 1e-5) {
    return 0;
  }

  const dot = v1x * v2x + v1y * v2y;
  const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

export function extractJointAngles(
  landmarks: Record<number, Point2D> | NormalizedLandmark[]
): Record<JointKey, number> | null {
  const result = {} as Record<JointKey, number>;
  for (const joint of KEY_JOINTS) {
    const a = landmarks[joint.a];
    const b = landmarks[joint.b];
    const c = landmarks[joint.c];
    if (!a || !b || !c) {
      return null;
    }
    result[joint.key] = computeJointAngleDeg(a, b, c);
  }
  return result;
}

function buildPoseTemplate(
  kind: PoseKind,
  label: string,
  isFakeout: boolean,
  skeletonPoints: Record<number, Point2D>
): PoseTemplate {
  const targetAngles = extractJointAngles(skeletonPoints);
  if (!targetAngles) {
    throw new Error(`Invalid skeleton definition for pose ${kind}`);
  }
  return {
    kind,
    label,
    isFakeout,
    skeletonPoints,
    targetAngles,
  };
}

// Canonical pose outlines in normalized [-1, 1] local space (0,0 = torso center)
export const POSE_TEMPLATES: PoseTemplate[] = [
  buildPoseTemplate('star', 'Star Pose', false, {
    0: { x: 0, y: -0.68 },
    11: { x: -0.18, y: -0.4 },
    12: { x: 0.18, y: -0.4 },
    13: { x: -0.46, y: -0.62 },
    14: { x: 0.46, y: -0.62 },
    15: { x: -0.72, y: -0.82 },
    16: { x: 0.72, y: -0.82 },
    23: { x: -0.14, y: 0.05 },
    24: { x: 0.14, y: 0.05 },
    25: { x: -0.32, y: 0.48 },
    26: { x: 0.32, y: 0.48 },
    27: { x: -0.48, y: 0.9 },
    28: { x: 0.48, y: 0.9 },
  }),
  buildPoseTemplate('t_pose', 'T-Pose', false, {
    0: { x: 0, y: -0.68 },
    11: { x: -0.18, y: -0.4 },
    12: { x: 0.18, y: -0.4 },
    13: { x: -0.5, y: -0.4 },
    14: { x: 0.5, y: -0.4 },
    15: { x: -0.82, y: -0.4 },
    16: { x: 0.82, y: -0.4 },
    23: { x: -0.13, y: 0.06 },
    24: { x: 0.13, y: 0.06 },
    25: { x: -0.14, y: 0.48 },
    26: { x: 0.14, y: 0.48 },
    27: { x: -0.15, y: 0.9 },
    28: { x: 0.15, y: 0.9 },
  }),
  buildPoseTemplate('tree', 'Tree Pose', false, {
    0: { x: 0, y: -0.68 },
    11: { x: -0.18, y: -0.4 },
    12: { x: 0.18, y: -0.4 },
    13: { x: -0.28, y: -0.7 },
    14: { x: 0.28, y: -0.7 },
    15: { x: -0.06, y: -0.94 },
    16: { x: 0.06, y: -0.94 },
    23: { x: -0.13, y: 0.06 },
    24: { x: 0.13, y: 0.06 },
    25: { x: -0.13, y: 0.48 },
    26: { x: 0.44, y: 0.26 },
    27: { x: -0.13, y: 0.9 },
    28: { x: 0.12, y: 0.48 },
  }),
  buildPoseTemplate('superhero', 'Superhero', false, {
    0: { x: 0, y: -0.68 },
    11: { x: -0.18, y: -0.4 },
    12: { x: 0.18, y: -0.4 },
    13: { x: -0.4, y: -0.18 },
    14: { x: 0.34, y: -0.68 },
    15: { x: -0.18, y: 0.04 },
    16: { x: 0.48, y: -0.94 },
    23: { x: -0.14, y: 0.06 },
    24: { x: 0.14, y: 0.06 },
    25: { x: -0.28, y: 0.48 },
    26: { x: 0.28, y: 0.48 },
    27: { x: -0.34, y: 0.9 },
    28: { x: 0.34, y: 0.9 },
  }),
  buildPoseTemplate('squat', 'Power Squat', false, {
    0: { x: 0, y: -0.52 },
    11: { x: -0.18, y: -0.26 },
    12: { x: 0.18, y: -0.26 },
    13: { x: -0.46, y: -0.22 },
    14: { x: 0.46, y: -0.22 },
    15: { x: -0.62, y: -0.42 },
    16: { x: 0.62, y: -0.42 },
    23: { x: -0.16, y: 0.18 },
    24: { x: 0.16, y: 0.18 },
    25: { x: -0.36, y: 0.46 },
    26: { x: 0.36, y: 0.46 },
    27: { x: -0.32, y: 0.88 },
    28: { x: 0.32, y: 0.88 },
  }),
  buildPoseTemplate('fakeout', 'FAKE-OUT!', true, {
    0: { x: 0, y: -0.68 },
    11: { x: -0.18, y: -0.4 },
    12: { x: 0.18, y: -0.4 },
    13: { x: 0.05, y: -0.18 },
    14: { x: -0.05, y: -0.18 },
    15: { x: 0.22, y: -0.42 },
    16: { x: -0.22, y: -0.42 },
    23: { x: -0.13, y: 0.06 },
    24: { x: 0.13, y: 0.06 },
    25: { x: -0.26, y: 0.46 },
    26: { x: 0.26, y: 0.46 },
    27: { x: -0.08, y: 0.88 },
    28: { x: 0.08, y: 0.88 },
  }),
];

export const VALID_POSES = POSE_TEMPLATES.filter((p) => !p.isFakeout);
export const FAKEOUT_POSE = POSE_TEMPLATES.find((p) => p.isFakeout)!;

export function scorePoseMatchPercent(
  observedAngles: Record<JointKey, number>,
  target: PoseTemplate
): number {
  let totalScore = 0;
  for (const joint of KEY_JOINTS) {
    const actual = observedAngles[joint.key];
    const desired = target.targetAngles[joint.key];
    const diff = Math.abs(actual - desired);

    // Within ±30° maps directly to 80%–100%; beyond 30° falls smoothly toward 0%
    const jointScore =
      diff <= JOINT_TOLERANCE_DEG
        ? 100 - (diff / JOINT_TOLERANCE_DEG) * 20
        : Math.max(0, 80 - ((diff - JOINT_TOLERANCE_DEG) / 60) * 80);
    totalScore += jointScore;
  }
  return Math.round(totalScore / KEY_JOINTS.length);
}

export function assignPoseToZone(
  landmarks: NormalizedLandmark[],
  mode: PoseGameMode,
  mirror: boolean = true
): PlayerId {
  if (mode === 'solo') return 'p1';
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  let normX = 0.5;
  if (leftHip && rightHip) {
    normX = (leftHip.x + rightHip.x) * 0.5;
  } else if (leftShoulder && rightShoulder) {
    normX = (leftShoulder.x + rightShoulder.x) * 0.5;
  }

  const screenX = mirror ? 1 - normX : normX;
  return screenX < 0.5 ? 'p1' : 'p2';
}

export function getHoldRequirementSec(mode: PoseGameMode, overdrive: boolean): number {
  if (overdrive) return 1.0;
  return mode === '1v1' ? 1.5 : 2.0;
}

export function computePoseTugRatio(
  mode: PoseGameMode,
  p1MatchPercent: number,
  p2MatchPercent: number
): number {
  if (mode === 'solo') {
    return Math.max(0, Math.min(1, p1MatchPercent / 100));
  }
  const diff = p1MatchPercent - p2MatchPercent;
  const ratio = 0.5 + (diff / 100) * 0.44;
  return Math.max(0.08, Math.min(0.92, ratio));
}

export function pickNextPose(
  currentKind: PoseKind,
  allowFakeout: boolean = true,
  rng: () => number = Math.random
): PoseTemplate {
  if (allowFakeout && !currentKind.includes('fakeout') && rng() < 0.16) {
    return FAKEOUT_POSE;
  }
  const candidates = VALID_POSES.filter((p) => p.kind !== currentKind);
  const idx = Math.floor(rng() * candidates.length);
  return candidates[idx] ?? VALID_POSES[0];
}

function createInitialPosePlayerState(initialPose: PoseTemplate): PosePlayerState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    posesMatched: 0,
    fakeoutsHit: 0,
    peakAccuracy: 0,
    matchPercent: 0,
    holdProgress: 0,
    currentPose: initialPose,
    fakeoutElapsed: 0,
    sabotageKind: null,
    sabotageRemaining: 0,
    calloutText: '',
    calloutColor: '#FFFFFF',
    calloutLife: 0,
  };
}

export function createInitialPoseGameState(
  phase: PoseGamePhase = 'title',
  mode: PoseGameMode = '1v1'
): PoseGameState {
  return {
    phase,
    mode,
    timeRemaining: POSE_ROUND_DURATION_SEC,
    elapsed: 0,
    overdrive: false,
    overdriveJustStarted: false,
    p1: createInitialPosePlayerState(VALID_POSES[0]),
    p2: createInitialPosePlayerState(VALID_POSES[1]),
    screenShake: 0,
    lastTickSecond: POSE_ROUND_DURATION_SEC,
    bestScoreForMvp: 0,
  };
}

export interface PlayerStepOutcome {
  matchedPose: boolean;
  triggeredFakeout: boolean;
  dodgedFakeout: boolean;
  triggeredSabotageOn: PlayerId | null;
  sabotageKind: SabotageKind | null;
  awardedPoints: number;
  poseLabel: string;
  accuracy: number;
}

function stepSinglePlayerPose(
  playerState: PosePlayerState,
  opponentState: PosePlayerState | null,
  playerId: PlayerId,
  mode: PoseGameMode,
  overdrive: boolean,
  dt: number,
  rng: () => number
): PlayerStepOutcome {
  const outcome: PlayerStepOutcome = {
    matchedPose: false,
    triggeredFakeout: false,
    dodgedFakeout: false,
    triggeredSabotageOn: null,
    sabotageKind: null,
    awardedPoints: 0,
    poseLabel: playerState.currentPose.label,
    accuracy: playerState.matchPercent,
  };

  if (playerState.sabotageRemaining > 0) {
    playerState.sabotageRemaining = Math.max(0, playerState.sabotageRemaining - dt);
    if (playerState.sabotageRemaining === 0) {
      playerState.sabotageKind = null;
    }
  }

  if (playerState.calloutLife > 0) {
    playerState.calloutLife = Math.max(0, playerState.calloutLife - dt);
  }

  if (playerState.matchPercent > playerState.peakAccuracy) {
    playerState.peakAccuracy = playerState.matchPercent;
  }

  const isFakeout = playerState.currentPose.isFakeout;
  if (isFakeout) {
    playerState.fakeoutElapsed += dt;

    if (playerState.matchPercent >= MATCH_THRESHOLD_PERCENT) {
      playerState.holdProgress += dt / FAKEOUT_TRIGGER_HOLD_SEC;
      if (playerState.holdProgress >= 1) {
        playerState.score = Math.max(0, playerState.score - 75);
        playerState.combo = 0;
        playerState.fakeoutsHit += 1;
        playerState.holdProgress = 0;
        playerState.fakeoutElapsed = 0;
        playerState.calloutText = '-75 FAKE-OUT!';
        playerState.calloutColor = '#EF4444';
        playerState.calloutLife = 1.1;
        playerState.currentPose = pickNextPose('fakeout', false, rng);
        outcome.triggeredFakeout = true;
        return outcome;
      }
    } else {
      playerState.holdProgress = Math.max(0, playerState.holdProgress - dt * 0.55);
      if (playerState.fakeoutElapsed >= FAKEOUT_DODGE_TIMEOUT_SEC) {
        const dodgeBonus = overdrive ? 50 : 25;
        playerState.score += dodgeBonus;
        playerState.holdProgress = 0;
        playerState.fakeoutElapsed = 0;
        playerState.calloutText = `DODGED +${dodgeBonus}`;
        playerState.calloutColor = '#10B981';
        playerState.calloutLife = 0.9;
        playerState.currentPose = pickNextPose('fakeout', false, rng);
        outcome.dodgedFakeout = true;
        return outcome;
      }
    }
    return outcome;
  }

  // Standard valid pose hold-to-score race
  const holdReq = getHoldRequirementSec(mode, overdrive);
  if (playerState.matchPercent >= MATCH_THRESHOLD_PERCENT) {
    playerState.holdProgress = Math.min(1, playerState.holdProgress + dt / holdReq);
    if (playerState.holdProgress >= 1) {
      playerState.combo += 1;
      if (playerState.combo > playerState.maxCombo) {
        playerState.maxCombo = playerState.combo;
      }
      playerState.posesMatched += 1;

      const basePoints = 100 + (playerState.combo - 1) * 15;
      const points = overdrive ? basePoints * 2 : basePoints;
      playerState.score += points;
      playerState.holdProgress = 0;
      playerState.calloutText = overdrive ? `+${points} (2X!)` : `+${points}`;
      playerState.calloutColor = playerId === 'p1' ? '#00E5FF' : '#FF2A6D';
      playerState.calloutLife = 1.0;

      outcome.matchedPose = true;
      outcome.awardedPoints = points;

      // Landing a 3-pose combo triggers sabotage on opponent in 1v1 mode
      if (mode === '1v1' && opponentState && playerState.combo % 3 === 0) {
        const sabKind: SabotageKind = rng() < 0.5 ? 'fog' : 'mirror';
        opponentState.sabotageKind = sabKind;
        opponentState.sabotageRemaining = SABOTAGE_DURATION_SEC;
        outcome.triggeredSabotageOn = playerId === 'p1' ? 'p2' : 'p1';
        outcome.sabotageKind = sabKind;
      }

      playerState.currentPose = pickNextPose(playerState.currentPose.kind, true, rng);
    }
  } else {
    // Decay hold progress gradually rather than instant reset
    playerState.holdProgress = Math.max(0, playerState.holdProgress - dt * 0.55);
  }

  return outcome;
}

export interface PoseSimulationOutcome {
  roundEnded: boolean;
  tickSecond: number | null;
  overdriveStarted: boolean;
  p1Outcome: PlayerStepOutcome;
  p2Outcome: PlayerStepOutcome | null;
}

export function stepPoseSimulation(
  state: PoseGameState,
  rawDt: number,
  rng: () => number = Math.random
): PoseSimulationOutcome {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const emptyOutcome: PlayerStepOutcome = {
    matchedPose: false,
    triggeredFakeout: false,
    dodgedFakeout: false,
    triggeredSabotageOn: null,
    sabotageKind: null,
    awardedPoints: 0,
    poseLabel: state.p1.currentPose.label,
    accuracy: state.p1.matchPercent,
  };

  if (state.phase !== 'playing') {
    return {
      roundEnded: false,
      tickSecond: null,
      overdriveStarted: false,
      p1Outcome: emptyOutcome,
      p2Outcome: null,
    };
  }

  if (state.screenShake > 0) {
    state.screenShake = Math.max(0, state.screenShake - dt * 36);
  }

  state.elapsed += dt;
  state.timeRemaining = Math.max(0, state.timeRemaining - dt);

  let overdriveStarted = false;
  if (!state.overdrive && state.timeRemaining <= OVERDRIVE_THRESHOLD_SEC) {
    state.overdrive = true;
    overdriveStarted = true;
  }

  let tickSecond: number | null = null;
  const ceilSec = Math.ceil(state.timeRemaining);
  if (ceilSec < state.lastTickSecond) {
    state.lastTickSecond = ceilSec;
    if (ceilSec <= 5 && ceilSec >= 1) {
      tickSecond = ceilSec;
    }
  }

  const p1Outcome = stepSinglePlayerPose(
    state.p1,
    state.mode === '1v1' ? state.p2 : null,
    'p1',
    state.mode,
    state.overdrive,
    dt,
    rng
  );

  const p2Outcome =
    state.mode === '1v1'
      ? stepSinglePlayerPose(
          state.p2,
          state.p1,
          'p2',
          state.mode,
          state.overdrive,
          dt,
          rng
        )
      : null;

  if (
    p1Outcome.matchedPose ||
    p1Outcome.triggeredFakeout ||
    p2Outcome?.matchedPose ||
    p2Outcome?.triggeredFakeout
  ) {
    state.screenShake = Math.max(state.screenShake, 10);
  }

  if (state.timeRemaining <= 0) {
    state.phase = 'gameover';
    return {
      roundEnded: true,
      tickSecond,
      overdriveStarted,
      p1Outcome,
      p2Outcome,
    };
  }

  return {
    roundEnded: false,
    tickSecond,
    overdriveStarted,
    p1Outcome,
    p2Outcome,
  };
}

export function determinePoseWinner(
  mode: PoseGameMode,
  p1Score: number,
  p2Score: number
): PlayerId | 'draw' | 'solo' {
  if (mode === 'solo') return 'solo';
  if (p1Score > p2Score) return 'p1';
  if (p2Score > p1Score) return 'p2';
  return 'draw';
}
