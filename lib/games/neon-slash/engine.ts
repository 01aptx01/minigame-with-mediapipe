import type {
  GamePhase,
  GameState,
  NormalizedLandmark,
  PlayerId,
  PlayerStats,
  SlashGameMode,
  Target,
  TargetKind,
} from './types';

export const ROUND_DURATION_SEC = 60;
export const SABOTAGE_DURATION_SEC = 3.0;
export const COMBO_WINDOW_SEC = 1.8;
export const MAX_MULTIPLIER = 5;
export const GRAVITY_PX_PER_SEC2 = 620;
export const BASE_GEM_POINTS = 10;
export const OPPONENT_GEM_PENALTY = -10;
export const SKULL_BOMB_PENALTY = -25;
export const SABOTAGE_BONUS_POINTS = 15;
export const INDEX_FINGERTIP_LANDMARK = 8;

function createInitialPlayerStats(): PlayerStats {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    multiplier: 1,
    lastSliceElapsed: -99,
    ownSlices: 0,
    penaltyHits: 0,
    sabotagesSent: 0,
    sabotageRemaining: 0,
  };
}

export function createInitialGameState(
  phase: GamePhase = 'title',
  mode: SlashGameMode = '1v1'
): GameState {
  return {
    phase,
    mode,
    timeRemaining: ROUND_DURATION_SEC,
    elapsed: 0,
    p1: createInitialPlayerStats(),
    p2: createInitialPlayerStats(),
    targets: [],
    slicedHalves: [],
    callouts: [],
    nextTargetId: 1,
    nextCalloutId: 1,
    spawnCooldown: 0.45,
    hitstopTimer: 0,
    screenShake: 0,
    lastTickSecond: ROUND_DURATION_SEC,
  };
}

export function getPlayerSideForX(
  x: number,
  width: number,
  mode: SlashGameMode = '1v1'
): PlayerId {
  if (mode === 'solo') return 'p1';
  return x < width * 0.5 ? 'p1' : 'p2';
}

export function projectLandmarkToCanvas(
  landmark: Pick<NormalizedLandmark, 'x' | 'y'>,
  width: number,
  height: number,
  mirror: boolean = true
): { x: number; y: number } {
  const normX = mirror ? 1 - landmark.x : landmark.x;
  return {
    x: Math.max(0, Math.min(width, normX * width)),
    y: Math.max(0, Math.min(height, landmark.y * height)),
  };
}

export function segmentIntersectsCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq <= 0.0001) {
    const distSq = (cx - x1) * (cx - x1) + (cy - y1) * (cy - y1);
    return distSq <= radius * radius;
  }

  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const distSq = (cx - closestX) * (cx - closestX) + (cy - closestY) * (cy - closestY);
  return distSq <= radius * radius;
}

export function calculateComboMultiplier(combo: number): number {
  if (combo <= 1) return 1;
  if (combo <= 3) return 2;
  if (combo <= 6) return 3;
  if (combo <= 10) return 4;
  return MAX_MULTIPLIER;
}

export function computeTugOfWarRatio(p1Score: number, p2Score: number): number {
  const diff = p1Score - p2Score;
  if (diff === 0) return 0.5;
  // Smooth logistic-style pressure curve centered at 0.5, bounded to [0.08, 0.92]
  const scale = Math.max(120, Math.abs(p1Score) + Math.abs(p2Score) + 80);
  const normalized = 0.5 + (diff / scale) * 0.45;
  return Math.max(0.08, Math.min(0.92, normalized));
}

export function determineWinner(
  p1Score: number,
  p2Score: number,
  mode: SlashGameMode = '1v1'
): PlayerId | 'draw' | 'solo' {
  if (mode === 'solo') return 'solo';
  if (p1Score > p2Score) return 'p1';
  if (p2Score > p1Score) return 'p2';
  return 'draw';
}

export function pickTargetKind(
  side: PlayerId,
  elapsed: number,
  rng: () => number = Math.random,
  mode: SlashGameMode = '1v1'
): TargetKind {
  const r = rng();
  if (mode === 'solo') {
    const bombChance = Math.min(0.24, 0.12 + (elapsed / ROUND_DURATION_SEC) * 0.12);
    return r < bombChance ? 'skull_bomb' : 'p1_gem';
  }

  const bombChance = Math.min(0.22, 0.12 + (elapsed / ROUND_DURATION_SEC) * 0.1);
  const sabotageChance = 0.1;
  const crossColorChance = 0.12;

  if (r < bombChance) return 'skull_bomb';
  if (r < bombChance + sabotageChance) return 'sabotage_orb';
  if (r < bombChance + sabotageChance + crossColorChance) {
    return side === 'p1' ? 'p2_gem' : 'p1_gem';
  }
  return side === 'p1' ? 'p1_gem' : 'p2_gem';
}

export function spawnTargetForSide(
  id: number,
  side: PlayerId,
  width: number,
  height: number,
  elapsed: number,
  rng: () => number = Math.random,
  mode: SlashGameMode = '1v1'
): Target {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(320, height);
  const halfWidth = safeWidth * 0.5;
  const margin = mode === 'solo' ? Math.min(96, safeWidth * 0.14) : Math.min(72, halfWidth * 0.18);

  const minX = mode === 'solo' ? margin : side === 'p1' ? margin : halfWidth + margin;
  const maxX = mode === 'solo' ? safeWidth - margin : side === 'p1' ? halfWidth - margin : safeWidth - margin;
  const x = minX + rng() * Math.max(40, maxX - minX);
  const y = safeHeight + 36;

  // Compute initial upward velocity to reach 55% to 82% up the screen
  const targetPeakHeight = safeHeight * (0.55 + rng() * 0.27);
  const vy = -Math.sqrt(2 * GRAVITY_PX_PER_SEC2 * targetPeakHeight);

  // Aim slightly inward toward the center of that player's half (or full arena in solo)
  const sideCenterX =
    mode === 'solo' ? safeWidth * 0.5 : side === 'p1' ? halfWidth * 0.5 : halfWidth * 1.5;
  const vx = (sideCenterX - x) * (0.35 + rng() * 0.35) + (rng() - 0.5) * 70;

  const kind = pickTargetKind(side, elapsed, rng, mode);
  const radius =
    kind === 'skull_bomb' ? 30 : kind === 'sabotage_orb' ? 28 : 32 + rng() * 6;

  return {
    id,
    kind,
    x,
    y,
    vx,
    vy,
    radius,
    rotation: rng() * Math.PI * 2,
    angularVelocity: (rng() - 0.5) * 4.5,
    sliced: false,
    hitFlash: 0,
    pulsePhase: rng() * Math.PI * 2,
  };
}

export interface SliceOutcome {
  pointsDelta: number;
  triggeredSabotageOn: PlayerId | null;
  wasPenalty: boolean;
  hitstop: number;
  shake: number;
  calloutText: string;
  calloutColor: string;
}

export function applySliceOutcome(
  state: GameState,
  target: Target,
  slicer: PlayerId
): SliceOutcome {
  const playerStats = slicer === 'p1' ? state.p1 : state.p2;
  const opponentId: PlayerId = slicer === 'p1' ? 'p2' : 'p1';
  const opponentStats = opponentId === 'p1' ? state.p1 : state.p2;

  target.sliced = true;

  const ownKind: TargetKind = slicer === 'p1' ? 'p1_gem' : 'p2_gem';
  const opponentKind: TargetKind = slicer === 'p1' ? 'p2_gem' : 'p1_gem';

  if (target.kind === ownKind) {
    const withinComboWindow = state.elapsed - playerStats.lastSliceElapsed <= COMBO_WINDOW_SEC;
    playerStats.combo = withinComboWindow ? playerStats.combo + 1 : 1;
    if (playerStats.combo > playerStats.maxCombo) {
      playerStats.maxCombo = playerStats.combo;
    }
    playerStats.multiplier = calculateComboMultiplier(playerStats.combo);
    playerStats.lastSliceElapsed = state.elapsed;
    playerStats.ownSlices += 1;

    const pointsDelta = BASE_GEM_POINTS * playerStats.multiplier;
    playerStats.score += pointsDelta;

    const color = slicer === 'p1' ? '#00E5FF' : '#FF2A6D';
    const label =
      playerStats.multiplier > 1
        ? `+${pointsDelta} (${playerStats.multiplier}x)`
        : `+${pointsDelta}`;

    return {
      pointsDelta,
      triggeredSabotageOn: null,
      wasPenalty: false,
      hitstop: 0.025,
      shake: 3,
      calloutText: label,
      calloutColor: color,
    };
  }

  if (target.kind === 'sabotage_orb') {
    playerStats.score += SABOTAGE_BONUS_POINTS;
    playerStats.sabotagesSent += 1;
    opponentStats.sabotageRemaining = SABOTAGE_DURATION_SEC;

    return {
      pointsDelta: SABOTAGE_BONUS_POINTS,
      triggeredSabotageOn: opponentId,
      wasPenalty: false,
      hitstop: 0.045,
      shake: 8,
      calloutText: `GLITCH +${SABOTAGE_BONUS_POINTS}!`,
      calloutColor: '#C084FC',
    };
  }

  // Penalty cases: Skull Bomb or Opponent's color gem
  playerStats.combo = 0;
  playerStats.multiplier = 1;
  playerStats.penaltyHits += 1;

  if (target.kind === 'skull_bomb') {
    playerStats.score = Math.max(0, playerStats.score + SKULL_BOMB_PENALTY);
    return {
      pointsDelta: SKULL_BOMB_PENALTY,
      triggeredSabotageOn: null,
      wasPenalty: true,
      hitstop: 0.06,
      shake: 14,
      calloutText: `${SKULL_BOMB_PENALTY} BOMB!`,
      calloutColor: '#F59E0B',
    };
  }

  // Opponent gem
  if (target.kind === opponentKind) {
    playerStats.score = Math.max(0, playerStats.score + OPPONENT_GEM_PENALTY);
    return {
      pointsDelta: OPPONENT_GEM_PENALTY,
      triggeredSabotageOn: null,
      wasPenalty: true,
      hitstop: 0.035,
      shake: 7,
      calloutText: `${OPPONENT_GEM_PENALTY} WRONG COLOR`,
      calloutColor: '#EF4444',
    };
  }

  return {
    pointsDelta: 0,
    triggeredSabotageOn: null,
    wasPenalty: false,
    hitstop: 0,
    shake: 0,
    calloutText: '',
    calloutColor: '#FFFFFF',
  };
}

export function getTargetColor(kind: TargetKind): string {
  switch (kind) {
    case 'p1_gem':
      return '#00E5FF';
    case 'p2_gem':
      return '#FF2A6D';
    case 'skull_bomb':
      return '#F59E0B';
    case 'sabotage_orb':
      return '#A855F7';
  }
}

export function stepGameSimulation(
  state: GameState,
  rawDt: number,
  width: number,
  height: number,
  rng: () => number = Math.random
): { roundEnded: boolean; tickSecond: number | null } {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);

  if (state.phase !== 'playing') {
    return { roundEnded: false, tickSecond: null };
  }

  // Decay hitstop & camera shake in real dt
  if (state.screenShake > 0) {
    state.screenShake = Math.max(0, state.screenShake - dt * 36);
  }

  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return { roundEnded: false, tickSecond: null };
  }

  state.elapsed += dt;
  state.timeRemaining = Math.max(0, state.timeRemaining - dt);

  // Sabotage timers decay
  if (state.p1.sabotageRemaining > 0) {
    state.p1.sabotageRemaining = Math.max(0, state.p1.sabotageRemaining - dt);
  }
  if (state.p2.sabotageRemaining > 0) {
    state.p2.sabotageRemaining = Math.max(0, state.p2.sabotageRemaining - dt);
  }

  // Expire stale combos cleanly
  if (state.p1.combo > 0 && state.elapsed - state.p1.lastSliceElapsed > COMBO_WINDOW_SEC) {
    state.p1.combo = 0;
    state.p1.multiplier = 1;
  }
  if (state.p2.combo > 0 && state.elapsed - state.p2.lastSliceElapsed > COMBO_WINDOW_SEC) {
    state.p2.combo = 0;
    state.p2.multiplier = 1;
  }

  // Countdown tick check (last 5 seconds)
  let tickSecond: number | null = null;
  const ceilSec = Math.ceil(state.timeRemaining);
  if (ceilSec < state.lastTickSecond) {
    state.lastTickSecond = ceilSec;
    if (ceilSec <= 5 && ceilSec >= 1) {
      tickSecond = ceilSec;
    }
  }

  // Wave spawning across both halves (1v1) or full arena (solo)
  state.spawnCooldown -= dt;
  if (state.spawnCooldown <= 0 && state.timeRemaining > 1.2) {
    const progress = state.elapsed / ROUND_DURATION_SEC;
    const baseInterval = Math.max(0.55, 1.15 - progress * 0.5);
    state.spawnCooldown = baseInterval * (0.8 + rng() * 0.4);

    if (state.mode === 'solo') {
      const first = spawnTargetForSide(
        state.nextTargetId++,
        'p1',
        width,
        height,
        state.elapsed,
        rng,
        'solo'
      );
      const second = spawnTargetForSide(
        state.nextTargetId++,
        'p1',
        width,
        height,
        state.elapsed,
        rng,
        'solo'
      );
      state.targets.push(first, second);
      if (progress > 0.35 && rng() < 0.45) {
        state.targets.push(
          spawnTargetForSide(state.nextTargetId++, 'p1', width, height, state.elapsed, rng, 'solo')
        );
      }
    } else {
      // Spawn symmetrical or dual-side wave so both P1 and P2 stay engaged
      const p1Target = spawnTargetForSide(state.nextTargetId++, 'p1', width, height, state.elapsed, rng, '1v1');
      const p2Target = spawnTargetForSide(state.nextTargetId++, 'p2', width, height, state.elapsed, rng, '1v1');
      state.targets.push(p1Target, p2Target);

      // Occasional extra target during mid/late round
      if (progress > 0.35 && rng() < 0.45) {
        const bonusSide: PlayerId = rng() < 0.5 ? 'p1' : 'p2';
        state.targets.push(
          spawnTargetForSide(state.nextTargetId++, bonusSide, width, height, state.elapsed, rng, '1v1')
        );
      }
    }
  }

  // Update active targets (O(1) swap-and-pop removal)
  for (let i = state.targets.length - 1; i >= 0; i--) {
    const t = state.targets[i];
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.vy += GRAVITY_PX_PER_SEC2 * dt;
    t.rotation += t.angularVelocity * dt;
    t.pulsePhase += dt * 6;

    // Keep targets mostly within arena horizontal bounds via soft bounce
    if (t.x < t.radius + 8 && t.vx < 0) {
      t.x = t.radius + 8;
      t.vx = Math.abs(t.vx) * 0.7;
    } else if (t.x > width - t.radius - 8 && t.vx > 0) {
      t.x = width - t.radius - 8;
      t.vx = -Math.abs(t.vx) * 0.7;
    }

    if (t.sliced || t.y > height + 90) {
      const lastIdx = state.targets.length - 1;
      if (i !== lastIdx) state.targets[i] = state.targets[lastIdx];
      state.targets.pop();
    }
  }

  // Update sliced halves (O(1) swap-and-pop removal)
  for (let i = state.slicedHalves.length - 1; i >= 0; i--) {
    const h = state.slicedHalves[i];
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.vy += GRAVITY_PX_PER_SEC2 * 1.15 * dt;
    h.rotation += h.angularVelocity * dt;
    h.life += dt;
    h.alpha = Math.max(0, 1 - h.life / h.maxLife);
    if (h.life >= h.maxLife || h.y > height + 100) {
      const lastIdx = state.slicedHalves.length - 1;
      if (i !== lastIdx) state.slicedHalves[i] = state.slicedHalves[lastIdx];
      state.slicedHalves.pop();
    }
  }

  // Update floating callouts (O(1) swap-and-pop removal)
  for (let i = state.callouts.length - 1; i >= 0; i--) {
    const c = state.callouts[i];
    c.y += c.vy * dt;
    c.life += dt;
    if (c.life >= c.maxLife) {
      const lastIdx = state.callouts.length - 1;
      if (i !== lastIdx) state.callouts[i] = state.callouts[lastIdx];
      state.callouts.pop();
    }
  }

  if (state.timeRemaining <= 0) {
    state.phase = 'gameover';
    return { roundEnded: true, tickSecond };
  }

  return { roundEnded: false, tickSecond };
}
