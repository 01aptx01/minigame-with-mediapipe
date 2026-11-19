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
  // No shoulder or elbow points are supplied: Six Seven only needs the wrists.
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
  side: 'left' | 'right' = 'left',
  scoringEnabled = true
) {
  return [0.56, 0.539, 0.51, 0.49, 0.53, 0.56].flatMap((y, index) => {
    const hit = updateSixSevenGesture(
      state,
      side === 'left' ? pose(y) : pose(0.56, y),
      startMs + index * 25,
      scoringEnabled
    );
    return hit;
  });
}

test('repeated same-wrist pumps score and keep the fixed screen-side number', () => {
  const state = createSixSevenState();
  const hits = [...pump(state, 0), ...pump(state, 150), ...pump(state, 300)];
  assert.equal(state.score, 3);
  assert.deepEqual(hits.map(hit => [hit.side, hit.number]), [
    ['left', 6], ['left', 6], ['left', 6],
  ]);
  assert.ok(hits.every(hit => hit.x === 0.7 && hit.y <= 0.539));
});

test('each wrist can score independently, with right fixed to 7', () => {
  const state = createSixSevenState();
  const hits = pump(state, 0, 'right');
  assert.equal(state.score, 1);
  assert.deepEqual(hits.map(hit => [hit.side, hit.number]), [['right', 7]]);
  assert.equal(hits[0].x, 0.3);
});

test('short wrist lifts count without the other arm or a held pose', () => {
  const state = createSixSevenState();
  assert.deepEqual(updateSixSevenGesture(state, pose(), 0), []);
  assert.deepEqual(updateSixSevenGesture(state, pose(0.55), 1000 / 30), []);
  const hits = updateSixSevenGesture(state, pose(0.538), 2000 / 30);
  assert.equal(hits[0]?.number, 6);
  assert.equal(state.score, 1);
});

test('repeated vertical strokes are stable at 24, 30, and 60 FPS', () => {
  for (const fps of [24, 30, 60]) {
    const state = createSixSevenState();
    const hits: SixSevenHit[] = [];
    const periodMs = 160;
    for (let frame = 0; frame * 1000 / fps < periodMs * 10; frame += 1) {
      const nowMs = frame * 1000 / fps;
      const phase = nowMs % periodMs / periodMs;
      const height = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      hits.push(...updateSixSevenGesture(state, pose(0.56 - 0.052 * height), nowMs));
    }
    assert.equal(hits.length, 10, `${fps} FPS`);
    assert.deepEqual(hits.map(hit => hit.number), Array.from({ length: 10 }, () => 6));
  }
});

test('independent tracks score alternating wrist strokes without a shared cooldown', () => {
  const state = createSixSevenState();
  const hits: SixSevenHit[] = [];
  for (let frame = 0; frame < 120; frame += 1) {
    const nowMs = frame * 1000 / 60;
    const height = (1 - Math.cos(nowMs / 200 * Math.PI * 2)) / 2;
    hits.push(...updateSixSevenGesture(state, pose(0.56 - 0.052 * height, 0.508 + 0.052 * height), nowMs));
  }
  assert.equal(hits.length, 20);
  assert.ok(hits.every((hit, index) => hit.side === (index % 2 === 0 ? 'left' : 'right')));
  assert.ok(hits.every((hit, index) => hit.number === (index % 2 === 0 ? 6 : 7)));
});

test('simultaneous wrist lifts return two hits and award two points', () => {
  const state = createSixSevenState();
  const hits: SixSevenHit[] = [];
  for (const [index, y] of [0.56, 0.53, 0.50, 0.48].entries()) {
    hits.push(...updateSixSevenGesture(state, pose(y, y), index * 30));
  }
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map(hit => [hit.side, hit.number]), [['left', 6], ['right', 7]]);
  assert.equal(state.score, 2);
});

test('horizontal crossings do not change a wrist identity or its number', () => {
  const state = createSixSevenState();
  const hits: SixSevenHit[] = [];
  const xs: [number, number][] = [[0.7, 0.3], [0.3, 0.7], [0.25, 0.75], [0.2, 0.8]];
  const ys = [0.56, 0.54, 0.51, 0.49];
  for (let i = 0; i < xs.length; i += 1) {
    const landmarks = pose(ys[i]);
    landmarks[15].x = xs[i][0];
    landmarks[16] = { x: xs[i][1], y: 0.56, visibility: 1 };
    hits.push(...updateSixSevenGesture(state, landmarks, i * 30));
  }
  assert.deepEqual(hits.map(hit => [hit.side, hit.number]), [['left', 6]]);
});

test('horizontal-only movement and small vertical jitter do not score', () => {
  const state = createSixSevenState();
  for (let i = 0; i < 30; i += 1) {
    const landmarks = pose(0.56 + (i % 2 === 0 ? 0.003 : -0.003));
    landmarks[15].x = (i % 20) / 20;
    assert.deepEqual(updateSixSevenGesture(state, landmarks, i * 30), []);
  }
  assert.equal(state.score, 0);
});

test('a one-frame spike and a held wrist do not add points', () => {
  const state = createSixSevenState();
  for (let i = 0; i < 28; i += 1) {
    const y = i === 8 ? 0.48 : 0.56 + (i % 2 === 0 ? 0.003 : -0.003);
    updateSixSevenGesture(state, pose(y), i * 30);
  }
  assert.equal(state.score, 0);
  for (let i = 0; i < 28; i += 1) updateSixSevenGesture(state, pose(0.495), 840 + i * 30);
  assert.equal(state.score, 1);
  for (let i = 0; i < 20; i += 1) updateSixSevenGesture(state, pose(0.495), 1680 + i * 30);
  assert.equal(state.score, 1);
});

test('a single downward glitch cannot rearm a held wrist', () => {
  const state = createSixSevenState();
  for (const [index, y] of [0.56, 0.54, 0.51, 0.48, 0.48, 0.56, 0.48, 0.48, 0.48].entries()) {
    updateSixSevenGesture(state, pose(y), index * 33);
  }
  assert.equal(state.score, 1);
});

test('one hidden or low-confidence wrist leaves the other playable', () => {
  const state = createSixSevenState();
  assert.equal(isSixSevenPoseVisible(withoutWrist(pose(), 'right')), true);
  assert.equal(getSixSevenWrist(withoutWrist(pose(), 'right'), 'right'), null);
  const hits: SixSevenHit[] = [];
  for (const [index, y] of [0.56, 0.53, 0.49, 0.48].entries()) {
    hits.push(...updateSixSevenGesture(state, withoutWrist(pose(y), 'right'), index * 25));
  }
  assert.deepEqual(hits.map(hit => hit.number), [6]);
  assert.equal(state.score, 1);
});

test('an occluded wrist reacquires a baseline instead of scoring a jump', () => {
  const state = createSixSevenState();
  updateSixSevenGesture(state, pose(), 0);
  updateSixSevenGesture(state, withoutWrist(pose(), 'left'), 30);
  updateSixSevenGesture(state, pose(0.49), 60);
  updateSixSevenGesture(state, pose(0.49), 90);
  updateSixSevenGesture(state, pose(0.49), 120);
  assert.equal(state.score, 0);
});

test('brief total pose dropouts keep motion tracks warm without scoring on reacquisition', () => {
  const state = createSixSevenState();
  updateSixSevenGesture(state, pose(), 0);
  updateSixSevenGesture(state, pose(0.54), 30);
  updateSixSevenGesture(state, null, 60);
  updateSixSevenGesture(state, null, 90);
  assert.deepEqual(updateSixSevenGesture(state, pose(0.48), 120), []);
  assert.equal(state.score, 0);

  // The missed lift is discarded; a new visible stroke still scores.
  updateSixSevenGesture(state, pose(0.56), 150);
  updateSixSevenGesture(state, pose(0.53), 180);
  const hits = updateSixSevenGesture(state, pose(0.49), 210);
  assert.deepEqual(hits.map(hit => hit.number), [6]);
  assert.equal(state.score, 1);
});

test('a brief omission can confirm that a scored wrist lowered and rearm it', () => {
  const state = createSixSevenState();
  updateSixSevenGesture(state, pose(), 0);
  updateSixSevenGesture(state, pose(0.53), 30);
  assert.equal(updateSixSevenGesture(state, pose(0.49), 60).length, 1);
  updateSixSevenGesture(state, null, 90);
  assert.deepEqual(updateSixSevenGesture(state, pose(0.56), 120), []);
  updateSixSevenGesture(state, pose(0.53), 150);
  assert.equal(updateSixSevenGesture(state, pose(0.49), 180).length, 1);
  assert.equal(state.score, 2);
});

test('slow inference gaps preserve continuous strokes but longer gaps rebase safely', () => {
  const state = createSixSevenState();
  updateSixSevenGesture(state, pose(), 0);
  updateSixSevenGesture(state, pose(0.53), 180);
  assert.equal(updateSixSevenGesture(state, pose(0.49), 360).length, 1);
  assert.equal(state.score, 1);

  // A long worker stall is treated as an unseen interval, never a giant lift.
  assert.deepEqual(updateSixSevenGesture(state, pose(0.56), 900), []);
  assert.equal(state.score, 1);
});

test('shoulder and body landmarks are not needed or consulted', () => {
  const state = createSixSevenState();
  const landmarks = pose();
  landmarks[11] = { x: 0.6, y: 0.4, visibility: 1 };
  landmarks[12] = { x: 0.4, y: 0.4, visibility: 1 };
  updateSixSevenGesture(state, landmarks, 0);
  for (const [index, y] of [0.54, 0.51, 0.49].entries()) {
    landmarks[15].y = y;
    landmarks[11].y = 1 - index / 2;
    landmarks[12].y = index / 2;
    updateSixSevenGesture(state, landmarks, (index + 1) * 30);
  }
  assert.equal(state.score, 1);
  assert.equal(isSixSevenPoseVisible(pose()), true);
  const leftOnly: SixSevenLandmark[] = [];
  leftOnly[15] = pose()[15];
  assert.equal(isSixSevenPoseVisible(leftOnly), true);
});

test('invalid wrist coordinates or low confidence are ignored', () => {
  assert.equal(isSixSevenPoseVisible(pose()), true);
  assert.equal(isSixSevenPoseVisible(null), false);
  const landmarks = pose();
  landmarks[15].x = Infinity;
  landmarks[16].y = -0.1;
  assert.equal(isSixSevenPoseVisible(landmarks), false);
});

test('countdown, duplicate timestamps, and resets do not add extra points', () => {
  const state = createSixSevenState();
  assert.deepEqual(pump(state, 0, 'left', false), []);
  assert.equal(state.score, 0);
  assert.deepEqual(pump(state, 150), [
    { number: 6, side: 'left', x: 0.7, y: 0.51, atMs: 200 },
  ]);
  assert.deepEqual(updateSixSevenGesture(state, pose(0.48), 275), []);
  assert.deepEqual(updateSixSevenGesture(state, pose(0.48), 270), []);
  resetSixSevenTracking(state);
  assert.deepEqual(updateSixSevenGesture(state, pose(0.48), 300), []);
  assert.equal(state.score, 1);
});

test('practice hits use the same fixed 6-left and 7-right mapping', () => {
  const state = createSixSevenState();
  const hits = [
    registerSixSevenPracticeHit(state, 'right', 10),
    registerSixSevenPracticeHit(state, 'right', 20),
    registerSixSevenPracticeHit(state, 'left', 30),
  ];
  assert.deepEqual(hits.map(hit => [hit.number, hit.x]), [[7, 0.33], [7, 0.33], [6, 0.67]]);
  assert.equal(state.score, 3);
});
