import { assignPoseToZone } from '@/lib/games/pose-match/engine';
import type {
  BodyBox,
  BodyStance,
  DodgeGameMode,
  DodgeGamePhase,
  DodgeGameState,
  DodgePlayerState,
  LaserObstacle,
  LaserPattern,
  LaserRect,
  NormalizedLandmark,
  PlayerId,
} from './types';

export { assignPoseToZone };

export const DODGE_ROUND_DURATION_SEC = 60;
export const DODGE_BPM = 128;
export const BEAT_SEC = 60 / DODGE_BPM; // ~0.46875s
export const SIXTEENTH_SEC = BEAT_SEC / 4;
export const OVERDRIVE_THRESHOLD_SEC = 15;
export const PLAYER_MAX_HP = 100;
export const LASER_HIT_DAMAGE = 20;
export const INVULN_DURATION_SEC = 0.55;
export const BASE_DODGE_POINTS = 50;
export const SURVIVAL_HP_BONUS_PER_HP = 5;

export function createNeutralBodyBox(): BodyBox {
  return {
    minX: 0.39,
    maxX: 0.61,
    minY: 0.24,
    maxY: 0.78,
    centerX: 0.5,
    centerY: 0.51,
    stance: 'standing',
    fromLivePose: false,
  };
}

function createInitialPlayerState(): DodgePlayerState {
  return {
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    score: 0,
    combo: 0,
    maxCombo: 0,
    dodgedCount: 0,
    hitsTaken: 0,
    eliminated: false,
    invulnTimer: 0,
    hitFlashTimer: 0,
    bodyBox: createNeutralBodyBox(),
    calloutText: '',
    calloutColor: '#00E5FF',
    calloutLife: 0,
  };
}

export function createInitialDodgeGameState(
  phase: DodgeGamePhase = 'title',
  mode: DodgeGameMode = '1v1'
): DodgeGameState {
  return {
    phase,
    mode,
    timeRemaining: DODGE_ROUND_DURATION_SEC,
    elapsed: 0,
    bpm: DODGE_BPM,
    beatPhase: 0,
    lastBeatStep: -1,
    overdrive: false,
    p1: createInitialPlayerState(),
    p2: createInitialPlayerState(),
    lasers: [],
    nextLaserId: 1,
    nextSpawnBeat: 2,
    screenShake: 0,
    hitstopTimer: 0,
    lastTickSecond: DODGE_ROUND_DURATION_SEC,
  };
}

export function getLaserPatternSpec(pattern: LaserPattern): {
  label: string;
  rect: LaserRect;
  color: string;
} {
  switch (pattern) {
    case 'high_bar':
      return {
        label: 'DUCK!',
        rect: { minX: 0.03, maxX: 0.97, minY: 0.08, maxY: 0.53 },
        color: '#F59E0B',
      };
    case 'left_wall':
      return {
        label: 'DODGE RIGHT →',
        rect: { minX: 0.0, maxX: 0.54, minY: 0.12, maxY: 0.92 },
        color: '#FF2A6D',
      };
    case 'right_wall':
      return {
        label: '← DODGE LEFT',
        rect: { minX: 0.46, maxX: 1.0, minY: 0.12, maxY: 0.92 },
        color: '#00E5FF',
      };
    case 'split_gate':
      return {
        label: 'SPLIT! STEP SIDE',
        rect: { minX: 0.36, maxX: 0.64, minY: 0.12, maxY: 0.92 },
        color: '#A855F7',
      };
  }
}

export function boxesOverlap(a: LaserRect, b: LaserRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function computeBodyBoundingBox(
  landmarks: NormalizedLandmark[],
  mode: DodgeGameMode,
  zone: PlayerId,
  mirror: boolean = true
): BodyBox | null {
  const nose = landmarks[0];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];

  if (!nose || !leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const toZoneX = (rawX: number): number => {
    const screenX = mirror ? 1 - rawX : rawX;
    if (mode === 'solo') {
      return Math.max(0.03, Math.min(0.97, screenX));
    }
    const local = zone === 'p1' ? screenX * 2 : (screenX - 0.5) * 2;
    return Math.max(0.03, Math.min(0.97, local));
  };

  const lsX = toZoneX(leftShoulder.x);
  const rsX = toZoneX(rightShoulder.x);
  const lhX = toZoneX(leftHip.x);
  const rhX = toZoneX(rightHip.x);
  const noseX = toZoneX(nose.x);

  const rawMinX = Math.min(lsX, rsX, lhX, rhX, noseX);
  const rawMaxX = Math.max(lsX, rsX, lhX, rhX, noseX);
  const padX = 0.035;

  const minX = Math.max(0.02, rawMinX - padX);
  const maxX = Math.min(0.98, rawMaxX + padX);
  const minY = Math.max(0.05, nose.y - 0.065);
  const maxY = Math.min(0.95, Math.max(leftHip.y, rightHip.y) + 0.06);

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;

  let stance: BodyStance = 'standing';
  if (minY >= 0.54) {
    stance = 'ducking';
  } else if (centerX < 0.37) {
    stance = 'lean_left';
  } else if (centerX > 0.63) {
    stance = 'lean_right';
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX,
    centerY,
    stance,
    fromLivePose: true,
  };
}

export function stepFallbackBodyBox(
  box: BodyBox,
  input: { left: boolean; right: boolean; duck: boolean },
  dt: number
): BodyBox {
  const targetCenterX = input.left && !input.right ? 0.2 : input.right && !input.left ? 0.8 : 0.5;
  const targetMinY = input.duck ? 0.58 : 0.24;
  const targetMaxY = input.duck ? 0.9 : 0.78;
  const halfW = 0.11;

  const lerp = Math.min(1, dt * 16);
  const nextCenterX = box.centerX + (targetCenterX - box.centerX) * lerp;
  const nextMinY = box.minY + (targetMinY - box.minY) * lerp;
  const nextMaxY = box.maxY + (targetMaxY - box.maxY) * lerp;

  let stance: BodyStance = 'standing';
  if (nextMinY >= 0.54) stance = 'ducking';
  else if (nextCenterX < 0.37) stance = 'lean_left';
  else if (nextCenterX > 0.63) stance = 'lean_right';

  return {
    minX: Math.max(0.02, nextCenterX - halfW),
    maxX: Math.min(0.98, nextCenterX + halfW),
    minY: nextMinY,
    maxY: nextMaxY,
    centerX: nextCenterX,
    centerY: (nextMinY + nextMaxY) * 0.5,
    stance,
    fromLivePose: false,
  };
}

export function computeDodgeTugRatio(
  mode: DodgeGameMode,
  p1: DodgePlayerState,
  p2: DodgePlayerState
): number {
  if (mode === 'solo') {
    return Math.max(0, Math.min(1, p1.hp / p1.maxHp));
  }
  const p1Power = p1.hp * 12 + p1.score;
  const p2Power = p2.hp * 12 + p2.score;
  const diff = p1Power - p2Power;
  if (diff === 0) return 0.5;
  const scale = Math.max(600, p1Power + p2Power);
  return Math.max(0.08, Math.min(0.92, 0.5 + (diff / scale) * 0.44));
}

export function determineDodgeWinner(
  mode: DodgeGameMode,
  p1: DodgePlayerState,
  p2: DodgePlayerState
): 'p1' | 'p2' | 'draw' | 'solo' | 'eliminated' {
  if (mode === 'solo') {
    return p1.eliminated ? 'eliminated' : 'solo';
  }
  if (p1.eliminated && !p2.eliminated) return 'p2';
  if (p2.eliminated && !p1.eliminated) return 'p1';
  if (p1.hp !== p2.hp) return p1.hp > p2.hp ? 'p1' : 'p2';
  if (p1.score !== p2.score) return p1.score > p2.score ? 'p1' : 'p2';
  return 'draw';
}

const PATTERN_POOL: LaserPattern[] = ['high_bar', 'left_wall', 'right_wall', 'split_gate'];

export function pickLaserPattern(
  previousPattern: LaserPattern | null,
  rng: () => number = Math.random
): LaserPattern {
  const candidates = previousPattern
    ? PATTERN_POOL.filter((p) => p !== previousPattern)
    : PATTERN_POOL;
  const idx = Math.floor(rng() * candidates.length);
  return candidates[idx] ?? 'high_bar';
}

export interface DodgeSimulationOutcome {
  roundEnded: boolean;
  survivedFullSong: boolean;
  tickSecond: number | null;
  beatStepTriggered: number | null;
  overdriveStarted: boolean;
  hits: Array<{ zone: PlayerId; pattern: LaserPattern }>;
  dodges: Array<{ zone: PlayerId; combo: number }>;
}

export function stepDodgeSimulation(
  state: DodgeGameState,
  rawDt: number,
  rng: () => number = Math.random
): DodgeSimulationOutcome {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const outcome: DodgeSimulationOutcome = {
    roundEnded: false,
    survivedFullSong: false,
    tickSecond: null,
    beatStepTriggered: null,
    overdriveStarted: false,
    hits: [],
    dodges: [],
  };

  if (state.phase !== 'playing') {
    return outcome;
  }

  if (state.screenShake > 0) {
    state.screenShake = Math.max(0, state.screenShake - dt * 36);
  }

  // Decay visual flash/callout timers smoothly even during hitstop
  for (const pState of [state.p1, state.p2]) {
    if (pState.hitFlashTimer > 0) pState.hitFlashTimer = Math.max(0, pState.hitFlashTimer - dt);
    if (pState.calloutLife > 0) pState.calloutLife = Math.max(0, pState.calloutLife - dt);
  }

  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return outcome;
  }

  state.elapsed += dt;
  state.timeRemaining = Math.max(0, state.timeRemaining - dt);
  state.beatPhase = (state.elapsed % BEAT_SEC) / BEAT_SEC;

  // Decay player invuln timers
  if (state.p1.invulnTimer > 0) state.p1.invulnTimer = Math.max(0, state.p1.invulnTimer - dt);
  if (state.p2.invulnTimer > 0) state.p2.invulnTimer = Math.max(0, state.p2.invulnTimer - dt);

  if (!state.overdrive && state.timeRemaining <= OVERDRIVE_THRESHOLD_SEC) {
    state.overdrive = true;
    outcome.overdriveStarted = true;
  }

  // EDM 16th-note beat sequencer trigger
  const currentStep = Math.floor(state.elapsed / SIXTEENTH_SEC);
  if (currentStep > state.lastBeatStep) {
    state.lastBeatStep = currentStep;
    outcome.beatStepTriggered = currentStep;
  }

  // Countdown ticks for final 5s
  const ceilSec = Math.ceil(state.timeRemaining);
  if (ceilSec < state.lastTickSecond) {
    state.lastTickSecond = ceilSec;
    if (ceilSec <= 5 && ceilSec >= 1) {
      outcome.tickSecond = ceilSec;
    }
  }

  // Spawn beat-synchronized incoming lasers
  const currentBeat = state.elapsed / BEAT_SEC;
  const travelBeats = state.overdrive ? 2.4 : state.elapsed > 20 ? 2.8 : 3.2;
  const travelTimeSec = travelBeats * BEAT_SEC;

  if (currentBeat >= state.nextSpawnBeat && state.timeRemaining > travelTimeSec + 0.4) {
    const beatGap = state.overdrive ? 2 : state.elapsed > 20 ? 3 : 4;
    state.nextSpawnBeat = currentBeat + beatGap;

    const lastLaser = state.lasers[state.lasers.length - 1];
    const pattern = pickLaserPattern(lastLaser ? lastLaser.pattern : null, rng);
    const spec = getLaserPatternSpec(pattern);
    const hitTime = state.elapsed + travelTimeSec;

    const spawnForZone = (zone: PlayerId): LaserObstacle => ({
      id: state.nextLaserId++,
      zone,
      pattern,
      label: spec.label,
      rect: spec.rect,
      spawnTime: state.elapsed,
      hitTime,
      z: 1.0,
      resolved: false,
      wasHit: false,
      color: spec.color,
    });

    state.lasers.push(spawnForZone('p1'));
    if (state.mode === '1v1') {
      state.lasers.push(spawnForZone('p2'));
    }
  }

  // Advance lasers in 3D perspective depth & run bounding-box collision at player plane
  for (let i = state.lasers.length - 1; i >= 0; i--) {
    const laser = state.lasers[i];
    const totalTravel = Math.max(0.1, laser.hitTime - laser.spawnTime);
    laser.z = (laser.hitTime - state.elapsed) / totalTravel;

    if (!laser.resolved && laser.z <= 0.08) {
      const pState = laser.zone === 'p1' ? state.p1 : state.p2;
      if (!pState.eliminated) {
        const hit = boxesOverlap(pState.bodyBox, laser.rect);
        if (hit && pState.invulnTimer <= 0) {
          laser.resolved = true;
          laser.wasHit = true;
          pState.hp = Math.max(0, pState.hp - LASER_HIT_DAMAGE);
          pState.combo = 0;
          pState.hitsTaken += 1;
          pState.invulnTimer = INVULN_DURATION_SEC;
          pState.hitFlashTimer = 0.25;
          pState.calloutText = `-${LASER_HIT_DAMAGE} HP HIT!`;
          pState.calloutColor = '#EF4444';
          pState.calloutLife = 0.9;

          state.screenShake = Math.max(state.screenShake, 12);
          state.hitstopTimer = Math.max(state.hitstopTimer, 0.045);

          if (pState.hp <= 0) {
            pState.eliminated = true;
            pState.calloutText = 'ELIMINATED!';
          }

          outcome.hits.push({ zone: laser.zone, pattern: laser.pattern });
        } else if (laser.z <= 0) {
          // Passed cleanly across player plane without touching bounding box!
          laser.resolved = true;
          pState.dodgedCount += 1;
          pState.combo += 1;
          if (pState.combo > pState.maxCombo) {
            pState.maxCombo = pState.combo;
          }
          const mult = Math.min(4, 1 + Math.floor(pState.combo / 3));
          const pts = BASE_DODGE_POINTS * mult * (state.overdrive ? 2 : 1);
          pState.score += pts;
          pState.calloutText = state.overdrive ? `DODGE +${pts} (2X)` : `DODGE +${pts}`;
          pState.calloutColor = laser.zone === 'p1' ? '#00E5FF' : '#FF2A6D';
          pState.calloutLife = 0.75;

          outcome.dodges.push({ zone: laser.zone, combo: pState.combo });
        }
      } else if (laser.z <= 0) {
        laser.resolved = true;
      }
    }

    if (laser.z < -0.18) {
      const lastIdx = state.lasers.length - 1;
      if (i !== lastIdx) state.lasers[i] = state.lasers[lastIdx];
      state.lasers.pop();
    }
  }

  // Check elimination finish conditions
  const p1Down = state.p1.eliminated;
  const p2Down = state.mode === '1v1' && state.p2.eliminated;

  if ((state.mode === 'solo' && p1Down) || (state.mode === '1v1' && (p1Down || p2Down))) {
    state.phase = 'gameover';
    outcome.roundEnded = true;
    outcome.survivedFullSong = false;
    return outcome;
  }

  // Survived until end of EDM track!
  if (state.timeRemaining <= 0) {
    state.p1.score += state.p1.hp * SURVIVAL_HP_BONUS_PER_HP;
    if (state.mode === '1v1') {
      state.p2.score += state.p2.hp * SURVIVAL_HP_BONUS_PER_HP;
    }
    state.phase = 'gameover';
    outcome.roundEnded = true;
    outcome.survivedFullSong = true;
    return outcome;
  }

  return outcome;
}
