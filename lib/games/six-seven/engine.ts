export interface SixSevenLandmark {
  x: number;
  y: number;
  visibility?: number;
}

export type SixSevenSide = 'left' | 'right';
export type SixSevenNumber = 6 | 7;

export interface SixSevenHit {
  number: SixSevenNumber;
  side: SixSevenSide;
  /** Raw, unmirrored MediaPipe normalized coordinates. */
  x: number;
  y: number;
  atMs: number;
}

interface WristTrack {
  filteredY: number;
  anchorY: number;
  armed: boolean;
  moving: boolean;
  pending: boolean;
}

export interface SixSevenState {
  score: number;
  tracking: {
    lastSampleAtMs: number | null;
    left: WristTrack | null;
    right: WristTrack | null;
  };
}

// Landmark 15 is the player's anatomical left wrist. The stage mirrors the
// camera, so it appears on screen-left; landmark 16 appears on screen-right.
const WRIST_INDEX: Record<SixSevenSide, number> = { left: 15, right: 16 };
const SIDE_NUMBER: Record<SixSevenSide, SixSevenNumber> = { left: 6, right: 7 };
const MIN_VISIBILITY = 0.42;
const POP_TRAVEL = 0.02;
const REARM_TRAVEL = 0.015;
const MIN_MOTION_STEP = 0.007;
const FILTER_TIME_CONSTANT_MS = 12;
const TRACKING_GAP_MS = 180;

export function createSixSevenState(): SixSevenState {
  return {
    score: 0,
    tracking: { lastSampleAtMs: null, left: null, right: null },
  };
}

/** Clear camera motion history without changing the score. */
export function resetSixSevenTracking(state: SixSevenState): void {
  state.tracking = { lastSampleAtMs: null, left: null, right: null };
}

function recordPop(
  state: SixSevenState,
  side: SixSevenSide,
  x: number,
  y: number,
  nowMs: number
): SixSevenHit {
  state.score += 1;
  return { number: SIDE_NUMBER[side], side, x, y, atMs: nowMs };
}

export function registerSixSevenPracticeHit(
  state: SixSevenState,
  side: SixSevenSide,
  nowMs: number
): SixSevenHit {
  // Practice positions use the same fixed display-side mapping as the camera.
  return recordPop(state, side, side === 'left' ? 0.67 : 0.33, 0.62, nowMs);
}

type Pose = readonly SixSevenLandmark[] | null | undefined;

function visible(landmark: SixSevenLandmark | undefined): landmark is SixSevenLandmark {
  return !!landmark &&
    Number.isFinite(landmark.x) && landmark.x >= 0 && landmark.x <= 1 &&
    Number.isFinite(landmark.y) && landmark.y >= 0 && landmark.y <= 1 &&
    (landmark.visibility === undefined ||
      (Number.isFinite(landmark.visibility) && landmark.visibility >= MIN_VISIBILITY));
}

export function getSixSevenWrist(pose: Pose, side: SixSevenSide): SixSevenLandmark | null {
  const wrist = pose?.[WRIST_INDEX[side]];
  return visible(wrist) ? wrist : null;
}

function readWrists(pose: Pose) {
  const leftWrist = getSixSevenWrist(pose, 'left');
  const rightWrist = getSixSevenWrist(pose, 'right');
  if (!leftWrist && !rightWrist) return null;
  return { leftWrist, rightWrist };
}

export function isSixSevenPoseVisible(pose: Pose): boolean {
  return readWrists(pose) !== null;
}

function advanceWrist(
  previous: WristTrack | null,
  rawY: number,
  elapsedMs: number
): { track: WristTrack; travel: number } {
  if (!previous) {
    return { track: { filteredY: rawY, anchorY: rawY, armed: true, moving: false, pending: false }, travel: 0 };
  }

  const alpha = 1 - Math.exp(-elapsedMs / FILTER_TIME_CONSTANT_MS);
  const filteredY = previous.filteredY + (rawY - previous.filteredY) * alpha;
  // In image coordinates, a smaller y value means the wrist moved upward.
  const step = previous.filteredY - filteredY;
  const rising = step >= MIN_MOTION_STEP;
  const upperY = Math.max(filteredY, rawY);

  if (!previous.armed) {
    const peak = Math.min(previous.anchorY, filteredY);
    const falling = step <= -MIN_MOTION_STEP;
    const resetReady = Math.min(filteredY, rawY) - peak >= REARM_TRAVEL;
    const armed = resetReady && (previous.pending || (previous.moving && falling));
    const anchorY = armed ? Math.max(previous.filteredY, filteredY) : peak;
    return {
      track: {
        filteredY,
        anchorY,
        armed,
        moving: armed ? rising : falling,
        pending: armed ? anchorY - upperY >= POP_TRAVEL : resetReady,
      },
      travel: 0,
    };
  }

  const anchorY = Math.max(previous.anchorY, filteredY);
  const travel = anchorY - upperY;
  const pending = travel >= POP_TRAVEL;
  // Two rising samples confirm a fast stroke. If the entire lift landed in
  // one sample, a second sample above the threshold rejects a one-frame spike.
  if (pending && ((previous.moving && rising) || previous.pending)) {
    return { track: { filteredY, anchorY: filteredY, armed: false, moving: false, pending: false }, travel };
  }

  return { track: { filteredY, anchorY, armed: true, moving: rising, pending }, travel: 0 };
}

/** Each wrist scores an upward stroke independently; lowering it rearms it. */
export function updateSixSevenGesture(
  state: SixSevenState,
  pose: Pose,
  nowMs: number,
  scoringEnabled = true
): SixSevenHit[] {
  if (!Number.isFinite(nowMs)) return [];
  const tracking = state.tracking;
  const elapsedMs = tracking.lastSampleAtMs === null ? 0 : nowMs - tracking.lastSampleAtMs;
  if (tracking.lastSampleAtMs !== null && elapsedMs <= 0) return [];
  tracking.lastSampleAtMs = nowMs;

  const wrists = readWrists(pose);
  if (elapsedMs > TRACKING_GAP_MS) {
    tracking.left = null;
    tracking.right = null;
  }
  if (!wrists) {
    tracking.left = null;
    tracking.right = null;
    return [];
  }

  // Each wrist has its own baseline and rearm state. A hidden wrist is reset
  // by itself, leaving the other wrist playable through temporary occlusion.
  const left = wrists.leftWrist && advanceWrist(tracking.left, wrists.leftWrist.y, elapsedMs);
  const right = wrists.rightWrist && advanceWrist(tracking.right, wrists.rightWrist.y, elapsedMs);
  tracking.left = left?.track ?? null;
  tracking.right = right?.track ?? null;
  if (!scoringEnabled) return [];

  const hits: SixSevenHit[] = [];
  if (left && left.travel > 0 && wrists.leftWrist) {
    hits.push(recordPop(state, 'left', wrists.leftWrist.x, wrists.leftWrist.y, nowMs));
  }
  if (right && right.travel > 0 && wrists.rightWrist) {
    hits.push(recordPop(state, 'right', wrists.rightWrist.x, wrists.rightWrist.y, nowMs));
  }
  return hits;
}
