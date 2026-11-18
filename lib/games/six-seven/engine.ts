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

interface RelativePose {
  leftY: number;
  rightY: number;
  leftX: number;
  leftRawY: number;
  rightX: number;
  rightRawY: number;
}

interface SixSevenTrackingState {
  lastSampleAtMs: number | null;
  filteredPose: RelativePose | null;
  stableSide: SixSevenSide | null;
  stableAnchor: RelativePose | null;
  neutralSinceMs: number | null;
  neutralSamples: number;
  candidateSide: SixSevenSide | null;
  candidateSinceMs: number | null;
  candidateSamples: number;
}

export interface SixSevenState {
  score: number;
  nextNumber: SixSevenNumber;
  /** Internal pose history. Use resetSixSevenTracking when changing input modes. */
  tracking: SixSevenTrackingState;
}

const MIN_LANDMARK_VISIBILITY = 0.45;
const MIN_SHOULDER_WIDTH = 0.06;
const SIDE_ENTER_THRESHOLD = 0.3;
const SIDE_EXIT_THRESHOLD = 0.18;
const MIN_WRIST_TRAVEL = 0.15;
// Keep roughly the same smoothing in real time at 24, 30, and 60 fps. A
// fixed EMA coefficient made high frame rates sluggish and low frame rates
// overly reactive.
const FILTER_TIME_CONSTANT_MS = 30;
const SIDE_CONFIRM_MS = 30;
const TRACKING_GAP_RESET_MS = 650;

function emptyTrackingState(): SixSevenTrackingState {
  return {
    lastSampleAtMs: null,
    filteredPose: null,
    stableSide: null,
    stableAnchor: null,
    neutralSinceMs: null,
    neutralSamples: 0,
    candidateSide: null,
    candidateSinceMs: null,
    candidateSamples: 0,
  };
}

export function createSixSevenState(): SixSevenState {
  return {
    score: 0,
    nextNumber: 6,
    tracking: emptyTrackingState(),
  };
}

/**
 * Drop only camera-derived history. Score and the next call stay intact, so a
 * resume or input-mode change always reacquires a baseline without a free hit.
 */
export function resetSixSevenTracking(state: SixSevenState): void {
  state.tracking = emptyTrackingState();
}

function sideForNumber(number: SixSevenNumber): SixSevenSide {
  return number === 6 ? 'left' : 'right';
}

function recordExpectedHit(
  state: SixSevenState,
  side: SixSevenSide,
  x: number,
  y: number,
  nowMs: number
): SixSevenHit | null {
  if (side !== sideForNumber(state.nextNumber)) return null;

  const hit: SixSevenHit = {
    number: state.nextNumber,
    side,
    x,
    y,
    atMs: nowMs,
  };
  state.score += 1;
  state.nextNumber = state.nextNumber === 6 ? 7 : 6;
  return hit;
}

/**
 * Score an intentional keyboard/touch practice answer without camera history.
 * The fixed raw x positions become screen-left and screen-right after mirroring.
 */
export function registerSixSevenPracticeHit(
  state: SixSevenState,
  side: SixSevenSide,
  nowMs: number
): SixSevenHit | null {
  return recordExpectedHit(state, side, side === 'left' ? 0.67 : 0.33, 0.62, nowMs);
}

function readRelativePose(pose: readonly SixSevenLandmark[] | null | undefined): RelativePose | null {
  if (!pose) return null;
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const leftWrist = pose[15];
  const rightWrist = pose[16];
  if (!leftShoulder || !rightShoulder || !leftWrist || !rightWrist) return null;

  const landmarks = [leftShoulder, rightShoulder, leftWrist, rightWrist];
  if (
    landmarks.some(
      (landmark) =>
        !Number.isFinite(landmark.x) ||
        !Number.isFinite(landmark.y) ||
        landmark.x < 0 ||
        landmark.x > 1 ||
        landmark.y < 0 ||
        landmark.y > 1 ||
        (landmark.visibility !== undefined &&
          (!Number.isFinite(landmark.visibility) || landmark.visibility < MIN_LANDMARK_VISIBILITY))
    )
  ) {
    return null;
  }

  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  if (shoulderWidth < MIN_SHOULDER_WIDTH) return null;

  return {
    // Reference each wrist to its own shoulder. A shoulder roll can move the
    // wrists in opposite image-space directions even when the arms stay fixed
    // relative to the torso; this removes that body-only motion.
    leftY: (leftWrist.y - leftShoulder.y) / shoulderWidth,
    rightY: (rightWrist.y - rightShoulder.y) / shoulderWidth,
    leftX: leftWrist.x,
    leftRawY: leftWrist.y,
    rightX: rightWrist.x,
    rightRawY: rightWrist.y,
  };
}

/**
 * Return whether all landmarks needed by the seesaw detector are usable.
 * Readiness and scoring share this validation so the camera can never report
 * ready for a pose that the gesture engine would immediately discard.
 */
export function isSixSevenPoseVisible(
  pose: readonly SixSevenLandmark[] | null | undefined
): boolean {
  return readRelativePose(pose) !== null;
}

function smoothPose(
  previous: RelativePose | null,
  current: RelativePose,
  elapsedMs: number
): RelativePose {
  if (!previous) return current;
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / FILTER_TIME_CONSTANT_MS);
  const mix = (before: number, after: number) => before + (after - before) * alpha;
  return {
    leftY: mix(previous.leftY, current.leftY),
    rightY: mix(previous.rightY, current.rightY),
    // Keep output landmarks fresh; only relative y values need motion filtering.
    leftX: current.leftX,
    leftRawY: current.leftRawY,
    rightX: current.rightX,
    rightRawY: current.rightRawY,
  };
}

function classifySide(pose: RelativePose, previousSide: SixSevenSide | null): SixSevenSide | null {
  const separation = pose.rightY - pose.leftY;
  if (previousSide === 'left') {
    if (separation <= -SIDE_ENTER_THRESHOLD) return 'right';
    if (separation >= SIDE_EXIT_THRESHOLD) return 'left';
    return null;
  }
  if (previousSide === 'right') {
    if (separation >= SIDE_ENTER_THRESHOLD) return 'left';
    if (separation <= -SIDE_EXIT_THRESHOLD) return 'right';
    return null;
  }
  if (separation >= SIDE_ENTER_THRESHOLD) return 'left';
  if (separation <= -SIDE_ENTER_THRESHOLD) return 'right';
  return null;
}

function hasOppositeWristTravel(
  from: RelativePose,
  to: RelativePose,
  targetSide: SixSevenSide
): boolean {
  const leftDelta = to.leftY - from.leftY;
  const rightDelta = to.rightY - from.rightY;
  if (targetSide === 'right') {
    return leftDelta >= MIN_WRIST_TRAVEL && rightDelta <= -MIN_WRIST_TRAVEL;
  }
  return leftDelta <= -MIN_WRIST_TRAVEL && rightDelta >= MIN_WRIST_TRAVEL;
}

function clearCandidate(state: SixSevenState): void {
  state.tracking.candidateSide = null;
  state.tracking.candidateSinceMs = null;
  state.tracking.candidateSamples = 0;
}

function advanceCandidate(state: SixSevenState, side: SixSevenSide, nowMs: number): boolean {
  if (state.tracking.candidateSide !== side) {
    state.tracking.candidateSide = side;
    state.tracking.candidateSinceMs = nowMs;
    state.tracking.candidateSamples = 1;
    return false;
  }

  state.tracking.candidateSamples += 1;
  const candidateSince = state.tracking.candidateSinceMs ?? nowMs;
  return (
    state.tracking.candidateSamples >= 2 &&
    nowMs - candidateSince >= SIDE_CONFIRM_MS
  );
}

function commitSide(
  state: SixSevenState,
  side: SixSevenSide,
  current: RelativePose,
  rawPose: RelativePose,
  nowMs: number,
  scoringEnabled: boolean
): SixSevenHit | null {
  const sourceAnchor = state.tracking.stableAnchor;
  const travelWasOpposite =
    sourceAnchor !== null && hasOppositeWristTravel(sourceAnchor, current, side);

  state.tracking.stableSide = side;
  state.tracking.stableAnchor = current;
  clearCandidate(state);

  if (!scoringEnabled || !travelWasOpposite) return null;
  const hitX = side === 'left' ? rawPose.leftX : rawPose.rightX;
  const hitY = side === 'left' ? rawPose.leftRawY : rawPose.rightRawY;
  return recordExpectedHit(state, side, hitX, hitY, nowMs);
}

/**
 * Update the seesaw detector once per fresh MediaPipe pose result. A null pose
 * breaks continuity and reacquires a baseline on the next visible detection.
 * Set scoringEnabled to false during a countdown to warm up tracking without
 * changing score or nextNumber.
 */
export function updateSixSevenGesture(
  state: SixSevenState,
  pose: readonly SixSevenLandmark[] | null | undefined,
  nowMs: number,
  scoringEnabled = true
): SixSevenHit | null {
  if (!Number.isFinite(nowMs)) {
    resetSixSevenTracking(state);
    return null;
  }

  const relativePose = readRelativePose(pose);
  if (!relativePose) {
    resetSixSevenTracking(state);
    return null;
  }

  const tracking = state.tracking;
  let elapsedMs = tracking.lastSampleAtMs === null
    ? 0
    : nowMs - tracking.lastSampleAtMs;
  if (
    tracking.lastSampleAtMs !== null &&
    (nowMs < tracking.lastSampleAtMs || nowMs - tracking.lastSampleAtMs > TRACKING_GAP_RESET_MS)
  ) {
    resetSixSevenTracking(state);
    elapsedMs = 0;
  }

  const current = smoothPose(state.tracking.filteredPose, relativePose, elapsedMs);
  const previousStableSide = state.tracking.stableSide;
  const observedSide = classifySide(current, previousStableSide);
  state.tracking.filteredPose = current;
  state.tracking.lastSampleAtMs = nowMs;

  // The first settled pose only establishes the starting side. It never scores.
  if (previousStableSide === null) {
    if (observedSide === null) {
      clearCandidate(state);
      if (state.tracking.stableAnchor === null) {
        if (state.tracking.neutralSinceMs === null) {
          state.tracking.neutralSinceMs = nowMs;
          state.tracking.neutralSamples = 1;
        } else {
          state.tracking.neutralSamples += 1;
          if (
            state.tracking.neutralSamples >= 2 &&
            nowMs - state.tracking.neutralSinceMs >= SIDE_CONFIRM_MS
          ) {
            // A settled, level start is a valid motion origin. The first true
            // left-up/right-down travel can therefore earn the opening 6.
            state.tracking.stableAnchor = current;
          }
        }
      }
      return null;
    }

    state.tracking.neutralSinceMs = null;
    state.tracking.neutralSamples = 0;

    const hasNeutralBaseline = state.tracking.stableAnchor !== null;
    if (!advanceCandidate(state, observedSide, nowMs)) return null;
    if (hasNeutralBaseline) {
      return commitSide(state, observedSide, current, relativePose, nowMs, scoringEnabled);
    }

    state.tracking.stableSide = observedSide;
    state.tracking.stableAnchor = current;
    clearCandidate(state);
    return null;
  }

  if (observedSide === previousStableSide) {
    clearCandidate(state);
    // Keep the start point at the last clearly held source-side pose. Once the
    // arms leave the source lane, this anchor remains fixed for travel checks.
    state.tracking.stableAnchor = current;
    return null;
  }

  if (observedSide === null) {
    clearCandidate(state);
    return null;
  }

  if (!advanceCandidate(state, observedSide, nowMs)) return null;
  return commitSide(state, observedSide, current, relativePose, nowMs, scoringEnabled);
}
