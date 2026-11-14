'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Camera, Play, User, Users } from 'lucide-react';
import {
  ArcadeGameShell,
  type ArcadeHudHandle,
} from '@/components/arcade/ArcadeGameShell';
import { LeaderboardPanel } from '@/components/arcade/LeaderboardPanel';
import { PlayerNameInputs } from '@/components/arcade/PlayerNameInputs';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { ArcadeAudioEngine } from '@/lib/games/shared/audio';
import {
  clearScoreboard,
  loadScoreboard,
  normalizePlayerName,
  recordMatchToScoreboard,
  saveScoreboard,
  type ScoreboardEntry,
} from '@/lib/games/shared/scoreboard';
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
  POSE_TEMPLATES,
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

interface ParticleBurst {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

const POOL_SIZE = 140;

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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 1280, height: 720 });

  const autostart = searchParams.get('autostart') === '1';
  const initialPhase: PoseGamePhase = autostart ? 'playing' : 'title';

  // 60FPS simulation refs
  const gameStateRef = useRef<PoseGameState>(createInitialPoseGameState(initialPhase, '1v1'));
  const audioRef = useRef<ArcadeAudioEngine | null>(null);
  const mvpSnapshotRef = useRef<MvpSnapshot | null>(null);
  const particlesRef = useRef<ParticleBurst[]>(
    Array.from({ length: POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 3,
      color: '#00E5FF',
      life: 0,
      maxLife: 0.5,
    }))
  );
  const particleCursorRef = useRef<number>(0);

  // Optional keyboard/click puppet pose override when no physical webcam skeleton is present
  const puppetPoseRef = useRef<{ p1: PoseKind | null; p2: PoseKind | null }>({
    p1: null,
    p2: null,
  });

  const hudHandleRef = useRef<ArcadeHudHandle | null>(null);
  const namesRef = useRef<{ p1: string; p2: string }>({ p1: '', p2: '' });

  // Discrete React UI states
  const [phase, setPhase] = useState<PoseGamePhase>(initialPhase);
  const [mode, setMode] = useState<PoseGameMode>('1v1');
  const [p1Name, setP1Name] = useState<string>('');
  const [p2Name, setP2Name] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [endSummary, setEndSummary] = useState<PoseEndSummary | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardEntry[]>([]);
  const [newEntryIds, setNewEntryIds] = useState<string[]>([]);

  // Lazily load PoseLandmarker model on mount
  useEffect(() => {
    audioRef.current = new ArcadeAudioEngine();
    void initializePoseModel();
  }, [initializePoseModel]);

  const spawnBurst = useCallback((x: number, y: number, color: string, count: number) => {
    const pool = particlesRef.current;
    for (let i = 0; i < count; i++) {
      const idx = particleCursorRef.current;
      particleCursorRef.current = (idx + 1) % POOL_SIZE;
      const p = pool[idx];
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 280;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 40;
      p.size = 3 + Math.random() * 4;
      p.color = color;
      p.life = 0;
      p.maxLife = 0.35 + Math.random() * 0.25;
    }
  }, []);

  const syncHudDom = useCallback((state: PoseGameState) => {
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
  }, []);

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
      particlesRef.current.forEach((p) => {
        p.active = false;
      });
      setEndSummary(null);
      setNewEntryIds([]);
      setPhase('playing');
      syncHudDom(fresh);
    },
    [mode, syncHudDom]
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
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleModeChange = useCallback((nextMode: PoseGameMode) => {
    setMode(nextMode);
    if (gameStateRef.current.phase === 'title') {
      gameStateRef.current.mode = nextMode;
    }
  }, []);

  const handleP1NameChange = useCallback((val: string) => {
    setP1Name(val);
    namesRef.current.p1 = val;
  }, []);

  const handleP2NameChange = useCallback((val: string) => {
    setP2Name(val);
    namesRef.current.p2 = val;
  }, []);

  const handleClearScoreboard = useCallback(() => {
    clearScoreboard('pose-match-battle');
    setScoreboard([]);
    setNewEntryIds([]);
  }, []);

  const triggerPuppetPose = useCallback((player: PlayerId, kind: PoseKind | null) => {
    puppetPoseRef.current[player] = kind;
  }, []);

  // Capture MVP Snapshot from active canvas
  const captureMvpSnapshot = useCallback(
    (player: PlayerId, poseLabel: string, accuracy: number, points: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        // Downscale to crisp 480x270 thumbnail to keep memory low
        const thumb = document.createElement('canvas');
        thumb.width = 480;
        thumb.height = 270;
        const tCtx = thumb.getContext('2d');
        if (!tCtx) return;
        tCtx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
        const dataUrl = thumb.toDataURL('image/jpeg', 0.8);
        mvpSnapshotRef.current = {
          dataUrl,
          poseLabel,
          player,
          accuracy,
          points,
        };
      } catch {
        // Ignore security/offscreen errors safely
      }
    },
    []
  );

  // Main 60FPS requestAnimationFrame loop
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
        // Flashbang / Fog Sabotage hides dashed target outline
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

      // Head ring
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
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';

      for (const [aIdx, bIdx] of POSE_SKELETON_SEGMENTS) {
        const a = points[aIdx];
        const b = points[bIdx];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Highlight 8 key joint nodes
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowBlur = 8;
      for (const idx of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        const pt = points[idx];
        if (!pt) continue;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
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

      // Top zone pose prompt label
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '800 22px "Outfit", sans-serif';
      ctx.fillStyle = pose.isFakeout ? '#EF4444' : '#F8FAFC';
      ctx.fillText(
        pose.isFakeout ? 'AVOID! FAKE-OUT POSE' : pose.label.toUpperCase(),
        centerX,
        118
      );

      // Sabotage alert if active
      if (playerState.sabotageRemaining > 0 && playerState.sabotageKind) {
        ctx.font = '700 13px "JetBrains Mono", monospace';
        ctx.fillStyle = '#F59E0B';
        const sabText =
          playerState.sabotageKind === 'fog'
            ? `FLASHBANG FOG · ${playerState.sabotageRemaining.toFixed(1)}s`
            : `MIRROR FLIP · ${playerState.sabotageRemaining.toFixed(1)}s`;
        ctx.fillText(sabText, centerX, 142);
      }

      // Callout popup
      if (playerState.calloutLife > 0) {
        ctx.globalAlpha = Math.min(1, playerState.calloutLife * 1.4);
        ctx.font = '800 26px "Outfit", sans-serif';
        ctx.fillStyle = playerState.calloutColor;
        ctx.fillText(playerState.calloutText, centerX, zoneH * 0.27);
        ctx.globalAlpha = 1;
      }

      // Lower Match % + Hold Progress Bar
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

      // Accuracy Track
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(barX, barY, barW, 10);
      ctx.strokeRect(barX, barY, barW, 10);

      // Accuracy Fill
      const matchColor =
        playerState.matchPercent >= MATCH_THRESHOLD_PERCENT
          ? pose.isFakeout
            ? '#EF4444'
            : '#10B981'
          : accent;
      ctx.fillStyle = matchColor;
      ctx.fillRect(barX, barY, barW * (playerState.matchPercent / 100), 10);

      // 80% threshold tick
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(barX + barW * 0.8 - 1, barY - 2, 2, 14);

      // Hold Progress Track directly underneath
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

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { width, height } = sizeRef.current;
      const dpr = canvas.width / Math.max(1, width);
      const state = gameStateRef.current;

      // 1. Poll MediaPipe PoseLandmarker (numPoses: 2)
      const poseResult = predictPose(now);
      const liveZonePoints: Record<PlayerId, Record<number, Point2D> | null> = {
        p1: null,
        p2: null,
      };

      let sawP1Live = false;
      let sawP2Live = false;

      if (poseResult && poseResult.landmarks.length > 0) {
        for (const landmarks of poseResult.landmarks) {
          const zone = assignPoseToZone(landmarks, state.mode, true);
          const isMirroredSabotage =
            (zone === 'p1' ? state.p1 : state.p2).sabotageKind === 'mirror' &&
            (zone === 'p1' ? state.p1 : state.p2).sabotageRemaining > 0;

          const angles = extractJointAngles(landmarks);
          const targetPose = zone === 'p1' ? state.p1.currentPose : state.p2.currentPose;
          const pct = angles ? scorePoseMatchPercent(angles, targetPose) : 0;

          const zoneX = state.mode === 'solo' ? 0 : zone === 'p1' ? 0 : width * 0.5;
          const zoneW = state.mode === 'solo' ? width : width * 0.5;

          const mapped: Record<number, Point2D> = {};
          landmarks.forEach((lm: NormalizedLandmark, idx: number) => {
            const rawScreenX = (1 - lm.x) * width;
            const localX = isMirroredSabotage
              ? zoneX + zoneW - (rawScreenX - zoneX)
              : rawScreenX;
            mapped[idx] = { x: localX, y: lm.y * height };
          });

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

      // Apply puppet fallback pose if no live skeleton detected for that zone
      const buildPuppetPoints = (
        zone: PlayerId,
        kind: PoseKind | null
      ): Record<number, Point2D> | null => {
        if (!kind) return null;
        const tmpl = POSE_TEMPLATES.find((p) => p.kind === kind);
        if (!tmpl) return null;
        const zoneX = state.mode === 'solo' ? 0 : zone === 'p1' ? 0 : width * 0.5;
        const zoneW = state.mode === 'solo' ? width : width * 0.5;
        const cx = zoneX + zoneW * 0.5;
        const cy = height * 0.52;
        const scale = Math.min(zoneW * 0.38, height * 0.28);
        const out: Record<number, Point2D> = {};
        for (const [k, pt] of Object.entries(tmpl.skeletonPoints)) {
          out[Number(k)] = { x: cx + pt.x * scale, y: cy + pt.y * scale };
        }
        return out;
      };

      if (!sawP1Live) {
        const puppetKind = puppetPoseRef.current.p1;
        if (puppetKind) {
          const puppetTmpl = POSE_TEMPLATES.find((p) => p.kind === puppetKind);
          if (puppetTmpl) {
            state.p1.matchPercent = scorePoseMatchPercent(
              puppetTmpl.targetAngles,
              state.p1.currentPose
            );
            liveZonePoints.p1 = buildPuppetPoints('p1', puppetKind);
          }
        } else {
          state.p1.matchPercent = Math.max(0, Math.round(state.p1.matchPercent * 0.86));
        }
      }

      if (state.mode === '1v1' && !sawP2Live) {
        const puppetKind = puppetPoseRef.current.p2;
        if (puppetKind) {
          const puppetTmpl = POSE_TEMPLATES.find((p) => p.kind === puppetKind);
          if (puppetTmpl) {
            state.p2.matchPercent = scorePoseMatchPercent(
              puppetTmpl.targetAngles,
              state.p2.currentPose
            );
            liveZonePoints.p2 = buildPuppetPoints('p2', puppetKind);
          }
        } else {
          state.p2.matchPercent = Math.max(0, Math.round(state.p2.matchPercent * 0.86));
        }
      }

      // 2. Step simulation
      const sim = stepPoseSimulation(state, rawDt);
      if (sim.overdriveStarted) {
        audioRef.current?.playOverdriveStart();
      }
      if (sim.tickSecond !== null) {
        audioRef.current?.playCountdownTick();
      }

      // Handle audio, bursts & MVP snapshot on pose events
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
          spawnBurst(cx, cy, color, 22);
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
          spawnBurst(cx, cy, '#EF4444', 20);
        } else if (outcome.dodgedFakeout) {
          audioRef.current?.playSlice(2);
          spawnBurst(cx, cy, '#10B981', 12);
        }
      };

      handlePlayerOutcome('p1', sim.p1Outcome);
      handlePlayerOutcome('p2', sim.p2Outcome);

      if (sim.roundEnded) {
        audioRef.current?.playRoundEnd();
        const p1Label = normalizePlayerName(
          namesRef.current.p1,
          state.mode === 'solo' ? 'Solo Player' : 'Player 1'
        );
        const p2Label = normalizePlayerName(namesRef.current.p2, 'Player 2');
        const incoming =
          state.mode === 'solo'
            ? [
                {
                  game: 'pose-match-battle' as const,
                  mode: 'solo' as const,
                  name: p1Label,
                  score: state.p1.score,
                  detail: `${state.p1.posesMatched} poses`,
                },
              ]
            : [
                {
                  game: 'pose-match-battle' as const,
                  mode: '1v1' as const,
                  name: p1Label,
                  score: state.p1.score,
                  detail: `${state.p1.posesMatched} poses`,
                },
                {
                  game: 'pose-match-battle' as const,
                  mode: '1v1' as const,
                  name: p2Label,
                  score: state.p2.score,
                  detail: `${state.p2.posesMatched} poses`,
                },
              ];

        const existing = loadScoreboard('pose-match-battle');
        const { entries, addedIds } = recordMatchToScoreboard(existing, incoming);
        saveScoreboard('pose-match-battle', entries);
        setScoreboard(entries);
        setNewEntryIds(addedIds);

        setPhase('gameover');
        setEndSummary({
          winner: determinePoseWinner(state.mode, state.p1.score, state.p2.score),
          mode: state.mode,
          p1: { ...state.p1 },
          p2: { ...state.p2 },
          mvpSnapshot: mvpSnapshotRef.current,
        });
      }

      // Update particles
      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      const pool = particlesRef.current;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 320 * dt;
        p.life += dt;
        if (p.life >= p.maxLife) p.active = false;
      }

      syncHudDom(state);

      // 3. Render Canvas
      ctx.save();
      ctx.scale(dpr, dpr);

      if (state.screenShake > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * state.screenShake * 1.4,
          (Math.random() - 0.5) * state.screenShake * 1.4
        );
      }

      ctx.fillStyle = '#07090F';
      ctx.fillRect(0, 0, width, height);

      // Mirrored webcam feed
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.36;
        ctx.translate(width, 0);
        ctx.scale(-1, 1);

        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = width / height;
        let drawW = width;
        let drawH = height;
        let drawX = 0;
        let drawY = 0;
        if (canvasAspect > videoAspect) {
          drawH = width / videoAspect;
          drawY = (height - drawH) * 0.5;
        } else {
          drawW = height * videoAspect;
          drawX = (width - drawW) * 0.5;
        }
        ctx.drawImage(video, drawX, drawY, drawW, drawH);
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= width; gx += 64) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, height);
          ctx.stroke();
        }
        for (let gy = 0; gy <= height; gy += 64) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(width, gy);
          ctx.stroke();
        }
      }

      // Overdrive border glow
      if (state.overdrive && state.phase === 'playing') {
        const pulse = 0.22 + Math.sin(now * 0.015) * 0.14;
        ctx.strokeStyle = `rgba(245, 158, 11, ${pulse})`;
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, width - 8, height - 8);
      }

      if (state.mode === '1v1') {
        // Center divider
        ctx.save();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(width * 0.5, 68);
        ctx.lineTo(width * 0.5, height);
        ctx.stroke();
        ctx.restore();

        // P1 Zone (Left)
        drawTargetOutline(
          ctx,
          0,
          width * 0.5,
          height,
          state.p1,
          '#00E5FF',
          state.overdrive,
          now
        );
        if (liveZonePoints.p1) {
          drawLiveSkeleton(ctx, liveZonePoints.p1, '#00E5FF');
        }
        drawZoneOverlayHud(
          ctx,
          0,
          width * 0.5,
          height,
          'p1',
          state.p1,
          state.mode,
          state.overdrive
        );

        // P2 Zone (Right)
        drawTargetOutline(
          ctx,
          width * 0.5,
          width * 0.5,
          height,
          state.p2,
          '#FF2A6D',
          state.overdrive,
          now
        );
        if (liveZonePoints.p2) {
          drawLiveSkeleton(ctx, liveZonePoints.p2, '#FF2A6D');
        }
        drawZoneOverlayHud(
          ctx,
          width * 0.5,
          width * 0.5,
          height,
          'p2',
          state.p2,
          state.mode,
          state.overdrive
        );
      } else {
        // 1P Solo Arcade full-width arena
        drawTargetOutline(
          ctx,
          0,
          width,
          height,
          state.p1,
          '#00E5FF',
          state.overdrive,
          now
        );
        if (liveZonePoints.p1) {
          drawLiveSkeleton(ctx, liveZonePoints.p1, '#00E5FF');
        }
        drawZoneOverlayHud(
          ctx,
          0,
          width,
          height,
          'p1',
          state.p1,
          state.mode,
          state.overdrive
        );
      }

      // Render particle bursts
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [captureMvpSnapshot, predictPose, spawnBurst, syncHudDom, videoRef]);

  const statusText =
    cameraStatus === 'active'
      ? poseModelStatus === 'ready'
        ? 'Webcam + 2-Pose Tracking Active'
        : 'Webcam Active · Loading Pose Model...'
      : 'Pose Puppet Fallback Ready (No Webcam)';

  const resolvedP1Name = normalizePlayerName(
    p1Name,
    mode === 'solo' ? 'Solo Player' : 'Player 1'
  );
  const resolvedP2Name = normalizePlayerName(p2Name, 'Player 2');

  const titleOverlay = (
    <div className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0D121E] p-6 shadow-2xl">
      <div className="flex flex-col items-center text-center">
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

        <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
          Pose Match Battle
        </h1>
        <p className="mt-1.5 text-xs text-slate-300 sm:text-sm">
          Hold 80%+ joint accuracy to score. Dodge red Fake-Outs &amp; win 2x Overdrive.
        </p>

        {/* Mode Toggle: 1v1 Race vs 1-Player Solo Arcade */}
        <div
          role="group"
          aria-label="Game mode"
          className="mt-4 inline-flex rounded-lg border border-slate-700 bg-[#080C15] p-1"
        >
          <button
            type="button"
            onClick={() => handleModeChange('1v1')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
              mode === '1v1'
                ? 'bg-cyan-400 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>1v1 Split Race</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('solo')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
              mode === 'solo'
                ? 'bg-cyan-400 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <span>1P Solo Arcade</span>
          </button>
        </div>

        <PlayerNameInputs
          soloMode={mode === 'solo'}
          p1Name={p1Name}
          p2Name={p2Name}
          onChangeP1Name={handleP1NameChange}
          onChangeP2Name={handleP2NameChange}
        />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-300">
          <span className="text-cyan-300">±30° Angle</span>
          <span className="text-emerald-300">
            Hold {mode === '1v1' ? '1.5s' : '2.0s'}
          </span>
          {mode === '1v1' && <span className="text-purple-300">3x Fog/Mirror</span>}
          <span className="text-amber-300">Final 15s 2x</span>
        </div>

        <div className="mt-4 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090D16] px-3.5 py-2 text-xs text-slate-300">
          <span>{statusText}</span>
          {cameraStatus !== 'active' && (
            <button
              type="button"
              onClick={() => void requestCamera()}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 whitespace-nowrap shrink-0"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Enable Webcam</span>
            </button>
          )}
        </div>
        {errorMessage && cameraStatus !== 'active' && (
          <p className="mt-1.5 text-xs text-slate-400">{errorMessage}</p>
        )}

        <div className="mt-5 flex w-full justify-center">
          <button
            type="button"
            data-start="true"
            onClick={() => startNewRound()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-6 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:w-auto whitespace-nowrap"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            <span>Start 60s Pose Battle</span>
          </button>
        </div>
      </div>
    </div>
  );

  // Practice Pose Puppet controls when webcam isn't streaming live poses
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
    <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0D121E] p-6 text-center shadow-2xl">
      <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">
        {endSummary.winner === 'p1'
          ? `${resolvedP1Name} Wins`
          : endSummary.winner === 'p2'
          ? `${resolvedP2Name} Wins`
          : endSummary.winner === 'solo'
          ? `${resolvedP1Name} · Run Complete`
          : 'Draw Match'}
      </h2>

      {/* MVP Snapshot Card */}
      {endSummary.mvpSnapshot && (
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
      )}

      <div
        className={`mt-4 grid gap-3 text-left ${
          endSummary.mode === 'solo' ? 'grid-cols-1' : 'grid-cols-2'
        }`}
      >
        <div className="rounded-xl border border-cyan-500/35 bg-[#090E18] p-3.5">
          <div className="truncate text-xs font-bold tracking-wider text-cyan-400 uppercase">
            {resolvedP1Name}
          </div>
          <div className="mt-0.5 font-mono text-3xl font-bold text-white tabular-nums">
            {endSummary.p1.score}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300 font-mono tabular-nums">
            <span>Poses {endSummary.p1.posesMatched}</span>
            <span>Max {endSummary.p1.maxCombo}x</span>
            <span>Peak {endSummary.p1.peakAccuracy}%</span>
          </div>
        </div>

        {endSummary.mode === '1v1' && (
          <div className="rounded-xl border border-rose-500/35 bg-[#090E18] p-3.5">
            <div className="truncate text-xs font-bold tracking-wider text-rose-400 uppercase">
              {resolvedP2Name}
            </div>
            <div className="mt-0.5 font-mono text-3xl font-bold text-white tabular-nums">
              {endSummary.p2.score}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300 font-mono tabular-nums">
              <span>Poses {endSummary.p2.posesMatched}</span>
              <span>Max {endSummary.p2.maxCombo}x</span>
              <span>Peak {endSummary.p2.peakAccuracy}%</span>
            </div>
          </div>
        )}
      </div>

      <LeaderboardPanel
        entries={scoreboard}
        highlightIds={newEntryIds}
        onClear={handleClearScoreboard}
      />

      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          data-start="true"
          onClick={() => startNewRound()}
          className="flex-1 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap"
        >
          Play Again
        </button>
        <Link
          href="/"
          className="flex-1 rounded-lg border border-slate-700 bg-[#121929] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-500 whitespace-nowrap"
        >
          Back to Hub
        </Link>
      </div>
    </div>
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
