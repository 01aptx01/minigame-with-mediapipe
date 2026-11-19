'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArcadeEndCard } from '@/components/arcade/ArcadeEndCard';
import { ArcadeGameShell } from '@/components/arcade/ArcadeGameShell';
import { ArcadeTitleCard } from '@/components/arcade/ArcadeTitleCard';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeReplay } from '@/hooks/useArcadeReplay';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import type { ReplayHudSnapshot } from '@/lib/games/shared/replay-canvas';
import {
  applySliceOutcome,
  computeTugOfWarRatio,
  createInitialGameState,
  determineWinner,
  getPlayerSideForX,
  getTargetColor,
  INDEX_FINGERTIP_LANDMARK,
  projectLandmarkToCanvas,
  ROUND_DURATION_SEC,
  segmentIntersectsCircle,
  stepGameSimulation,
} from '@/lib/games/neon-slash/engine';
import type {
  EndGameSummary,
  GamePhase,
  GameState,
  HandBlade,
  PlayerId,
  SlashGameMode,
  Target,
} from '@/lib/games/neon-slash/types';
import {
  createParticlePool,
  drawArenaBackdrop,
  drawSplitDivider,
  resetParticlePool,
  spawnParticleBurst,
  updateAndDrawParticles,
} from '@/lib/games/shared/canvas';

const BLADE_TRAIL_MAX_AGE_MS = 220;
const BLADE_TRAIL_MAX_POINTS = 14;

export default function NeonSlashGame() {
  const searchParams = useSearchParams();
  const {
    videoRef,
    cameraStatus,
    modelStatus,
    errorMessage,
    requestCamera,
    initializeModel,
    predict,
  } = useMediaPipe();

  useEffect(() => {
    void initializeModel();
  }, [initializeModel]);

  const initialPhase: GamePhase =
    searchParams.get('autostart') === '1' ? 'playing' : 'title';

  const {
    canvasRef,
    sizeRef,
    hudHandleRef,
    audioRef,
    phase,
    setPhase,
    mode,
    setMode,
    p1Name,
    p2Name,
    resolvedP1Name,
    resolvedP2Name,
    handleP1NameChange,
    handleP2NameChange,
    isMuted,
    toggleMute,
    scoreboard,
    newEntryIds,
    setNewEntryIds,
    recordScoreboardRound,
    handleClearScoreboard,
  } = useArcadeSession('neon-slash-duel', initialPhase, '1v1');
  const {
    enabled: replayEnabled,
    setEnabled: setReplayEnabled,
    clips: replayClips,
    recording: replayRecording,
    status: replayStatus,
    supported: replaySupported,
    start: startReplay,
    pause: pauseReplay,
    resume: resumeReplay,
    finish: finishReplay,
    remove: removeReplay,
  } = useArcadeReplay({ gameId: 'neon-slash-duel', gameName: 'Neon Slash Duel' });

  const gameStateRef = useRef<GameState>(createInitialGameState(initialPhase, '1v1'));
  const particlesRef = useRef(createParticlePool(220));
  const bladesRef = useRef<Map<string, HandBlade>>(new Map());
  const pointerBladeDownRef = useRef<boolean>(false);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);

  const [endSummary, setEndSummary] = useState<EndGameSummary | null>(null);

  const getReplayHudSnapshot = useCallback((): ReplayHudSnapshot => {
    const state = gameStateRef.current;
    return {
      timeRemaining: state.timeRemaining,
      p1Name: resolvedP1Name,
      p1Score: state.p1.score,
      ...(state.mode === '1v1'
        ? { p2Name: resolvedP2Name, p2Score: state.p2.score }
        : {}),
    };
  }, [resolvedP1Name, resolvedP2Name]);

  const syncHudDom = useCallback(
    (state: GameState) => {
      hudHandleRef.current?.updateHud({
        timeRemaining: state.timeRemaining,
        p1Score: state.p1.score,
        p1Meta: state.p1.multiplier > 1 ? `${state.p1.multiplier}x COMBO` : '1x',
        p2Score: state.p2.score,
        p2Meta: state.p2.multiplier > 1 ? `${state.p2.multiplier}x COMBO` : '1x',
        tugRatio: computeTugOfWarRatio(state.p1.score, state.p2.score),
      });
    },
    [hudHandleRef]
  );

  const sliceTargetWithSegment = useCallback(
    (
      state: GameState,
      target: Target,
      slicer: PlayerId,
      x1: number,
      y1: number,
      x2: number,
      y2: number
    ) => {
      const outcome = applySliceOutcome(state, target, slicer);
      state.hitstopTimer = Math.max(state.hitstopTimer, outcome.hitstop);
      state.screenShake = Math.max(state.screenShake, outcome.shake);

      const color = getTargetColor(target.kind);
      const burstColor = outcome.wasPenalty ? '#EF4444' : color;
      spawnParticleBurst(
        particlesRef.current,
        target.x,
        target.y,
        burstColor,
        outcome.wasPenalty ? 22 : 16
      );

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const perpX = -Math.sin(angle);
      const perpY = Math.cos(angle);
      for (const side of [-1, 1] as const) {
        state.slicedHalves.push({
          x: target.x + perpX * side * 6,
          y: target.y + perpY * side * 6,
          vx: target.vx + perpX * side * 140,
          vy: target.vy - 90 + perpY * side * 90,
          radius: target.radius,
          rotation: target.rotation,
          angularVelocity: side * 4.2,
          color,
          kind: target.kind,
          side,
          alpha: 1,
          life: 0,
          maxLife: 0.55,
        });
      }

      state.callouts.push({
        id: state.nextCalloutId++,
        x: target.x,
        y: target.y - 12,
        vy: -78,
        text: outcome.calloutText,
        color: outcome.calloutColor,
        life: 0,
        maxLife: 0.75,
        scale: outcome.triggeredSabotageOn ? 1.25 : 1,
      });

      const audio = audioRef.current;
      if (audio) {
        if (outcome.triggeredSabotageOn) {
          audio.playSabotage();
        } else if (outcome.wasPenalty) {
          audio.playPenalty(target.kind === 'skull_bomb');
        } else {
          const stats = slicer === 'p1' ? state.p1 : state.p2;
          audio.playSlice(stats.multiplier);
        }
      }
    },
    [audioRef]
  );

  const startNewRound = useCallback(
    (overrideMode?: SlashGameMode) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const nextMode = overrideMode ?? mode;
      const fresh = createInitialGameState('playing', nextMode);
      gameStateRef.current = fresh;
      const canvas = canvasRef.current;
      if (canvas) startReplay(canvas, getReplayHudSnapshot);
      resetParticlePool(particlesRef.current);
      bladesRef.current.clear();
      setEndSummary(null);
      setNewEntryIds([]);
      setPhase('playing');
      syncHudDom(fresh);
    },
    [canvasRef, getReplayHudSnapshot, mode, setNewEntryIds, setPhase, startReplay, syncHudDom]
  );

  const handleModeChange = useCallback(
    (nextMode: SlashGameMode) => {
      setMode(nextMode);
      if (gameStateRef.current.phase === 'title') {
        gameStateRef.current.mode = nextMode;
      }
    },
    [setMode]
  );

  const togglePause = useCallback(() => {
    const current = gameStateRef.current.phase;
    if (current === 'playing') {
      gameStateRef.current.phase = 'paused';
      pauseReplay();
      setPhase('paused');
    } else if (current === 'paused') {
      gameStateRef.current.phase = 'playing';
      resumeReplay();
      setPhase('playing');
    }
  }, [pauseReplay, resumeReplay, setPhase]);

  // Pointer/Mouse Laser Blade input fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toCanvasCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const pushPointerPoint = (x: number, y: number, checkSlice: boolean) => {
      const now = performance.now();
      const { width } = sizeRef.current;
      const side = getPlayerSideForX(x, width, gameStateRef.current.mode);
      const bladeKey = 'pointer';
      let blade = bladesRef.current.get(bladeKey);
      if (!blade) {
        blade = { handKey: bladeKey, player: side, points: [], lastSeenTime: now };
        bladesRef.current.set(bladeKey, blade);
      }

      const prevPoint = blade.points[blade.points.length - 1];
      blade.player = side;
      blade.lastSeenTime = now;
      blade.points.push({ x, y, time: now });
      if (blade.points.length > BLADE_TRAIL_MAX_POINTS) {
        blade.points.shift();
      }

      if (checkSlice && prevPoint && gameStateRef.current.phase === 'playing') {
        const distSq = (x - prevPoint.x) ** 2 + (y - prevPoint.y) ** 2;
        if (distSq >= 4) {
          const state = gameStateRef.current;
          for (const target of state.targets) {
            if (target.sliced) continue;
            if (
              segmentIntersectsCircle(
                prevPoint.x,
                prevPoint.y,
                x,
                y,
                target.x,
                target.y,
                target.radius + 8
              )
            ) {
              sliceTargetWithSegment(state, target, side, prevPoint.x, prevPoint.y, x, y);
            }
          }
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerBladeDownRef.current = true;
      const pt = toCanvasCoords(e.clientX, e.clientY);
      lastPointerPosRef.current = pt;
      pushPointerPoint(pt.x, pt.y, false);
    };

    const onPointerMove = (e: PointerEvent) => {
      const pt = toCanvasCoords(e.clientX, e.clientY);
      const prev = lastPointerPosRef.current;
      lastPointerPosRef.current = pt;

      const movedEnough = prev ? (pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2 > 16 : false;
      if (pointerBladeDownRef.current || movedEnough) {
        pushPointerPoint(pt.x, pt.y, true);
      }
    };

    const onPointerUp = () => {
      pointerBladeDownRef.current = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [canvasRef, sizeRef, sliceTargetWithSegment]);

  // Main 60FPS requestAnimationFrame loop
  useEffect(() => {
    let lastTime = performance.now();
    let rafId = 0;

    let cachedWashCtx: CanvasRenderingContext2D | null = null;
    let cachedWashWidth = 0;
    let cachedP1Wash: CanvasGradient | null = null;
    let cachedP2Wash: CanvasGradient | null = null;

    const drawTarget = (ctx: CanvasRenderingContext2D, target: Target) => {
      const color = getTargetColor(target.kind);
      ctx.save();
      ctx.translate(target.x, target.y);
      ctx.rotate(target.rotation);

      if (target.kind === 'p1_gem' || target.kind === 'p2_gem') {
        const r = target.radius;
        ctx.fillStyle =
          target.kind === 'p1_gem'
            ? 'rgba(0, 229, 255, 0.22)'
            : 'rgba(255, 42, 109, 0.22)';
        ctx.strokeStyle =
          target.kind === 'p1_gem'
            ? 'rgba(0, 229, 255, 0.25)'
            : 'rgba(255, 42, 109, 0.25)';
        ctx.lineWidth = 9;

        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.78, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.78, 0);
        ctx.closePath();
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.44);
        ctx.lineTo(r * 0.34, 0);
        ctx.lineTo(0, r * 0.44);
        ctx.lineTo(-r * 0.34, 0);
        ctx.closePath();
        ctx.fill();
      } else if (target.kind === 'skull_bomb') {
        const r = target.radius;
        ctx.fillStyle = '#0D1017';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
        ctx.lineWidth = 9;

        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();

        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.arc(0, -r * 0.1, r * 0.44, Math.PI, 0, false);
        ctx.lineTo(r * 0.32, r * 0.35);
        ctx.lineTo(-r * 0.32, r * 0.35);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#0D1017';
        ctx.beginPath();
        ctx.arc(-r * 0.16, -r * 0.06, r * 0.11, 0, Math.PI * 2);
        ctx.arc(r * 0.16, -r * 0.06, r * 0.11, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(0, -r * 0.85, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (target.kind === 'sabotage_orb') {
        const r = target.radius;
        const pulse = 1 + Math.sin(target.pulsePhase) * 0.09;
        ctx.scale(pulse, pulse);

        ctx.strokeStyle = 'rgba(168, 85, 247, 0.32)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(168, 85, 247, 0.28)';
        ctx.strokeStyle = '#C084FC';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = '#F3E8FF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.62, 0.2, Math.PI * 1.1);
        ctx.stroke();

        ctx.fillStyle = '#F5D0FE';
        ctx.beginPath();
        ctx.moveTo(4, -12);
        ctx.lineTo(-7, 2);
        ctx.lineTo(1, 2);
        ctx.lineTo(-4, 12);
        ctx.lineTo(8, -2);
        ctx.lineTo(0, -2);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    };

    const drawSabotageGlitch = (
      ctx: CanvasRenderingContext2D,
      side: PlayerId,
      remaining: number,
      width: number,
      height: number,
      nowMs: number
    ) => {
      if (remaining <= 0) return;
      const halfW = width * 0.5;
      const startX = side === 'p1' ? 0 : halfW;

      ctx.save();
      ctx.beginPath();
      ctx.rect(startX, 0, halfW, height);
      ctx.clip();

      ctx.fillStyle = 'rgba(168, 85, 247, 0.14)';
      ctx.fillRect(startX, 0, halfW, height);

      for (let i = 0; i < 14; i++) {
        const seed = Math.sin(nowMs * 0.025 + i * 19.7);
        const y = (Math.abs(Math.sin(nowMs * 0.008 + i * 3.1)) * height) | 0;
        const h = 4 + ((i * 7) % 16);
        const shift = seed * 36;
        ctx.fillStyle =
          i % 3 === 0
            ? 'rgba(192, 132, 252, 0.38)'
            : i % 3 === 1
            ? 'rgba(0, 229, 255, 0.26)'
            : 'rgba(255, 42, 109, 0.28)';
        ctx.fillRect(startX + shift, y, halfW, h);
      }

      ctx.fillStyle = 'rgba(7, 9, 15, 0.32)';
      for (let y = 0; y < height; y += 8) {
        ctx.fillRect(startX, y, halfW, 2);
      }

      ctx.fillStyle = 'rgba(192, 132, 252, 0.95)';
      ctx.font = '700 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `SIGNAL GLITCH · ${remaining.toFixed(1)}s`,
        startX + halfW * 0.5,
        104
      );
      ctx.restore();
    };

    const renderFrame = (now: number) => {
      rafId = requestAnimationFrame(renderFrame);
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;

      if (document.hidden) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      const { width, height } = sizeRef.current;
      const dpr = canvas.width / Math.max(1, width);
      const state = gameStateRef.current;

      const result = state.phase === 'playing' ? predict(now) : null;
      if (result && result.landmarks.length > 0) {
        result.landmarks.forEach((landmarks, handIdx) => {
          const tip = landmarks[INDEX_FINGERTIP_LANDMARK];
          if (!tip) return;

          const { x, y } = projectLandmarkToCanvas(tip, width, height, true);
          const player = getPlayerSideForX(x, width, state.mode);
          const handKey = `hand_${handIdx}`;

          let blade = bladesRef.current.get(handKey);
          if (!blade) {
            blade = { handKey, player, points: [], lastSeenTime: now };
            bladesRef.current.set(handKey, blade);
          }

          const prev = blade.points[blade.points.length - 1];
          blade.player = player;
          blade.lastSeenTime = now;
          blade.points.push({ x, y, time: now });
          if (blade.points.length > BLADE_TRAIL_MAX_POINTS) {
            blade.points.shift();
          }

          if (prev && state.phase === 'playing') {
            const moveDistSq = (x - prev.x) ** 2 + (y - prev.y) ** 2;
            if (moveDistSq >= 4) {
              for (const target of state.targets) {
                if (target.sliced) continue;
                if (
                  segmentIntersectsCircle(
                    prev.x,
                    prev.y,
                    x,
                    y,
                    target.x,
                    target.y,
                    target.radius + 10
                  )
                ) {
                  sliceTargetWithSegment(state, target, player, prev.x, prev.y, x, y);
                }
              }
            }
          }
        });
      }

      // In-place O(k) expired point pruning (zero array allocation)
      bladesRef.current.forEach((blade, key) => {
        const pts = blade.points;
        let removeCount = 0;
        while (removeCount < pts.length && now - pts[removeCount].time > BLADE_TRAIL_MAX_AGE_MS) {
          removeCount++;
        }
        if (removeCount > 0) {
          pts.splice(0, removeCount);
        }
        if (pts.length === 0 && now - blade.lastSeenTime > 400) {
          bladesRef.current.delete(key);
        }
      });

      const simOutcome = stepGameSimulation(state, rawDt, width, height);
      if (simOutcome.tickSecond !== null) {
        audioRef.current?.playCountdownTick();
      }
      if (simOutcome.roundEnded) {
        audioRef.current?.playRoundEnd();
        finishReplay(
          Math.max(state.p1.score, state.p2.score),
          ROUND_DURATION_SEC - Math.max(0, state.timeRemaining)
        );
        recordScoreboardRound(
          state.mode,
          { score: state.p1.score, detail: `${state.p1.maxCombo}x max` },
          { score: state.p2.score, detail: `${state.p2.maxCombo}x max` }
        );
        setPhase('gameover');
        setEndSummary({
          winner: determineWinner(state.p1.score, state.p2.score, state.mode),
          mode: state.mode,
          p1: { ...state.p1 },
          p2: { ...state.p2 },
        });
      }

      syncHudDom(state);

      ctx.save();
      ctx.scale(dpr, dpr);

      if (state.screenShake > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * state.screenShake * 1.6,
          (Math.random() - 0.5) * state.screenShake * 1.6
        );
      }

      drawArenaBackdrop(ctx, videoRef.current, width, height, { videoAlpha: 0.34 });

      if (state.mode === '1v1') {
        if (cachedWashCtx !== ctx || cachedWashWidth !== width || !cachedP1Wash || !cachedP2Wash) {
          cachedWashCtx = ctx;
          cachedWashWidth = width;
          cachedP1Wash = ctx.createLinearGradient(0, 0, width * 0.5, 0);
          cachedP1Wash.addColorStop(0, 'rgba(0, 229, 255, 0.08)');
          cachedP1Wash.addColorStop(1, 'rgba(0, 229, 255, 0.0)');
          cachedP2Wash = ctx.createLinearGradient(width * 0.5, 0, width, 0);
          cachedP2Wash.addColorStop(0, 'rgba(255, 42, 109, 0.0)');
          cachedP2Wash.addColorStop(1, 'rgba(255, 42, 109, 0.08)');
        }
        ctx.fillStyle = cachedP1Wash;
        ctx.fillRect(0, 0, width * 0.5, height);
        ctx.fillStyle = cachedP2Wash;
        ctx.fillRect(width * 0.5, 0, width * 0.5, height);

        drawSplitDivider(ctx, width, height, 68);

        ctx.font =
          width < 640
            ? '700 10px "JetBrains Mono", monospace'
            : '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.52)';
        ctx.fillText(width < 640 ? 'P1 · CYAN' : 'P1 ZONE · CYAN', width * 0.25, height - 18);
        ctx.fillStyle = 'rgba(255, 42, 109, 0.52)';
        ctx.fillText(width < 640 ? 'P2 · CRIMSON' : 'P2 ZONE · CRIMSON', width * 0.75, height - 18);
      } else {
        ctx.font =
          width < 640
            ? '700 10px "JetBrains Mono", monospace'
            : '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.52)';
        ctx.fillText(
          width < 640
            ? 'SOLO · SLICE CYAN GEMS'
            : 'SOLO ARENA · SLICE CYAN GEMS · DODGE BOMBS',
          width * 0.5,
          height - 18
        );
      }

      for (let i = 0; i < state.slicedHalves.length; i++) {
        const h = state.slicedHalves[i];
        ctx.save();
        ctx.globalAlpha = h.alpha;
        ctx.translate(h.x, h.y);
        ctx.rotate(h.rotation);
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.arc(
          0,
          0,
          h.radius * 0.72,
          h.side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
          h.side < 0 ? Math.PI * 1.5 : Math.PI * 0.5
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      for (let i = 0; i < state.targets.length; i++) {
        drawTarget(ctx, state.targets[i]);
      }

      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      updateAndDrawParticles(ctx, particlesRef.current, dt, 420);

      bladesRef.current.forEach((blade) => {
        const pts = blade.points;
        if (pts.length === 0) return;

        const bladeColor = blade.player === 'p1' ? '#00E5FF' : '#FF2A6D';
        const auraColor = blade.player === 'p1' ? 'rgba(0, 229, 255, 0.25)' : 'rgba(255, 42, 109, 0.25)';

        ctx.save();
        ctx.lineCap = 'round';
        if (pts.length >= 2) {
          const denom = pts.length - 1;
          for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const t = i / denom;

            ctx.globalAlpha = t * 0.55;
            ctx.strokeStyle = auraColor;
            ctx.lineWidth = 10 + t * 14;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();

            ctx.globalAlpha = t * 0.85;
            ctx.strokeStyle = bladeColor;
            ctx.lineWidth = 4 + t * 8;
            ctx.stroke();

            ctx.globalAlpha = t;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1.5 + t * 3;
            ctx.stroke();
          }
        }

        const tip = pts[pts.length - 1];
        ctx.globalAlpha = 1;
        ctx.strokeStyle = auraColor;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 13, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = bladeColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 11, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      for (const c of state.callouts) {
        const alpha = Math.max(0, 1 - c.life / c.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${Math.round(20 * c.scale)}px "Outfit", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#07090F';
        ctx.strokeText(c.text, c.x, c.y);
        ctx.fillStyle = c.color;
        ctx.fillText(c.text, c.x, c.y);
        ctx.restore();
      }

      if (state.phase === 'playing' && state.mode === '1v1') {
        drawSabotageGlitch(ctx, 'p1', state.p1.sabotageRemaining, width, height, now);
        drawSabotageGlitch(ctx, 'p2', state.p2.sabotageRemaining, width, height, now);
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    audioRef,
    canvasRef,
    predict,
    recordScoreboardRound,
    finishReplay,
    setPhase,
    sizeRef,
    sliceTargetWithSegment,
    syncHudDom,
    videoRef,
  ]);

  const cameraReadyLabel =
    cameraStatus === 'active'
      ? modelStatus === 'ready'
        ? 'Webcam + 4-Hand Tracking Active'
        : 'Webcam Active · Loading Hand Model...'
      : cameraStatus === 'requesting'
      ? 'Requesting Camera Access...'
      : 'Pointer Blade Mode Active (No Webcam)';

  const slashRules = [
    { text: 'Gem +10×Combo', colorClass: 'text-cyan-300' },
    ...(mode === '1v1' ? [{ text: 'Enemy -10', colorClass: 'text-rose-300' }] : []),
    { text: 'Bomb -25', colorClass: 'text-amber-300' },
    ...(mode === '1v1' ? [{ text: 'Orb 3s Glitch', colorClass: 'text-purple-300' }] : []),
  ];

  const titleOverlay = (
    <ArcadeTitleCard
      icon={
        <svg viewBox="0 0 120 44" className="mb-2.5 h-10 w-24" aria-hidden="true">
          <path d="M14 34 L52 10" stroke="#00E5FF" strokeWidth="4" strokeLinecap="round" />
          <path d="M106 34 L68 10" stroke="#FF2A6D" strokeWidth="4" strokeLinecap="round" />
          <polygon
            points="60,4 72,22 60,40 48,22"
            fill="rgba(168,85,247,0.28)"
            stroke="#C084FC"
            strokeWidth="2.5"
          />
        </svg>
      }
      title="Neon Slash Duel"
      subtitle={
        mode === 'solo'
          ? 'Slice Cyan gems across the full arena and dodge Skull Bombs.'
          : 'Left half is Cyan (P1), right half is Crimson (P2).'
      }
      mode={mode}
      duelLabel="1v1 Split Duel"
      soloLabel="1P Solo"
      onModeChange={handleModeChange}
      p1Name={p1Name}
      p2Name={p2Name}
      onChangeP1Name={handleP1NameChange}
      onChangeP2Name={handleP2NameChange}
      rules={slashRules}
      cameraStatus={cameraStatus}
      cameraStatusLabel={cameraReadyLabel}
      errorMessage={errorMessage}
      onRequestCamera={() => void requestCamera()}
      startLabel={mode === 'solo' ? 'Start 60s Solo Run' : 'Start 60s Duel'}
      onStart={() => startNewRound()}
    />
  );

  const endOverlay = endSummary ? (
    <ArcadeEndCard
      winnerTitle={
        endSummary.winner === 'p1'
          ? `${resolvedP1Name} Wins`
          : endSummary.winner === 'p2'
          ? `${resolvedP2Name} Wins`
          : endSummary.winner === 'solo'
          ? `${resolvedP1Name} · Run Complete`
          : 'Draw Match'
      }
      mode={endSummary.mode}
      p1={{
        name: resolvedP1Name,
        score: endSummary.p1.score,
        metrics: [
          `Slices ${endSummary.p1.ownSlices}`,
          `Max ${endSummary.p1.maxCombo}x`,
          ...(endSummary.mode === '1v1' ? [`Glitch ${endSummary.p1.sabotagesSent}`] : []),
        ],
      }}
      p2={
        endSummary.mode === '1v1'
          ? {
              name: resolvedP2Name,
              score: endSummary.p2.score,
              metrics: [
                `Slices ${endSummary.p2.ownSlices}`,
                `Max ${endSummary.p2.maxCombo}x`,
                `Glitch ${endSummary.p2.sabotagesSent}`,
              ],
            }
          : undefined
      }
      scoreboard={scoreboard}
      highlightIds={newEntryIds}
      onClearScoreboard={handleClearScoreboard}
      replayLabel={endSummary.mode === 'solo' ? 'Play Again' : 'Replay Duel'}
      onReplay={() => startNewRound()}
    />
  ) : null;

  return (
    <ArcadeGameShell
      phase={phase}
      isMuted={isMuted}
      initialDurationSec={ROUND_DURATION_SEC}
      soloMode={mode === 'solo'}
      hideTugBar={mode === 'solo'}
      p1Label={p1Name.trim() || undefined}
      p2Label={p2Name.trim() || undefined}
      canvasTestId="neon-slash-canvas"
      canvasRef={canvasRef}
      sizeRef={sizeRef}
      hudHandleRef={hudHandleRef}
      onStart={() => startNewRound()}
      onTogglePause={togglePause}
      onToggleMute={toggleMute}
      onRestart={() => startNewRound()}
      replayControls={{
        gameName: 'Neon Slash Duel',
        enabled: replayEnabled,
        onEnabledChange: setReplayEnabled,
        supported: replaySupported,
        clips: replayClips,
        status: replayStatus,
        recording: replayRecording,
        onRemove: removeReplay,
      }}
      titleOverlay={titleOverlay}
      endOverlay={endOverlay}
    />
  );
}
