'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { ArcadeAudioEngine } from '@/lib/games/neon-slash/audio';
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

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 1280, height: 720 });

  const autostart = searchParams.get('autostart') === '1';
  const initialPhase: GamePhase = autostart ? 'playing' : 'title';

  // 60FPS simulation refs (never stored in React state)
  const gameStateRef = useRef<GameState>(createInitialGameState(initialPhase));
  const particlesRef = useRef<Particle[]>(createParticlePool());
  const particleCursorRef = useRef<number>(0);
  const bladesRef = useRef<Map<string, HandBlade>>(new Map());
  const pointerBladeDownRef = useRef<boolean>(false);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const audioRef = useRef<ArcadeAudioEngine | null>(null);

  // Direct DOM refs for zero-re-render 60FPS HUD updates
  const timerTextRef = useRef<HTMLSpanElement | null>(null);
  const p1ScoreTextRef = useRef<HTMLSpanElement | null>(null);
  const p2ScoreTextRef = useRef<HTMLSpanElement | null>(null);
  const p1ComboTextRef = useRef<HTMLSpanElement | null>(null);
  const p2ComboTextRef = useRef<HTMLSpanElement | null>(null);
  const tugP1BarRef = useRef<HTMLDivElement | null>(null);
  const tugDividerRef = useRef<HTMLDivElement | null>(null);

  // Discrete React UI states
  const [phase, setPhase] = useState<GamePhase>(initialPhase);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [endSummary, setEndSummary] = useState<EndGameSummary | null>(null);

  const syncBodyDataset = useCallback((nextPhase: GamePhase) => {
    if (typeof document !== 'undefined') {
      document.body.dataset.state = nextPhase;
    }
  }, []);

  const syncHudDom = useCallback((state: GameState) => {
    if (timerTextRef.current) {
      const secs = Math.max(0, Math.ceil(state.timeRemaining));
      timerTextRef.current.textContent = String(secs).padStart(2, '0');
    }
    if (p1ScoreTextRef.current) {
      p1ScoreTextRef.current.textContent = String(Math.round(state.p1.score));
    }
    if (p2ScoreTextRef.current) {
      p2ScoreTextRef.current.textContent = String(Math.round(state.p2.score));
    }
    if (p1ComboTextRef.current) {
      p1ComboTextRef.current.textContent =
        state.p1.multiplier > 1 ? `${state.p1.multiplier}x COMBO` : '1x';
    }
    if (p2ComboTextRef.current) {
      p2ComboTextRef.current.textContent =
        state.p2.multiplier > 1 ? `${state.p2.multiplier}x COMBO` : '1x';
    }

    const ratio = computeTugOfWarRatio(state.p1.score, state.p2.score);
    const pct = (ratio * 100).toFixed(2);
    if (tugP1BarRef.current) {
      tugP1BarRef.current.style.width = `${pct}%`;
    }
    if (tugDividerRef.current) {
      tugDividerRef.current.style.left = `${pct}%`;
    }
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

      // Spawn two split halves drifting apart perpendicular to blade angle
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

      // Floating score callout
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

  const startNewRound = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const fresh = createInitialGameState('playing');
    gameStateRef.current = fresh;
    particlesRef.current.forEach((p) => {
      p.active = false;
    });
    bladesRef.current.clear();
    setEndSummary(null);
    setPhase('playing');
    syncBodyDataset('playing');
    syncHudDom(fresh);
  }, [syncBodyDataset, syncHudDom]);

  const togglePause = useCallback(() => {
    const current = gameStateRef.current.phase;
    if (current === 'playing') {
      gameStateRef.current.phase = 'paused';
      setPhase('paused');
      syncBodyDataset('paused');
    } else if (current === 'paused') {
      gameStateRef.current.phase = 'playing';
      setPhase('playing');
      syncBodyDataset('playing');
    }
  }, [syncBodyDataset]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  // Init audio engine & body dataset
  useEffect(() => {
    audioRef.current = new ArcadeAudioEngine();
    syncBodyDataset(initialPhase);

    return () => {
      if (typeof document !== 'undefined') {
        delete document.body.dataset.state;
      }
    };
  }, [initialPhase, syncBodyDataset]);

  // Keyboard shortcuts: Enter/Space to start, P/Esc to pause, M to mute, R to restart
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const currentPhase = gameStateRef.current.phase;

      if ((key === 'enter' || key === ' ') && currentPhase === 'title') {
        e.preventDefault();
        startNewRound();
        return;
      }
      if ((key === 'p' || key === 'escape') && (currentPhase === 'playing' || currentPhase === 'paused')) {
        e.preventDefault();
        togglePause();
        return;
      }
      if (key === 'm') {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (key === 'r' && currentPhase !== 'title') {
        e.preventDefault();
        startNewRound();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startNewRound, toggleMute, togglePause]);

  // ResizeObserver for crisp DPR canvas sizing
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const updateSize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(240, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      sizeRef.current = { width, height };
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Pointer/Mouse Laser Blade input fallback (allows smooth slicing without a webcam too)
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
      const side = getPlayerSideForX(x, width);
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

      // Active slice on drag OR quick mouse sweep when playing
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
        ctx.fillStyle = target.kind === 'p1_gem' ? 'rgba(0, 229, 255, 0.22)' : 'rgba(255, 42, 109, 0.22)';
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

        // Inner bright core facet
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

        // Octagon hazard frame
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

        // Stylized geometric skull inside
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#F8FAFC';
        ctx.beginPath();
        ctx.arc(0, -r * 0.1, r * 0.44, Math.PI, 0, false);
        ctx.lineTo(r * 0.32, r * 0.35);
        ctx.lineTo(-r * 0.32, r * 0.35);
        ctx.closePath();
        ctx.fill();

        // Dark eye sockets
        ctx.fillStyle = '#0D1017';
        ctx.beginPath();
        ctx.arc(-r * 0.16, -r * 0.06, r * 0.11, 0, Math.PI * 2);
        ctx.arc(r * 0.16, -r * 0.06, r * 0.11, 0, Math.PI * 2);
        ctx.fill();

        // Glowing fuse spark at top
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

        // Orbiting glitch arc
        ctx.strokeStyle = '#F3E8FF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.62, 0.2, Math.PI * 1.1);
        ctx.stroke();

        // Lightning bolt core
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

      // Violet-tinted interference wash
      ctx.fillStyle = 'rgba(168, 85, 247, 0.14)';
      ctx.fillRect(startX, 0, halfW, height);

      // Horizontal glitch tear bars
      const barCount = 14;
      for (let i = 0; i < barCount; i++) {
        const seed = Math.sin(nowMs * 0.025 + i * 19.7);
        const y = ((Math.abs(Math.sin(nowMs * 0.008 + i * 3.1)) * height) | 0);
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

      // Static scanlines
      ctx.fillStyle = 'rgba(7, 9, 15, 0.32)';
      for (let y = 0; y < height; y += 8) {
        ctx.fillRect(startX, y, halfW, 2);
      }

      // Clear text banner in sabotaged half
      ctx.fillStyle = 'rgba(168, 85, 247, 0.92)';
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

      // 1. Poll MediaPipe HandLandmarker (up to 4 hands)
      const result = predict(now);
      if (result && result.landmarks.length > 0) {
        result.landmarks.forEach((landmarks, handIdx) => {
          const tip = landmarks[INDEX_FINGERTIP_LANDMARK];
          if (!tip) return;

          const { x, y } = projectLandmarkToCanvas(tip, width, height, true);
          const player = getPlayerSideForX(x, width);
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

          // Check laser slice intersection against active targets
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

      // Prune stale trail points
      bladesRef.current.forEach((blade, key) => {
        blade.points = blade.points.filter((pt) => now - pt.time <= BLADE_TRAIL_MAX_AGE_MS);
        if (blade.points.length === 0 && now - blade.lastSeenTime > 400) {
          bladesRef.current.delete(key);
        }
      });

      // 2. Step simulation if playing
      const simOutcome = stepGameSimulation(state, rawDt, width, height);
      if (simOutcome.tickSecond !== null) {
        audioRef.current?.playCountdownTick();
      }
      if (simOutcome.roundEnded) {
        audioRef.current?.playRoundEnd();
        setPhase('gameover');
        syncBodyDataset('gameover');
        setEndSummary({
          winner: determineWinner(state.p1.score, state.p2.score),
          p1: { ...state.p1 },
          p2: { ...state.p2 },
        });
      }

      // Update pooled particles in-place
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

      // Sync top HUD DOM refs with zero React setState
      syncHudDom(state);

      // 3. Render Canvas
      ctx.save();
      ctx.scale(dpr, dpr);

      // Screen shake offset
      if (state.screenShake > 0.2) {
        const shakeX = (Math.random() - 0.5) * state.screenShake * 1.6;
        const shakeY = (Math.random() - 0.5) * state.screenShake * 1.6;
        ctx.translate(shakeX, shakeY);
      }

      // Base dark obsidian background
      ctx.fillStyle = '#07090F';
      ctx.fillRect(0, 0, width, height);

      // Draw mirrored webcam feed if active
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.translate(width, 0);
        ctx.scale(-1, 1);

        // Cover-fit video inside canvas
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
        // Subtle neon grid backdrop when camera is off/unavailable
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

      // Subtle side washes (P1 Blue Left / P2 Red Right)
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

      // Vertical center laser divider
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(width * 0.5, 68);
      ctx.lineTo(width * 0.5, height);
      ctx.stroke();
      ctx.restore();

      // Side zone labels centered cleanly in each half
      ctx.save();
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.52)';
      ctx.fillText('P1 ZONE · CYAN', width * 0.25, height - 18);
      ctx.fillStyle = 'rgba(255, 42, 109, 0.52)';
      ctx.fillText('P2 ZONE · CRIMSON', width * 0.75, height - 18);
      ctx.restore();

      // Sliced halves
      for (const h of state.slicedHalves) {
        ctx.save();
        ctx.globalAlpha = h.alpha;
        ctx.translate(h.x, h.y);
        ctx.rotate(h.rotation);
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.arc(0, 0, h.radius * 0.72, h.side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, h.side < 0 ? Math.PI * 1.5 : Math.PI * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Active targets
      for (const target of state.targets) {
        drawTarget(ctx, target);
      }

      // Pooled particles
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

      // Glowing laser blade trails (up to 4 hands + pointer)
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

            // White hot core
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

        // Fingertip reticle ring at latest point
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

      // Floating score callouts
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

      // 3-second Sabotage Glitch overlays on affected halves
      if (state.phase === 'playing') {
        drawSabotageGlitch(ctx, 'p1', state.p1.sabotageRemaining, width, height, now);
        drawSabotageGlitch(ctx, 'p2', state.p2.sabotageRemaining, width, height, now);
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [predict, sliceTargetWithSegment, syncBodyDataset, syncHudDom, videoRef]);

  const cameraReadyLabel =
    cameraStatus === 'active'
      ? modelStatus === 'ready'
        ? 'Webcam + 4-Hand Tracking Active'
        : 'Webcam Active · Loading Hand Model...'
      : cameraStatus === 'requesting'
      ? 'Requesting Camera Access...'
      : 'Pointer Blade Mode Active (No Webcam)';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#07090F] text-slate-100 select-none">
      {/* Isolated Canvas Stage */}
      <div ref={stageRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          data-testid="neon-slash-canvas"
          className="block h-full w-full cursor-crosshair touch-none"
        />
      </div>

      {/* Top HUD Overlay (pointer-events-none wrapper, pointer-events-auto controls) */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2 px-4 pt-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back to Hub + P1 Score */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-slate-700/70 bg-[#0D121D]/90 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-white whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Hub</span>
            </Link>

            <div className="flex items-baseline gap-2.5 rounded-lg border border-cyan-500/30 bg-[#0D121D]/90 px-3.5 py-1.5">
              <span className="text-[11px] font-bold tracking-wider text-cyan-400 uppercase">
                P1
              </span>
              <span
                ref={p1ScoreTextRef}
                data-testid="p1-score"
                className="font-mono text-2xl font-bold text-white tabular-nums"
              >
                0
              </span>
              <span
                ref={p1ComboTextRef}
                className="font-mono text-xs font-semibold text-cyan-300 tabular-nums"
              >
                1x
              </span>
            </div>
          </div>

          {/* Center: 60s Timer */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-[#0D121D]/95 px-4 py-1.5 shadow-lg">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                Time
              </span>
              <span
                ref={timerTextRef}
                data-testid="match-timer"
                className="font-mono text-2xl font-bold text-white tabular-nums"
              >
                {ROUND_DURATION_SEC}
              </span>
            </div>
          </div>

          {/* Right: P2 Score + Utility Buttons */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-baseline gap-2.5 rounded-lg border border-rose-500/30 bg-[#0D121D]/90 px-3.5 py-1.5">
              <span
                ref={p2ComboTextRef}
                className="font-mono text-xs font-semibold text-rose-300 tabular-nums"
              >
                1x
              </span>
              <span
                ref={p2ScoreTextRef}
                data-testid="p2-score"
                className="font-mono text-2xl font-bold text-white tabular-nums"
              >
                0
              </span>
              <span className="text-[11px] font-bold tracking-wider text-rose-400 uppercase">
                P2
              </span>
            </div>

            <div className="pointer-events-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  toggleMute();
                }}
                aria-label={isMuted ? 'Unmute audio (M)' : 'Mute audio (M)'}
                title="Mute / Unmute (M)"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D121D]/90 text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {phase !== 'title' && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      togglePause();
                    }}
                    aria-label={phase === 'paused' ? 'Resume game (P)' : 'Pause game (P)'}
                    title="Pause / Resume (P)"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D121D]/90 text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    {phase === 'paused' ? (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Pause className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      startNewRound();
                    }}
                    aria-label="Restart round (R)"
                    title="Restart (R)"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D121D]/90 text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tug-of-War Score Bar */}
        <div
          aria-label="Tug-of-war score bar"
          className="relative mx-auto h-2.5 w-full max-w-2xl overflow-hidden rounded-full border border-slate-700/80 bg-rose-600/85"
        >
          <div
            ref={tugP1BarRef}
            style={{ width: '50%' }}
            className="h-full bg-cyan-400 transition-[width] duration-75"
          />
          <div
            ref={tugDividerRef}
            style={{ left: '50%' }}
            className="absolute top-0 h-full w-1 -translate-x-1/2 bg-white shadow-[0_0_8px_#fff]"
          />
        </div>
      </header>

      {/* Title Screen Overlay */}
      {phase === 'title' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090F]/80 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700/80 bg-[#0D121E] p-7 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              {/* Custom SVG Title Emblem */}
              <svg
                viewBox="0 0 120 44"
                className="mb-3 h-11 w-28"
                aria-hidden="true"
              >
                <path
                  d="M14 34 L52 10"
                  stroke="#00E5FF"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M106 34 L68 10"
                  stroke="#FF2A6D"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <polygon
                  points="60,4 72,22 60,40 48,22"
                  fill="rgba(168,85,247,0.28)"
                  stroke="#C084FC"
                  strokeWidth="2.5"
                />
              </svg>

              <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Neon Slash Duel
              </h1>
              <p className="mt-2 max-w-md text-sm text-slate-300">
                Two-player webcam laser battle. Left half is Blue (P1), right half is Crimson (P2). Slice your own gems fast to build 5x combos.
              </p>

              {/* Target Legend */}
              <div className="mt-6 grid w-full grid-cols-2 gap-3 text-left text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-cyan-500/30 bg-[#0A0F1A] p-3">
                  <div className="font-semibold text-cyan-300">Own Gem</div>
                  <div className="mt-0.5 font-mono text-slate-300">+10 × Combo</div>
                </div>
                <div className="rounded-lg border border-rose-500/30 bg-[#0A0F1A] p-3">
                  <div className="font-semibold text-rose-300">Enemy Gem</div>
                  <div className="mt-0.5 font-mono text-slate-300">-10 Penalty</div>
                </div>
                <div className="rounded-lg border border-amber-500/35 bg-[#0A0F1A] p-3">
                  <div className="font-semibold text-amber-300">Skull Bomb</div>
                  <div className="mt-0.5 font-mono text-slate-300">-25 &amp; Reset</div>
                </div>
                <div className="rounded-lg border border-purple-500/40 bg-[#0A0F1A] p-3">
                  <div className="font-semibold text-purple-300">Sabotage Orb</div>
                  <div className="mt-0.5 font-mono text-slate-300">Glitch 3.0s</div>
                </div>
              </div>

              {/* Camera & Tracking Status */}
              <div className="mt-5 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090D16] px-4 py-2.5 text-xs text-slate-300">
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
                <p className="mt-2 text-xs text-slate-400">{errorMessage}</p>
              )}

              {/* Primary Start CTA */}
              <div className="mt-6 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  data-start="true"
                  onClick={startNewRound}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-7 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>Start 60s Duel</span>
                </button>
              </div>

              <p className="mt-5 text-xs text-slate-400">
                Index Fingers (Webcam) or Drag Pointer · Enter Start · P Pause · M Mute
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {phase === 'paused' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090F]/80 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#0D121E] p-6 text-center shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white">Match Paused</h2>
            <p className="mt-1.5 text-sm text-slate-400">
              Take a breather or reset the 60-second clock.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={togglePause}
                className="w-full rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300"
              >
                Resume Match
              </button>
              <button
                type="button"
                onClick={startNewRound}
                className="w-full rounded-lg border border-slate-700 bg-[#121929] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-500"
              >
                Restart Match
              </button>
              <Link
                href="/"
                className="w-full rounded-lg border border-slate-800 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:text-white"
              >
                Back to Hub
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* End Game Overlay */}
      {phase === 'gameover' && endSummary && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090F]/85 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0D121E] p-7 text-center shadow-2xl">
            <h2 className="font-display text-3xl font-extrabold text-white">
              {endSummary.winner === 'p1'
                ? 'Player 1 Wins'
                : endSummary.winner === 'p2'
                ? 'Player 2 Wins'
                : 'Draw Match'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">60-second duel complete</p>

            <div className="mt-6 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl border border-cyan-500/35 bg-[#090E18] p-4">
                <div className="text-xs font-bold tracking-wider text-cyan-400 uppercase">
                  P1 · Cyan
                </div>
                <div className="mt-1 font-mono text-3xl font-bold text-white tabular-nums">
                  {endSummary.p1.score}
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-300 font-mono tabular-nums">
                  <div>Slices: {endSummary.p1.ownSlices}</div>
                  <div>Max Combo: {endSummary.p1.maxCombo}</div>
                  <div>Sabotages: {endSummary.p1.sabotagesSent}</div>
                </div>
              </div>

              <div className="rounded-xl border border-rose-500/35 bg-[#090E18] p-4">
                <div className="text-xs font-bold tracking-wider text-rose-400 uppercase">
                  P2 · Crimson
                </div>
                <div className="mt-1 font-mono text-3xl font-bold text-white tabular-nums">
                  {endSummary.p2.score}
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-300 font-mono tabular-nums">
                  <div>Slices: {endSummary.p2.ownSlices}</div>
                  <div>Max Combo: {endSummary.p2.maxCombo}</div>
                  <div>Sabotages: {endSummary.p2.sabotagesSent}</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                data-start="true"
                onClick={startNewRound}
                className="flex-1 rounded-lg bg-cyan-400 px-5 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap"
              >
                Replay Duel
              </button>
              <Link
                href="/"
                className="flex-1 rounded-lg border border-slate-700 bg-[#121929] px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-slate-500 whitespace-nowrap"
              >
                Back to Hub
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
