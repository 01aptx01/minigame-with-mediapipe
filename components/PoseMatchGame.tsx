'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArcadeEndCard } from '@/components/arcade/ArcadeEndCard';
import { ArcadeGameShell } from '@/components/arcade/ArcadeGameShell';
import { ArcadeTitleCard } from '@/components/arcade/ArcadeTitleCard';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import {
  assignPoseToZone,
  computePoseTugRatio,
  createInitialPoseGameState,
  determinePoseWinner,
  extractJointAngles,
  getHoldRequirementSec,
  MATCH_THRESHOLD_PERCENT,
  POSE_ROUND_DURATION_SEC,
  POSE_SKELETON_SEGMENTS,
  POSE_TEMPLATE_BY_KIND,
  POSE_TEMPLATES,
  POSE_RENDER_KEYPOINTS,
  scorePoseMatchPercent,
  stepPoseSimulation,
} from '@/lib/games/pose-match/engine';
import type {
  MvpSnapshot,
  NormalizedLandmark,
  PlayerId,
  Point2D,
  PoseEndSummary,
  PoseGameMode,
  PoseGamePhase,
  PoseGameState,
  PoseKind,
  PosePlayerState,
} from '@/lib/games/pose-match/types';
import {
  createParticlePool,
  drawArenaBackdrop,
  drawSplitDivider,
  resetParticlePool,
  spawnParticleBurst,
  updateAndDrawParticles,
} from '@/lib/games/shared/canvas';

export default function PoseMatchGame() {
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

  const initialPhase: PoseGamePhase =
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
  } = useArcadeSession('pose-match-battle', initialPhase, '1v1');

  const gameStateRef = useRef<PoseGameState>(createInitialPoseGameState(initialPhase, '1v1'));
  const mvpSnapshotRef = useRef<MvpSnapshot | null>(null);
  const mvpCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef(createParticlePool(140));
  const puppetPoseRef = useRef<{ p1: PoseKind | null; p2: PoseKind | null }>({
    p1: null,
    p2: null,
  });

  const [endSummary, setEndSummary] = useState<PoseEndSummary | null>(null);

  useEffect(() => {
    void initializePoseModel();
  }, [initializePoseModel]);

  const syncHudDom = useCallback(
    (state: PoseGameState) => {
      hudHandleRef.current?.updateHud({
        timeRemaining: state.timeRemaining,
        p1Score: state.p1.score,
        p1Meta: `${state.p1.matchPercent}% · ${state.p1.combo}x`,
        p2Score: state.p2.score,
        p2Meta: `${state.p2.matchPercent}% · ${state.p2.combo}x`,
        tugRatio: computePoseTugRatio(
          state.mode,
          state.p1.matchPercent,
          state.p2.matchPercent
        ),
        tugDividerPercent: state.mode === 'solo' ? 80 : undefined,
        overdrive: state.overdrive && state.phase === 'playing',
      });
    },
    [hudHandleRef]
  );

  const startNewRound = useCallback(
    (overrideMode?: PoseGameMode) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const nextMode = overrideMode ?? mode;
      const fresh = createInitialPoseGameState('playing', nextMode);
      gameStateRef.current = fresh;
      mvpSnapshotRef.current = null;
      puppetPoseRef.current = { p1: null, p2: null };
      resetParticlePool(particlesRef.current);
      setEndSummary(null);
      setNewEntryIds([]);
      setPhase('playing');
      syncHudDom(fresh);
    },
    [mode, setNewEntryIds, setPhase, syncHudDom]
  );

  const handleModeChange = useCallback(
    (nextMode: PoseGameMode) => {
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
      setPhase('paused');
    } else if (current === 'paused') {
      gameStateRef.current.phase = 'playing';
      setPhase('playing');
    }
  }, [setPhase]);

  const triggerPuppetPose = useCallback((player: PlayerId, kind: PoseKind | null) => {
    puppetPoseRef.current[player] = kind;
  }, []);

  const captureMvpSnapshot = useCallback(
    (player: PlayerId, poseLabel: string, accuracy: number, points: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        if (!mvpCanvasRef.current) {
          const thumb = document.createElement('canvas');
          thumb.width = 480;
          thumb.height = 270;
          mvpCanvasRef.current = thumb;
        }
        const thumb = mvpCanvasRef.current;
        const tCtx = thumb.getContext('2d');
        if (!tCtx) return;
        tCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
        mvpSnapshotRef.current = {
          dataUrl: thumb.toDataURL('image/jpeg', 0.8),
          poseLabel,
          player,
          accuracy,
          points,
        };
      } catch {
        // Ignore offscreen export errors safely
      }
    },
    [canvasRef]
  );

  useEffect(() => {
    let lastTime = performance.now();
    let rafId = 0;

    const drawTargetOutline = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      playerState: PosePlayerState,
      accentColor: string,
      overdrive: boolean,
      nowMs: number
    ) => {
      const pose = playerState.currentPose;
      const centerX = zoneX + zoneW * 0.5;
      const centerY = zoneH * 0.52;
      const scale = Math.min(zoneW * 0.38, zoneH * 0.28);

      const isFogged =
        playerState.sabotageKind === 'fog' && playerState.sabotageRemaining > 0;

      if (isFogged) {
        ctx.save();
        const grad = ctx.createRadialGradient(
          centerX,
          centerY,
          20,
          centerX,
          centerY,
          scale * 1.35
        );
        grad.addColorStop(0, 'rgba(226, 232, 240, 0.55)');
        grad.addColorStop(0.6, 'rgba(148, 163, 184, 0.35)');
        grad.addColorStop(1, 'rgba(15, 23, 42, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, scale * 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      const strokeColor = pose.isFakeout ? '#EF4444' : accentColor;
      const pulseSpeed = overdrive ? 0.012 : 0.005;
      const pulseAlpha = 0.55 + Math.sin(nowMs * pulseSpeed) * 0.25;

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.globalAlpha = pulseAlpha;
      ctx.lineWidth = pose.isFakeout ? 4 : 3.5;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -(nowMs * (overdrive ? 0.09 : 0.04));

      const pts = pose.skeletonPoints;
      for (const [aIdx, bIdx] of POSE_SKELETON_SEGMENTS) {
        const a = pts[aIdx];
        const b = pts[bIdx];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(centerX + a.x * scale, centerY + a.y * scale);
        ctx.lineTo(centerX + b.x * scale, centerY + b.y * scale);
        ctx.stroke();
      }

      const head = pts[0];
      if (head) {
        ctx.beginPath();
        ctx.arc(
          centerX + head.x * scale,
          centerY + head.y * scale,
          scale * 0.14,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawLiveSkeleton = (
      ctx: CanvasRenderingContext2D,
      points: Record<number, Point2D>,
      color: string
    ) => {
      ctx.save();
      ctx.lineCap = 'round';

      ctx.beginPath();
      for (let i = 0; i < POSE_SKELETON_SEGMENTS.length; i++) {
        const [aIdx, bIdx] = POSE_SKELETON_SEGMENTS[i];
        const a = points[aIdx];
        const b = points[bIdx];
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }

      // Batched outer glow + crisp neon core without shadowBlur
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth = 11;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      for (let i = 1; i < POSE_RENDER_KEYPOINTS.length; i++) {
        const pt = points[POSE_RENDER_KEYPOINTS[i]];
        if (!pt) continue;
        ctx.moveTo(pt.x + 4.5, pt.y);
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    };

    const drawZoneOverlayHud = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      playerId: PlayerId,
      playerState: PosePlayerState,
      modeNow: PoseGameMode,
      overdrive: boolean
    ) => {
      const accent = playerId === 'p1' ? '#00E5FF' : '#FF2A6D';
      const pose = playerState.currentPose;
      const centerX = zoneX + zoneW * 0.5;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 22px "Outfit", sans-serif';
      ctx.fillStyle = pose.isFakeout ? '#EF4444' : '#F8FAFC';
      ctx.fillText(
        pose.isFakeout ? 'AVOID! FAKE-OUT POSE' : pose.label.toUpperCase(),
        centerX,
        118
      );

      if (playerState.sabotageRemaining > 0 && playerState.sabotageKind) {
        ctx.font = '700 13px "JetBrains Mono", monospace';
        ctx.fillStyle = '#F59E0B';
        const sabText =
          playerState.sabotageKind === 'fog'
            ? `FLASHBANG FOG · ${playerState.sabotageRemaining.toFixed(1)}s`
            : `MIRROR FLIP · ${playerState.sabotageRemaining.toFixed(1)}s`;
        ctx.fillText(sabText, centerX, 142);
      }

      if (playerState.calloutLife > 0) {
        ctx.globalAlpha = Math.min(1, playerState.calloutLife * 1.4);
        ctx.font = '800 26px "Outfit", sans-serif';
        ctx.fillStyle = playerState.calloutColor;
        ctx.fillText(playerState.calloutText, centerX, zoneH * 0.27);
        ctx.globalAlpha = 1;
      }

      const barW = Math.min(280, zoneW - 48);
      const barX = centerX - barW * 0.5;
      const barY = zoneH - 68;

      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#CBD5E1';
      ctx.fillText(`MATCH ${playerState.matchPercent}%`, barX, barY - 8);

      const holdReq = getHoldRequirementSec(modeNow, overdrive);
      ctx.textAlign = 'right';
      ctx.fillStyle =
        playerState.matchPercent >= MATCH_THRESHOLD_PERCENT ? '#10B981' : '#94A3B8';
      ctx.fillText(
        `HOLD ${(playerState.holdProgress * holdReq).toFixed(1)}s / ${holdReq.toFixed(1)}s`,
        barX + barW,
        barY - 8
      );

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(barX, barY, barW, 10);
      ctx.strokeRect(barX, barY, barW, 10);

      const matchColor =
        playerState.matchPercent >= MATCH_THRESHOLD_PERCENT
          ? pose.isFakeout
            ? '#EF4444'
            : '#10B981'
          : accent;
      ctx.fillStyle = matchColor;
      ctx.fillRect(barX, barY, barW * (playerState.matchPercent / 100), 10);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(barX + barW * 0.8 - 1, barY - 2, 2, 14);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(barX, barY + 14, barW, 7);
      ctx.fillStyle = pose.isFakeout ? '#EF4444' : '#F59E0B';
      ctx.fillRect(barX, barY + 14, barW * Math.min(1, playerState.holdProgress), 7);

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

      const poseResult = state.phase === 'playing' ? predictPose(now) : null;
      const liveZonePoints: Record<PlayerId, Record<number, Point2D> | null> = {
        p1: null,
        p2: null,
      };

      let sawP1Live = false;
      let sawP2Live = false;

      if (poseResult && poseResult.landmarks.length > 0) {
        for (let pIdx = 0; pIdx < poseResult.landmarks.length; pIdx++) {
          const landmarks = poseResult.landmarks[pIdx];
          const zone = assignPoseToZone(landmarks, state.mode, true);
          const pState = zone === 'p1' ? state.p1 : state.p2;
          const isMirroredSabotage =
            pState.sabotageKind === 'mirror' && pState.sabotageRemaining > 0;

          const angles = extractJointAngles(landmarks);
          const pct = angles ? scorePoseMatchPercent(angles, pState.currentPose) : 0;

          const zoneX = state.mode === 'solo' ? 0 : zone === 'p1' ? 0 : width * 0.5;
          const zoneW = state.mode === 'solo' ? width : width * 0.5;

          const mapped: Record<number, Point2D> = {};
          for (let i = 0; i < landmarks.length; i++) {
            const lm: NormalizedLandmark = landmarks[i];
            const rawScreenX = (1 - lm.x) * width;
            const localX = isMirroredSabotage
              ? zoneX + zoneW - (rawScreenX - zoneX)
              : rawScreenX;
            mapped[i] = { x: localX, y: lm.y * height };
          }

          if (zone === 'p1') {
            sawP1Live = true;
            state.p1.matchPercent = pct;
            liveZonePoints.p1 = mapped;
          } else {
            sawP2Live = true;
            state.p2.matchPercent = pct;
            liveZonePoints.p2 = mapped;
          }
        }
      }

      const applyPuppetFallback = (zone: PlayerId, pState: PosePlayerState) => {
        const puppetKind = puppetPoseRef.current[zone];
        if (!puppetKind) {
          pState.matchPercent = Math.max(0, Math.round(pState.matchPercent * 0.86));
          return;
        }
        const tmpl = POSE_TEMPLATE_BY_KIND[puppetKind];
        if (!tmpl) return;

        pState.matchPercent = scorePoseMatchPercent(tmpl.targetAngles, pState.currentPose);
        const zoneX = state.mode === 'solo' ? 0 : zone === 'p1' ? 0 : width * 0.5;
        const zoneW = state.mode === 'solo' ? width : width * 0.5;
        const cx = zoneX + zoneW * 0.5;
        const cy = height * 0.52;
        const scale = Math.min(zoneW * 0.38, height * 0.28);
        const out: Record<number, Point2D> = {};
        for (let i = 0; i < POSE_RENDER_KEYPOINTS.length; i++) {
          const kp = POSE_RENDER_KEYPOINTS[i];
          const pt = tmpl.skeletonPoints[kp];
          if (pt) {
            out[kp] = { x: cx + pt.x * scale, y: cy + pt.y * scale };
          }
        }
        liveZonePoints[zone] = out;
      };

      if (!sawP1Live) applyPuppetFallback('p1', state.p1);
      if (state.mode === '1v1' && !sawP2Live) applyPuppetFallback('p2', state.p2);

      const sim = stepPoseSimulation(state, rawDt);
      if (sim.overdriveStarted) audioRef.current?.playOverdriveStart();
      if (sim.tickSecond !== null) audioRef.current?.playCountdownTick();

      const handlePlayerOutcome = (
        player: PlayerId,
        outcome: typeof sim.p1Outcome | null
      ) => {
        if (!outcome) return;
        const zoneX = state.mode === 'solo' ? 0 : player === 'p1' ? 0 : width * 0.5;
        const zoneW = state.mode === 'solo' ? width : width * 0.5;
        const cx = zoneX + zoneW * 0.5;
        const cy = height * 0.5;
        const color = player === 'p1' ? '#00E5FF' : '#FF2A6D';

        if (outcome.matchedPose) {
          const pState = player === 'p1' ? state.p1 : state.p2;
          audioRef.current?.playPoseMatch(pState.combo, state.overdrive);
          spawnParticleBurst(particlesRef.current, cx, cy, color, 22, 90, 280);
          if (outcome.triggeredSabotageOn) {
            audioRef.current?.playSabotage();
          }
          if (outcome.awardedPoints >= state.bestScoreForMvp) {
            state.bestScoreForMvp = outcome.awardedPoints;
            captureMvpSnapshot(
              player,
              outcome.poseLabel,
              outcome.accuracy,
              outcome.awardedPoints
            );
          }
        } else if (outcome.triggeredFakeout) {
          audioRef.current?.playPenalty(true);
          spawnParticleBurst(particlesRef.current, cx, cy, '#EF4444', 20, 90, 280);
        } else if (outcome.dodgedFakeout) {
          audioRef.current?.playSlice(2);
          spawnParticleBurst(particlesRef.current, cx, cy, '#10B981', 12, 90, 240);
        }
      };

      handlePlayerOutcome('p1', sim.p1Outcome);
      handlePlayerOutcome('p2', sim.p2Outcome);

      if (sim.roundEnded) {
        audioRef.current?.playRoundEnd();
        recordScoreboardRound(
          state.mode,
          { score: state.p1.score, detail: `${state.p1.posesMatched} poses` },
          { score: state.p2.score, detail: `${state.p2.posesMatched} poses` }
        );
        setPhase('gameover');
        setEndSummary({
          winner: determinePoseWinner(state.mode, state.p1.score, state.p2.score),
          mode: state.mode,
          p1: { ...state.p1 },
          p2: { ...state.p2 },
          mvpSnapshot: mvpSnapshotRef.current,
        });
      }

      syncHudDom(state);

      ctx.save();
      ctx.scale(dpr, dpr);

      if (state.screenShake > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * state.screenShake * 1.4,
          (Math.random() - 0.5) * state.screenShake * 1.4
        );
      }

      drawArenaBackdrop(ctx, videoRef.current, width, height, { videoAlpha: 0.36 });

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
        playerState: PosePlayerState,
        accent: string
      ) => {
        drawTargetOutline(
          ctx,
          zoneX,
          zoneW,
          height,
          playerState,
          accent,
          state.overdrive,
          now
        );
        const livePts = liveZonePoints[playerId];
        if (livePts) {
          drawLiveSkeleton(ctx, livePts, accent);
        }
        drawZoneOverlayHud(
          ctx,
          zoneX,
          zoneW,
          height,
          playerId,
          playerState,
          state.mode,
          state.overdrive
        );
      };

      if (state.mode === '1v1') {
        drawSplitDivider(ctx, width, height, 68);
        renderZone(0, width * 0.5, 'p1', state.p1, '#00E5FF');
        renderZone(width * 0.5, width * 0.5, 'p2', state.p2, '#FF2A6D');
      } else {
        renderZone(0, width, 'p1', state.p1, '#00E5FF');
      }

      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      updateAndDrawParticles(ctx, particlesRef.current, dt, 320);

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    audioRef,
    canvasRef,
    captureMvpSnapshot,
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
        ? 'Webcam + 2-Pose Full Tracking Active'
        : 'Webcam Active · Loading Pose Model...'
      : 'Pose Puppet Fallback Ready (No Webcam)';

  const poseRules = [
    { text: '±30° Angle', colorClass: 'text-cyan-300' },
    { text: `Hold ${mode === '1v1' ? '1.5s' : '2.0s'}`, colorClass: 'text-emerald-300' },
    ...(mode === '1v1' ? [{ text: '3x Fog/Mirror', colorClass: 'text-purple-300' }] : []),
    { text: 'Final 15s 2x', colorClass: 'text-amber-300' },
  ];

  const titleOverlay = (
    <ArcadeTitleCard
      icon={
        <svg viewBox="0 0 120 48" className="mb-2.5 h-10 w-24" aria-hidden="true">
          <circle cx="36" cy="12" r="5" stroke="#00E5FF" strokeWidth="2.5" fill="none" />
          <path
            d="M16 18 L36 22 L56 18 M36 22 L36 34 L24 46 M36 34 L48 46"
            stroke="#00E5FF"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="84" cy="12" r="5" stroke="#FF2A6D" strokeWidth="2.5" fill="none" />
          <path
            d="M66 10 L84 22 L102 10 M84 22 L84 34 L72 46 M84 34 L96 46"
            stroke="#FF2A6D"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      }
      title="Pose Match Battle"
      subtitle="Hold 80%+ joint accuracy to score. Dodge red Fake-Outs & win 2x Overdrive."
      mode={mode}
      duelLabel="1v1 Split Race"
      soloLabel="1P Solo Arcade"
      onModeChange={handleModeChange}
      p1Name={p1Name}
      p2Name={p2Name}
      onChangeP1Name={handleP1NameChange}
      onChangeP2Name={handleP2NameChange}
      rules={poseRules}
      cameraStatus={cameraStatus}
      cameraStatusLabel={statusText}
      errorMessage={errorMessage}
      onRequestCamera={() => void requestCamera()}
      startLabel="Start 60s Pose Battle"
      onStart={() => startNewRound()}
    />
  );

  const bottomControls =
    phase === 'playing' && cameraStatus !== 'active' ? (
      <div className="pointer-events-auto fixed bottom-2 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-slate-700/80 bg-[#0D121E]/95 px-3 py-1.5 text-xs">
        <span className="mr-1 font-mono text-[11px] text-slate-400">Practice P1:</span>
        {POSE_TEMPLATES.map((pose) => (
          <button
            key={pose.kind}
            type="button"
            onPointerDown={() => triggerPuppetPose('p1', pose.kind)}
            onPointerUp={() => triggerPuppetPose('p1', null)}
            onPointerLeave={() => triggerPuppetPose('p1', null)}
            className={`rounded px-2 py-1 font-semibold transition-colors ${
              pose.isFakeout
                ? 'border border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/30'
                : 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/25'
            }`}
          >
            {pose.label}
          </button>
        ))}
      </div>
    ) : null;

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
      topSlot={
        endSummary.mvpSnapshot ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-amber-500/40 bg-[#090D16] text-left">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-xs">
              <span className="font-bold text-amber-300">
                MVP ·{' '}
                {endSummary.mvpSnapshot.player === 'p1' ? resolvedP1Name : resolvedP2Name}
              </span>
              <span className="font-mono text-slate-300">
                {endSummary.mvpSnapshot.poseLabel} ({endSummary.mvpSnapshot.accuracy}% · +
                {endSummary.mvpSnapshot.points})
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={endSummary.mvpSnapshot.dataUrl}
              alt={`MVP pose capture: ${endSummary.mvpSnapshot.poseLabel}`}
              className="h-28 w-full object-cover"
            />
          </div>
        ) : undefined
      }
      p1={{
        name: resolvedP1Name,
        score: endSummary.p1.score,
        metrics: [
          `Poses ${endSummary.p1.posesMatched}`,
          `Max ${endSummary.p1.maxCombo}x`,
          `Peak ${endSummary.p1.peakAccuracy}%`,
        ],
      }}
      p2={
        endSummary.mode === '1v1'
          ? {
              name: resolvedP2Name,
              score: endSummary.p2.score,
              metrics: [
                `Poses ${endSummary.p2.posesMatched}`,
                `Max ${endSummary.p2.maxCombo}x`,
                `Peak ${endSummary.p2.peakAccuracy}%`,
              ],
            }
          : undefined
      }
      scoreboard={scoreboard}
      highlightIds={newEntryIds}
      onClearScoreboard={handleClearScoreboard}
      replayLabel="Play Again"
      onReplay={() => startNewRound()}
    />
  ) : null;

  return (
    <ArcadeGameShell
      phase={phase}
      isMuted={isMuted}
      initialDurationSec={POSE_ROUND_DURATION_SEC}
      soloMode={mode === 'solo'}
      p1Label={p1Name.trim() || undefined}
      p2Label={p2Name.trim() || undefined}
      canvasTestId="pose-match-canvas"
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
