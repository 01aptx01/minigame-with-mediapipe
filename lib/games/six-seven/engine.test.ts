import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSixSevenState,
  isSixSevenPoseVisible,
  registerSixSevenPracticeHit,
  resetSixSevenTracking,
  updateSixSevenGesture,
} from './engine';
import type { SixSevenLandmark, SixSevenSide } from './engine';

function makePose(
  side: SixSevenSide,
  overrides: Partial<Record<11 | 12 | 15 | 16, Partial<SixSevenLandmark>>> = {}
): SixSevenLandmark[] {
  const pose: SixSevenLandmark[] = Array.from({ length: 17 }, () => ({
    x: 0.5,
    y: 0.4,
    visibility: 1,
  }));
  pose[11] = { x: 0.4, y: 0.4, visibility: 1, ...overrides[11] };
  pose[12] = { x: 0.6, y: 0.4, visibility: 1, ...overrides[12] };
  const leftHigh = side === 'left';
  pose[15] = { x: 0.67, y: leftHigh ? 0.36 : 0.44, visibility: 1, ...overrides[15] };
  pose[16] = { x: 0.33, y: leftHigh ? 0.44 : 0.36, visibility: 1, ...overrides[16] };
  return pose;
}

function poseBetween(
  fromSide: SixSevenSide,
  toSide: SixSevenSide,
  progress: number
): SixSevenLandmark[] {
  const from = makePose(fromSide);
  const to = makePose(toSide);
  const pose = makePose(fromSide);
  for (const index of [15, 16] as const) {
    pose[index] = {
      ...pose[index],
      y: from[index].y + (to[index].y - from[index].y) * progress,
    };
  }
  return pose;
}

function holdSide(
  state: ReturnType<typeof createSixSevenState>,
  side: SixSevenSide,
  startAtMs: number,
  count = 5
): void {
  for (let i = 0; i < count; i++) {
    updateSixSevenGesture(state, makePose(side), startAtMs + i * 33);
  }
}

function holdNeutral(
  state: ReturnType<typeof createSixSevenState>,
  startAtMs: number,
  count = 5
): void {
  const levelPose = makePose('left');
  levelPose[15] = { x: 0.67, y: 0.4, visibility: 1 };
  levelPose[16] = { x: 0.33, y: 0.4, visibility: 1 };
  for (let i = 0; i < count; i++) {
    updateSixSevenGesture(state, levelPose, startAtMs + i * 33);
  }
}

function moveToSide(
  state: ReturnType<typeof createSixSevenState>,
  side: SixSevenSide,
  startAtMs: number,
  count = 8
) {
  const hits = [];
  for (let i = 0; i < count; i++) {
    const hit = updateSixSevenGesture(state, makePose(side), startAtMs + i * 33);
    if (hit) hits.push(hit);
  }
  return hits;
}

test('captures the initial side without a hit and scores only the expected alternating side', () => {
  const state = createSixSevenState();
  holdSide(state, 'left', 0);
  assert.equal(state.score, 0, 'holding the first 6 pose should not score');
  assert.equal(state.nextNumber, 6);

  const wrongFirstSide = moveToSide(state, 'right', 200);
  assert.equal(wrongFirstSide.length, 0, '7 cannot score before the first 6');
  assert.equal(state.score, 0);

  const firstSix = moveToSide(state, 'left', 500);
  assert.equal(firstSix.length, 1);
  assert.equal(firstSix[0].number, 6);
  assert.equal(firstSix[0].side, 'left');
  assert.ok(Math.abs(firstSix[0].x - 0.67) < 0.001);
  assert.equal(state.score, 1);
  assert.equal(state.nextNumber, 7);

  const seven = moveToSide(state, 'right', 800);
  assert.equal(seven.length, 1);
  assert.equal(seven[0].number, 7);
  assert.equal(seven[0].side, 'right');
  assert.ok(Math.abs(seven[0].x - 0.33) < 0.001);
  assert.equal(state.score, 2);
  assert.equal(state.nextNumber, 6);
});

test('starting on the right side still makes the first successful hit left/6', () => {
  const state = createSixSevenState();
  holdSide(state, 'right', 0);
  assert.equal(state.score, 0);

  const firstSix = moveToSide(state, 'left', 200);
  assert.equal(firstSix.length, 1);
  assert.deepEqual(
    { number: firstSix[0].number, side: firstSix[0].side },
    { number: 6, side: 'left' }
  );
  assert.equal(state.score, 1);
});

test('countdown tracking records anchors without scoring, then GO scores the first expected swing', () => {
  const state = createSixSevenState();

  for (let i = 0; i < 5; i++) {
    updateSixSevenGesture(state, makePose('right'), i * 33, false);
  }
  for (let i = 0; i < 8; i++) {
    updateSixSevenGesture(state, makePose('left'), 165 + i * 33, false);
  }
  for (let i = 0; i < 8; i++) {
    updateSixSevenGesture(state, makePose('right'), 429 + i * 33, false);
  }

  assert.equal(state.score, 0, 'countdown movements must not increase the score');
  assert.equal(state.nextNumber, 6, 'countdown movements must not consume the opening 6');

  const firstAfterGo = moveToSide(state, 'left', 700);
  assert.equal(firstAfterGo.length, 1);
  assert.deepEqual(
    { number: firstAfterGo[0].number, side: firstAfterGo[0].side },
    { number: 6, side: 'left' }
  );
  assert.equal(state.score, 1);
});

test('a settled level start can score the first left/up seesaw movement', () => {
  const state = createSixSevenState();
  holdNeutral(state, 0);
  assert.equal(state.score, 0, 'settling at level only creates a motion baseline');

  const firstSix = moveToSide(state, 'left', 200);
  assert.equal(firstSix.length, 1);
  assert.equal(firstSix[0].number, 6);
  assert.equal(firstSix[0].side, 'left');
  assert.equal(state.score, 1);
});

test('static poses and near-level jitter do not generate repeated hits', () => {
  const state = createSixSevenState();
  holdSide(state, 'left', 0);

  for (let time = 200; time < 3_000; time += 33) {
    updateSixSevenGesture(state, makePose('left'), time);
  }
  assert.equal(state.score, 0);

  // Stay below the lane threshold around level; small pose changes must not
  // create a debounced side switch.
  for (let i = 0; i < 30; i++) {
    const pose = makePose('left');
    pose[15] = { x: 0.67, y: 0.42 + (i % 2 === 0 ? 0.002 : -0.002), visibility: 1 };
    pose[16] = { x: 0.33, y: 0.42 + (i % 2 === 0 ? -0.002 : 0.002), visibility: 1 };
    updateSixSevenGesture(state, pose, 3_100 + i * 33);
  }
  assert.equal(state.score, 0);
});

test('a brief opposite-side pose that does not survive debounce is ignored', () => {
  const state = createSixSevenState();
  holdSide(state, 'right', 0);

  // A two-frame flick crosses into the opposite lane briefly, then settles
  // back on the source side before the 30 ms confirmation interval completes.
  updateSixSevenGesture(state, makePose('left'), 165);
  updateSixSevenGesture(state, makePose('left'), 198);
  for (let i = 0; i < 8; i++) updateSixSevenGesture(state, makePose('right'), 231 + i * 33);

  assert.equal(state.score, 0);
  assert.equal(state.nextNumber, 6);
});

test('pose readiness uses the same landmark and shoulder validation as scoring', () => {
  assert.equal(isSixSevenPoseVisible(makePose('left')), true);
  assert.equal(isSixSevenPoseVisible(null), false);
  assert.equal(isSixSevenPoseVisible(undefined), false);
  assert.equal(isSixSevenPoseVisible(makePose('left').slice(0, 16)), false);

  const lowConfidence = makePose('left');
  lowConfidence[16] = { ...lowConfidence[16], visibility: 0.2 };
  assert.equal(isSixSevenPoseVisible(lowConfidence), false);

  const narrowShoulders = makePose('left');
  narrowShoulders[12] = { ...narrowShoulders[12], x: 0.44 };
  assert.equal(isSixSevenPoseVisible(narrowShoulders), false);
});

test('timestamp-adaptive filtering scores a realistic seesaw sweep within 200 ms at 24, 30, and 60 fps', () => {
  const measuredLatencies: Record<number, number> = {};

  for (const fps of [24, 30, 60]) {
    const state = createSixSevenState();
    const frameMs = 1_000 / fps;
    const startMs = 1_000;
    const baselineFrames = 4;
    for (let frame = 0; frame < baselineFrames; frame++) {
      updateSixSevenGesture(state, makePose('right'), startMs + frame * frameMs);
    }

    const motionStartMs = startMs + baselineFrames * frameMs;
    let hit: ReturnType<typeof updateSixSevenGesture> = null;
    // The arms move in opposite directions over 120 ms, then stay at the
    // target endpoint while the detector confirms that the change is real.
    for (let frame = 0; frame <= fps; frame++) {
      const elapsedMs = frame * frameMs;
      const progress = Math.min(1, elapsedMs / 120);
      hit = updateSixSevenGesture(
        state,
        poseBetween('right', 'left', progress),
        motionStartMs + elapsedMs
      );
      if (hit) break;
    }

    assert.ok(hit, `${fps} fps sweep should produce its opening 6`);
    assert.equal(hit.number, 6);
    assert.equal(hit.side, 'left');
    measuredLatencies[fps] = hit.atMs - motionStartMs;
    assert.ok(
      measuredLatencies[fps] <= 200,
      `${fps} fps hit latency was ${measuredLatencies[fps]} ms`
    );
  }

  assert.deepEqual(Object.keys(measuredLatencies).sort(), ['24', '30', '60']);
});

test('fast alternating seesaw sweeps score without a neutral pose at all common frame rates', () => {
  for (const fps of [24, 30, 60]) {
    const state = createSixSevenState();
    const frameMs = 1_000 / fps;
    const motionStartMs = 4 * frameMs;
    const halfCycleMs = 180;
    const movementMs = 80;
    const hits: NonNullable<ReturnType<typeof updateSixSevenGesture>>[] = [];

    for (let frame = 0; frame < 4; frame++) {
      updateSixSevenGesture(state, makePose('right'), frame * frameMs);
    }

    for (let frame = 4; frame * frameMs - motionStartMs <= 1_080; frame++) {
      const nowMs = frame * frameMs;
      const elapsedMs = nowMs - motionStartMs;
      const cycle = Math.floor(elapsedMs / halfCycleMs);
      const fromSide: SixSevenSide = cycle % 2 === 0 ? 'right' : 'left';
      const toSide: SixSevenSide = fromSide === 'right' ? 'left' : 'right';
      const phaseMs = elapsedMs % halfCycleMs;
      const progress = Math.min(1, phaseMs / movementMs);
      const hit = updateSixSevenGesture(
        state,
        poseBetween(fromSide, toSide, progress),
        nowMs
      );
      if (hit) hits.push(hit);
    }

    assert.ok(hits.length >= 4, `${fps} fps scored only ${hits.length} rapid hits`);
    for (let index = 0; index < hits.length; index++) {
      assert.equal(hits[index].side, index % 2 === 0 ? 'left' : 'right');
      assert.equal(hits[index].number, index % 2 === 0 ? 6 : 7);
    }
    assert.ok(
      hits.slice(1).every((hit, index) => hit.atMs - hits[index].atMs <= 250),
      `${fps} fps rapid hit intervals should remain under 250 ms`
    );
  }
});

test('opposite-side endpoints without opposite wrist travel do not score', () => {
  const state = createSixSevenState();
  holdSide(state, 'right', 0);

  // The wrists both travel down. Their vertical order flips, but this is not a
  // seesaw movement because the anatomical left wrist never travels upward.
  const sameDirectionPose = (): SixSevenLandmark[] => {
    const pose = makePose('left');
    pose[15] = { x: 0.67, y: 0.46, visibility: 1 };
    pose[16] = { x: 0.33, y: 0.54, visibility: 1 };
    return pose;
  };
  for (let i = 0; i < 8; i++) {
    updateSixSevenGesture(state, sameDirectionPose(), 200 + i * 33);
  }
  assert.equal(state.score, 0);
  assert.equal(state.nextNumber, 6);
});

test('a tracking gap or invalid landmark reacquires a baseline without scoring', () => {
  const state = createSixSevenState();
  holdSide(state, 'right', 0);

  assert.equal(updateSixSevenGesture(state, null, 200), null);
  holdSide(state, 'left', 233);
  assert.equal(state.score, 0, 'the first post-gap pose is a baseline');

  const lowConfidence = makePose('right');
  lowConfidence[15] = { ...lowConfidence[15], visibility: 0.2 };
  assert.equal(updateSixSevenGesture(state, lowConfidence, 500), null);
  holdSide(state, 'right', 533);
  assert.equal(state.score, 0, 'the first valid pose after a poor frame is a baseline');

  const offFrame = makePose('left');
  offFrame[15] = { ...offFrame[15], x: 1.05 };
  assert.equal(updateSixSevenGesture(state, offFrame, 700), null);
  holdSide(state, 'left', 733);
  assert.equal(state.score, 0, 'off-frame model estimates also break continuity');

  const hit = moveToSide(state, 'right', 1_000);
  assert.equal(hit.length, 0, 'the reacquired left pose did not count as a hit');
  const recoveredSix = moveToSide(state, 'left', 1_300);
  assert.equal(recoveredSix.length, 1);
  assert.equal(recoveredSix[0].number, 6);
  assert.equal(state.score, 1);
});

test('shoulder translation and body lean shared by both wrists are normalized away', () => {
  const state = createSixSevenState();
  holdSide(state, 'right', 0);

  for (let i = 0; i < 12; i++) {
    const shift = i * 0.004;
    const pose = makePose('right');
    pose[11] = { x: 0.4 + shift, y: 0.4 + shift, visibility: 1 };
    pose[12] = { x: 0.6 + shift, y: 0.4 + shift, visibility: 1 };
    pose[15] = { x: 0.67 + shift, y: 0.46 + shift, visibility: 1 };
    pose[16] = { x: 0.33 + shift, y: 0.38 + shift, visibility: 1 };
    updateSixSevenGesture(state, pose, 200 + i * 33);
  }

  assert.equal(state.score, 0);
});

test('shoulder roll with wrists fixed to their shoulders does not count as a seesaw', () => {
  const state = createSixSevenState();
  holdNeutral(state, 0);

  for (let i = 0; i < 8; i++) {
    const roll = Math.min(0.04, i * 0.01);
    const pose = makePose('left');
    pose[11] = { x: 0.4, y: 0.4 - roll, visibility: 1 };
    pose[12] = { x: 0.6, y: 0.4 + roll, visibility: 1 };
    pose[15] = { x: 0.67, y: 0.4 - roll, visibility: 1 };
    pose[16] = { x: 0.33, y: 0.4 + roll, visibility: 1 };
    updateSixSevenGesture(state, pose, 200 + i * 33);
  }

  assert.equal(state.score, 0);
  assert.equal(state.nextNumber, 6);
});

test('long detection gaps and explicit resets keep score while clearing motion history', () => {
  const state = createSixSevenState();
  holdSide(state, 'right', 0);
  assert.equal(updateSixSevenGesture(state, makePose('left'), 1_000), null);
  holdSide(state, 'left', 1_033);
  assert.equal(state.score, 0);

  const practiceHit = registerSixSevenPracticeHit(state, 'left', 1_300);
  assert.deepEqual(practiceHit, {
    number: 6,
    side: 'left',
    x: 0.67,
    y: 0.62,
    atMs: 1_300,
  });
  assert.equal(state.score, 1);
  assert.equal(state.nextNumber, 7);

  resetSixSevenTracking(state);
  assert.equal(state.score, 1);
  assert.equal(state.nextNumber, 7);
  holdSide(state, 'right', 1_500);
  assert.equal(state.score, 1, 'reset pose history should not score an initial side');
});

test('practice input accepts only the next side and advances 6 then 7', () => {
  const state = createSixSevenState();
  assert.equal(registerSixSevenPracticeHit(state, 'right', 10), null);
  assert.equal(state.score, 0);
  assert.equal(state.nextNumber, 6);

  const six = registerSixSevenPracticeHit(state, 'left', 20);
  assert.equal(six?.number, 6);
  assert.equal(six?.x, 0.67);
  assert.equal(six?.y, 0.62);
  const seven = registerSixSevenPracticeHit(state, 'right', 30);
  assert.equal(seven?.number, 7);
  assert.equal(seven?.x, 0.33);
  assert.equal(seven?.y, 0.62);
  assert.equal(state.score, 2);
  assert.equal(state.nextNumber, 6);
});
