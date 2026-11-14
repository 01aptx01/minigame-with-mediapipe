'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { ArcadeEndCard } from '@/components/arcade/ArcadeEndCard';
import { ArcadeGameShell } from '@/components/arcade/ArcadeGameShell';
import { ArcadeTitleCard } from '@/components/arcade/ArcadeTitleCard';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import {
  analyzeFaceMouth,
  computeMuncherTugRatio,
  createInitialMuncherState,
  determineMuncherWinner,
  FACE_OVAL_INDICES,
  getPlayerMouthWorldPosition,
  LEFT_EYE_OUTER_IDX,
  MUNCHER_ROUND_DURATION_SEC,
  OUTER_LIPS_INDICES,
  RIGHT_EYE_OUTER_IDX,
  SNACK_CATALOG,
  stepFallbackMouthController,
  stepMuncherSimulation,
} from '@/lib/games/neon-muncher/engine';
import type {
  FallingItem,
  MuncherEndSummary,
  MuncherGameState,
  MuncherMode,
  MuncherPhase,
  MuncherPlayerState,
  NormalizedFaceLandmark,
  PlayerId,
  ShameSnapshot,
} from '@/lib/games/neon-muncher/types';
import {
  createParticlePool,
  drawArenaBackdrop,
  drawSplitDivider,
  resetParticlePool,
  spawnParticleBurst,
  updateAndDrawParticles,
} from '@/lib/games/shared/canvas';

interface FallbackControls {
  left: boolean;
  right: boolean;
  open: boolean;
  tiltLeft: boolean;
  tiltRight: boolean;
}

export default function NeonMuncherGame() {
  const searchParams = useSearchParams();
  const {
    videoRef,
    cameraStatus,
    faceModelStatus,
    errorMessage,
    requestCamera,
    initializeFaceModel,
    predictFace,
  } = useMediaPipe();

  useEffect(() => {
    void initializeFaceModel();
  }, [initializeFaceModel]);

  const initialPhase: MuncherPhase =
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
  } = useArcadeSession('neon-muncher', initialPhase, '1v1');

  const gameStateRef = useRef<MuncherGameState>(createInitialMuncherState(initialPhase, '1v1'));
  const particlesRef = useRef(createParticlePool(200));
  const shameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shameSnapshotRef = useRef<ShameSnapshot | null>(null);
  const controlsRef = useRef<{ p1: FallbackControls; p2: FallbackControls }>({
    p1: { left: false, right: false, open: false, tiltLeft: false, tiltRight: false },
    p2: { left: false, right: false, open: false, tiltLeft: false, tiltRight: false },
  });

  const [endSummary, setEndSummary] = useState<MuncherEndSummary | null>(null);

  const clearInputs = useCallback(() => {
    controlsRef.current.p1 = {
      left: false,
      right: false,
      open: false,
      tiltLeft: false,
      tiltRight: false,
    };
    controlsRef.current.p2 = {
      left: false,
      right: false,
      open: false,
      tiltLeft: false,
      tiltRight: false,
    };
  }, []);

  const syncHudDom = useCallback(
    (state: MuncherGameState) => {
      const p1Pct = Math.round(state.p1.mouthOpenRatio * 100);
      const p2Pct = Math.round(state.p2.mouthOpenRatio * 100);
      hudHandleRef.current?.updateHud({
        timeRemaining: state.timeRemaining,
        p1Score: state.p1.score,
        p1Meta: `${p1Pct}% · ${state.p1.combo}x`,
        p2Score: state.p2.score,
        p2Meta: `${p2Pct}% · ${state.p2.combo}x`,
        tugRatio: computeMuncherTugRatio(state.mode, state.p1.score, state.p2.score),
        overdrive: state.p1.feverTimer > 0 || state.p2.feverTimer > 0,
      });
    },
    [hudHandleRef]
  );

  const captureShameSnapshot = useCallback(
    (
      player: PlayerId,
      trigger: ShameSnapshot['trigger'],
      caption: string,
      mouthPct: number,
      points: number,
      stateMode: MuncherMode
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        if (!shameCanvasRef.current) {
          const thumb = document.createElement('canvas');
          thumb.width = 480;
          thumb.height = 270;
          shameCanvasRef.current = thumb;
        }
        const thumb = shameCanvasRef.current;
        const tCtx = thumb.getContext('2d');
        if (!tCtx) return;

        // Crop to the player's half in 1v1 so friends see their goofy face close-up
        const srcX = stateMode === '1v1' && player === 'p2' ? canvas.width * 0.5 : 0;
        const srcW = stateMode === '1v1' ? canvas.width * 0.5 : canvas.width;
        tCtx.clearRect(0, 0, thumb.width, thumb.height);
        tCtx.drawImage(canvas, srcX, 0, srcW, canvas.height, 0, 0, thumb.width, thumb.height);

        // Stamp hilarious meme badge directly onto exported snapshot
        tCtx.fillStyle = trigger === 'bomb_face' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)';
        tCtx.fillRect(14, thumb.height - 46, thumb.width - 28, 32);
        tCtx.font = '800 15px "Outfit", sans-serif';
        tCtx.textAlign = 'center';
        tCtx.fillStyle = '#FFFFFF';
        tCtx.fillText(caption, thumb.width * 0.5, thumb.height - 25);

        shameSnapshotRef.current = {
          dataUrl: thumb.toDataURL('image/jpeg', 0.85),
          player,
          trigger,
          caption,
          mouthPct,
          points,
          zoneX: srcX,
          zoneW: srcW,
        };
      } catch {
        // Ignore export errors gracefully
      }
    },
    [canvasRef]
  );

  const startNewRound = useCallback(
    (overrideMode?: MuncherMode) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const nextMode = overrideMode ?? mode;
      const fresh = createInitialMuncherState('playing', nextMode);
      gameStateRef.current = fresh;
      shameSnapshotRef.current = null;
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
    (nextMode: MuncherMode) => {
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

  // Keyboard fallback controls (P1: A/D move, W/Space open mouth, Q/E tilt; P2: Arrows move, Up/Enter open)
  useEffect(() => {
    const setKeyState = (e: KeyboardEvent, active: boolean) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a') controlsRef.current.p1.left = active;
      else if (k === 'd') controlsRef.current.p1.right = active;
      else if (k === 'w' || e.code === 'Space') {
        if (gameStateRef.current.phase === 'playing' && e.code === 'Space') {
          e.preventDefault();
        }
        controlsRef.current.p1.open = active;
      } else if (k === 'q') controlsRef.current.p1.tiltLeft = active;
      else if (k === 'e') controlsRef.current.p1.tiltRight = active;
      else if (e.key === 'ArrowLeft') controlsRef.current.p2.left = active;
      else if (e.key === 'ArrowRight') controlsRef.current.p2.right = active;
      else if (e.key === 'ArrowUp') controlsRef.current.p2.open = active;
    };

    const onKeyDown = (e: KeyboardEvent) => setKeyState(e, true);
    const onKeyUp = (e: KeyboardEvent) => setKeyState(e, false);

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

  useEffect(() => {
    let lastTime = performance.now();
    let rafId = 0;

    const drawFaceMeshOverlay = (
      ctx: CanvasRenderingContext2D,
      landmarks: NormalizedFaceLandmark[],
      width: number,
      height: number,
      accent: string,
      isOpen: boolean,
      fever: boolean
    ) => {
      ctx.save();
      // Face oval wireframe
      ctx.strokeStyle = fever ? '#10B981' : accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
        const lm = landmarks[FACE_OVAL_INDICES[i]];
        if (!lm) continue;
        const sx = (1 - lm.x) * width;
        const sy = lm.y * height;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.stroke();

      // Lip ring highlights bright when wide open!
      ctx.strokeStyle = isOpen ? '#10B981' : '#F59E0B';
      ctx.globalAlpha = isOpen ? 0.95 : 0.65;
      ctx.lineWidth = isOpen ? 3.5 : 2;
      ctx.beginPath();
      for (let i = 0; i < OUTER_LIPS_INDICES.length; i++) {
        const lm = landmarks[OUTER_LIPS_INDICES[i]];
        if (!lm) continue;
        const sx = (1 - lm.x) * width;
        const sy = lm.y * height;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.stroke();

      // Neon cyber visor across eyes
      const lEye = landmarks[LEFT_EYE_OUTER_IDX];
      const rEye = landmarks[RIGHT_EYE_OUTER_IDX];
      if (lEye && rEye) {
        const lx = (1 - lEye.x) * width;
        const ly = lEye.y * height;
        const rx = (1 - rEye.x) * width;
        const ry = rEye.y * height;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawMouthCatcher = (
      ctx: CanvasRenderingContext2D,
      pState: MuncherPlayerState,
      zone: PlayerId,
      modeNow: MuncherMode,
      width: number,
      height: number,
      accent: string,
      hasLiveFace: boolean
    ) => {
      const pos = getPlayerMouthWorldPosition(pState, zone, modeNow, width, height);
      const isFever = pState.feverTimer > 0;
      const mouthColor =
        pState.stunTimer > 0
          ? '#EF4444'
          : isFever
          ? '#10B981'
          : pState.isMouthOpen
          ? accent
          : '#94A3B8';

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pState.headTiltRad);

      if (!hasLiveFace) {
        // Goofy cyber-head puppet for no-webcam play (centered slightly higher so mouth sits at jaw)
        ctx.strokeStyle = mouthColor;
        ctx.fillStyle = 'rgba(13, 18, 30, 0.88)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -26, pos.catchRadius * 1.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Chomp mouth ring / jaw indicator
      const openHeight = 6 + pState.mouthOpenRatio * (pos.catchRadius * 0.72);
      ctx.strokeStyle = mouthColor;
      ctx.fillStyle = pState.isMouthOpen
        ? isFever
          ? 'rgba(16, 185, 129, 0.25)'
          : 'rgba(0, 229, 255, 0.16)'
        : 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = pState.isMouthOpen ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 2, pos.catchRadius * 0.88, openHeight, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (!hasLiveFace) {
        // Draw eyes after mouth so wide chomps never cover the eyes
        ctx.fillStyle = pState.stunTimer > 0 ? '#EF4444' : '#FFFFFF';
        if (pState.stunTimer > 0) {
          ctx.font = '800 17px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('X   X', 0, -44);
        } else {
          ctx.beginPath();
          ctx.arc(-18, -48, 6, 0, Math.PI * 2);
          ctx.arc(18, -48, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Target reticle ticks
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = mouthColor;
      ctx.fillText(
        pState.stunTimer > 0
          ? 'STUNNED!'
          : pState.isMouthOpen
          ? 'MUNCH READY!'
          : 'CLAMPED',
        0,
        openHeight + 20
      );

      ctx.restore();
    };

    const drawFallingItem = (ctx: CanvasRenderingContext2D, item: FallingItem) => {
      const meta = SNACK_CATALOG[item.kind];
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);

      // Outer neon aura ring
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.arc(0, 0, item.radius * 1.24, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0D121E';
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = item.isBomb ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, item.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.rotate(-item.rotation);
      ctx.font = `${Math.round(item.radius * 1.15)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(meta.emoji, 0, 2);
      ctx.restore();
    };

    const drawZoneHud = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      pState: MuncherPlayerState,
      accent: string
    ) => {
      const centerX = zoneX + zoneW * 0.5;
      const barW = Math.min(220, zoneW - 44);
      const barX = centerX - barW * 0.5;
      const barY = 92;

      ctx.save();
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const pct = Math.round(pState.mouthOpenRatio * 100);
      ctx.fillStyle = pState.isMouthOpen ? '#10B981' : '#94A3B8';
      ctx.fillText(
        pState.feverTimer > 0
          ? `FEVER 2X · ${pState.feverTimer.toFixed(1)}s`
          : `MOUTH OPEN ${pct}%`,
        centerX,
        barY - 6
      );

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(barX, barY, barW, 9);
      ctx.strokeRect(barX, barY, barW, 9);

      ctx.fillStyle = pState.isMouthOpen ? '#10B981' : accent;
      ctx.fillRect(barX, barY, barW * pState.mouthOpenRatio, 9);

      // 40% open threshold marker
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(barX + barW * 0.4 - 1, barY - 2, 2, 13);

      if (pState.calloutLife > 0) {
        ctx.globalAlpha = Math.min(1, pState.calloutLife * 1.5);
        ctx.font = '800 24px "Outfit", sans-serif';
        ctx.fillStyle = pState.calloutColor;
        ctx.fillText(pState.calloutText, centerX, zoneH * 0.25);
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

      const faceResult = state.phase === 'playing' ? predictFace(now) : null;
      const detectedFaces: Array<{
        landmarks: NormalizedFaceLandmark[];
        zone: PlayerId;
        isOpen: boolean;
        fever: boolean;
      }> = [];

      let sawP1Face = false;
      let sawP2Face = false;

      if (faceResult && faceResult.faceLandmarks.length > 0) {
        for (let fIdx = 0; fIdx < faceResult.faceLandmarks.length; fIdx++) {
          const landmarks = faceResult.faceLandmarks[fIdx];
          const analysis = analyzeFaceMouth(landmarks, width, height, state.mode, true);
          if (!analysis) continue;

          const pState = analysis.zone === 'p1' ? state.p1 : state.p2;
          const zoneX = state.mode === 'solo' ? 0 : analysis.zone === 'p1' ? 0 : width * 0.5;
          const zoneW = state.mode === 'solo' ? width : width * 0.5;

          pState.mouthXNorm = Math.max(0.08, Math.min(0.92, (analysis.mouthX - zoneX) / Math.max(1, zoneW)));
          pState.mouthYNorm = Math.max(0.32, Math.min(0.86, analysis.mouthY / Math.max(1, height)));
          pState.mouthOpenRatio = analysis.mouthOpenRatio;
          pState.isMouthOpen = analysis.isMouthOpen;
          pState.headTiltRad = analysis.headTiltRad;

          if (analysis.zone === 'p1') sawP1Face = true;
          else sawP2Face = true;

          detectedFaces.push({
            landmarks,
            zone: analysis.zone,
            isOpen: analysis.isMouthOpen,
            fever: pState.feverTimer > 0,
          });
        }
      }

      if (state.phase === 'playing') {
        if (!sawP1Face) {
          const c = controlsRef.current.p1;
          const moveDir = c.left === c.right ? 0 : c.left ? -1 : 1;
          const tiltDir = c.tiltLeft === c.tiltRight ? 0 : c.tiltLeft ? -1 : 1;
          stepFallbackMouthController(state.p1, moveDir, c.open, tiltDir, dt);
        }
        if (state.mode === '1v1' && !sawP2Face) {
          const c = controlsRef.current.p2;
          const moveDir = c.left === c.right ? 0 : c.left ? -1 : 1;
          stepFallbackMouthController(state.p2, moveDir, c.open, 0, dt);
        }
      }

      const sim = stepMuncherSimulation(state, rawDt, width, height);
      if (sim.tickSecond !== null) audioRef.current?.playCountdownTick();

      for (let i = 0; i < sim.munchedBy.length; i++) {
        const m = sim.munchedBy[i];
        const pState = m.player === 'p1' ? state.p1 : state.p2;
        audioRef.current?.playMunch(pState.combo, m.fever);
        spawnParticleBurst(particlesRef.current, m.x, m.y, SNACK_CATALOG[m.kind].color, 18, 90, 260);
      }
      for (let i = 0; i < sim.deflectedBy.length; i++) {
        const d = sim.deflectedBy[i];
        audioRef.current?.playBombDeflect();
        spawnParticleBurst(particlesRef.current, d.x, d.y, '#10B981', 12, 80, 220);
      }
      for (let i = 0; i < sim.bombedBy.length; i++) {
        const b = sim.bombedBy[i];
        audioRef.current?.playPenalty(true);
        spawnParticleBurst(particlesRef.current, b.x, b.y, '#EF4444', 32, 130, 380);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      if (state.screenShake > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * state.screenShake * 1.5,
          (Math.random() - 0.5) * state.screenShake * 1.5
        );
      }

      drawArenaBackdrop(ctx, videoRef.current, width, height, { videoAlpha: 0.44 });
      if (state.mode === '1v1') {
        drawSplitDivider(ctx, width, height, 68);
      }

      for (let i = 0; i < detectedFaces.length; i++) {
        const f = detectedFaces[i];
        drawFaceMeshOverlay(
          ctx,
          f.landmarks,
          width,
          height,
          f.zone === 'p1' ? '#00E5FF' : '#FF2A6D',
          f.isOpen,
          f.fever
        );
      }

      drawMouthCatcher(
        ctx,
        state.p1,
        'p1',
        state.mode,
        width,
        height,
        '#00E5FF',
        sawP1Face
      );
      if (state.mode === '1v1') {
        drawMouthCatcher(
          ctx,
          state.p2,
          'p2',
          state.mode,
          width,
          height,
          '#FF2A6D',
          sawP2Face
        );
      }

      for (let i = 0; i < state.items.length; i++) {
        drawFallingItem(ctx, state.items[i]);
      }

      if (state.mode === '1v1') {
        drawZoneHud(ctx, 0, width * 0.5, height, state.p1, '#00E5FF');
        drawZoneHud(ctx, width * 0.5, width * 0.5, height, state.p2, '#FF2A6D');
      } else {
        drawZoneHud(ctx, 0, width, height, state.p1, '#00E5FF');
      }

      updateAndDrawParticles(ctx, particlesRef.current, dt, 340);
      ctx.restore();

      // Capture shame snapshot AFTER drawing current frame so the goofy face + item impact show up!
      if (sim.shameCandidate) {
        captureShameSnapshot(
          sim.shameCandidate.player,
          sim.shameCandidate.trigger,
          sim.shameCandidate.caption,
          sim.shameCandidate.mouthPct,
          sim.shameCandidate.points,
          state.mode
        );
      }

      if (sim.roundEnded) {
        audioRef.current?.playRoundEnd();
        recordScoreboardRound(
          state.mode,
          { score: state.p1.score, detail: `${state.p1.itemsMunched} munched` },
          { score: state.p2.score, detail: `${state.p2.itemsMunched} munched` }
        );
        setPhase('gameover');
        setEndSummary({
          winner: determineMuncherWinner(state.mode, state.p1.score, state.p2.score),
          mode: state.mode,
          p1: { ...state.p1 },
          p2: { ...state.p2 },
          shameSnapshot: shameSnapshotRef.current,
        });
      }

      syncHudDom(state);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    audioRef,
    canvasRef,
    captureShameSnapshot,
    predictFace,
    recordScoreboardRound,
    setPhase,
    sizeRef,
    syncHudDom,
    videoRef,
  ]);

  const statusText =
    cameraStatus === 'active'
      ? faceModelStatus === 'ready'
        ? 'Webcam + 478-Point Face Mesh Active'
        : 'Webcam Active · Loading Face Landmarker...'
      : 'Keyboard / Button Mouth Controls Ready (A/D Move, Space Open Wide)';

  const rules = [
    { text: 'Open Mouth = Munch', colorClass: 'text-cyan-300' },
    { text: 'Clamp Shut = Deflect 💣', colorClass: 'text-emerald-300' },
    { text: '🌶️ = 2x Fever', colorClass: 'text-amber-300' },
    { text: 'Shame Snapshot', colorClass: 'text-rose-300' },
  ];

  const titleOverlay = (
    <ArcadeTitleCard
      icon={
        <svg viewBox="0 0 120 48" className="mb-2.5 h-10 w-24" aria-hidden="true">
          <circle cx="60" cy="24" r="19" stroke="#EC4899" strokeWidth="2.5" fill="rgba(236,72,153,0.12)" />
          <circle cx="51" cy="18" r="2.5" fill="#FFFFFF" />
          <circle cx="69" cy="18" r="2.5" fill="#FFFFFF" />
          <ellipse cx="60" cy="30" rx="9" ry="7" stroke="#10B981" strokeWidth="2.5" fill="rgba(16,185,129,0.25)" />
        </svg>
      }
      title="Neon Muncher"
      subtitle="Move your head and open wide to chomp neon snacks—clamp shut or lean away from bombs!"
      mode={mode}
      duelLabel="1v1 Munch Battle"
      soloLabel="1P Solo Feast"
      onModeChange={handleModeChange}
      p1Name={p1Name}
      p2Name={p2Name}
      onChangeP1Name={handleP1NameChange}
      onChangeP2Name={handleP2NameChange}
      rules={rules}
      cameraStatus={cameraStatus}
      cameraStatusLabel={statusText}
      errorMessage={errorMessage}
      onRequestCamera={() => void requestCamera()}
      startLabel="Open Wide & Play (45s)"
      onStart={() => startNewRound()}
    />
  );

  const bottomControls =
    phase === 'playing' && cameraStatus !== 'active' ? (
      <div className="pointer-events-auto fixed bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-700/80 bg-[#0D121E]/95 px-3 py-1.5 text-xs">
        <span className="font-mono text-[11px] text-slate-400">Move P1:</span>
        <button
          type="button"
          onPointerDown={() => { controlsRef.current.p1.left = true; }}
          onPointerUp={() => { controlsRef.current.p1.left = false; }}
          onPointerLeave={() => { controlsRef.current.p1.left = false; }}
          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-200 hover:bg-cyan-500/25"
        >
          ← Left (A)
        </button>
        <button
          type="button"
          onPointerDown={() => { controlsRef.current.p1.open = true; }}
          onPointerUp={() => { controlsRef.current.p1.open = false; }}
          onPointerLeave={() => { controlsRef.current.p1.open = false; }}
          className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 font-bold text-emerald-200 hover:bg-emerald-500/30"
        >
          😮 Open Wide (Space)
        </button>
        <button
          type="button"
          onPointerDown={() => { controlsRef.current.p1.right = true; }}
          onPointerUp={() => { controlsRef.current.p1.right = false; }}
          onPointerLeave={() => { controlsRef.current.p1.right = false; }}
          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-200 hover:bg-cyan-500/25"
        >
          Right (D) →
        </button>
      </div>
    ) : null;

  const endOverlay = endSummary ? (
    <ArcadeEndCard
      winnerTitle={
        endSummary.winner === 'p1'
          ? `${resolvedP1Name} Wins the Feast!`
          : endSummary.winner === 'p2'
          ? `${resolvedP2Name} Wins the Feast!`
          : endSummary.winner === 'solo'
          ? `${resolvedP1Name} · Feast Complete`
          : 'Tied Munch Off!'
      }
      mode={endSummary.mode}
      topSlot={
        endSummary.shameSnapshot ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-pink-500/40 bg-[#090D16] text-left">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-xs">
              <span className="font-bold text-pink-300">
                SHAME CAM ·{' '}
                {endSummary.shameSnapshot.player === 'p1' ? resolvedP1Name : resolvedP2Name}
              </span>
              <a
                href={endSummary.shameSnapshot.dataUrl}
                download="neon-muncher-shame-cam.jpg"
                className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                Save Photo
              </a>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={endSummary.shameSnapshot.dataUrl}
              alt={`Funny moment capture: ${endSummary.shameSnapshot.caption}`}
              className="h-32 w-full object-cover"
            />
          </div>
        ) : undefined
      }
      p1={{
        name: resolvedP1Name,
        score: endSummary.p1.score,
        metrics: [
          `Ate ${endSummary.p1.itemsMunched}`,
          `Clamped ${endSummary.p1.bombsDeflected}💣`,
          `Max Mouth ${endSummary.p1.peakMouthPct}%`,
        ],
      }}
      p2={
        endSummary.mode === '1v1'
          ? {
              name: resolvedP2Name,
              score: endSummary.p2.score,
              metrics: [
                `Ate ${endSummary.p2.itemsMunched}`,
                `Clamped ${endSummary.p2.bombsDeflected}💣`,
                `Max Mouth ${endSummary.p2.peakMouthPct}%`,
              ],
            }
          : undefined
      }
      scoreboard={scoreboard}
      highlightIds={newEntryIds}
      onClearScoreboard={handleClearScoreboard}
      replayLabel="Munch Again"
      onReplay={() => startNewRound()}
    />
  ) : null;

  return (
    <ArcadeGameShell
      phase={phase}
      isMuted={isMuted}
      initialDurationSec={MUNCHER_ROUND_DURATION_SEC}
      soloMode={mode === 'solo'}
      p1Label={p1Name.trim() || undefined}
      p2Label={p2Name.trim() || undefined}
      canvasTestId="neon-muncher-canvas"
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
