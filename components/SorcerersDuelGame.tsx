'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArcadeEndCard } from '@/components/arcade/ArcadeEndCard';
import { ArcadeGameShell } from '@/components/arcade/ArcadeGameShell';
import { ArcadeTitleCard } from '@/components/arcade/ArcadeTitleCard';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import { getPlayerSideForX, projectLandmarkToCanvas } from '@/lib/games/neon-slash/engine';
import {
  createParticlePool,
  drawArenaBackdrop,
  drawSplitDivider,
  resetParticlePool,
  spawnParticleBurst,
  updateAndDrawParticles,
} from '@/lib/games/shared/canvas';
import {
  classifySorcererGesture,
  computeSorcererTugRatio,
  createInitialSorcererState,
  determineSorcererWinner,
  getSpellMeta,
  SORCERER_ROUND_DURATION_SEC,
  stepSorcererSimulation,
} from '@/lib/games/sorcerers-duel/engine';
import type {
  MagicEffect,
  PlayerId,
  SorcererEndSummary,
  SorcererGameState,
  SorcererMode,
  SorcererPhase,
  SorcererPlayerState,
  SpellKind,
} from '@/lib/games/sorcerers-duel/types';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export default function SorcerersDuelGame() {
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

  const initialPhase: SorcererPhase =
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
  } = useArcadeSession('sorcerers-duel', initialPhase, '1v1');

  const gameStateRef = useRef<SorcererGameState>(createInitialSorcererState(initialPhase, '1v1'));
  const particlesRef = useRef(createParticlePool(240));
  const fallbackSpellRef = useRef<{ p1: SpellKind; p2: SpellKind }>({
    p1: 'none',
    p2: 'none',
  });

  const [endSummary, setEndSummary] = useState<SorcererEndSummary | null>(null);

  const syncHudDom = useCallback(
    (state: SorcererGameState) => {
      hudHandleRef.current?.updateHud({
        timeRemaining: state.timeRemaining,
        p1Score: state.p1.score,
        p1Meta: `${state.p1.hp} HP · ${getSpellMeta(state.p1.activeSpell).short}`,
        p2Score: state.p2.score,
        p2Meta: `${state.p2.hp} HP · ${getSpellMeta(state.p2.activeSpell).short}`,
        tugRatio: computeSorcererTugRatio(state.p1, state.p2),
      });
    },
    [hudHandleRef]
  );

  const clearFallbackSpells = useCallback(() => {
    fallbackSpellRef.current = { p1: 'none', p2: 'none' };
  }, []);

  const startNewRound = useCallback(
    (overrideMode?: SorcererMode) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const nextMode = overrideMode ?? mode;
      const fresh = createInitialSorcererState('playing', nextMode);
      gameStateRef.current = fresh;
      clearFallbackSpells();
      resetParticlePool(particlesRef.current);
      setEndSummary(null);
      setNewEntryIds([]);
      setPhase('playing');
      syncHudDom(fresh);
    },
    [clearFallbackSpells, mode, setNewEntryIds, setPhase, syncHudDom]
  );

  const handleModeChange = useCallback(
    (nextMode: SorcererMode) => {
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
      clearFallbackSpells();
      setPhase('paused');
    } else if (current === 'paused') {
      gameStateRef.current.phase = 'playing';
      setPhase('playing');
    }
  }, [clearFallbackSpells, setPhase]);

  const setFallbackSpell = useCallback((player: PlayerId, spell: SpellKind) => {
    fallbackSpellRef.current[player] = spell;
  }, []);

  // Keyboard spell fallback (1/2/3 or Q/W/E for P1; 7/8/9 or I/O/P for P2)
  useEffect(() => {
    const mapKey = (e: KeyboardEvent, active: boolean) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === '1' || k === 'q') fallbackSpellRef.current.p1 = active ? 'lightning' : 'none';
      else if (k === '2' || k === 'w') fallbackSpellRef.current.p1 = active ? 'shield' : 'none';
      else if (k === '3' || k === 'e') fallbackSpellRef.current.p1 = active ? 'crit' : 'none';
      else if (k === '7' || k === 'i') fallbackSpellRef.current.p2 = active ? 'lightning' : 'none';
      else if (k === '8' || k === 'o') fallbackSpellRef.current.p2 = active ? 'shield' : 'none';
      else if (k === '9' || k === 'p' && e.shiftKey) {
        fallbackSpellRef.current.p2 = active ? 'crit' : 'none';
      }
    };

    const onKeyDown = (e: KeyboardEvent) => mapKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => mapKey(e, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearFallbackSpells);
    document.addEventListener('visibilitychange', clearFallbackSpells);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearFallbackSpells);
      document.removeEventListener('visibilitychange', clearFallbackSpells);
    };
  }, [clearFallbackSpells]);

  useEffect(() => {
    let lastTime = performance.now();
    let rafId = 0;

    const drawLightningBolt = (
      ctx: CanvasRenderingContext2D,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color: string,
      alpha: number,
      seed: number
    ) => {
      const segments = 9;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const bx = x1 + (x2 - x1) * t;
        const by = y1 + (y2 - y1) * t;
        const jitter = Math.sin(seed * 41.3 + i * 17.9 + alpha * 12) * 34;
        ctx.lineTo(bx, by + jitter);
      }
      ctx.lineTo(x2, y2);

      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = 16;
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.9;
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    };

    const drawMagicEffect = (
      ctx: CanvasRenderingContext2D,
      fx: MagicEffect,
      width: number,
      height: number
    ) => {
      const progress = Math.min(1, fx.life / fx.maxLife);
      const alpha = 1 - progress;
      const p1X = width * 0.25;
      const p2X = width * 0.75;
      const centerY = height * 0.54;
      const startX = fx.from === 'p1' ? p1X : p2X;
      const endX = fx.to === 'p1' ? p1X : p2X;

      if (fx.kind === 'bolt') {
        drawLightningBolt(ctx, startX, centerY, endX, centerY, fx.color, alpha, fx.seed);
      } else if (fx.kind === 'reflect') {
        const midX = width * 0.5;
        drawLightningBolt(ctx, endX, centerY - 24, midX, centerY, '#00E5FF', alpha * 0.85, fx.seed);
        drawLightningBolt(ctx, midX, centerY, endX, centerY + 18, '#10B981', alpha, fx.seed + 1);
      } else if (fx.kind === 'meteor') {
        const curX = startX + (endX - startX) * Math.min(1, progress * 1.45);
        const arcY = centerY - Math.sin(progress * Math.PI) * 90;
        const radius = progress < 0.7 ? 24 : 24 + (progress - 0.7) * 260;

        ctx.save();
        ctx.globalAlpha = alpha * 0.32;
        ctx.fillStyle = fx.color;
        ctx.beginPath();
        ctx.arc(curX, arcY, radius * 1.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(curX, arcY, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(curX, arcY, Math.max(8, radius * 0.38), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (fx.kind === 'clash_ring') {
        const radius = 24 + progress * Math.min(width, height) * 0.36;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 6 * alpha + 2;
        ctx.beginPath();
        ctx.arc(width * 0.5, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };

    const drawSorcererAura = (
      ctx: CanvasRenderingContext2D,
      zoneX: number,
      zoneW: number,
      zoneH: number,
      pState: SorcererPlayerState,
      accent: string,
      nowMs: number
    ) => {
      const cx = pState.handCenterNorm
        ? pState.handCenterNorm.x * zoneW + zoneX
        : zoneX + zoneW * 0.5;
      const cy = pState.handCenterNorm
        ? pState.handCenterNorm.y * zoneH
        : zoneH * 0.56;
      const spellMeta = getSpellMeta(pState.activeSpell);
      const spellColor = pState.activeSpell === 'none' ? accent : spellMeta.color;

      ctx.save();

      // Hit flash wash on zone
      if (pState.hitFlashTimer > 0) {
        ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(0.35, pState.hitFlashTimer * 1.2)})`;
        ctx.fillRect(zoneX, 0, zoneW, zoneH);
      }

      // Rotating arcane sigil circle around active spell
      const baseR = Math.min(zoneW, zoneH) * 0.16;
      const rot = nowMs * 0.0022;
      ctx.translate(cx, cy);
      ctx.rotate(rot);

      ctx.strokeStyle = spellColor;
      ctx.globalAlpha = pState.activeSpell === 'none' ? 0.25 : 0.72;
      ctx.lineWidth = pState.activeSpell === 'shield' ? 4 : 2.5;
      ctx.setLineDash(pState.activeSpell === 'shield' ? [] : [10, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, baseR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (pState.activeSpell === 'shield') {
        // Hexagonal reflect barrier
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#10B981';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const px = Math.cos(a) * (baseR * 1.28);
          const py = Math.sin(a) * (baseR * 1.28);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (pState.activeSpell === 'crit') {
        // Pulsing crit charge orb
        const pulse = 0.45 + pState.chargeProgress * 0.75;
        ctx.globalAlpha = 0.35 + pState.chargeProgress * 0.45;
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(0, 0, baseR * 0.68 * pulse, 0, Math.PI * 2);
        ctx.fill();
      } else if (pState.activeSpell === 'lightning') {
        // Crackling lightning star spokes
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + rot * 2;
          ctx.moveTo(Math.cos(a) * baseR * 0.4, Math.sin(a) * baseR * 0.4);
          ctx.lineTo(Math.cos(a + 0.15) * baseR * 1.15, Math.sin(a + 0.15) * baseR * 1.15);
        }
        ctx.stroke();
      }

      ctx.restore();

      // Zone HP Bar + Spell Label + Charge Bar
      const centerX = zoneX + zoneW * 0.5;
      const barW = Math.min(250, Math.max(120, zoneW - 32));
      const barX = centerX - barW * 0.5;
      const barY = zoneW < 320 ? 128 : 98;

      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(barX, barY, barW, 11);
      ctx.strokeRect(barX, barY, barW, 11);

      const hpRatio = Math.max(0, pState.hp / pState.maxHp);
      ctx.fillStyle = hpRatio <= 0.25 ? '#EF4444' : accent;
      ctx.fillRect(barX, barY, barW * hpRatio, 11);

      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(`HP ${pState.hp} / ${pState.maxHp}`, centerX, barY - 6);

      ctx.font = zoneW < 230 ? '800 14px "Outfit", sans-serif' : '800 18px "Outfit", sans-serif';
      ctx.fillStyle = spellColor;
      ctx.fillText(spellMeta.label.toUpperCase(), centerX, barY + 34);

      if (pState.chargeProgress > 0.02) {
        const cY = barY + 46;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(barX, cY, barW, 7);
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(barX, cY, barW * pState.chargeProgress, 7);
      }

      if (pState.calloutLife > 0) {
        ctx.globalAlpha = Math.min(1, pState.calloutLife * 1.4);
        ctx.font = zoneW < 230 ? '800 18px "Outfit", sans-serif' : '800 24px "Outfit", sans-serif';
        ctx.fillStyle = pState.calloutColor;
        ctx.fillText(pState.calloutText, centerX, Math.max(barY + 80, zoneH * 0.28));
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

      const handResult = state.phase === 'playing' ? predict(now) : null;
      const handSkeletons: Array<{
        player: PlayerId;
        color: string;
        pts: Array<{ x: number; y: number }>;
      }> = [];

      let sawP1Hand = false;
      let sawP2Hand = false;

      if (handResult && handResult.landmarks.length > 0) {
        for (let hIdx = 0; hIdx < handResult.landmarks.length; hIdx++) {
          const landmarks = handResult.landmarks[hIdx];
          const wrist = landmarks[0];
          if (!wrist) continue;

          const { x, y } = projectLandmarkToCanvas(wrist, width, height, true);
          const side: PlayerId =
            state.mode === 'solo' ? 'p1' : getPlayerSideForX(x, width, '1v1');
          const spell = classifySorcererGesture(landmarks);
          const pState = side === 'p1' ? state.p1 : state.p2;

          if (side === 'p1') sawP1Hand = true;
          else sawP2Hand = true;

          pState.activeSpell = spell;
          const zoneX = side === 'p1' ? 0 : width * 0.5;
          const zoneW = width * 0.5;
          pState.handCenterNorm = {
            x: Math.max(0.1, Math.min(0.9, (x - zoneX) / Math.max(1, zoneW))),
            y: Math.max(0.2, Math.min(0.85, y / Math.max(1, height))),
          };

          const pts: Array<{ x: number; y: number }> = [];
          for (let i = 0; i < landmarks.length; i++) {
            pts[i] = projectLandmarkToCanvas(landmarks[i], width, height, true);
          }
          handSkeletons.push({
            player: side,
            color: getSpellMeta(spell).color,
            pts,
          });
        }
      }

      if (state.phase === 'playing') {
        if (!sawP1Hand) {
          state.p1.activeSpell = fallbackSpellRef.current.p1;
          state.p1.handCenterNorm = null;
        }
        if (state.mode === '1v1' && !sawP2Hand) {
          state.p2.activeSpell = fallbackSpellRef.current.p2;
          state.p2.handCenterNorm = null;
        }
      }

      const sim = stepSorcererSimulation(state, rawDt);
      if (sim.tickSecond !== null) audioRef.current?.playCountdownTick();

      if (sim.fullCritFiredBy) {
        audioRef.current?.playSpellCast('crit');
        const targetX = sim.fullCritFiredBy === 'p1' ? width * 0.75 : width * 0.25;
        spawnParticleBurst(particlesRef.current, targetX, height * 0.54, '#F59E0B', 32, 140, 380);
      }

      if (sim.clashed && sim.clashed.winner !== 'none') {
        const res = sim.clashed;
        if (res.reflectedBy) {
          audioRef.current?.playSpellReflect();
        } else if (res.winner === 'p1' || res.winner === 'p2') {
          const winSpell = res.winner === 'p1' ? state.p1.activeSpell : state.p2.activeSpell;
          audioRef.current?.playSpellCast(winSpell === 'none' ? 'lightning' : winSpell);
        } else {
          audioRef.current?.playSlice(2);
        }

        const fxX =
          res.winner === 'clash'
            ? width * 0.5
            : res.effectTo === 'p1'
            ? width * 0.25
            : width * 0.75;
        spawnParticleBurst(particlesRef.current, fxX, height * 0.54, res.effectColor, 26, 120, 340);
      }

      if (sim.roundEnded) {
        audioRef.current?.playRoundEnd();
        recordScoreboardRound(
          state.mode,
          { score: state.p1.score, detail: `${state.p1.hp} HP · ${state.p1.wins} hits` },
          { score: state.p2.score, detail: `${state.p2.hp} HP · ${state.p2.wins} hits` }
        );
        setPhase('gameover');
        setEndSummary({
          winner: determineSorcererWinner(state.p1, state.p2),
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
      drawSplitDivider(ctx, width, height, 68);

      // Center RPS Clash Pulse Ring
      if (state.phase === 'playing') {
        const clashRatio = Math.max(0, Math.min(1, 1 - state.clashCooldown / state.clashInterval));
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(width * 0.5, height * 0.54, 30, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#C084FC';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(
          width * 0.5,
          height * 0.54,
          30,
          -Math.PI * 0.5,
          -Math.PI * 0.5 + Math.PI * 2 * clashRatio
        );
        ctx.stroke();

        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#E2E8F0';
        ctx.fillText('CLASH', width * 0.5, height * 0.54 + 4);
        ctx.restore();
      }

      drawSorcererAura(ctx, 0, width * 0.5, height, state.p1, '#00E5FF', now);
      drawSorcererAura(ctx, width * 0.5, width * 0.5, height, state.p2, '#FF2A6D', now);

      // Draw hand skeletons cleanly
      for (let i = 0; i < handSkeletons.length; i++) {
        const sk = handSkeletons[i];
        ctx.save();
        ctx.strokeStyle = sk.color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
          const [aIdx, bIdx] = HAND_CONNECTIONS[c];
          const a = sk.pts[aIdx];
          const b = sk.pts[bIdx];
          if (!a || !b) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        for (let j = 0; j < sk.pts.length; j++) {
          const pt = sk.pts[j];
          ctx.moveTo(pt.x + 3, pt.y);
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.restore();
      }

      for (let i = 0; i < state.effects.length; i++) {
        drawMagicEffect(ctx, state.effects[i], width, height);
      }

      updateAndDrawParticles(ctx, particlesRef.current, dt, 260);
      ctx.restore();
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    audioRef,
    canvasRef,
    predict,
    recordScoreboardRound,
    setPhase,
    sizeRef,
    syncHudDom,
    videoRef,
  ]);

  const statusText =
    cameraStatus === 'active'
      ? modelStatus === 'ready'
        ? 'Webcam + Hand Spell Recognition Active'
        : 'Webcam Active · Loading Hand Model...'
      : 'Keyboard / Spell Button Mode Ready (1/2/3 or Q/W/E)';

  const spellRules = [
    { text: '✌️ Bolt > ✊ Fist', colorClass: 'text-cyan-300' },
    { text: '🖐️ Shield > ✌️ Bolt', colorClass: 'text-emerald-300' },
    { text: '✊ Fist > 🖐️ Shield', colorClass: 'text-amber-300' },
  ];

  const titleOverlay = (
    <ArcadeTitleCard
      icon={
        <svg viewBox="0 0 120 48" className="mb-2.5 h-10 w-24" aria-hidden="true">
          <path d="M26 10 L16 24 L26 24 L20 38" stroke="#00E5FF" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="60,8 74,18 74,32 60,42 46,32 46,18" fill="rgba(16,185,129,0.22)" stroke="#10B981" strokeWidth="2.5" />
          <circle cx="96" cy="24" r="11" fill="rgba(245,158,11,0.24)" stroke="#F59E0B" strokeWidth="2.5" />
        </svg>
      }
      title="Sorcerer's Duel"
      subtitle="Cast real-time RPS hand spells: Two-finger Lightning, Open-palm Shield, or Fist Charge."
      mode={mode}
      duelLabel="1v1 Wizard Duel"
      soloLabel="1P vs Arcane Bot"
      onModeChange={handleModeChange}
      p1Name={p1Name}
      p2Name={p2Name}
      onChangeP1Name={handleP1NameChange}
      onChangeP2Name={handleP2NameChange}
      rules={spellRules}
      cameraStatus={cameraStatus}
      cameraStatusLabel={statusText}
      errorMessage={errorMessage}
      onRequestCamera={() => void requestCamera()}
      startLabel="Begin Spell Duel (60s)"
      onStart={() => startNewRound()}
    />
  );

  const bottomControls =
    phase === 'playing' && cameraStatus !== 'active' ? (
      <div className="pointer-events-auto fixed bottom-2 left-1/2 z-20 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-slate-700/80 bg-[#0D121E]/95 px-2.5 py-1.5 text-xs shadow-lg">
        <span className="hidden font-mono text-[11px] text-slate-400 sm:inline">Cast P1:</span>
        <button
          type="button"
          onPointerDown={() => setFallbackSpell('p1', 'lightning')}
          onPointerUp={() => setFallbackSpell('p1', 'none')}
          onPointerLeave={() => setFallbackSpell('p1', 'none')}
          className="whitespace-nowrap rounded border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 active:border-cyan-300 active:bg-cyan-500/40"
        >
          ✌️ Lightning (1)
        </button>
        <button
          type="button"
          onPointerDown={() => setFallbackSpell('p1', 'shield')}
          onPointerUp={() => setFallbackSpell('p1', 'none')}
          onPointerLeave={() => setFallbackSpell('p1', 'none')}
          className="whitespace-nowrap rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25 active:border-emerald-300 active:bg-emerald-500/40"
        >
          🖐️ Shield (2)
        </button>
        <button
          type="button"
          onPointerDown={() => setFallbackSpell('p1', 'crit')}
          onPointerUp={() => setFallbackSpell('p1', 'none')}
          onPointerLeave={() => setFallbackSpell('p1', 'none')}
          className="whitespace-nowrap rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-200 transition-colors hover:bg-amber-500/25 active:border-amber-300 active:bg-amber-500/40"
        >
          ✊ Crit Fist (3)
        </button>
      </div>
    ) : null;

  const p2DisplayName = mode === 'solo' ? 'Arcane Bot' : resolvedP2Name;

  const endOverlay = endSummary ? (
    <ArcadeEndCard
      winnerTitle={
        endSummary.winner === 'p1'
          ? `${resolvedP1Name} Wins the Duel!`
          : endSummary.winner === 'p2'
          ? `${p2DisplayName} Wins!`
          : 'Arcane Stalemate'
      }
      mode={endSummary.mode}
      p1={{
        name: resolvedP1Name,
        score: endSummary.p1.score,
        metrics: [
          `HP ${endSummary.p1.hp}`,
          `Counters ${endSummary.p1.wins}`,
          `Max ${endSummary.p1.maxCombo}x`,
        ],
      }}
      p2={
        endSummary.mode === '1v1'
          ? {
              name: p2DisplayName,
              score: endSummary.p2.score,
              metrics: [
                `HP ${endSummary.p2.hp}`,
                `Counters ${endSummary.p2.wins}`,
                `Max ${endSummary.p2.maxCombo}x`,
              ],
            }
          : undefined
      }
      scoreboard={scoreboard}
      highlightIds={newEntryIds}
      onClearScoreboard={handleClearScoreboard}
      replayLabel="Rematch Duel"
      onReplay={() => startNewRound()}
    />
  ) : null;

  return (
    <ArcadeGameShell
      phase={phase}
      isMuted={isMuted}
      initialDurationSec={SORCERER_ROUND_DURATION_SEC}
      soloMode={false}
      p1Label={p1Name.trim() || undefined}
      p2Label={mode === 'solo' ? 'ARCANE BOT' : p2Name.trim() || undefined}
      canvasTestId="sorcerers-duel-canvas"
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
