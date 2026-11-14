import type {
  ActiveSpell,
  NormalizedLandmark,
  PlayerId,
  SorcererGameState,
  SorcererMode,
  SorcererPhase,
  SorcererPlayerState,
  SpellKind,
} from './types';

export const SORCERER_ROUND_DURATION_SEC = 60;
export const SORCERER_MAX_HP = 100;
export const CLASH_INTERVAL_SEC = 1.65;
export const CRIT_CHARGE_DURATION_SEC = 1.25;

export function getSpellMeta(spell: SpellKind): {
  label: string;
  short: string;
  color: string;
} {
  switch (spell) {
    case 'lightning':
      return { label: 'Lightning Bolt', short: '✌️ BOLT', color: '#00E5FF' };
    case 'shield':
      return { label: 'Reflect Shield', short: '🖐️ SHIELD', color: '#10B981' };
    case 'crit':
      return { label: 'Arcane Fist', short: '✊ CRIT', color: '#F59E0B' };
    default:
      return { label: 'Channeling...', short: 'NONE', color: '#64748B' };
  }
}

function distSq2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function isFingerExtended(
  wrist: NormalizedLandmark,
  pip: NormalizedLandmark,
  tip: NormalizedLandmark
): boolean {
  const wristToTip = distSq2D(wrist, tip);
  const wristToPip = distSq2D(wrist, pip);
  return wristToTip > wristToPip * 1.25;
}

/**
 * Classifies MediaPipe 21-landmark hand skeleton into Sorcerer's Duel spells:
 * - Two fingers (Index + Middle up, Ring + Pinky curled) => 'lightning'
 * - Open palm (4 fingers extended) => 'shield'
 * - Closed fist (all 4 fingers curled) => 'crit'
 */
export function classifySorcererGesture(landmarks: NormalizedLandmark[]): SpellKind {
  if (!landmarks || landmarks.length < 21) return 'none';
  const wrist = landmarks[0];
  const indexUp = isFingerExtended(wrist, landmarks[6], landmarks[8]);
  const middleUp = isFingerExtended(wrist, landmarks[10], landmarks[12]);
  const ringUp = isFingerExtended(wrist, landmarks[14], landmarks[16]);
  const pinkyUp = isFingerExtended(wrist, landmarks[18], landmarks[20]);

  if (indexUp && middleUp && ringUp && pinkyUp) {
    return 'shield';
  }
  if (indexUp && middleUp && !ringUp && !pinkyUp) {
    return 'lightning';
  }
  if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
    return 'crit';
  }
  return 'none';
}

function createInitialSorcererPlayer(): SorcererPlayerState {
  return {
    hp: SORCERER_MAX_HP,
    maxHp: SORCERER_MAX_HP,
    score: 0,
    wins: 0,
    combo: 0,
    maxCombo: 0,
    activeSpell: 'none',
    chargeProgress: 0,
    shieldActiveTimer: 0,
    hitFlashTimer: 0,
    handCenterNorm: null,
    calloutText: '',
    calloutColor: '#00E5FF',
    calloutLife: 0,
  };
}

export function createInitialSorcererState(
  phase: SorcererPhase = 'title',
  mode: SorcererMode = '1v1'
): SorcererGameState {
  return {
    phase,
    mode,
    timeRemaining: SORCERER_ROUND_DURATION_SEC,
    elapsed: 0,
    clashCooldown: CLASH_INTERVAL_SEC,
    clashInterval: CLASH_INTERVAL_SEC,
    botDecisionTimer: 0.4,
    botSpell: 'shield',
    p1: createInitialSorcererPlayer(),
    p2: createInitialSorcererPlayer(),
    effects: [],
    nextEffectId: 1,
    screenShake: 0,
    hitstopTimer: 0,
    lastTickSecond: SORCERER_ROUND_DURATION_SEC,
  };
}

export interface RpsClashResolution {
  winner: PlayerId | 'clash' | 'none';
  p1DamageTaken: number;
  p2DamageTaken: number;
  p1ScoreGain: number;
  p2ScoreGain: number;
  reflectedBy: PlayerId | null;
  interruptedCrit: PlayerId | null;
  effectKind: 'bolt' | 'meteor' | 'reflect' | 'clash_ring' | null;
  effectFrom: PlayerId;
  effectTo: PlayerId;
  effectColor: string;
}

/**
 * Resolves a real-time Rock-Paper-Scissors magic clash:
 * - Lightning (✌️) beats Crit Fist (✊): zaps & interrupts charge!
 * - Reflect Shield (🖐️) beats Lightning (✌️): bounces bolt back!
 * - Crit Fist (✊) beats Reflect Shield (🖐️): shatters shield!
 */
export function resolveSpellClash(
  p1Spell: SpellKind,
  p2Spell: SpellKind,
  p1Charge: number,
  p2Charge: number
): RpsClashResolution {
  if (p1Spell === 'none' && p2Spell === 'none') {
    return {
      winner: 'none',
      p1DamageTaken: 0,
      p2DamageTaken: 0,
      p1ScoreGain: 0,
      p2ScoreGain: 0,
      reflectedBy: null,
      interruptedCrit: null,
      effectKind: null,
      effectFrom: 'p1',
      effectTo: 'p2',
      effectColor: '#64748B',
    };
  }

  if (p1Spell === p2Spell) {
    return {
      winner: 'clash',
      p1DamageTaken: 0,
      p2DamageTaken: 0,
      p1ScoreGain: 35,
      p2ScoreGain: 35,
      reflectedBy: null,
      interruptedCrit: null,
      effectKind: 'clash_ring',
      effectFrom: 'p1',
      effectTo: 'p2',
      effectColor: getSpellMeta(p1Spell).color,
    };
  }

  // Unopposed spell vs none
  if (p2Spell === 'none') {
    const dmg = p1Spell === 'crit' ? Math.round(18 + p1Charge * 16) : p1Spell === 'shield' ? 10 : 16;
    return {
      winner: 'p1',
      p1DamageTaken: 0,
      p2DamageTaken: dmg,
      p1ScoreGain: dmg * 6,
      p2ScoreGain: 0,
      reflectedBy: null,
      interruptedCrit: null,
      effectKind: p1Spell === 'crit' ? 'meteor' : 'bolt',
      effectFrom: 'p1',
      effectTo: 'p2',
      effectColor: getSpellMeta(p1Spell).color,
    };
  }

  if (p1Spell === 'none') {
    const dmg = p2Spell === 'crit' ? Math.round(18 + p2Charge * 16) : p2Spell === 'shield' ? 10 : 16;
    return {
      winner: 'p2',
      p1DamageTaken: dmg,
      p2DamageTaken: 0,
      p1ScoreGain: 0,
      p2ScoreGain: dmg * 6,
      reflectedBy: null,
      interruptedCrit: null,
      effectKind: p2Spell === 'crit' ? 'meteor' : 'bolt',
      effectFrom: 'p2',
      effectTo: 'p1',
      effectColor: getSpellMeta(p2Spell).color,
    };
  }

  const beats = (a: ActiveSpell, b: ActiveSpell): boolean =>
    (a === 'lightning' && b === 'crit') ||
    (a === 'shield' && b === 'lightning') ||
    (a === 'crit' && b === 'shield');

  const p1Won = beats(p1Spell, p2Spell);
  const winner: PlayerId = p1Won ? 'p1' : 'p2';
  const winSpell = p1Won ? p1Spell : p2Spell;
  const loseSpell = p1Won ? p2Spell : p1Spell;
  const winCharge = p1Won ? p1Charge : p2Charge;

  let dmg = 20;
  let effectKind: 'bolt' | 'meteor' | 'reflect' = 'bolt';
  let reflectedBy: PlayerId | null = null;
  let interruptedCrit: PlayerId | null = null;

  if (winSpell === 'shield' && loseSpell === 'lightning') {
    dmg = 18;
    effectKind = 'reflect';
    reflectedBy = winner;
  } else if (winSpell === 'crit' && loseSpell === 'shield') {
    dmg = Math.round(22 + winCharge * 14);
    effectKind = 'meteor';
  } else if (winSpell === 'lightning' && loseSpell === 'crit') {
    dmg = 22;
    effectKind = 'bolt';
    interruptedCrit = p1Won ? 'p2' : 'p1';
  }

  return {
    winner,
    p1DamageTaken: p1Won ? 0 : dmg,
    p2DamageTaken: p1Won ? dmg : 0,
    p1ScoreGain: p1Won ? dmg * 8 : 0,
    p2ScoreGain: p1Won ? 0 : dmg * 8,
    reflectedBy,
    interruptedCrit,
    effectKind,
    effectFrom: winner,
    effectTo: winner === 'p1' ? 'p2' : 'p1',
    effectColor: getSpellMeta(winSpell).color,
  };
}

export function computeSorcererTugRatio(p1: SorcererPlayerState, p2: SorcererPlayerState): number {
  const diff = p1.hp - p2.hp;
  if (diff === 0) {
    const scoreDiff = p1.score - p2.score;
    if (scoreDiff === 0) return 0.5;
    return Math.max(0.15, Math.min(0.85, 0.5 + (scoreDiff / 800) * 0.35));
  }
  return Math.max(0.08, Math.min(0.92, 0.5 + (diff / SORCERER_MAX_HP) * 0.44));
}

export function determineSorcererWinner(
  p1: SorcererPlayerState,
  p2: SorcererPlayerState
): PlayerId | 'draw' {
  if (p1.hp !== p2.hp) return p1.hp > p2.hp ? 'p1' : 'p2';
  if (p1.score !== p2.score) return p1.score > p2.score ? 'p1' : 'p2';
  return 'draw';
}

export interface SorcererStepOutcome {
  roundEnded: boolean;
  tickSecond: number | null;
  clashed: RpsClashResolution | null;
  fullCritFiredBy: PlayerId | null;
}

const BOT_SPELLS: ActiveSpell[] = ['lightning', 'shield', 'crit'];

export function stepSorcererSimulation(
  state: SorcererGameState,
  rawDt: number,
  rng: () => number = Math.random
): SorcererStepOutcome {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const outcome: SorcererStepOutcome = {
    roundEnded: false,
    tickSecond: null,
    clashed: null,
    fullCritFiredBy: null,
  };

  if (state.phase !== 'playing') {
    return outcome;
  }

  if (state.screenShake > 0) {
    state.screenShake = Math.max(0, state.screenShake - dt * 36);
  }

  for (const pState of [state.p1, state.p2]) {
    if (pState.hitFlashTimer > 0) pState.hitFlashTimer = Math.max(0, pState.hitFlashTimer - dt);
    if (pState.shieldActiveTimer > 0) {
      pState.shieldActiveTimer = Math.max(0, pState.shieldActiveTimer - dt);
    }
    if (pState.calloutLife > 0) pState.calloutLife = Math.max(0, pState.calloutLife - dt);
  }

  for (let i = state.effects.length - 1; i >= 0; i--) {
    const fx = state.effects[i];
    fx.life += dt;
    if (fx.life >= fx.maxLife) {
      const lastIdx = state.effects.length - 1;
      if (i !== lastIdx) state.effects[i] = state.effects[lastIdx];
      state.effects.pop();
    }
  }

  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return outcome;
  }

  state.elapsed += dt;
  state.timeRemaining = Math.max(0, state.timeRemaining - dt);

  const ceilSec = Math.ceil(state.timeRemaining);
  if (ceilSec < state.lastTickSecond) {
    state.lastTickSecond = ceilSec;
    if (ceilSec <= 5 && ceilSec >= 1) {
      outcome.tickSecond = ceilSec;
    }
  }

  // In 1P Solo mode, run AI Arcane Sorcerer opponent
  if (state.mode === 'solo') {
    state.botDecisionTimer -= dt;
    if (state.botDecisionTimer <= 0) {
      state.botDecisionTimer = 0.75 + rng() * 0.7;
      state.botSpell = BOT_SPELLS[Math.floor(rng() * BOT_SPELLS.length)] ?? 'lightning';
    }
    state.p2.activeSpell = state.botSpell;
  }

  // Update Fist Charge (crit) and Shield aura timers
  for (const id of ['p1', 'p2'] as const) {
    const pState = id === 'p1' ? state.p1 : state.p2;
    const opp = id === 'p1' ? state.p2 : state.p1;

    if (pState.activeSpell === 'shield') {
      pState.shieldActiveTimer = 0.12;
    }

    if (pState.activeSpell === 'crit') {
      pState.chargeProgress = Math.min(1, pState.chargeProgress + dt / CRIT_CHARGE_DURATION_SEC);
      if (pState.chargeProgress >= 1) {
        // Immediate Critical Meteor Strike!
        pState.chargeProgress = 0;
        const blockedByLightning = opp.activeSpell === 'lightning';
        const dmg = blockedByLightning ? 12 : opp.activeSpell === 'shield' ? 30 : 24;
        opp.hp = Math.max(0, opp.hp - dmg);
        opp.hitFlashTimer = 0.3;
        opp.calloutText = `CRIT -${dmg}!`;
        opp.calloutColor = '#EF4444';
        opp.calloutLife = 0.95;

        pState.score += dmg * 9;
        pState.combo += 1;
        if (pState.combo > pState.maxCombo) pState.maxCombo = pState.combo;
        pState.wins += 1;
        pState.calloutText = 'MAX CRIT METEOR!';
        pState.calloutColor = '#F59E0B';
        pState.calloutLife = 0.95;

        state.effects.push({
          id: state.nextEffectId++,
          kind: 'meteor',
          from: id,
          to: id === 'p1' ? 'p2' : 'p1',
          color: '#F59E0B',
          life: 0,
          maxLife: 0.55,
          seed: rng(),
        });
        state.screenShake = Math.max(state.screenShake, 12);
        state.hitstopTimer = Math.max(state.hitstopTimer, 0.045);
        state.clashCooldown = state.clashInterval;
        outcome.fullCritFiredBy = id;
      }
    } else {
      pState.chargeProgress = Math.max(0, pState.chargeProgress - dt * 1.4);
    }
  }

  // Real-time RPS Clash Beat
  if (!outcome.fullCritFiredBy) {
    state.clashCooldown -= dt;
    if (state.clashCooldown <= 0) {
      state.clashCooldown = state.clashInterval;
      const res = resolveSpellClash(
        state.p1.activeSpell,
        state.p2.activeSpell,
        state.p1.chargeProgress,
        state.p2.chargeProgress
      );
      outcome.clashed = res;

      if (res.effectKind) {
        state.effects.push({
          id: state.nextEffectId++,
          kind: res.effectKind,
          from: res.effectFrom,
          to: res.effectTo,
          color: res.effectColor,
          life: 0,
          maxLife: 0.52,
          seed: rng(),
        });
      }

      if (res.winner === 'p1' || res.winner === 'p2') {
        const winState = res.winner === 'p1' ? state.p1 : state.p2;
        const loseState = res.winner === 'p1' ? state.p2 : state.p1;
        const dmg = res.winner === 'p1' ? res.p2DamageTaken : res.p1DamageTaken;

        loseState.hp = Math.max(0, loseState.hp - dmg);
        loseState.combo = 0;
        loseState.hitFlashTimer = 0.28;
        loseState.calloutText = `-${dmg} HP`;
        loseState.calloutColor = '#EF4444';
        loseState.calloutLife = 0.85;

        if (res.interruptedCrit) {
          loseState.chargeProgress = 0;
          loseState.calloutText = `INTERRUPTED -${dmg}!`;
        }

        winState.score += res.winner === 'p1' ? res.p1ScoreGain : res.p2ScoreGain;
        winState.wins += 1;
        winState.combo += 1;
        if (winState.combo > winState.maxCombo) winState.maxCombo = winState.combo;
        winState.calloutText = res.reflectedBy ? 'REFLECTED!' : 'COUNTER HIT!';
        winState.calloutColor = res.effectColor;
        winState.calloutLife = 0.85;

        if (winState.activeSpell === 'crit') {
          winState.chargeProgress = 0;
        }

        state.screenShake = Math.max(state.screenShake, 9);
        state.hitstopTimer = Math.max(state.hitstopTimer, 0.035);
      } else if (res.winner === 'clash') {
        state.p1.score += res.p1ScoreGain;
        state.p2.score += res.p2ScoreGain;
        state.p1.calloutText = 'ARCANE CLASH!';
        state.p2.calloutText = 'ARCANE CLASH!';
        state.p1.calloutColor = res.effectColor;
        state.p2.calloutColor = res.effectColor;
        state.p1.calloutLife = 0.65;
        state.p2.calloutLife = 0.65;
        state.screenShake = Math.max(state.screenShake, 5);
      }
    }
  }

  // KO or Clock end check
  if (state.p1.hp <= 0 || state.p2.hp <= 0 || state.timeRemaining <= 0) {
    state.phase = 'gameover';
    outcome.roundEnded = true;
    return outcome;
  }

  return outcome;
}
