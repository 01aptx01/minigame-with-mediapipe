'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArcadeEndCard } from '@/components/arcade/ArcadeEndCard';
import { ArcadeGameShell } from '@/components/arcade/ArcadeGameShell';
import { ArcadeTitleCard } from '@/components/arcade/ArcadeTitleCard';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import { POSE_SKELETON_SEGMENTS } from '@/lib/games/pose-match/engine';
import {
  assignPoseToZone,
  computeBodyBoundingBox,
  computeDodgeTugRatio,
  createInitialDodgeGameState,
  determineDodgeWinner,
  DODGE_ROUND_DURATION_SEC,
  stepDodgeSimulation,
  stepFallbackBodyBox,
} from '@/lib/games/rhythm-dodge/engine';
import type {
  BodyBox,
  DodgeEndSummary,
  DodgeGameMode,
  DodgeGamePhase,
  DodgeGameState,
  DodgePlayerState,
  LaserObstacle,
  PlayerId,
} from '@/lib/games/rhythm-dodge/types';
import {
  createParticlePool,
  drawArenaBackdrop,
  drawSplitDivider,
  resetParticlePool,
  spawnParticleBurst,
  updateAndDrawParticles,
} from '@/lib/games/shared/canvas';

interface PlayerInputState {
  left: boolean;
  right: boolean;
  duck: boolean;
}

const KEY_JOINTS_PREVIEW = [0, 11, 12, 13, 14, 15, 16, 23, 24] as const;

export default function RhythmDodgeGame() {
  const searchParams = useSearchParams();
  const {
    videoRef,
    cameraStatus,
    poseModelStatus,
    errorMessage,
    requestCamera,
    initializePoseModel,
    predictPose,
  } = useMediaPipe();

  const initialPhase: DodgeGamePhase =
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
  } = useArcadeSession('rhythm-dodge', initialPhase, '1v1');

  const gameStateRef = useRef<DodgeGameState>(createInitialDodgeGameState(initialPhase, '1v1'));
  const particlesRef = useRef(createParticlePool(180));
  const inputRef = useRef<{ p1: PlayerInputState; p2: PlayerInputState }>({
    p1: { left: false, right: false, duck: false },
    p2: { left: false, right: false, duck: false },
  });

  const [endSummary, setEndSummary] = useState<DodgeEndSummary | null>(null);

  useEffect(() => {
    void initializePoseModel();
  }, [initializePoseModel]);

  const syncHudDom = useCallback(
    (state: DodgeGameState) => {
      hudHandleRef.current?.updateHud({
        timeRemaining: state.timeRemaining,
        p1Score: state.p1.score,
        p1Meta: `${state.p1.hp} HP · ${state.p1.combo}x`,
        p2Score: state.p2.score,
        p2Meta: `${state.p2.hp} HP · ${state.p2.combo}x`,
        tugRatio: computeDodgeTugRatio(state.mode, state.p1, state.p2),
        overdrive: state.overdrive && state.phase === 'playing',
      });
    },
    [hudHandleRef]
  );

  const clearInputs = useCallback(() => {
    inputRef.current.p1 = { left: false, right: false, duck: false };
    inputRef.current.p2 = { left: false, right: false, duck: false };
  }, []);

  const startNewRound = useCallback(
    (overrideMode?: DodgeGameMode) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const nextMode = overrideMode ?? mode;
      const fresh = createInitialDodgeGameState('playing', nextMode);
      gameStateRef.current = fresh;
      clearInputs();
      resetParticlePool(particlesRef.current);
      setEndSummary(null);
      setNewEntryIds([]);
      setPhase('playing');
      syncHudDom(fresh);
    },
    [clearInputs, mode, setNewEntryIds, setPhase, syncHudDom]
  );

  const handleModeChange = useCallback(
    (nextMode: DodgeGameMode) => {
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
      clearInputs();
      setPhase('paused');
    } else if (current === 'paused') {
      gameStateRef.current.phase = 'playing';
      setPhase('playing');
    }
  }, [clearInputs, setPhase]);

  // Keyboard dodge/squat input fallback (A/D/S or Arrows for P1; J/L/K for P2)
  useEffect(() => {
    const setKeyFlag = (e: KeyboardEvent, pressed: boolean) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') inputRef.current.p1.left = pressed;
      else if (k === 'd' || k === 'arrowright') inputRef.current.p1.right = pressed;
      else if (k === 's' || k === 'arrowdown') inputRef.current.p1.duck = pressed;
      else if (k === 'j') inputRef.current.p2.left = pressed;
      else if (k === 'l') inputRef.current.p2.right = pressed;
      else if (k === 'k') inputRef.current.p2.duck = pressed;
    };

    const onKeyDown = (e: KeyboardEvent) => setKeyFlag(e, true);
    const onKeyUp = (e: KeyboardEvent) => setKeyFlag(e, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearInputs);
    document.addEventListener('visibilitychange', clearInputs);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearInputs);
      document.removeEventListener('visibilitychange', clearInputs);
    };
  }, [clearInputs]);

  // 60FPS 3D Perspective Tunnel + Pose Bounding-Box Collision Render Loop
  useEffect(() => {
    let lastTime = performance.now();
    let rafId = 0;

    const projectTunnelX = (vpX: number, targetX: number, p: number) =>
      vpX + (targetX - vpX) * p;
    const projectTunnelY = (vpY: number, targetY: number, p: number) =>
      vpY + (targetY - vpY) * p;

    const drawPerspectiveTunnel = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      beatPhase: number,
      overdrive: boolean,
      accent: string
    ) => {
      const vpX = zoneX + zoneW * 0.5;
      const vpY = zoneH * 0.3;
      const left = zoneX + 12;
      const right = zoneX + zoneW - 12;
      const top = 118;
      const bottom = zoneH - 22;
      const beatPulse = Math.max(0, 1 - beatPhase * 2.2);

      ctx.save();
      // Outer horizon frame + 4 perspective tunnel rails
      ctx.strokeStyle = overdrive
        ? `rgba(245, 158, 11, ${0.22 + beatPulse * 0.2})`
        : `rgba(148, 163, 184, ${0.14 + beatPulse * 0.14})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // Perspective rays from vanishing point
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(left, top);
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(right, top);
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(left, bottom);
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(right, bottom);
      // Mid floor perspective rails
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(zoneX + zoneW * 0.3, bottom);
      ctx.moveTo(vpX, vpY);
      ctx.lineTo(zoneX + zoneW * 0.7, bottom);
      ctx.stroke();

      // Beat-synced depth rings rushing toward player
      const ringCount = 5;
      for (let i = 0; i < ringCount; i++) {
        const z = (i + (1 - beatPhase)) / ringCount;
        const p = 0.2 + (1 - z) * 0.8;
        const rx = projectTunnelX(vpX, left, p);
        const rw = projectTunnelX(vpX, right, p) - rx;
        const ry = projectTunnelY(vpY, top, p);
        const rh = projectTunnelY(vpY, bottom, p) - ry;

        ctx.strokeStyle = i === 0 ? accent : 'rgba(148, 163, 184, 0.16)';
        ctx.globalAlpha = 0.12 + (1 - z) * 0.22;
        ctx.lineWidth = 1 + (1 - z) * 1.4;
        ctx.strokeRect(rx, ry, rw, rh);
      }
      ctx.restore();
    };

    const drawPerspectiveLaser = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      laser: LaserObstacle
    ) => {
      if (laser.z < -0.1 || laser.z > 1.05) return;
      const vpX = zoneX + zoneW * 0.5;
      const vpY = zoneH * 0.3;
      const clampedZ = Math.max(0, Math.min(1, laser.z));
      const p = 0.2 + (1 - clampedZ) * 0.8;

      const planeLeft = zoneX + laser.rect.minX * zoneW;
      const planeRight = zoneX + laser.rect.maxX * zoneW;
      const planeTop = laser.rect.minY * zoneH;
      const planeBottom = laser.rect.maxY * zoneH;

      const x = projectTunnelX(vpX, planeLeft, p);
      const x2 = projectTunnelX(vpX, planeRight, p);
      const y = projectTunnelY(vpY, planeTop, p);
      const y2 = projectTunnelY(vpY, planeBottom, p);
      const w = Math.max(4, x2 - x);
      const h = Math.max(4, y2 - y);

      ctx.save();
      const proximityAlpha = 0.35 + (1 - clampedZ) * 0.65;

      // Subtle landing zone outline on player plane when approaching
      if (clampedZ < 0.45 && !laser.resolved) {
        ctx.globalAlpha = (0.45 - clampedZ) * 0.7;
        ctx.strokeStyle = laser.color;
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(planeLeft, planeTop, planeRight - planeLeft, planeBottom - planeTop);
        ctx.setLineDash([]);
      }

      // Main 3D laser barrier fill + neon border (layered, zero shadowBlur)
      ctx.globalAlpha = proximityAlpha * 0.22;
      ctx.fillStyle = laser.color;
      ctx.fillRect(x, y, w, h);

      ctx.globalAlpha = proximityAlpha * 0.35;
      ctx.strokeStyle = laser.color;
      ctx.lineWidth = 5 + (1 - clampedZ) * 6;
      ctx.strokeRect(x, y, w, h);

      ctx.globalAlpha = proximityAlpha;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Action cue label inside incoming laser
      if (clampedZ > 0.05 && w > 54 && h > 26) {
        ctx.font = `800 ${Math.round(11 + (1 - clampedZ) * 7)}px "Outfit", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(laser.label, x + w * 0.5, y + h * 0.5);
      }

      ctx.restore();
    };

    const drawBodyBoundingBox = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      box: BodyBox,
      pState: DodgePlayerState,
      accent: string
    ) => {
      const bx = zoneX + box.minX * zoneW;
      const bw = Math.max(24, (box.maxX - box.minX) * zoneW);
      const by = box.minY * zoneH;
      const bh = Math.max(40, (box.maxY - box.minY) * zoneH);

      const isFlashing = pState.hitFlashTimer > 0;
      const isInvulnBlink =
        pState.invulnTimer > 0 && Math.floor(pState.invulnTimer * 18) % 2 === 0;
      const strokeColor = pState.eliminated
        ? '#64748B'
        : isFlashing
        ? '#EF4444'
        : box.stance === 'ducking'
        ? '#10B981'
        : accent;

      ctx.save();
      if (isInvulnBlink && !isFlashing) {
        ctx.globalAlpha = 0.45;
      }

      // Hitbox subtle fill
      ctx.fillStyle = isFlashing
        ? 'rgba(239, 68, 68, 0.25)'
        : box.stance === 'ducking'
        ? 'rgba(16, 185, 129, 0.14)'
        : 'rgba(0, 229, 255, 0.08)';
      ctx.fillRect(bx, by, bw, bh);

      // Bounding box dashed frame + bright corner brackets
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);

      const corner = 12;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(bx, by + corner);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + corner, by);
      // Top-right
      ctx.moveTo(bx + bw - corner, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + corner);
      // Bottom-left
      ctx.moveTo(bx, by + bh - corner);
      ctx.lineTo(bx, by + bh);
      ctx.lineTo(bx + corner, by + bh);
      // Bottom-right
      ctx.moveTo(bx + bw - corner, by + bh);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + bw, by + bh - corner);
      ctx.stroke();

      // If no live webcam pose, draw clean cyber silhouette figure inside bounding box
      if (!box.fromLivePose) {
        const cx = bx + bw * 0.5;
        const headR = Math.min(18, bw * 0.2);
        const headY = by + headR + 8;
        const shoulderY = headY + headR + 10;
        const hipY = by + bh - 12;

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, headY, headR, 0, Math.PI * 2);
        ctx.moveTo(cx - bw * 0.34, shoulderY);
        ctx.lineTo(cx + bw * 0.34, shoulderY);
        ctx.moveTo(cx, shoulderY);
        ctx.lineTo(cx, hipY);
        ctx.moveTo(cx - bw * 0.24, hipY);
        ctx.lineTo(cx + bw * 0.24, hipY);
        ctx.stroke();
      }

      // Stance tag above bounding box
      const stanceText = pState.eliminated
        ? 'KO'
        : box.stance === 'ducking'
        ? 'DUCKING'
        : box.stance === 'lean_left'
        ? 'DODGE LEFT'
        : box.stance === 'lean_right'
        ? 'DODGE RIGHT'
        : 'READY';
      const stanceTopMin = zoneW < 320 ? 152 : 122;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = strokeColor;
      ctx.fillText(stanceText, bx + bw * 0.5, Math.max(stanceTopMin, by - 8));

      ctx.restore();
    };

    const drawZoneStatusBars = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      pState: DodgePlayerState,
      accent: string
    ) => {
      const centerX = zoneX + zoneW * 0.5;
      const barW = Math.min(240, Math.max(120, zoneW - 32));
      const barX = centerX - barW * 0.5;
      const barY = zoneW < 320 ? 126 : 98;

      ctx.save();
      // HP meter bar
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(barX, barY, barW, 10);
      ctx.strokeRect(barX, barY, barW, 10);

      const hpRatio = Math.max(0, pState.hp / pState.maxHp);
      ctx.fillStyle = hpRatio <= 0.25 ? '#EF4444' : hpRatio <= 0.5 ? '#F59E0B' : accent;
      ctx.fillRect(barX, barY, barW * hpRatio, 10);

      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(`SHIELD ${pState.hp} / ${pState.maxHp}`, centerX, barY - 6);

      // Floating hit/dodge callout
      if (pState.calloutLife > 0) {
        ctx.globalAlpha = Math.min(1, pState.calloutLife * 1.4);
        ctx.font = zoneW < 230 ? '800 18px "Outfit", sans-serif' : '800 24px "Outfit", sans-serif';
        ctx.fillStyle = pState.calloutColor;
        ctx.fillText(pState.calloutText, centerX, Math.max(barY + 38, zoneH * 0.22));
      }
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
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      const poseResult = state.phase === 'playing' ? predictPose(now) : null;
      const liveSkeletons: Record<PlayerId, Array<{ x: number; y: number }> | null> = {
        p1: null,
        p2: null,
      };

      let sawP1Pose = false;
      let sawP2Pose = false;

      if (poseResult && poseResult.landmarks.length > 0) {
        for (let pIdx = 0; pIdx < poseResult.landmarks.length; pIdx++) {
          const landmarks = poseResult.landmarks[pIdx];
          const zone = assignPoseToZone(landmarks, state.mode, true);
          const box = computeBodyBoundingBox(landmarks, state.mode, zone, true);
          if (!box) continue;

          if (zone === 'p1') {
            sawP1Pose = true;
            state.p1.bodyBox = box;
          } else {
            sawP2Pose = true;
            state.p2.bodyBox = box;
          }

          const pts: Array<{ x: number; y: number }> = [];
          for (let i = 0; i < landmarks.length; i++) {
            pts[i] = { x: (1 - landmarks[i].x) * width, y: landmarks[i].y * height };
          }
          liveSkeletons[zone] = pts;
        }
      }

      if (state.phase === 'playing') {
        if (!sawP1Pose) {
          state.p1.bodyBox = stepFallbackBodyBox(state.p1.bodyBox, inputRef.current.p1, dt);
        }
        if (state.mode === '1v1' && !sawP2Pose) {
          state.p2.bodyBox = stepFallbackBodyBox(state.p2.bodyBox, inputRef.current.p2, dt);
        }
      }

      const sim = stepDodgeSimulation(state, rawDt);
      if (sim.beatStepTriggered !== null) {
        audioRef.current?.playEdmBeatStep(sim.beatStepTriggered, state.overdrive);
      }
      if (sim.overdriveStarted) {
        audioRef.current?.playOverdriveStart();
      }
      if (sim.tickSecond !== null) {
        audioRef.current?.playCountdownTick();
      }

      for (let i = 0; i < sim.hits.length; i++) {
        const h = sim.hits[i];
        const zoneX = state.mode === 'solo' ? 0 : h.zone === 'p1' ? 0 : width * 0.5;
        const zoneW = state.mode === 'solo' ? width : width * 0.5;
        const pState = h.zone === 'p1' ? state.p1 : state.p2;
        audioRef.current?.playPenalty(pState.eliminated);
        spawnParticleBurst(
          particlesRef.current,
          zoneX + pState.bodyBox.centerX * zoneW,
          pState.bodyBox.centerY * height,
          '#EF4444',
          22,
          120,
          300
        );
      }

      for (let i = 0; i < sim.dodges.length; i++) {
        const d = sim.dodges[i];
        const zoneX = state.mode === 'solo' ? 0 : d.zone === 'p1' ? 0 : width * 0.5;
        const zoneW = state.mode === 'solo' ? width : width * 0.5;
        const pState = d.zone === 'p1' ? state.p1 : state.p2;
        audioRef.current?.playLaserDodge(d.combo);
        spawnParticleBurst(
          particlesRef.current,
          zoneX + pState.bodyBox.centerX * zoneW,
          pState.bodyBox.minY * height,
          d.zone === 'p1' ? '#00E5FF' : '#FF2A6D',
          10,
          90,
          200
        );
      }

      if (sim.roundEnded) {
        audioRef.current?.playRoundEnd();
        recordScoreboardRound(
          state.mode,
          { score: state.p1.score, detail: `${state.p1.hp} HP · ${state.p1.dodgedCount} dodged` },
          { score: state.p2.score, detail: `${state.p2.hp} HP · ${state.p2.dodgedCount} dodged` }
        );
        setPhase('gameover');
        setEndSummary({
          winner: determineDodgeWinner(state.mode, state.p1, state.p2),
          mode: state.mode,
          survivedFullSong: sim.survivedFullSong,
          p1: { ...state.p1 },
          p2: { ...state.p2 },
        });
      }

      syncHudDom(state);

      ctx.save();
      ctx.scale(dpr, dpr);

      if (state.screenShake > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * state.screenShake * 1.5,
          (Math.random() - 0.5) * state.screenShake * 1.5
        );
      }

      drawArenaBackdrop(ctx, videoRef.current, width, height, { videoAlpha: 0.34 });

      if (state.overdrive && state.phase === 'playing') {
        const pulse = 0.22 + Math.sin(now * 0.015) * 0.14;
        ctx.strokeStyle = `rgba(245, 158, 11, ${pulse})`;
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, width - 8, height - 8);
      }

      const renderZone = (
        zoneX: number,
        zoneW: number,
        playerId: PlayerId,
        pState: DodgePlayerState,
        accent: string
      ) => {
        drawPerspectiveTunnel(
          ctx,
          zoneX,
          zoneW,
          height,
          state.beatPhase,
          state.overdrive,
          accent
        );

        // Draw lasers back-to-front (largest z first)
        for (let i = state.lasers.length - 1; i >= 0; i--) {
          const laser = state.lasers[i];
          if (laser.zone === playerId) {
            drawPerspectiveLaser(ctx, zoneX, zoneW, height, laser);
          }
        }

        const skel = liveSkeletons[playerId];
        if (skel) {
          ctx.save();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < POSE_SKELETON_SEGMENTS.length; i++) {
            const [aIdx, bIdx] = POSE_SKELETON_SEGMENTS[i];
            const a = skel[aIdx];
            const b = skel[bIdx];
            if (!a || !b) continue;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          for (let i = 0; i < KEY_JOINTS_PREVIEW.length; i++) {
            const pt = skel[KEY_JOINTS_PREVIEW[i]];
            if (!pt) continue;
            ctx.moveTo(pt.x + 4, pt.y);
            ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
        }

        drawBodyBoundingBox(ctx, zoneX, zoneW, height, pState.bodyBox, pState, accent);
        drawZoneStatusBars(ctx, zoneX, zoneW, height, pState, accent);
      };

      if (state.mode === '1v1') {
        drawSplitDivider(ctx, width, height, 68);
        renderZone(0, width * 0.5, 'p1', state.p1, '#00E5FF');
        renderZone(width * 0.5, width * 0.5, 'p2', state.p2, '#FF2A6D');
      } else {
        renderZone(0, width, 'p1', state.p1, '#00E5FF');
      }

      updateAndDrawParticles(ctx, particlesRef.current, dt, 340);
      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    audioRef,
    canvasRef,
    predictPose,
    recordScoreboardRound,
    setPhase,
    sizeRef,
    syncHudDom,
    videoRef,
  ]);

  const statusText =
    cameraStatus === 'active'
      ? poseModelStatus === 'ready'
        ? 'Webcam + Body Bounding-Box Tracking Active'
        : 'Webcam Active · Loading Pose Model...'
      : 'Keyboard / Button Dodge Controls Ready (A/S/D or Arrows)';

  const dodgeRules = [
    { text: '128 BPM Lasers', colorClass: 'text-cyan-300' },
    { text: 'Squat & Lean', colorClass: 'text-emerald-300' },
    { text: '-20 HP on Hit', colorClass: 'text-rose-300' },
    { text: 'Survive 60s EDM', colorClass: 'text-amber-300' },
  ];

  const titleOverlay = (
    <ArcadeTitleCard
      icon={
        <svg viewBox="0 0 120 48" className="mb-2.5 h-10 w-24" aria-hidden="true">
          <polygon
            points="18,42 42,10 78,10 102,42"
            fill="none"
            stroke="#00E5FF"
            strokeWidth="2.5"
          />
          <line x1="22" y1="22" x2="98" y2="22" stroke="#F59E0B" strokeWidth="3.5" />
          <rect
            x="48"
            y="26"
            width="24"
            height="18"
            rx="3"
            fill="rgba(0,229,255,0.2)"
            stroke="#00E5FF"
            strokeWidth="2"
          />
        </svg>
      }
      title="Rhythm Dodge"
      subtitle="Squat under overhead beams and dodge left or right to the 128 BPM synthwave beat."
      mode={mode}
      duelLabel="1v1 Laser Survival"
      soloLabel="1P Solo Survival"
      onModeChange={handleModeChange}
      p1Name={p1Name}
      p2Name={p2Name}
      onChangeP1Name={handleP1NameChange}
      onChangeP2Name={handleP2NameChange}
      rules={dodgeRules}
      cameraStatus={cameraStatus}
      cameraStatusLabel={statusText}
      errorMessage={errorMessage}
      onRequestCamera={() => void requestCamera()}
      startLabel="Drop the Beat (60s)"
      onStart={() => startNewRound()}
    />
  );

  const bottomControls =
    phase === 'playing' && cameraStatus !== 'active' ? (
      <div className="pointer-events-auto fixed bottom-2 left-1/2 z-20 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-slate-700/80 bg-[#0D121E]/95 px-2.5 py-1.5 text-xs shadow-lg">
        <span className="hidden font-mono text-[11px] text-slate-400 sm:inline">Move P1:</span>
        <button
          type="button"
          onPointerDown={() => {
            inputRef.current.p1.left = true;
          }}
          onPointerUp={() => {
            inputRef.current.p1.left = false;
          }}
          onPointerLeave={() => {
            inputRef.current.p1.left = false;
          }}
          className="whitespace-nowrap rounded border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 active:border-cyan-300 active:bg-cyan-500/40 sm:px-3"
        >
          ← Left (A)
        </button>
        <button
          type="button"
          onPointerDown={() => {
            inputRef.current.p1.duck = true;
          }}
          onPointerUp={() => {
            inputRef.current.p1.duck = false;
          }}
          onPointerLeave={() => {
            inputRef.current.p1.duck = false;
          }}
          className="whitespace-nowrap rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/30 active:border-emerald-300 active:bg-emerald-500/45 sm:px-3"
        >
          ↓ Squat / Duck (S)
        </button>
        <button
          type="button"
          onPointerDown={() => {
            inputRef.current.p1.right = true;
          }}
          onPointerUp={() => {
            inputRef.current.p1.right = false;
          }}
          onPointerLeave={() => {
            inputRef.current.p1.right = false;
          }}
          className="whitespace-nowrap rounded border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 active:border-cyan-300 active:bg-cyan-500/40 sm:px-3"
        >
          Right (D) →
        </button>
      </div>
    ) : null;

  const endOverlay = endSummary ? (
    <ArcadeEndCard
      winnerTitle={
        endSummary.winner === 'p1'
          ? `${resolvedP1Name} Wins!`
          : endSummary.winner === 'p2'
          ? `${resolvedP2Name} Wins!`
          : endSummary.winner === 'solo'
          ? `${resolvedP1Name} Survived the Drop!`
          : endSummary.winner === 'eliminated'
          ? `${resolvedP1Name} · Eliminated`
          : 'Draw Match'
      }
      mode={endSummary.mode}
      p1={{
        name: resolvedP1Name,
        score: endSummary.p1.score,
        metrics: [
          `HP ${endSummary.p1.hp}`,
          `Dodged ${endSummary.p1.dodgedCount}`,
          `Max ${endSummary.p1.maxCombo}x`,
        ],
      }}
      p2={
        endSummary.mode === '1v1'
          ? {
              name: resolvedP2Name,
              score: endSummary.p2.score,
              metrics: [
                `HP ${endSummary.p2.hp}`,
                `Dodged ${endSummary.p2.dodgedCount}`,
                `Max ${endSummary.p2.maxCombo}x`,
              ],
            }
          : undefined
      }
      scoreboard={scoreboard}
      highlightIds={newEntryIds}
      onClearScoreboard={handleClearScoreboard}
      replayLabel="Play Track Again"
      onReplay={() => startNewRound()}
    />
  ) : null;

  return (
    <ArcadeGameShell
      phase={phase}
      isMuted={isMuted}
      initialDurationSec={DODGE_ROUND_DURATION_SEC}
      soloMode={mode === 'solo'}
      p1Label={p1Name.trim() || undefined}
      p2Label={p2Name.trim() || undefined}
      canvasTestId="rhythm-dodge-canvas"
      canvasRef={canvasRef}
      sizeRef={sizeRef}
      hudHandleRef={hudHandleRef}
      onStart={() => startNewRound()}
      onTogglePause={togglePause}
      onToggleMute={toggleMute}
      onRestart={() => startNewRound()}
      titleOverlay={titleOverlay}
      endOverlay={endOverlay}
      bottomControls={bottomControls}
    />
  );
}
