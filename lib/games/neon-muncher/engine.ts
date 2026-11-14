import type {
  FaceMouthAnalysis,
  FallingItem,
  FallingItemKind,
  MuncherGameState,
  MuncherMode,
  MuncherPhase,
  MuncherPlayerState,
  MuncherSimEvent,
  NormalizedFaceLandmark,
  PlayerId,
} from './types';

export const MUNCHER_ROUND_DURATION_SEC = 45;
export const MOUTH_OPEN_THRESHOLD = 0.4;
export const BOMB_PENALTY_POINTS = 120;
export const BOMB_DEFLECT_POINTS = 25;
export const FEVER_DURATION_SEC = 5.5;

// MediaPipe FaceMesh 478-landmark indices
export const FACE_TOP_IDX = 10;
export const FACE_CHIN_IDX = 152;
export const LIP_TOP_INNER_IDX = 13;
export const LIP_BOTTOM_INNER_IDX = 14;
export const MOUTH_LEFT_IDX = 61;
export const MOUTH_RIGHT_IDX = 291;
export const LEFT_EYE_OUTER_IDX = 33;
export const RIGHT_EYE_OUTER_IDX = 263;
export const NOSE_TIP_IDX = 1;

export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

export const OUTER_LIPS_INDICES = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
] as const;

export const SNACK_CATALOG: Record<
  FallingItemKind,
  { label: string; emoji: string; color: string; points: number; radius: number }
> = {
  burger: { label: 'NEON BURGER', emoji: '🍔', color: '#F59E0B', points: 45, radius: 26 },
  ramen: { label: 'CYBER RAMEN', emoji: '🍜', color: '#00E5FF', points: 55, radius: 26 },
  donut: { label: 'TURBO DONUT', emoji: '🍩', color: '#EC4899', points: 40, radius: 24 },
  boba: { label: 'GOLD BOBA', emoji: '🧋', color: '#A855F7', points: 65, radius: 24 },
  chili: { label: 'FEVER CHILI', emoji: '🌶️', color: '#10B981', points: 90, radius: 23 },
  bomb: { label: 'SKULL BOMB', emoji: '💣', color: '#EF4444', points: 0, radius: 26 },
};

function createPlayerState(): MuncherPlayerState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    itemsMunched: 0,
    bombsDeflected: 0,
    bombsEaten: 0,
    peakMouthPct: 0,
    feverTimer: 0,
    stunTimer: 0,
    mouthXNorm: 0.5,
    mouthYNorm: 0.72,
    mouthOpenRatio: 0,
    isMouthOpen: false,
    headTiltRad: 0,
    comboTimeout: 0,
    calloutText: '',
    calloutColor: '#00E5FF',
    calloutLife: 0,
  };
}

export function createInitialMuncherState(
  phase: MuncherPhase = 'title',
  mode: MuncherMode = '1v1'
): MuncherGameState {
  return {
    phase,
    mode,
    timeRemaining: MUNCHER_ROUND_DURATION_SEC,
    spawnTimer: 0.45,
    nextItemId: 1,
    screenShake: 0,
    hitstopTimer: 0,
    bestShameScore: 0,
    items: [],
    p1: createPlayerState(),
    p2: createPlayerState(),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function analyzeFaceMouth(
  landmarks: NormalizedFaceLandmark[],
  width: number,
  height: number,
  mode: MuncherMode,
  mirrorX: boolean = true
): FaceMouthAnalysis | null {
  const top = landmarks[FACE_TOP_IDX];
  const chin = landmarks[FACE_CHIN_IDX];
  const lipTop = landmarks[LIP_TOP_INNER_IDX];
  const lipBot = landmarks[LIP_BOTTOM_INNER_IDX];
  const mouthL = landmarks[MOUTH_LEFT_IDX];
  const mouthR = landmarks[MOUTH_RIGHT_IDX];
  const eyeL = landmarks[LEFT_EYE_OUTER_IDX];
  const eyeR = landmarks[RIGHT_EYE_OUTER_IDX];
  const nose = landmarks[NOSE_TIP_IDX];

  if (!top || !chin || !lipTop || !lipBot || !mouthL || !mouthR || !eyeL || !eyeR || !nose) {
    return null;
  }

  const toScreen = (lm: NormalizedFaceLandmark) => ({
    x: (mirrorX ? 1 - lm.x : lm.x) * width,
    y: lm.y * height,
  });

  const sTop = toScreen(top);
  const sChin = toScreen(chin);
  const sLipTop = toScreen(lipTop);
  const sLipBot = toScreen(lipBot);
  const sMouthL = toScreen(mouthL);
  const sMouthR = toScreen(mouthR);
  const sEyeL = toScreen(eyeL);
  const sEyeR = toScreen(eyeR);
  const sNose = toScreen(nose);

  const faceHeightPx = Math.max(24, Math.hypot(sChin.x - sTop.x, sChin.y - sTop.y));
  const mouthGapPx = Math.hypot(sLipBot.x - sLipTop.x, sLipBot.y - sLipTop.y);
  const mouthWidthPx = Math.max(12, Math.hypot(sMouthR.x - sMouthL.x, sMouthR.y - sMouthL.y));

  // Normalize mouth gap relative to face height so distance from camera never breaks sensitivity
  const normalizedGap = mouthGapPx / faceHeightPx;
  const mouthOpenRatio = clamp((normalizedGap - 0.022) / 0.125, 0, 1);
  const isMouthOpen = mouthOpenRatio >= MOUTH_OPEN_THRESHOLD;

  const mouthX = (sLipTop.x + sLipBot.x) * 0.5;
  const mouthY = (sLipTop.y + sLipBot.y) * 0.5;

  // Compute eye roll angle in screen space (left-to-right eye on screen)
  const leftScreenEye = sEyeL.x <= sEyeR.x ? sEyeL : sEyeR;
  const rightScreenEye = sEyeL.x <= sEyeR.x ? sEyeR : sEyeL;
  const headTiltRad = Math.atan2(
    rightScreenEye.y - leftScreenEye.y,
    Math.max(1, rightScreenEye.x - leftScreenEye.x)
  );

  const zone: PlayerId = mode === 'solo' ? 'p1' : mouthX < width * 0.5 ? 'p1' : 'p2';

  return {
    zone,
    mouthX,
    mouthY,
    mouthWidthPx,
    mouthGapPx,
    mouthOpenRatio,
    isMouthOpen,
    headTiltRad,
    faceCenterX: sNose.x,
    faceCenterY: (sTop.y + sChin.y) * 0.5,
    faceRadiusPx: faceHeightPx * 0.55,
  };
}

export function getComboMultiplier(combo: number): number {
  if (combo >= 12) return 4;
  if (combo >= 7) return 3;
  if (combo >= 3) return 2;
  return 1;
}

export function spawnZoneItem(
  state: MuncherGameState,
  zone: PlayerId,
  width: number,
  forcedKind?: FallingItemKind
): FallingItem {
  const zoneX = state.mode === 'solo' ? 0 : zone === 'p1' ? 0 : width * 0.5;
  const zoneW = state.mode === 'solo' ? width : width * 0.5;

  const elapsed = MUNCHER_ROUND_DURATION_SEC - state.timeRemaining;
  const bombChance = clamp(0.18 + (elapsed / MUNCHER_ROUND_DURATION_SEC) * 0.14, 0.18, 0.34);

  let kind: FallingItemKind;
  if (forcedKind) {
    kind = forcedKind;
  } else {
    const r = Math.random();
    if (r < bombChance) {
      kind = 'bomb';
    } else if (r < bombChance + 0.09) {
      kind = 'chili';
    } else {
      const snacks: FallingItemKind[] = ['burger', 'ramen', 'donut', 'boba'];
      kind = snacks[Math.floor(Math.random() * snacks.length)];
    }
  }

  const meta = SNACK_CATALOG[kind];
  const margin = Math.min(54, zoneW * 0.15);
  const spawnX = zoneX + margin + Math.random() * Math.max(20, zoneW - margin * 2);
  const speedScale = 1 + (elapsed / MUNCHER_ROUND_DURATION_SEC) * 0.55;

  const item: FallingItem = {
    id: state.nextItemId++,
    kind,
    zone,
    x: spawnX,
    y: -30,
    vx: (Math.random() - 0.5) * 44,
    vy: (210 + Math.random() * 115) * speedScale,
    radius: meta.radius,
    rotation: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 3.4,
    points: meta.points,
    isBomb: kind === 'bomb',
    active: true,
  };

  state.items.push(item);
  return item;
}

export function getPlayerMouthWorldPosition(
  pState: MuncherPlayerState,
  zone: PlayerId,
  mode: MuncherMode,
  width: number,
  height: number
): { x: number; y: number; catchRadius: number } {
  const zoneX = mode === 'solo' ? 0 : zone === 'p1' ? 0 : width * 0.5;
  const zoneW = mode === 'solo' ? width : width * 0.5;
  const x = zoneX + clamp(pState.mouthXNorm, 0.08, 0.92) * zoneW;
  const y = clamp(pState.mouthYNorm, 0.3, 0.88) * height;
  const baseRadius = mode === 'solo' ? 42 : 36;
  const feverBoost = pState.feverTimer > 0 ? 12 : 0;
  const openBoost = pState.isMouthOpen ? pState.mouthOpenRatio * 14 : -8;
  return {
    x,
    y,
    catchRadius: Math.max(22, baseRadius + feverBoost + openBoost),
  };
}

export function stepFallbackMouthController(
  pState: MuncherPlayerState,
  moveDir: -1 | 0 | 1,
  openHeld: boolean,
  tiltDir: -1 | 0 | 1,
  dt: number
): void {
  const speed = 0.72;
  pState.mouthXNorm = clamp(pState.mouthXNorm + moveDir * speed * dt, 0.1, 0.9);
  const targetOpen = openHeld ? 0.92 : 0.08;
  const rate = openHeld ? 14 : 11;
  pState.mouthOpenRatio += (targetOpen - pState.mouthOpenRatio) * Math.min(1, dt * rate);
  pState.isMouthOpen = pState.mouthOpenRatio >= MOUTH_OPEN_THRESHOLD;

  const targetTilt = tiltDir * 0.38;
  pState.headTiltRad += (targetTilt - pState.headTiltRad) * Math.min(1, dt * 10);
}

function tickPlayerTimers(pState: MuncherPlayerState, dt: number): void {
  if (pState.feverTimer > 0) pState.feverTimer = Math.max(0, pState.feverTimer - dt);
  if (pState.stunTimer > 0) pState.stunTimer = Math.max(0, pState.stunTimer - dt);
  if (pState.calloutLife > 0) pState.calloutLife = Math.max(0, pState.calloutLife - dt);
  if (pState.comboTimeout > 0) {
    pState.comboTimeout -= dt;
    if (pState.comboTimeout <= 0) {
      pState.combo = 0;
      pState.comboTimeout = 0;
    }
  }
}

export function stepMuncherSimulation(
  state: MuncherGameState,
  rawDt: number,
  width: number,
  height: number
): MuncherSimEvent {
  const events: MuncherSimEvent = {
    munchedBy: [],
    deflectedBy: [],
    bombedBy: [],
    shameCandidate: null,
    tickSecond: null,
    roundEnded: false,
  };

  if (state.phase !== 'playing') return events;

  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  state.screenShake = Math.max(0, state.screenShake - dt * 26);

  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return events;
  }

  const prevWhole = Math.ceil(state.timeRemaining);
  state.timeRemaining = Math.max(0, state.timeRemaining - dt);
  const nextWhole = Math.ceil(state.timeRemaining);
  if (nextWhole < prevWhole && nextWhole <= 5 && nextWhole > 0) {
    events.tickSecond = nextWhole;
  }

  tickPlayerTimers(state.p1, dt);
  if (state.mode === '1v1') tickPlayerTimers(state.p2, dt);

  // Track widest mouth percentage
  const p1Pct = Math.round(state.p1.mouthOpenRatio * 100);
  if (p1Pct > state.p1.peakMouthPct) state.p1.peakMouthPct = p1Pct;
  if (state.mode === '1v1') {
    const p2Pct = Math.round(state.p2.mouthOpenRatio * 100);
    if (p2Pct > state.p2.peakMouthPct) state.p2.peakMouthPct = p2Pct;
  }

  // Spawn items per active zone
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    const elapsed = MUNCHER_ROUND_DURATION_SEC - state.timeRemaining;
    const progress = elapsed / MUNCHER_ROUND_DURATION_SEC;
    const baseInterval = state.mode === 'solo' ? 0.56 : 0.72;
    state.spawnTimer = Math.max(0.28, baseInterval - progress * 0.24);

    spawnZoneItem(state, 'p1', width);
    if (state.mode === '1v1') {
      spawnZoneItem(state, 'p2', width);
    }
  }

  const p1Mouth = getPlayerMouthWorldPosition(state.p1, 'p1', state.mode, width, height);
  const p2Mouth = getPlayerMouthWorldPosition(state.p2, 'p2', state.mode, width, height);

  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    if (!item.active) continue;

    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.rotation += item.vr * dt;

    const zoneX = state.mode === 'solo' ? 0 : item.zone === 'p1' ? 0 : width * 0.5;
    const zoneW = state.mode === 'solo' ? width : width * 0.5;
    if (item.x - item.radius < zoneX + 10) {
      item.x = zoneX + 10 + item.radius;
      item.vx = Math.abs(item.vx);
    } else if (item.x + item.radius > zoneX + zoneW - 10) {
      item.x = zoneX + zoneW - 10 - item.radius;
      item.vx = -Math.abs(item.vx);
    }

    if (item.y - item.radius > height + 40) {
      item.active = false;
      continue;
    }

    const pState = item.zone === 'p1' ? state.p1 : state.p2;
    const mouth = item.zone === 'p1' ? p1Mouth : p2Mouth;

    if (pState.stunTimer > 0) continue;

    const dist = Math.hypot(item.x - mouth.x, item.y - mouth.y);
    if (dist <= item.radius + mouth.catchRadius) {
      if (item.isBomb) {
        if (pState.isMouthOpen) {
          // Swallowed a bomb while mouth was open!
          item.active = false;
          pState.score = Math.max(0, pState.score - BOMB_PENALTY_POINTS);
          pState.combo = 0;
          pState.comboTimeout = 0;
          pState.feverTimer = 0;
          pState.bombsEaten += 1;
          pState.stunTimer = 0.65;
          pState.calloutText = `KABOOM! -${BOMB_PENALTY_POINTS}`;
          pState.calloutColor = '#EF4444';
          pState.calloutLife = 1.1;
          state.screenShake = 18;
          state.hitstopTimer = 0.055;
          events.bombedBy.push({ player: item.zone, x: item.x, y: item.y });

          const mouthPct = Math.round(pState.mouthOpenRatio * 100);
          const priority = 1000 + mouthPct;
          if (priority > state.bestShameScore) {
            state.bestShameScore = priority;
            events.shameCandidate = {
              player: item.zone,
              trigger: 'bomb_face',
              caption: 'ATE A SKULL BOMB!',
              mouthPct,
              points: -BOMB_PENALTY_POINTS,
              priority,
            };
          }
        } else {
          // Mouth clamped shut! Safe bounce deflection
          item.vy = -Math.max(180, Math.abs(item.vy) * 0.75);
          item.vx = (item.x < mouth.x ? -1 : 1) * 220;
          item.y = mouth.y - mouth.catchRadius - item.radius - 4;
          pState.score += BOMB_DEFLECT_POINTS;
          pState.bombsDeflected += 1;
          pState.calloutText = `CLAMPED! +${BOMB_DEFLECT_POINTS}`;
          pState.calloutColor = '#10B981';
          pState.calloutLife = 0.7;
          events.deflectedBy.push({ player: item.zone, x: item.x, y: item.y });
        }
      } else {
        // Edible snack or chili
        if (pState.isMouthOpen) {
          item.active = false;
          pState.combo += 1;
          if (pState.combo > pState.maxCombo) pState.maxCombo = pState.combo;
          pState.comboTimeout = 2.6;
          pState.itemsMunched += 1;

          if (item.kind === 'chili') {
            pState.feverTimer = FEVER_DURATION_SEC;
          }

          const mult = getComboMultiplier(pState.combo) * (pState.feverTimer > 0 ? 2 : 1);
          const awarded = item.points * mult;
          pState.score += awarded;

          const meta = SNACK_CATALOG[item.kind];
          pState.calloutText =
            item.kind === 'chili'
              ? `FEVER 2X! +${awarded}`
              : pState.combo >= 3
              ? `NOM ${pState.combo}x +${awarded}`
              : `CHOMP +${awarded}`;
          pState.calloutColor = meta.color;
          pState.calloutLife = 0.85;
          state.screenShake = Math.max(state.screenShake, item.kind === 'chili' ? 9 : 4);

          events.munchedBy.push({
            player: item.zone,
            kind: item.kind,
            x: item.x,
            y: item.y,
            points: awarded,
            fever: pState.feverTimer > 0,
          });

          const mouthPct = Math.round(pState.mouthOpenRatio * 100);
          if (mouthPct >= 68) {
            const priority = mouthPct * 5 + awarded;
            if (priority > state.bestShameScore) {
              state.bestShameScore = priority;
              events.shameCandidate = {
                player: item.zone,
                trigger: 'wide_munch',
                caption: `MEGA MUNCH (${mouthPct}% OPEN!)`,
                mouthPct,
                points: awarded,
                priority,
              };
            }
          }
        } else {
          // Closed mouth bonks snack away!
          if (item.vy > 0) {
            item.vy = -Math.max(120, item.vy * 0.48);
            item.vx = (item.x < mouth.x ? -1 : 1) * 140;
            item.y = mouth.y - mouth.catchRadius - item.radius - 2;
            pState.calloutText = 'OPEN WIDE!';
            pState.calloutColor = '#94A3B8';
            pState.calloutLife = 0.45;
          }
        }
      }
    }
  }

  // O(1) swap-and-pop cleanup
  let i = 0;
  while (i < state.items.length) {
    if (!state.items[i].active) {
      const last = state.items.pop()!;
      if (i < state.items.length) {
        state.items[i] = last;
      }
    } else {
      i++;
    }
  }

  if (state.timeRemaining <= 0) {
    state.phase = 'gameover';
    events.roundEnded = true;
  }

  return events;
}

export function computeMuncherTugRatio(
  mode: MuncherMode,
  p1Score: number,
  p2Score: number
): number {
  if (mode === 'solo') {
    return clamp(p1Score / 1500, 0.08, 1);
  }
  const total = p1Score + p2Score;
  if (total <= 0) return 0.5;
  return clamp(p1Score / total, 0.1, 0.9);
}

export function determineMuncherWinner(
  mode: MuncherMode,
  p1Score: number,
  p2Score: number
): PlayerId | 'draw' | 'solo' {
  if (mode === 'solo') return 'solo';
  if (p1Score > p2Score) return 'p1';
  if (p2Score > p1Score) return 'p2';
  return 'draw';
}
