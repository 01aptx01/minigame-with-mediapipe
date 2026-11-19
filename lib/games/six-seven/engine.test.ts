import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSixSevenState,
  getSixSevenWrist,
  isSixSevenPoseVisible,
  registerSixSevenPracticeHit,
  resetSixSevenTracking,
  updateSixSevenGesture,
  type SixSevenHit,
  type SixSevenLandmark,
} from './engine';

function pose(leftY = 0.56, rightY = 0.56): SixSevenLandmark[] {
  const landmarks: SixSevenLandmark[] = [];
  landmarks[11] = { x: 0.6, y: 0.4, visibility: 1 };
  landmarks[12] = { x: 0.4, y: 0.4, visibility: 1 };
  landmarks[15] = { x: 0.7, y: leftY, visibility: 1 };
  landmarks[16] = { x: 0.3, y: rightY, visibility: 1 };
  return landmarks;
}

function withoutWrist(
  landmarks: SixSevenLandmark[],
  side: 'left' | 'right'
) {
  const index = side === 'left' ? 15 : 16;
  landmarks[index] = { ...landmarks[index], visibility: 0.2 };
  return landmarks;
}

function pump(
  state: ReturnType<typeof createSixSevenState>,
  startMs: number,
  scoringEnabled = true
) {
  return [0.56, 0.539, 0.51, 0.49, 0.53, 0.56].flatMap((leftY, index) => {
    const hit = updateSixSevenGesture(state, pose(leftY), startMs + index * 25, scoringEnabled);
    return hit ? [hit] : [];
  });
}

test('a repeated same-hand pump can score and the emitted numbers alternate', () => {
  const state = createSixSevenState();
  const hits = [...pump(state, 0), ...pump(state, 150), ...pump(state, 300)];
  assert.equal(state.score, 3);
  assert.deepEqual(hits.map(hit => [hit.side, hit.number]), [['left', 6], ['left', 7], ['left', 6]]);
  assert.ok(hits.every(hit => hit.x === 0.7 && hit.y <= 0.539));
});

test('short wrist lifts count without matching the other arm or holding a pose', () => {
  const state = createSixSevenState();
  assert.equal(updateSixSevenGesture(state, pose(), 0), null);
  assert.equal(updateSixSevenGesture(state, pose(0.55), 1000 / 30), null);
  const hit = updateSixSevenGesture(state, pose(0.538), 2000 / 30);
  assert.equal(hit?.number, 6);
  assert.equal(state.score, 1);
});

test('rapid repeated lifts keep up at 24, 30, and 60 FPS', () => {
  for (const fps of [24, 30, 60]) {
    const state = createSixSevenState();
    const hits: SixSevenHit[] = [];
    const periodMs = 160;
    for (let frame = 0; frame * 1000 / fps < periodMs * 10; frame += 1) {
      const nowMs = frame * 1000 / fps;
      const phase = nowMs % periodMs / periodMs;
      const height = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      const hit = updateSixSevenGesture(state, pose(0.56 - 0.052 * height), nowMs);
      if (hit) hits.push(hit);
    }
    assert.equal(hits.length, 10, `${fps} FPS`);
    assert.deepEqual(hits.map(hit => hit.number), [6, 7, 6, 7, 6, 7, 6, 7, 6, 7]);
  }
});

test('alternating wrist strokes can score at a faster cadence than one wrist', () => {
  const state = createSixSevenState();
  const hits: SixSevenHit[] = [];
  for (let frame = 0; frame < 120; frame += 1) {
    const nowMs = frame * 1000 / 60;
    const height = (1 - Math.cos(nowMs / 200 * Math.PI * 2)) / 2;
    const hit = updateSixSevenGesture(state, pose(0.56 - 0.052 * height, 0.508 + 0.052 * height), nowMs);
    if (hit) hits.push(hit);
  }
  assert.equal(hits.length, 20);
  assert.ok(hits.every((hit, index) => hit.side === (index % 2 === 0 ? 'left' : 'right')));
});

test('simultaneous and adjacent-frame lifts produce a single point', () => {
  const simultaneous = createSixSevenState();
  for (const [index, y] of [0.56, 0.53, 0.50, 0.48, 0.55, 0.56].entries()) {
    updateSixSevenGesture(simultaneous, pose(y, y), index * 30);
  }
  assert.equal(simultaneous.score, 1);

  const adjacent = createSixSevenState();
  for (const [index, [left, right]] of [[0.56, 0.56], [0.53, 0.56], [0.50, 0.53], [0.49, 0.50], [0.49, 0.49]].entries()) {
    updateSixSevenGesture(adjacent, pose(left, right), index * 30);
  }
  assert.equal(adjacent.score, 1);
});

test('holding a raised wrist, tiny jitter, and a one-frame spike do not add points', () => {
  const state = createSixSevenState();
  for (let i = 0; i < 28; i += 1) {
    const y = i === 8 ? 0.48 : 0.56 + (i % 2 === 0 ? 0.003 : -0.003);
    updateSixSevenGesture(state, pose(y), i * 30);
  }
  assert.equal(state.score, 0);
  for (let i = 0; i < 28; i += 1) updateSixSevenGesture(state, pose(0.495), 840 + i * 30);
  assert.equal(state.score, 1);
});

test('a single downward glitch cannot rearm a held wrist', () => {
  const state = createSixSevenState();
  for (const [index, y] of [0.56, 0.54, 0.51, 0.48, 0.48, 0.56, 0.48, 0.48, 0.48].entries()) {
    updateSixSevenGesture(state, pose(y), index * 33);
  }
  assert.equal(state.score, 1);
});

test('one hidden or low-confidence wrist leaves the visible wrist playable', () => {
  const state = createSixSevenState();
  assert.equal(isSixSevenPoseVisible(withoutWrist(pose(), 'right')), true);
  assert.equal(getSixSevenWrist(withoutWrist(pose(), 'right'), 'right'), null);
  for (const [index, y] of [0.56, 0.53, 0.49, 0.48].entries()) {
    updateSixSevenGesture(state, withoutWrist(pose(y), 'right'), index * 25);
  }
  assert.equal(state.score, 1);
});

test('a wrist reacquires its baseline after disappearing or a stale frame gap', () => {
  const state = createSixSevenState();
  updateSixSevenGesture(state, pose(), 0);
  updateSixSevenGesture(state, withoutWrist(pose(), 'left'), 30);
  updateSixSevenGesture(state, pose(0.49), 60);
  updateSixSevenGesture(state, pose(0.49), 90);
  updateSixSevenGesture(state, pose(0.49), 120);
  assert.equal(state.score, 0);

  updateSixSevenGesture(state, pose(), 500);
  updateSixSevenGesture(state, pose(0.495), 900);
  updateSixSevenGesture(state, pose(0.495), 930);
  assert.equal(state.score, 0);
});

test('body translation and shoulder roll do not move the relative wrist position', () => {
  const state = createSixSevenState();
  for (let frame = 0; frame < 80; frame += 1) {
    const lean = Math.sin(frame / 4) * 0.045;
    const rise = Math.cos(frame / 3) * 0.04;
    const landmarks = pose(0.56 + rise + lean, 0.56 + rise - lean);
    landmarks[11].y += rise + lean;
    landmarks[12].y += rise - lean;
    updateSixSevenGesture(state, landmarks, frame * 33);
  }
  assert.equal(state.score, 0);
});

test('changing camera distance at a fixed arm position does not pop', () => {
  const state = createSixSevenState();
  for (let frame = 0; frame < 70; frame += 1) {
    const scale = 1 + 0.35 * Math.sin(frame / 8);
    const landmarks = pose();
    for (const index of [11, 12, 15, 16]) {
      landmarks[index].x = 0.5 + (landmarks[index].x - 0.5) * scale;
      landmarks[index].y = 0.4 + (landmarks[index].y - 0.4) * scale;
    }
    updateSixSevenGesture(state, landmarks, frame * 33);
  }
  assert.equal(state.score, 0);
});

test('invalid coordinates or missing shoulder landmarks do not make the camera ready', () => {
  assert.equal(isSixSevenPoseVisible(pose()), true);
  assert.equal(isSixSevenPoseVisible(null), false);
  const landmarks = pose();
  landmarks[15].x = Infinity;
  landmarks[16].y = -0.1;
  assert.equal(isSixSevenPoseVisible(landmarks), false);
  assert.equal(isSixSevenPoseVisible([pose()[15]]), false);
});

test('countdown, duplicate timestamps, and input confidence resets do not award extra points', () => {
  const state = createSixSevenState();
  assert.deepEqual(pump(state, 0, false), []);
  assert.equal(state.score, 0);
  assert.equal(state.nextNumber, 6);
  assert.equal(pump(state, 150)[0]?.number, 6);
  assert.equal(updateSixSevenGesture(state, pose(0.48), 275), null);
  assert.equal(updateSixSevenGesture(state, pose(0.48), 270), null);
  resetSixSevenTracking(state);
  assert.equal(updateSixSevenGesture(state, pose(0.48), 300), null);
  assert.equal(state.score, 1);
  assert.equal(state.nextNumber, 7);
});

test('practice taps can repeat on either side and award one point each', () => {
  const state = createSixSevenState();
  const hits = [
    registerSixSevenPracticeHit(state, 'right', 10),
    registerSixSevenPracticeHit(state, 'right', 20),
    registerSixSevenPracticeHit(state, 'left', 30),
  ];
  assert.deepEqual(hits.map(hit => [hit.number, hit.x]), [[6, 0.33], [7, 0.33], [6, 0.67]]);
  assert.equal(state.score, 3);
});
