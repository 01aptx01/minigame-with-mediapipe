import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAT_SEC,
  boxesOverlap,
  computeBodyBoundingBox,
  computeDodgeTugRatio,
  createInitialDodgeGameState,
  determineDodgeWinner,
  getLaserPatternSpec,
  LASER_HIT_DAMAGE,
  PLAYER_MAX_HP,
  stepDodgeSimulation,
  stepFallbackBodyBox,
  SURVIVAL_HP_BONUS_PER_HP,
} from './engine';
import type { NormalizedLandmark } from './types';

function makePoseLandmarks(opts: {
  centerX: number;
  headY: number;
  hipY: number;
  widthHalf?: number;
}): NormalizedLandmark[] {
  const arr: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: opts.centerX,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  const hw = opts.widthHalf ?? 0.08;
  arr[0] = { x: opts.centerX, y: opts.headY, z: 0, visibility: 1 };
  arr[11] = { x: opts.centerX - hw, y: opts.headY + 0.14, z: 0, visibility: 1 };
  arr[12] = { x: opts.centerX + hw, y: opts.headY + 0.14, z: 0, visibility: 1 };
  arr[23] = { x: opts.centerX - hw * 0.8, y: opts.hipY, z: 0, visibility: 1 };
  arr[24] = { x: opts.centerX + hw * 0.8, y: opts.hipY, z: 0, visibility: 1 };
  return arr;
}

test('computeBodyBoundingBox mirrors coordinates, scopes to player zone, and classifies stances', () => {
  // Raw camera centerX = 0.75 -> mirrored screenX = 0.25 -> P1 left zone (0.25 * 2 = 0.50 center)
  const standingP1 = computeBodyBoundingBox(
    makePoseLandmarks({ centerX: 0.75, headY: 0.26, hipY: 0.68 }),
    '1v1',
    'p1',
    true
  );
  assert.ok(standingP1);
  assert.equal(standingP1.stance, 'standing');
  assert.ok(Math.abs(standingP1.centerX - 0.5) < 0.05);

  // Ducking pose (head drops down to y = 0.64)
  const duckingSolo = computeBodyBoundingBox(
    makePoseLandmarks({ centerX: 0.5, headY: 0.64, hipY: 0.84 }),
    'solo',
    'p1',
    true
  );
  assert.ok(duckingSolo);
  assert.equal(duckingSolo.stance, 'ducking');
  assert.ok(duckingSolo.minY > 0.54);
});

test('AABB collision catches standing hit on high_bar laser and clears cleanly when ducking', () => {
  const highBar = getLaserPatternSpec('high_bar').rect;
  const standing = computeBodyBoundingBox(
    makePoseLandmarks({ centerX: 0.5, headY: 0.28, hipY: 0.7 }),
    'solo',
    'p1',
    true
  )!;
  const ducking = computeBodyBoundingBox(
    makePoseLandmarks({ centerX: 0.5, headY: 0.64, hipY: 0.85 }),
    'solo',
    'p1',
    true
  )!;

  assert.equal(boxesOverlap(standing, highBar), true);
  assert.equal(boxesOverlap(ducking, highBar), false);
});

test('horizontal dodge patterns block center and clear when leaning left or right', () => {
  const leftWall = getLaserPatternSpec('left_wall').rect;
  const rightWall = getLaserPatternSpec('right_wall').rect;
  const splitGate = getLaserPatternSpec('split_gate').rect;

  let box = createInitialDodgeGameState('playing', 'solo').p1.bodyBox;
  assert.equal(boxesOverlap(box, leftWall), true);
  assert.equal(boxesOverlap(box, rightWall), true);
  assert.equal(boxesOverlap(box, splitGate), true);

  // Move right via fallback controller
  for (let i = 0; i < 20; i++) {
    box = stepFallbackBodyBox(box, { left: false, right: true, duck: false }, 0.05);
  }
  assert.equal(box.stance, 'lean_right');
  assert.equal(boxesOverlap(box, leftWall), false);
  assert.equal(boxesOverlap(box, splitGate), false);
  assert.equal(boxesOverlap(box, rightWall), true);
});

test('laser collision deducts HP with i-frames, clean dodge awards score, and KO ends match', () => {
  const state = createInitialDodgeGameState('playing', 'solo');
  state.nextSpawnBeat = 999; // control laser manually

  // Spawn an unavoidable laser right before player plane while standing
  const spec = getLaserPatternSpec('high_bar');
  state.lasers.push({
    id: 1,
    zone: 'p1',
    pattern: 'high_bar',
    label: spec.label,
    rect: spec.rect,
    spawnTime: 0,
    hitTime: 1.0,
    z: 0.05,
    resolved: false,
    wasHit: false,
    color: spec.color,
  });

  state.elapsed = 0.96;
  const hitOutcome = stepDodgeSimulation(state, 0.02);
  assert.equal(hitOutcome.hits.length, 1);
  assert.equal(state.p1.hp, PLAYER_MAX_HP - LASER_HIT_DAMAGE);
  assert.equal(state.p1.hitsTaken, 1);

  // Advance past brief 45ms hitstop freeze before next laser
  for (let i = 0; i < 3; i++) {
    stepDodgeSimulation(state, 0.02);
  }

  // Next laser while ducking -> clean dodge!
  state.p1.bodyBox = stepFallbackBodyBox(
    state.p1.bodyBox,
    { left: false, right: false, duck: true },
    0.5
  );
  state.lasers.push({
    id: 2,
    zone: 'p1',
    pattern: 'high_bar',
    label: spec.label,
    rect: spec.rect,
    spawnTime: 1.0,
    hitTime: 2.0,
    z: 0.01,
    resolved: false,
    wasHit: false,
    color: spec.color,
  });
  state.elapsed = 2.05;
  const dodgeOutcome = stepDodgeSimulation(state, 0.02);
  assert.equal(dodgeOutcome.dodges.length, 1);
  assert.equal(state.p1.dodgedCount, 1);
  assert.ok(state.p1.score > 0);
});

test('1v1 KO and full-song survival bonus determine winner accurately', () => {
  const koState = createInitialDodgeGameState('playing', '1v1');
  koState.nextSpawnBeat = 999;
  koState.p2.hp = LASER_HIT_DAMAGE;
  const spec = getLaserPatternSpec('high_bar');
  koState.lasers.push({
    id: 10,
    zone: 'p2',
    pattern: 'high_bar',
    label: spec.label,
    rect: spec.rect,
    spawnTime: 0,
    hitTime: 1.0,
    z: 0.02,
    resolved: false,
    wasHit: false,
    color: spec.color,
  });
  koState.elapsed = 0.96;
  const koOut = stepDodgeSimulation(koState, 0.02);
  assert.equal(koOut.roundEnded, true);
  assert.equal(koOut.survivedFullSong, false);
  assert.equal(determineDodgeWinner('1v1', koState.p1, koState.p2), 'p1');

  // Survival end-of-song bonus
  const winState = createInitialDodgeGameState('playing', 'solo');
  winState.nextSpawnBeat = 999;
  winState.timeRemaining = 0.01;
  winState.p1.hp = 80;
  const winOut = stepDodgeSimulation(winState, 0.03);
  assert.equal(winOut.roundEnded, true);
  assert.equal(winOut.survivedFullSong, true);
  assert.equal(winState.p1.score, 80 * SURVIVAL_HP_BONUS_PER_HP);
  assert.equal(determineDodgeWinner('solo', winState.p1, winState.p2), 'solo');
  assert.ok(computeDodgeTugRatio('solo', winState.p1, winState.p2) === 0.8);
  assert.ok(BEAT_SEC > 0.45 && BEAT_SEC < 0.48);
});
