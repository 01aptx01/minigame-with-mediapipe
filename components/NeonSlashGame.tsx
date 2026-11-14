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
  Particle,
  PlayerId,
  SlashGameMode,
  Target,
} from '@/lib/games/neon-slash/types';

const PARTICLE_POOL_SIZE = 220;
const BLADE_TRAIL_MAX_AGE_MS = 220;
const BLADE_TRAIL_MAX_POINTS = 14;

function createParticlePool(): Particle[] {
  return Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 3,
    color: '#00E5FF',
    alpha: 0,
    life: 0,
    maxLife: 0.4,
  }));
}

export default function NeonSlashGame() {
  const searchParams = useSearchParams();
  const {
    videoRef,
    cameraStatus,
    modelStatus,
    errorMessage,
    requestCamera,
    predict,
  } = useMediaPipe();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 1280, height: 720 });

  const autostart = searchParams.get('autostart') === '1';
  const initialPhase: GamePhase = autostart ? 'playing' : 'title';

  // 60FPS simulation refs
  const gameStateRef = useRef<GameState>(createInitialGameState(initialPhase, '1v1'));
  const particlesRef = useRef<Particle[]>(createParticlePool());
  const particleCursorRef = useRef<number>(0);
  const bladesRef = useRef<Map<string, HandBlade>>(new Map());
  const pointerBladeDownRef = useRef<boolean>(false);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const audioRef = useRef<ArcadeAudioEngine | null>(null);
  const namesRef = useRef<{ p1: string; p2: string }>({ p1: '', p2: '' });

  const hudHandleRef = useRef<ArcadeHudHandle | null>(null);

  // Discrete React UI states
  const [phase, setPhase] = useState<GamePhase>(initialPhase);
  const [mode, setMode] = useState<SlashGameMode>('1v1');
  const [p1Name, setP1Name] = useState<string>('');
  const [p2Name, setP2Name] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [endSummary, setEndSummary] = useState<EndGameSummary | null>(null);
  const [scoreboard, setScoreboard] = useState<ScoreboardEntry[]>([]);
  const [newEntryIds, setNewEntryIds] = useState<string[]>([]);

  const syncHudDom = useCallback((state: GameState) => {
    hudHandleRef.current?.updateHud({
      timeRemaining: state.timeRemaining,
      p1Score: state.p1.score,
      p1Meta: state.p1.multiplier > 1 ? `${state.p1.multiplier}x COMBO` : '1x',
      p2Score: state.p2.score,
      p2Meta: state.p2.multiplier > 1 ? `${state.p2.multiplier}x COMBO` : '1x',
      tugRatio: computeTugOfWarRatio(state.p1.score, state.p2.score),
    });
  }, []);

  const spawnParticleBurst = useCallback(
    (x: number, y: number, color: string, count: number) => {
      const pool = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const idx = particleCursorRef.current;
        particleCursorRef.current = (idx + 1) % PARTICLE_POOL_SIZE;
        const p = pool[idx];
        const angle = Math.random() * Math.PI * 2;
        const speed = 120 + Math.random() * 340;
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed - 60;
        p.size = 2.5 + Math.random() * 4.5;
        p.color = color;
        p.life = 0;
        p.maxLife = 0.28 + Math.random() * 0.25;
        p.alpha = 1;
      }
    },
    []
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
      spawnParticleBurst(target.x, target.y, burstColor, outcome.wasPenalty ? 22 : 16);

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
    [spawnParticleBurst]
  );

  const startNewRound = useCallback(
    (overrideMode?: SlashGameMode) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const nextMode = overrideMode ?? mode;
      const fresh = createInitialGameState('playing', nextMode);
      gameStateRef.current = fresh;
      particlesRef.current.forEach((p) => {
        p.active = false;
      });
      bladesRef.current.clear();
      setEndSummary(null);
      setNewEntryIds([]);
      setPhase('playing');
      syncHudDom(fresh);
    },
    [mode, syncHudDom]
  );

  const handleModeChange = useCallback((nextMode: SlashGameMode) => {
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
    clearScoreboard('neon-slash-duel');
    setScoreboard([]);
    setNewEntryIds([]);
  }, []);

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

  useEffect(() => {
    audioRef.current = new ArcadeAudioEngine();
  }, []);

  // Pointer/Mouse Laser Blade input fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toCanvasCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
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
  }, [sliceTargetWithSegment]);

  // Main 60FPS requestAnimationFrame loop
  useEffect(() => {
    let lastTime = performance.now();
    let rafId = 0;

    const drawTarget = (ctx: CanvasRenderingContext2D, target: Target) => {
      const color = getTargetColor(target.kind);
      ctx.save();
      ctx.translate(target.x, target.y);
      ctx.rotate(target.rotation);

      if (target.kind === 'p1_gem' || target.kind === 'p2_gem') {
        const r = target.radius;
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.fillStyle =
          target.kind === 'p1_gem'
            ? 'rgba(0, 229, 255, 0.22)'
            : 'rgba(255, 42, 109, 0.22)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.78, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.78, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
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
        ctx.shadowColor = '#EF4444';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#0D1017';
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 3;

        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
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
        ctx.shadowColor = '#A855F7';
        ctx.shadowBlur = 22;

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

      const barCount = 14;
      for (let i = 0; i < barCount; i++) {
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

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { width, height } = sizeRef.current;
      const dpr = canvas.width / Math.max(1, width);
      const state = gameStateRef.current;

      const result = predict(now);
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

      bladesRef.current.forEach((blade, key) => {
        blade.points = blade.points.filter((pt) => now - pt.time <= BLADE_TRAIL_MAX_AGE_MS);
        if (blade.points.length === 0 && now - blade.lastSeenTime > 400) {
          bladesRef.current.delete(key);
        }
      });

      const simOutcome = stepGameSimulation(state, rawDt, width, height);
      if (simOutcome.tickSecond !== null) {
        audioRef.current?.playCountdownTick();
      }
      if (simOutcome.roundEnded) {
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
                  game: 'neon-slash-duel' as const,
                  mode: 'solo' as const,
                  name: p1Label,
                  score: state.p1.score,
                  detail: `${state.p1.maxCombo}x max`,
                },
              ]
            : [
                {
                  game: 'neon-slash-duel' as const,
                  mode: '1v1' as const,
                  name: p1Label,
                  score: state.p1.score,
                  detail: `${state.p1.maxCombo}x max`,
                },
                {
                  game: 'neon-slash-duel' as const,
                  mode: '1v1' as const,
                  name: p2Label,
                  score: state.p2.score,
                  detail: `${state.p2.maxCombo}x max`,
                },
              ];

        const existing = loadScoreboard('neon-slash-duel');
        const { entries, addedIds } = recordMatchToScoreboard(existing, incoming);
        saveScoreboard('neon-slash-duel', entries);
        setScoreboard(entries);
        setNewEntryIds(addedIds);

        setPhase('gameover');
        setEndSummary({
          winner: determineWinner(state.p1.score, state.p2.score, state.mode),
          mode: state.mode,
          p1: { ...state.p1 },
          p2: { ...state.p2 },
        });
      }

      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      const pool = particlesRef.current;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 420 * dt;
        p.life += dt;
        p.alpha = Math.max(0, 1 - p.life / p.maxLife);
        if (p.life >= p.maxLife) {
          p.active = false;
        }
      }

      syncHudDom(state);

      ctx.save();
      ctx.scale(dpr, dpr);

      if (state.screenShake > 0.2) {
        const shakeX = (Math.random() - 0.5) * state.screenShake * 1.6;
        const shakeY = (Math.random() - 0.5) * state.screenShake * 1.6;
        ctx.translate(shakeX, shakeY);
      }

      ctx.fillStyle = '#07090F';
      ctx.fillRect(0, 0, width, height);

      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.34;
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
        const gridStep = 64;
        for (let gx = 0; gx <= width; gx += gridStep) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, height);
          ctx.stroke();
        }
        for (let gy = 0; gy <= height; gy += gridStep) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(width, gy);
          ctx.stroke();
        }
      }

      if (state.mode === '1v1') {
        const p1Wash = ctx.createLinearGradient(0, 0, width * 0.5, 0);
        p1Wash.addColorStop(0, 'rgba(0, 229, 255, 0.08)');
        p1Wash.addColorStop(1, 'rgba(0, 229, 255, 0.0)');
        ctx.fillStyle = p1Wash;
        ctx.fillRect(0, 0, width * 0.5, height);

        const p2Wash = ctx.createLinearGradient(width * 0.5, 0, width, 0);
        p2Wash.addColorStop(0, 'rgba(255, 42, 109, 0.0)');
        p2Wash.addColorStop(1, 'rgba(255, 42, 109, 0.08)');
        ctx.fillStyle = p2Wash;
        ctx.fillRect(width * 0.5, 0, width * 0.5, height);

        ctx.save();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(width * 0.5, 68);
        ctx.lineTo(width * 0.5, height);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.font = '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.52)';
        ctx.fillText('P1 ZONE · CYAN', width * 0.25, height - 18);
        ctx.fillStyle = 'rgba(255, 42, 109, 0.52)';
        ctx.fillText('P2 ZONE · CRIMSON', width * 0.75, height - 18);
        ctx.restore();
      } else {
        ctx.save();
        ctx.font = '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.52)';
        ctx.fillText('SOLO ARENA · SLICE CYAN GEMS · DODGE BOMBS', width * 0.5, height - 18);
        ctx.restore();
      }

      for (const h of state.slicedHalves) {
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

      for (const target of state.targets) {
        drawTarget(ctx, target);
      }

      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.active) continue;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      bladesRef.current.forEach((blade) => {
        const pts = blade.points;
        if (pts.length === 0) return;

        const bladeColor = blade.player === 'p1' ? '#00E5FF' : '#FF2A6D';

        if (pts.length >= 2) {
          for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i - 1];
            const p1 = pts[i];
            const t = i / (pts.length - 1);

            ctx.save();
            ctx.lineCap = 'round';
            ctx.strokeStyle = bladeColor;
            ctx.shadowColor = bladeColor;
            ctx.shadowBlur = 18;
            ctx.globalAlpha = t * 0.85;
            ctx.lineWidth = 4 + t * 10;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#FFFFFF';
            ctx.globalAlpha = t;
            ctx.lineWidth = 1.5 + t * 3.5;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
            ctx.restore();
          }
        }

        const tip = pts[pts.length - 1];
        ctx.save();
        ctx.strokeStyle = bladeColor;
        ctx.shadowColor = bladeColor;
        ctx.shadowBlur = 14;
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

      if (state.phase === 'playing') {
        drawSabotageGlitch(ctx, 'p1', state.p1.sabotageRemaining, width, height, now);
        drawSabotageGlitch(ctx, 'p2', state.p2.sabotageRemaining, width, height, now);
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [predict, sliceTargetWithSegment, syncHudDom, videoRef]);

  const cameraReadyLabel =
    cameraStatus === 'active'
      ? modelStatus === 'ready'
        ? 'Webcam + 4-Hand Tracking Active'
        : 'Webcam Active · Loading Hand Model...'
      : cameraStatus === 'requesting'
      ? 'Requesting Camera Access...'
      : 'Pointer Blade Mode Active (No Webcam)';

  const resolvedP1Name = normalizePlayerName(
    p1Name,
    mode === 'solo' ? 'Solo Player' : 'Player 1'
  );
  const resolvedP2Name = normalizePlayerName(p2Name, 'Player 2');

  const titleOverlay = (
    <div className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0D121E] p-6 shadow-2xl">
      <div className="flex flex-col items-center text-center">
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

        <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
          Neon Slash Duel
        </h1>
        <p className="mt-1.5 text-xs text-slate-300 sm:text-sm">
          {mode === 'solo'
            ? 'Slice Cyan gems across the full arena and dodge Skull Bombs.'
            : 'Left half is Cyan (P1), right half is Crimson (P2).'}
        </p>

        {/* Mode Toggle: 1v1 vs 1P Solo */}
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
            <span>1v1 Split Duel</span>
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
            <span>1P Solo</span>
          </button>
        </div>

        {/* Optional Player Name Inputs */}
        <PlayerNameInputs
          soloMode={mode === 'solo'}
          p1Name={p1Name}
          p2Name={p2Name}
          onChangeP1Name={handleP1NameChange}
          onChangeP2Name={handleP2NameChange}
        />

        {/* Compact Single-Line Scoring Key */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-300">
          <span className="text-cyan-300">Gem +10×Combo</span>
          {mode === '1v1' && <span className="text-rose-300">Enemy -10</span>}
          <span className="text-amber-300">Bomb -25</span>
          {mode === '1v1' && <span className="text-purple-300">Orb 3s Glitch</span>}
        </div>

        <div className="mt-4 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090D16] px-3.5 py-2 text-xs text-slate-300">
          <span>{cameraReadyLabel}</span>
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
            <span>{mode === 'solo' ? 'Start 60s Solo Run' : 'Start 60s Duel'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  const endOverlay = endSummary ? (
    <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0D121E] p-6 text-center shadow-2xl">
      <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">
        {endSummary.winner === 'p1'
          ? `${resolvedP1Name} Wins`
          : endSummary.winner === 'p2'
          ? `${resolvedP2Name} Wins`
          : endSummary.winner === 'solo'
          ? `${resolvedP1Name} · Run Complete`
          : 'Draw Match'}
      </h2>

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
            <span>Slices {endSummary.p1.ownSlices}</span>
            <span>Max {endSummary.p1.maxCombo}x</span>
            {endSummary.mode === '1v1' && <span>Glitch {endSummary.p1.sabotagesSent}</span>}
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
              <span>Slices {endSummary.p2.ownSlices}</span>
              <span>Max {endSummary.p2.maxCombo}x</span>
              <span>Glitch {endSummary.p2.sabotagesSent}</span>
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
          {endSummary.mode === 'solo' ? 'Play Again' : 'Replay Duel'}
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
      titleOverlay={titleOverlay}
      endOverlay={endOverlay}
    />
  );
}
