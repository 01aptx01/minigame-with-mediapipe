import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignPoseToZone,
  computeJointAngleDeg,
  computePoseTugRatio,
  createInitialPoseGameState,
  determinePoseWinner,
  FAKEOUT_POSE,
  getHoldRequirementSec,
  POSE_TEMPLATES,
  SABOTAGE_DURATION_SEC,
  scorePoseMatchPercent,
  stepPoseSimulation,
  VALID_POSES,
} from './engine';
import type { NormalizedLandmark } from './types';

function makeLandmarks(hipCenterX: number): NormalizedLandmark[] {
  const arr: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: hipCenterX,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  arr[23] = { x: hipCenterX - 0.04, y: 0.55, z: 0, visibility: 1 };
  arr[24] = { x: hipCenterX + 0.04, y: 0.55, z: 0, visibility: 1 };
  return arr;
}

test('computeJointAngleDeg calculates exact 90 and 180 degree angles invariant to scale', () => {
  const rightAngle = computeJointAngleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.ok(Math.abs(rightAngle - 90) < 0.001);

  const scaledRightAngle = computeJointAngleDeg({ x: 0, y: 500 }, { x: 0, y: 0 }, { x: 500, y: 0 });
  assert.ok(Math.abs(scaledRightAngle - 90) < 0.001);

  const straight = computeJointAngleDeg({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.ok(Math.abs(straight - 180) < 0.001);
});

test('scorePoseMatchPercent returns 100% on exact canonical pose and >= 80% within ±30 deg tolerance', () => {
  const star = POSE_TEMPLATES.find((p) => p.kind === 'star')!;
  assert.equal(scorePoseMatchPercent(star.targetAngles, star), 100);

  const perturbed = { ...star.targetAngles, left_elbow: star.targetAngles.left_elbow - 25 };
  const pct = scorePoseMatchPercent(perturbed, star);
  assert.ok(pct >= 80 && pct < 100, `Expected >= 80% for 25 deg single joint error, got ${pct}`);
});

test('assignPoseToZone splits P1 left and P2 right with horizontal mirroring, and always P1 in solo', () => {
  // Raw camera x = 0.78 -> mirrored screen x = 0.22 (Left / P1)
  assert.equal(assignPoseToZone(makeLandmarks(0.78), '1v1', true), 'p1');
  // Raw camera x = 0.22 -> mirrored screen x = 0.78 (Right / P2)
  assert.equal(assignPoseToZone(makeLandmarks(0.22), '1v1', true), 'p2');
  // Solo mode always assigns P1
  assert.equal(assignPoseToZone(makeLandmarks(0.22), 'solo', true), 'p1');
});

test('hold-to-score progresses at >= 80%, decays gradually below 80%, and triggers 3-combo sabotage', () => {
  const state = createInitialPoseGameState('playing', '1v1');
  const rng = () => 0.25;

  // Match >= 80% for 0.75s (half of 1.5s hold)
  state.p1.matchPercent = 92;
  for (let i = 0; i < 15; i++) {
    stepPoseSimulation(state, 0.05, rng);
  }
  assert.ok(state.p1.holdProgress > 0.4 && state.p1.holdProgress < 0.6);

  // Drop below 80% -> decays gradually, does NOT reset to 0 instantly
  state.p1.matchPercent = 40;
  stepPoseSimulation(state, 0.05, rng);
  assert.ok(state.p1.holdProgress > 0.35, 'Hold progress should decay gradually');

  // Complete 3 poses in a row to trigger sabotage on P2
  state.p1.holdProgress = 0;
  state.p1.matchPercent = 95;
  let sabotageObserved = false;
  for (let step = 0; step < 120; step++) {
    const out = stepPoseSimulation(state, 0.05, rng);
    if (out.p1Outcome.triggeredSabotageOn === 'p2') {
      sabotageObserved = true;
    }
  }
  assert.equal(state.p1.posesMatched, 3);
  assert.equal(sabotageObserved, true);
  assert.ok(state.p2.sabotageRemaining > 0 && state.p2.sabotageRemaining <= SABOTAGE_DURATION_SEC);
});

test('fakeout pose deducts points if matched above 80% and awards bonus when dodged', () => {
  const state = createInitialPoseGameState('playing', '1v1');
  state.p1.score = 150;
  state.p1.combo = 2;
  state.p1.currentPose = FAKEOUT_POSE;
  state.p1.matchPercent = 90;

  let hitFakeout = false;
  for (let i = 0; i < 20; i++) {
    const out = stepPoseSimulation(state, 0.05, () => 0.1);
    if (out.p1Outcome.triggeredFakeout) hitFakeout = true;
  }
  assert.equal(hitFakeout, true);
  assert.equal(state.p1.score, 75);
  assert.equal(state.p1.combo, 0);

  // Now test dodging fakeout
  state.p1.currentPose = FAKEOUT_POSE;
  state.p1.matchPercent = 30;
  let dodged = false;
  for (let i = 0; i < 80; i++) {
    const out = stepPoseSimulation(state, 0.05, () => 0.1);
    if (out.p1Outcome.dodgedFakeout) dodged = true;
  }
  assert.equal(dodged, true);
  assert.equal(state.p1.score, 100);
});

test('overdrive activates in final 15s, reduces hold requirement to 1s, and awards 2x points', () => {
  const state = createInitialPoseGameState('playing', '1v1');
  assert.equal(getHoldRequirementSec('1v1', false), 1.5);
  assert.equal(getHoldRequirementSec('solo', false), 2.0);
  assert.equal(getHoldRequirementSec('1v1', true), 1.0);

  state.timeRemaining = 14.5;
  state.p1.currentPose = VALID_POSES[0];
  state.p1.matchPercent = 95;

  let matchedPoints = 0;
  for (let i = 0; i < 22; i++) {
    const out = stepPoseSimulation(state, 0.05, () => 0.3);
    if (out.p1Outcome.matchedPose) matchedPoints = out.p1Outcome.awardedPoints;
  }
  assert.equal(state.overdrive, true);
  assert.equal(matchedPoints, 200);
});

test('tug-of-war tracks live match percent differential and winner calculation works', () => {
  assert.equal(computePoseTugRatio('1v1', 80, 80), 0.5);
  assert.ok(computePoseTugRatio('1v1', 95, 40) > 0.7);
  assert.ok(computePoseTugRatio('1v1', 25, 90) < 0.3);
  assert.equal(computePoseTugRatio('solo', 85, 0), 0.85);

  assert.equal(determinePoseWinner('1v1', 300, 200), 'p1');
  assert.equal(determinePoseWinner('1v1', 100, 200), 'p2');
  assert.equal(determinePoseWinner('1v1', 200, 200), 'draw');
  assert.equal(determinePoseWinner('solo', 200, 0), 'solo');
});
