import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySorcererGesture,
  computeSorcererTugRatio,
  createInitialSorcererState,
  determineSorcererWinner,
  resolveSpellClash,
  SORCERER_MAX_HP,
  stepSorcererSimulation,
} from './engine';
import type { NormalizedLandmark } from './types';

function makeHandLandmarks(extended: {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}): NormalizedLandmark[] {
  const arr: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 1,
  }));
  // Wrist at (0.5, 0.85)
  arr[0] = { x: 0.5, y: 0.85, z: 0, visibility: 1 };

  const setFinger = (pipIdx: number, tipIdx: number, x: number, up: boolean) => {
    arr[pipIdx] = { x, y: 0.62, z: 0, visibility: 1 };
    // Extended tip is much farther from wrist than pip; curled tip is closer to wrist
    arr[tipIdx] = { x, y: up ? 0.3 : 0.74, z: 0, visibility: 1 };
  };

  setFinger(6, 8, 0.42, extended.index);
  setFinger(10, 12, 0.48, extended.middle);
  setFinger(14, 16, 0.54, extended.ring);
  setFinger(18, 20, 0.6, extended.pinky);
  return arr;
}

test('classifySorcererGesture distinguishes two-finger lightning, open-palm shield, and closed-fist crit', () => {
  const lightning = makeHandLandmarks({ index: true, middle: true, ring: false, pinky: false });
  const shield = makeHandLandmarks({ index: true, middle: true, ring: true, pinky: true });
  const crit = makeHandLandmarks({ index: false, middle: false, ring: false, pinky: false });

  assert.equal(classifySorcererGesture(lightning), 'lightning');
  assert.equal(classifySorcererGesture(shield), 'shield');
  assert.equal(classifySorcererGesture(crit), 'crit');
});

test('resolveSpellClash enforces RPS triangle: lightning > crit > shield > lightning', () => {
  // Shield reflects Lightning onto lightning caster
  const reflectRes = resolveSpellClash('lightning', 'shield', 0, 0);
  assert.equal(reflectRes.winner, 'p2');
  assert.equal(reflectRes.reflectedBy, 'p2');
  assert.ok(reflectRes.p1DamageTaken > 0 && reflectRes.p2DamageTaken === 0);

  // Lightning interrupts charging Fist
  const zapRes = resolveSpellClash('lightning', 'crit', 0, 0.6);
  assert.equal(zapRes.winner, 'p1');
  assert.equal(zapRes.interruptedCrit, 'p2');
  assert.ok(zapRes.p2DamageTaken > 0);

  // Crit Fist shatters Shield
  const shatterRes = resolveSpellClash('crit', 'shield', 0.9, 0);
  assert.equal(shatterRes.winner, 'p1');
  assert.ok(shatterRes.p2DamageTaken >= 30);

  // Same spell -> Arcane Clash (0 damage, score boost)
  const clashRes = resolveSpellClash('lightning', 'lightning', 0, 0);
  assert.equal(clashRes.winner, 'clash');
  assert.equal(clashRes.p1DamageTaken, 0);
  assert.equal(clashRes.p2DamageTaken, 0);
  assert.ok(clashRes.p1ScoreGain > 0);
});

test('holding fist charges critical meteor strike and triggers KO when opponent HP drops to 0', () => {
  const state = createInitialSorcererState('playing', '1v1');
  state.p1.activeSpell = 'crit';
  state.p2.activeSpell = 'shield';
  state.p2.hp = 20;

  let fired = false;
  for (let i = 0; i < 30; i++) {
    const out = stepSorcererSimulation(state, 0.05, () => 0.4);
    if (out.fullCritFiredBy === 'p1') fired = true;
  }

  assert.equal(fired, true);
  assert.equal(state.p2.hp, 0);
  assert.equal(state.phase, 'gameover');
  assert.equal(determineSorcererWinner(state.p1, state.p2), 'p1');
  assert.ok(computeSorcererTugRatio(state.p1, state.p2) > 0.8);
  assert.equal(state.p1.maxHp, SORCERER_MAX_HP);
});
