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
  nextNumber: SixSevenNumber;
  tracking: {
    lastSampleAtMs: number | null;
    lastPopAtMs: number;
    left: WristTrack | null;
    right: WristTrack | null;
  };
}

const WRIST_INDEX: Record<SixSevenSide, number> = { left: 15, right: 16 };
const MIN_VISIBILITY = 0.42;
const MIN_SHOULDER_WIDTH = 0.045;
const POP_TRAVEL = 0.085;
const REARM_TRAVEL = 0.065;
const MIN_MOTION_STEP = 0.035;
const FILTER_TIME_CONSTANT_MS = 12;
const MIN_POP_INTERVAL_MS = 55;
const TRACKING_GAP_MS = 180;

export function createSixSevenState(): SixSevenState {
  return {
    score: 0,
    nextNumber: 6,
    tracking: { lastSampleAtMs: null, lastPopAtMs: -Infinity, left: null, right: null },
  };
}

/** Clear camera motion history without changing the score or the next number. */
export function resetSixSevenTracking(state: SixSevenState): void {
  state.tracking = { lastSampleAtMs: null, lastPopAtMs: -Infinity, left: null, right: null };
}

function recordPop(
  state: SixSevenState,
  side: SixSevenSide,
  x: number,
  y: number,
  nowMs: number
): SixSevenHit {
  const hit = { number: state.nextNumber, side, x, y, atMs: nowMs };
  state.score += 1;
  state.nextNumber = state.nextNumber === 6 ? 7 : 6;
  return hit;
}

export function registerSixSevenPracticeHit(
  state: SixSevenState,
  side: SixSevenSide,
  nowMs: number
): SixSevenHit {
  // Practice positions become screen-left and screen-right after mirroring.
  return recordPop(state, side, side === 'left' ? 0.67 : 0.33, 0.62, nowMs);
}

type Pose = readonly SixSevenLandmark[] | null | undefined;

function visible(landmark: SixSevenLandmark | undefined): landmark is SixSevenLandmark {
  return !!landmark &&
    landmark.x >= 0 && landmark.x <= 1 &&
    landmark.y >= 0 && landmark.y <= 1 &&
    (landmark.visibility === undefined ||
      (Number.isFinite(landmark.visibility) && landmark.visibility >= MIN_VISIBILITY));
}

export function getSixSevenWrist(pose: Pose, side: SixSevenSide): SixSevenLandmark | null {
  const wrist = pose?.[WRIST_INDEX[side]];
  return visible(wrist) ? wrist : null;
}

function readPose(pose: Pose) {
  const leftShoulder = pose?.[11];
  const rightShoulder = pose?.[12];
  if (!visible(leftShoulder) || !visible(rightShoulder)) return null;
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  if (shoulderWidth < MIN_SHOULDER_WIDTH) return null;

  const leftWrist = getSixSevenWrist(pose, 'left');
  const rightWrist = getSixSevenWrist(pose, 'right');
  if (!leftWrist && !rightWrist) return null;
  return { leftShoulder, rightShoulder, shoulderWidth, leftWrist, rightWrist };
}

export function isSixSevenPoseVisible(pose: Pose): boolean {
  return readPose(pose) !== null;
}

function advanceWrist(
  previous: WristTrack | null,
  relativeY: number,
  shoulderSpan: number,
  elapsedMs: number
): { track: WristTrack; travel: number } {
  const rawY = relativeY / shoulderSpan;
  if (!previous) {
    return { track: { filteredY: rawY, anchorY: rawY, armed: true, moving: false, pending: false }, travel: 0 };
  }

  const alpha = 1 - Math.exp(-elapsedMs / FILTER_TIME_CONSTANT_MS);
  const filteredY = previous.filteredY + (rawY - previous.filteredY) * alpha;
  const step = previous.filteredY - filteredY;
  const rising = step >= MIN_MOTION_STEP;
  const popTravel = Math.max(POP_TRAVEL, 0.009 / shoulderSpan);
  const upperY = Math.max(filteredY, rawY);

  if (!previous.armed) {
    const peak = Math.min(previous.anchorY, filteredY);
    const falling = step <= -MIN_MOTION_STEP;
    const resetReady = Math.min(filteredY, rawY) - peak >= Math.max(REARM_TRAVEL, 0.007 / shoulderSpan);
    const armed = resetReady && (previous.pending || (previous.moving && falling));
    const anchorY = armed ? Math.max(previous.filteredY, filteredY) : peak;
    return {
      track: {
        filteredY,
        anchorY,
        armed,
        moving: armed ? rising : falling,
        pending: armed ? anchorY - upperY >= popTravel : resetReady,
      },
      travel: 0,
    };
  }

  const anchorY = Math.max(previous.anchorY, filteredY);
  const travel = anchorY - upperY;
  const pending = travel >= popTravel;
  // Two rising samples confirm a fast stroke. If the entire lift landed in
  // one sample, a second sample above the threshold rejects a one-frame spike.
  if (pending && ((previous.moving && rising) || previous.pending)) {
    return { track: { filteredY, anchorY: filteredY, armed: false, moving: false, pending: false }, travel };
  }

  return { track: { filteredY, anchorY, armed: true, moving: rising, pending }, travel: 0 };
}

/** Each deliberate upward stroke can pop. Lower that wrist to arm its next pop. */
export function updateSixSevenGesture(
  state: SixSevenState,
  pose: Pose,
  nowMs: number,
  scoringEnabled = true,
  videoAspect = 1
): SixSevenHit | null {
  if (!Number.isFinite(nowMs)) return null;
  const tracking = state.tracking;
  const elapsedMs = tracking.lastSampleAtMs === null ? 0 : nowMs - tracking.lastSampleAtMs;
  if (tracking.lastSampleAtMs !== null && elapsedMs <= 0) return null;
  tracking.lastSampleAtMs = nowMs;

  const body = readPose(pose);
  if (!body || elapsedMs > TRACKING_GAP_MS) {
    tracking.left = null;
    tracking.right = null;
  }
  if (!body) return null;

  // Convert horizontal span to the same units as vertical wrist displacement.
  // Each shoulder is its own origin, so translating or rolling the body alone
  // does not turn into an upward stroke.
  const aspect = Number.isFinite(videoAspect) && videoAspect > 0 ? videoAspect : 1;
  const shoulderSpan = body.shoulderWidth * aspect;
  const left = body.leftWrist && advanceWrist(
    tracking.left, body.leftWrist.y - body.leftShoulder.y, shoulderSpan, elapsedMs
  );
  const right = body.rightWrist && advanceWrist(
    tracking.right, body.rightWrist.y - body.rightShoulder.y, shoulderSpan, elapsedMs
  );
  tracking.left = left?.track ?? null;
  tracking.right = right?.track ?? null;

  // Hands that rise together produce one pop, including on adjacent frames.
  const leftTravel = left?.travel ?? 0;
  const rightTravel = right?.travel ?? 0;
  if (!scoringEnabled || nowMs - tracking.lastPopAtMs < MIN_POP_INTERVAL_MS ||
      (leftTravel === 0 && rightTravel === 0)) return null;

  const side = leftTravel >= rightTravel ? 'left' : 'right';
  const wrist = side === 'left' ? body.leftWrist : body.rightWrist;
  if (!wrist) return null;

  tracking.lastPopAtMs = nowMs;
  return recordPop(state, side, wrist.x, wrist.y, nowMs);
}
