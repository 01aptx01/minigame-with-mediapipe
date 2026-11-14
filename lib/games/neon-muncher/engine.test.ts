import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFaceMouth,
  BOMB_DEFLECT_POINTS,
  BOMB_PENALTY_POINTS,
  computeMuncherTugRatio,
  createInitialMuncherState,
  determineMuncherWinner,
  FACE_CHIN_IDX,
  FACE_TOP_IDX,
  getPlayerMouthWorldPosition,
  LEFT_EYE_OUTER_IDX,
  LIP_BOTTOM_INNER_IDX,
  LIP_TOP_INNER_IDX,
  MOUTH_LEFT_IDX,
  MOUTH_RIGHT_IDX,
  NOSE_TIP_IDX,
  RIGHT_EYE_OUTER_IDX,
  spawnZoneItem,
  stepFallbackMouthController,
  stepMuncherSimulation,
} from './engine';
import type { NormalizedFaceLandmark } from './types';

function makeSyntheticFace(options: {
  centerXNorm: number;
  lipGapNorm: number;
  faceHeightNorm?: number;
  eyeTiltOffsetY?: number;
}): NormalizedFaceLandmark[] {
  const arr: NormalizedFaceLandmark[] = Array.from({ length: 478 }, () => ({
    x: options.centerXNorm,
    y: 0.5,
    z: 0,
  }));
  const h = options.faceHeightNorm ?? 0.4;
  const cx = options.centerXNorm;
  const cy = 0.5;
  const tilt = options.eyeTiltOffsetY ?? 0;

  arr[FACE_TOP_IDX] = { x: cx, y: cy - h * 0.5 };
  arr[FACE_CHIN_IDX] = { x: cx, y: cy + h * 0.5 };
  arr[NOSE_TIP_IDX] = { x: cx, y: cy };
  arr[LEFT_EYE_OUTER_IDX] = { x: cx - 0.08, y: cy - 0.08 - tilt };
  arr[RIGHT_EYE_OUTER_IDX] = { x: cx + 0.08, y: cy - 0.08 + tilt };
  arr[MOUTH_LEFT_IDX] = { x: cx - 0.04, y: cy + 0.1 };
  arr[MOUTH_RIGHT_IDX] = { x: cx + 0.04, y: cy + 0.1 };
  arr[LIP_TOP_INNER_IDX] = { x: cx, y: cy + 0.1 - options.lipGapNorm * 0.5 };
  arr[LIP_BOTTOM_INNER_IDX] = { x: cx, y: cy + 0.1 + options.lipGapNorm * 0.5 };

  return arr;
}

test('analyzeFaceMouth detects closed vs wide-open mouth invariant to face scale and assigns mirrored 1v1 zones', () => {
  // User on left side of raw webcam (x=0.25) mirrors to right side (p2) when mirrorX=true
  const closedNear = makeSyntheticFace({ centerXNorm: 0.25, lipGapNorm: 0.005, faceHeightNorm: 0.45 });
  const openFar = makeSyntheticFace({ centerXNorm: 0.78, lipGapNorm: 0.036, faceHeightNorm: 0.22 });

  const closedRes = analyzeFaceMouth(closedNear, 1280, 720, '1v1', true);
  assert.ok(closedRes);
  assert.equal(closedRes.zone, 'p2');
  assert.equal(closedRes.isMouthOpen, false);
  assert.ok(closedRes.mouthOpenRatio < 0.1);

  const openRes = analyzeFaceMouth(openFar, 1280, 720, '1v1', true);
  assert.ok(openRes);
  assert.equal(openRes.zone, 'p1');
  assert.equal(openRes.isMouthOpen, true);
  assert.ok(openRes.mouthOpenRatio >= 0.85);

  const soloRes = analyzeFaceMouth(closedNear, 1280, 720, 'solo', true);
  assert.ok(soloRes);
  assert.equal(soloRes.zone, 'p1');
});

test('open mouth chomps snacks for points while closed mouth bonks snacks away', () => {
  const state = createInitialMuncherState('playing', 'solo');
  state.spawnTimer = 99;
  const mouthPos = getPlayerMouthWorldPosition(state.p1, 'p1', 'solo', 1000, 700);

  // Closed mouth bonks burger away without scoring
  state.p1.isMouthOpen = false;
  state.p1.mouthOpenRatio = 0.05;
  const burger1 = spawnZoneItem(state, 'p1', 1000, 'burger');
  burger1.x = mouthPos.x;
  burger1.y = mouthPos.y - 5;
  burger1.vy = 200;

  const evClosed = stepMuncherSimulation(state, 0.016, 1000, 700);
  assert.equal(evClosed.munchedBy.length, 0);
  assert.equal(state.p1.score, 0);
  assert.equal(burger1.active, true);
  assert.ok(burger1.vy < 0);

  // Clear bonked burger1 and test fresh open-mouth chomp + wide_munch shame snapshot candidate
  burger1.active = false;
  state.p1.isMouthOpen = true;
  state.p1.mouthOpenRatio = 0.92;
  const burger2 = spawnZoneItem(state, 'p1', 1000, 'burger');
  burger2.x = mouthPos.x;
  burger2.y = mouthPos.y;
  burger2.vy = 200;

  const evOpen = stepMuncherSimulation(state, 0.016, 1000, 700);
  assert.equal(evOpen.munchedBy.length, 1);
  assert.ok(state.p1.score > 0);
  assert.equal(state.p1.itemsMunched, 1);
  assert.equal(burger2.active, false);
  assert.equal(evOpen.shameCandidate?.trigger, 'wide_munch');
});

test('open mouth swallows skull bomb for heavy penalty & shame shot, closed mouth safely clamps bomb', () => {
  const state = createInitialMuncherState('playing', 'solo');
  state.spawnTimer = 99;
  state.p1.score = 300;
  const mouthPos = getPlayerMouthWorldPosition(state.p1, 'p1', 'solo', 1000, 700);

  // Clamped mouth deflects bomb safely
  state.p1.isMouthOpen = false;
  state.p1.mouthOpenRatio = 0.08;
  const bomb1 = spawnZoneItem(state, 'p1', 1000, 'bomb');
  bomb1.x = mouthPos.x;
  bomb1.y = mouthPos.y;
  bomb1.vy = 240;

  const evDeflect = stepMuncherSimulation(state, 0.016, 1000, 700);
  assert.equal(evDeflect.deflectedBy.length, 1);
  assert.equal(evDeflect.bombedBy.length, 0);
  assert.equal(state.p1.score, 300 + BOMB_DEFLECT_POINTS);
  assert.equal(state.p1.bombsDeflected, 1);
  assert.ok(bomb1.vy < 0);

  // Open mouth eats bomb -> KABOOM penalty + bomb_face shame snapshot
  state.p1.isMouthOpen = true;
  state.p1.mouthOpenRatio = 0.85;
  const bomb2 = spawnZoneItem(state, 'p1', 1000, 'bomb');
  bomb2.x = mouthPos.x;
  bomb2.y = mouthPos.y;

  const evBoom = stepMuncherSimulation(state, 0.016, 1000, 700);
  assert.equal(evBoom.bombedBy.length, 1);
  assert.equal(state.p1.bombsEaten, 1);
  assert.equal(state.p1.score, 300 + BOMB_DEFLECT_POINTS - BOMB_PENALTY_POINTS);
  assert.equal(evBoom.shameCandidate?.trigger, 'bomb_face');
});

test('chili activates fever 2x multiplier, fallback controller moves & opens mouth, and timer ends round', () => {
  const state = createInitialMuncherState('playing', '1v1');
  state.spawnTimer = 99;

  stepFallbackMouthController(state.p1, 1, true, -1, 0.25);
  assert.ok(state.p1.mouthXNorm > 0.5);
  assert.ok(state.p1.isMouthOpen);
  assert.ok(state.p1.headTiltRad < 0);

  const mouthPos = getPlayerMouthWorldPosition(state.p1, 'p1', '1v1', 1000, 700);
  const chili = spawnZoneItem(state, 'p1', 1000, 'chili');
  chili.x = mouthPos.x;
  chili.y = mouthPos.y;

  const evChili = stepMuncherSimulation(state, 0.016, 1000, 700);
  assert.equal(evChili.munchedBy.length, 1);
  assert.ok(state.p1.feverTimer > 4.5);
  assert.ok(computeMuncherTugRatio('1v1', state.p1.score, 0) > 0.5);

  state.timeRemaining = 0.02;
  const evEnd = stepMuncherSimulation(state, 0.05, 1000, 700);
  assert.equal(evEnd.roundEnded, true);
  assert.equal(state.phase, 'gameover');
  assert.equal(determineMuncherWinner('1v1', state.p1.score, state.p2.score), 'p1');
});
