import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSixSevenState,
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

  for (let i = 0; i < 5; i++) {
    updateSixSevenGesture(state, makePose('left'), 200 + i * 33);
  }
  for (let i = 0; i < 8; i++) {
    updateSixSevenGesture(state, makePose('right'), 400 + i * 33);
  }

  assert.equal(state.score, 0);
  assert.equal(state.nextNumber, 6);
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
