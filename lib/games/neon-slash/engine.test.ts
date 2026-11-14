import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySliceOutcome,
  calculateComboMultiplier,
  computeTugOfWarRatio,
  createInitialGameState,
  determineWinner,
  getPlayerSideForX,
  projectLandmarkToCanvas,
  ROUND_DURATION_SEC,
  SABOTAGE_DURATION_SEC,
  segmentIntersectsCircle,
  spawnTargetForSide,
  stepGameSimulation,
} from './engine';
import type { Target } from './types';

function makeTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: 1,
    kind: 'p1_gem',
    x: 200,
    y: 300,
    vx: 0,
    vy: -400,
    radius: 32,
    rotation: 0,
    angularVelocity: 1,
    sliced: false,
    hitFlash: 0,
    pulsePhase: 0,
    ...overrides,
  };
}

test('projectLandmarkToCanvas mirrors horizontally by default and assigns player sides', () => {
  const projectedLeft = projectLandmarkToCanvas({ x: 0.8, y: 0.5 }, 1000, 600, true);
  assert.ok(Math.abs(projectedLeft.x - 200) < 0.001);
  assert.ok(Math.abs(projectedLeft.y - 300) < 0.001);
  assert.equal(getPlayerSideForX(projectedLeft.x, 1000), 'p1');

  const projectedRight = projectLandmarkToCanvas({ x: 0.2, y: 0.5 }, 1000, 600, true);
  assert.ok(Math.abs(projectedRight.x - 800) < 0.001);
  assert.equal(getPlayerSideForX(projectedRight.x, 1000), 'p2');
});

test('segmentIntersectsCircle detects laser blade slices accurately', () => {
  assert.equal(segmentIntersectsCircle(0, 0, 100, 0, 50, 15, 20), true);
  assert.equal(segmentIntersectsCircle(0, 0, 100, 0, 50, 35, 20), false);
  assert.equal(segmentIntersectsCircle(10, 10, 10, 10, 15, 10, 10), true);
});

test('scoring and combo multiplier escalate for quick consecutive own-color slices', () => {
  const state = createInitialGameState('playing');
  state.elapsed = 1.0;

  const first = applySliceOutcome(state, makeTarget({ id: 1, kind: 'p1_gem' }), 'p1');
  assert.equal(first.pointsDelta, 10);
  assert.equal(state.p1.combo, 1);
  assert.equal(state.p1.multiplier, 1);

  state.elapsed = 2.0; // within 1.8s combo window
  const second = applySliceOutcome(state, makeTarget({ id: 2, kind: 'p1_gem' }), 'p1');
  assert.equal(second.pointsDelta, 20);
  assert.equal(state.p1.combo, 2);
  assert.equal(state.p1.multiplier, 2);
  assert.equal(state.p1.score, 30);

  assert.equal(calculateComboMultiplier(7), 4);
  assert.equal(calculateComboMultiplier(12), 5);
});

test('slicing skull bomb or opponent color deducts points and resets combo', () => {
  const state = createInitialGameState('playing');
  state.p1.score = 40;
  state.p1.combo = 4;
  state.p1.multiplier = 3;

  const wrongColor = applySliceOutcome(state, makeTarget({ id: 3, kind: 'p2_gem' }), 'p1');
  assert.equal(wrongColor.wasPenalty, true);
  assert.equal(wrongColor.pointsDelta, -10);
  assert.equal(state.p1.score, 30);
  assert.equal(state.p1.combo, 0);
  assert.equal(state.p1.multiplier, 1);

  const bomb = applySliceOutcome(state, makeTarget({ id: 4, kind: 'skull_bomb' }), 'p1');
  assert.equal(bomb.wasPenalty, true);
  assert.equal(bomb.pointsDelta, -25);
  assert.equal(state.p1.score, 5);
});

test('slicing sabotage orb glitches opponent half for 3 seconds', () => {
  const state = createInitialGameState('playing');
  const outcome = applySliceOutcome(state, makeTarget({ id: 5, kind: 'sabotage_orb' }), 'p1');

  assert.equal(outcome.triggeredSabotageOn, 'p2');
  assert.equal(state.p2.sabotageRemaining, SABOTAGE_DURATION_SEC);
  assert.equal(state.p1.sabotageRemaining, 0);
  assert.equal(state.p1.sabotagesSent, 1);
  assert.ok(state.p1.score > 0);
});

test('tug-of-war ratio balances at 0.5 and responds to lead changes', () => {
  assert.equal(computeTugOfWarRatio(0, 0), 0.5);
  assert.equal(computeTugOfWarRatio(100, 100), 0.5);
  assert.ok(computeTugOfWarRatio(150, 50) > 0.5);
  assert.ok(computeTugOfWarRatio(20, 180) < 0.5);
  assert.ok(computeTugOfWarRatio(99999, 0) <= 0.92);
  assert.ok(computeTugOfWarRatio(0, 99999) >= 0.08);
});

test('simulation spawns parabolic targets, ticks down 60s timer, and transitions to gameover', () => {
  const state = createInitialGameState('playing');
  assert.equal(state.timeRemaining, ROUND_DURATION_SEC);

  // Deterministic rng
  let seed = 0.42;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Step 1 second in 0.05s increments -> should spawn targets
  for (let i = 0; i < 20; i++) {
    stepGameSimulation(state, 0.05, 1280, 720, rng);
  }
  assert.ok(state.targets.length > 0);

  const sampleTarget = spawnTargetForSide(99, 'p1', 1280, 720, 5, rng);
  assert.ok(sampleTarget.vy < 0, 'Target should launch upward from bottom');
  assert.ok(sampleTarget.x < 640, 'P1 target should spawn in left half');

  // Fast-forward remaining timer
  state.timeRemaining = 0.04;
  const result = stepGameSimulation(state, 0.05, 1280, 720, rng);
  assert.equal(result.roundEnded, true);
  assert.equal(state.phase, 'gameover');

  assert.equal(determineWinner(120, 90), 'p1');
  assert.equal(determineWinner(40, 90), 'p2');
  assert.equal(determineWinner(50, 50), 'draw');
  assert.equal(determineWinner(150, 0, 'solo'), 'solo');
});

test('solo mode routes full canvas to p1 and spawns only p1 gems or skull bombs', () => {
  const state = createInitialGameState('playing', 'solo');
  assert.equal(getPlayerSideForX(980, 1000, 'solo'), 'p1');
  assert.equal(getPlayerSideForX(20, 1000, 'solo'), 'p1');

  let seed = 0.31;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let i = 0; i < 30; i++) {
    stepGameSimulation(state, 0.05, 1280, 720, rng);
  }
  assert.ok(state.targets.length > 0);
  for (const t of state.targets) {
    assert.ok(t.kind === 'p1_gem' || t.kind === 'skull_bomb');
  }
});
