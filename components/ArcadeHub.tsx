'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Camera,
  Hand,
  Keyboard,
  Play,
  Smile,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import {
  getPlayerSideForX,
  INDEX_FINGERTIP_LANDMARK,
  projectLandmarkToCanvas,
} from '@/lib/games/neon-slash/engine';
import { drawArenaBackdrop, drawSplitDivider } from '@/lib/games/shared/canvas';

export default function ArcadeHub() {
  const {
    videoRef,
    cameraStatus,
    modelStatus,
    errorMessage,
    requestCamera,
    initializeModel,
    predict,
  } = useMediaPipe();

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewSizeRef = useRef<{ width: number; height: number }>({ width: 560, height: 240 });
  const pointerPosRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  useEffect(() => {
    void initializeModel();
  }, [initializeModel]);

  // Live 60FPS calibration preview canvas in Hero right column
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(300, Math.floor(rect.width));
      const height = Math.max(200, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      previewSizeRef.current = { width, height };
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);

    let rafId = 0;

    const renderPreview = (now: number) => {
      rafId = requestAnimationFrame(renderPreview);
      if (document.hidden) return;

      const { width, height } = previewSizeRef.current;
      const dpr = canvas.width / Math.max(1, width);

      ctx.save();
      ctx.scale(dpr, dpr);

      const hasVideo = drawArenaBackdrop(ctx, videoRef.current, width, height, {
        background: '#090D16',
        videoAlpha: 0.52,
        gridStep: 48,
        gridStroke: 'rgba(148, 163, 184, 0.08)',
      });

      if (!hasVideo) {
        // Ambient floating calibration targets
        const t = now * 0.0014;
        const p1x = width * 0.25 + Math.cos(t) * 28;
        const p1y = height * 0.5 + Math.sin(t * 1.4) * 22;
        ctx.strokeStyle = '#00E5FF';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p1x, p1y - 18);
        ctx.lineTo(p1x + 15, p1y);
        ctx.lineTo(p1x, p1y + 18);
        ctx.lineTo(p1x - 15, p1y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const p2x = width * 0.75 + Math.sin(t * 1.1) * 28;
        const p2y = height * 0.5 + Math.cos(t * 1.3) * 22;
        ctx.strokeStyle = '#FF2A6D';
        ctx.fillStyle = 'rgba(255, 42, 109, 0.16)';
        ctx.beginPath();
        ctx.moveTo(p2x, p2y - 18);
        ctx.lineTo(p2x + 15, p2y);
        ctx.lineTo(p2x, p2y + 18);
        ctx.lineTo(p2x - 15, p2y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      drawSplitDivider(ctx, width, height, 0);

      // Zone labels
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
      ctx.textAlign = 'left';
      ctx.fillText('P1 · CYAN HALF', 14, 24);

      ctx.fillStyle = 'rgba(255, 42, 109, 0.85)';
      ctx.textAlign = 'right';
      ctx.fillText('P2 · CRIMSON HALF', width - 14, 24);

      // Draw live MediaPipe fingertips if active
      const result = predict(now);
      if (result && result.landmarks.length > 0) {
        for (let i = 0; i < result.landmarks.length; i++) {
          const tip = result.landmarks[i][INDEX_FINGERTIP_LANDMARK];
          if (!tip) continue;
          const { x, y } = projectLandmarkToCanvas(tip, width, height, true);
          const side = getPlayerSideForX(x, width);
          const color = side === 'p1' ? '#00E5FF' : '#FF2A6D';

          ctx.strokeStyle = side === 'p1' ? 'rgba(0, 229, 255, 0.28)' : 'rgba(255, 42, 109, 0.28)';
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.arc(x, y, 13, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (pointerPosRef.current.active) {
        const { x, y } = pointerPosRef.current;
        const side = getPlayerSideForX(x, width);
        ctx.strokeStyle = side === 'p1' ? '#00E5FF' : '#FF2A6D';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderPreview);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [predict, videoRef]);

  const handlePreviewMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerPosRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    };
  };

  const handlePreviewLeave = () => {
    pointerPosRef.current.active = false;
  };

  const statusText =
    cameraStatus === 'active'
      ? modelStatus === 'ready'
        ? 'Camera Active · 4-Hand Tracking Ready'
        : modelStatus === 'loading'
        ? 'Camera Active · Loading Hand Model...'
        : 'Camera Active'
      : cameraStatus === 'requesting'
      ? 'Requesting Camera Permission...'
      : cameraStatus === 'denied'
      ? 'Camera Blocked · Pointer Mode Ready'
      : 'Pointer Mode Ready · Connect Webcam Anytime';

  return (
    <div className="min-h-screen bg-[#07090F] text-slate-100">
      {/* Minimal Top Bar */}
      <header className="border-b border-slate-800/80 bg-[#07090F]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3.5">
          <Link
            href="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Webcam Party Arcade
          </Link>

          <button
            type="button"
            onClick={() => void requestCamera()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0E131E] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-white whitespace-nowrap shrink-0"
          >
            <Camera className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            <span>{cameraStatus === 'active' ? 'Camera Ready' : 'Enable Webcam'}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-5">
        {/* Hero + Live Shared MediaPipe Preview */}
        <section
          id="calibration"
          className="grid items-center gap-6 lg:grid-cols-12"
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col justify-center lg:col-span-6"
          >
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[42px] lg:leading-[1.1] text-balance">
              One webcam. Solo runs or 1v1 party duels.
            </h1>
            <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-slate-300">
              Pick a game below to play 1P Solo or battle a friend side-by-side—no webcam required to test with mouse or fallback controls.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="font-medium text-slate-200">{statusText}</span>
              {errorMessage && cameraStatus !== 'active' && (
                <span className="text-slate-400">· {errorMessage}</span>
              )}
            </div>
          </motion.div>

          {/* Right Column: Live Shared Hand-Tracking Preview */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0E131E] lg:col-span-6"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-300">
              <span className="font-semibold text-white">Live Camera Calibration</span>
              <span className="font-mono text-slate-400">
                {cameraStatus === 'active' ? 'Webcam Feed' : 'Interactive Grid'}
              </span>
            </div>
            <div className="relative h-[200px]">
              <canvas
                ref={previewCanvasRef}
                onPointerMove={handlePreviewMove}
                onPointerLeave={handlePreviewLeave}
                data-testid="hub-preview-canvas"
                className="block h-full w-full cursor-crosshair"
              />
            </div>
          </motion.div>
        </section>

        {/* Game Cards Grid */}
        <section id="games" className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-xl font-bold text-white whitespace-nowrap sm:text-2xl">
              Arcade Lineup
            </h2>
            <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
              6 Playable · Ready to Party
            </span>
          </div>

          <div className="mt-4 grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {/* Playable Card 1: Neon Slash Duel */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-cyan-500/40 bg-[#0E131E] transition-colors hover:border-cyan-400">
              <div>
                <div className="relative h-28 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg viewBox="0 0 360 180" className="h-full w-full" aria-hidden="true">
                    <line x1="180" y1="0" x2="180" y2="180" stroke="rgba(148,163,184,0.22)" strokeDasharray="6 6" />
                    <path d="M36 140 L144 48" stroke="#00E5FF" strokeWidth="5" strokeLinecap="round" />
                    <path d="M324 140 L216 48" stroke="#FF2A6D" strokeWidth="5" strokeLinecap="round" />
                    <polygon points="90,46 114,70 90,94 66,70" fill="rgba(0,229,255,0.22)" stroke="#00E5FF" strokeWidth="2.5" />
                    <polygon points="270,46 294,70 270,94 246,70" fill="rgba(255,42,109,0.22)" stroke="#FF2A6D" strokeWidth="2.5" />
                    <circle cx="180" cy="90" r="20" fill="rgba(168,85,247,0.28)" stroke="#C084FC" strokeWidth="2.5" />
                  </svg>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
                    <span className="font-semibold text-cyan-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2P</span>
                    <span aria-hidden="true">·</span>
                    <span>60s Duel</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-white">
                    Neon Slash Duel
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Slice gems with fingertip laser blades, dodge Skull Bombs, and trigger 3s glitches.
                  </p>
                </div>
              </div>

              <div className="px-4 pb-4">
                <Link
                  href="/?game=neon-slash-duel"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-cyan-300"
                >
                  <Swords className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Play Neon Slash Duel</span>
                </Link>
              </div>
            </article>

            {/* Playable Card 2: Pose Match Battle */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-rose-500/40 bg-[#0E131E] transition-colors hover:border-rose-400">
              <div>
                <div className="relative h-28 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg viewBox="0 0 360 180" className="h-full w-full" aria-hidden="true">
                    <line x1="180" y1="0" x2="180" y2="180" stroke="rgba(148,163,184,0.22)" strokeDasharray="6 6" />
                    <circle cx="100" cy="54" r="12" stroke="#00E5FF" strokeWidth="2.5" fill="none" />
                    <path d="M68 72 L100 84 L132 72 M100 84 L100 118 M100 118 L80 144 M100 118 L120 144" stroke="#00E5FF" strokeWidth="3" strokeLinecap="round" fill="none" />
                    <circle cx="260" cy="54" r="12" stroke="#FF2A6D" strokeWidth="2.5" fill="none" />
                    <path d="M232 56 L260 84 L288 56 M260 84 L260 118 M260 118 L242 144 M260 118 L278 144" stroke="#FF2A6D" strokeWidth="3" strokeLinecap="round" fill="none" />
                  </svg>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
                    <span className="font-semibold text-rose-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2P</span>
                    <span aria-hidden="true">·</span>
                    <span>2x Overdrive</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-white">
                    Pose Match Battle
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Match neon silhouette poses using 8-joint angle scoring and dodge red Fake-Outs.
                  </p>
                </div>
              </div>

              <div className="px-4 pb-4">
                <Link
                  href="/?game=pose-match-battle"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-400"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>Play Pose Match Battle</span>
                </Link>
              </div>
            </article>

            {/* Playable Card 3: Rhythm Dodge */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-amber-500/40 bg-[#0E131E] transition-colors hover:border-amber-400">
              <div>
                <div className="relative h-28 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg viewBox="0 0 360 180" className="h-full w-full" aria-hidden="true">
                    <line x1="180" y1="30" x2="36" y2="170" stroke="rgba(148,163,184,0.22)" strokeWidth="2" />
                    <line x1="180" y1="30" x2="324" y2="170" stroke="rgba(148,163,184,0.22)" strokeWidth="2" />
                    <line x1="78" y1="74" x2="282" y2="74" stroke="#F59E0B" strokeWidth="5" strokeLinecap="round" />
                    <rect x="136" y="94" width="88" height="56" rx="6" fill="rgba(0,229,255,0.16)" stroke="#00E5FF" strokeWidth="2.5" strokeDasharray="6 4" />
                    <circle cx="180" cy="110" r="9" stroke="#00E5FF" strokeWidth="2.5" fill="none" />
                    <path d="M162 124 L198 124 M180 120 L180 140" stroke="#00E5FF" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
                    <span className="font-semibold text-amber-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2P</span>
                    <span aria-hidden="true">·</span>
                    <span>128 BPM EDM</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-white">
                    Rhythm Dodge
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Squat, duck, and lean to dodge 3D perspective lasers synced to an EDM beat.
                  </p>
                </div>
              </div>

              <div className="px-4 pb-4">
                <Link
                  href="/?game=rhythm-dodge"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-amber-300"
                >
                  <Zap className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>Play Rhythm Dodge</span>
                </Link>
              </div>
            </article>

            {/* Playable Card 4: Sorcerer's Duel */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-purple-500/40 bg-[#0E131E] transition-colors hover:border-purple-400">
              <div>
                <div className="relative h-28 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg viewBox="0 0 360 180" className="h-full w-full" aria-hidden="true">
                    <path d="M90 36 L66 84 L96 84 L74 138" stroke="#00E5FF" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    <polygon points="180,44 218,68 218,112 180,136 142,112 142,68" fill="rgba(16,185,129,0.18)" stroke="#10B981" strokeWidth="2.5" />
                    <circle cx="276" cy="90" r="28" fill="rgba(245,158,11,0.22)" stroke="#F59E0B" strokeWidth="2.5" />
                  </svg>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
                    <span className="font-semibold text-purple-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2P</span>
                    <span aria-hidden="true">·</span>
                    <span>Hand Spells</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-white">
                    Sorcerer&apos;s Duel
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Cast real-time RPS hand spells—Lightning, Reflect Shield, and Fist Charge.
                  </p>
                </div>
              </div>

              <div className="px-4 pb-4">
                <Link
                  href="/?game=sorcerers-duel"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-purple-500 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-purple-400"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Play Sorcerer&apos;s Duel</span>
                </Link>
              </div>
            </article>

            {/* Playable Card 5: Neon Muncher */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-pink-500/40 bg-[#0E131E] transition-colors hover:border-pink-400">
              <div>
                <div className="relative h-28 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg viewBox="0 0 360 180" className="h-full w-full" aria-hidden="true">
                    <circle cx="180" cy="108" r="46" stroke="#EC4899" strokeWidth="3" fill="rgba(236,72,153,0.14)" />
                    <circle cx="162" cy="92" r="5" fill="#FFFFFF" />
                    <circle cx="198" cy="92" r="5" fill="#FFFFFF" />
                    <ellipse cx="180" cy="122" rx="20" ry="15" stroke="#10B981" strokeWidth="3" fill="rgba(16,185,129,0.24)" />
                    <circle cx="180" cy="40" r="14" stroke="#F59E0B" strokeWidth="2.5" fill="rgba(245,158,11,0.25)" />
                    <circle cx="112" cy="52" r="12" stroke="#EF4444" strokeWidth="2.5" fill="rgba(239,68,68,0.2)" />
                    <circle cx="248" cy="52" r="12" stroke="#00E5FF" strokeWidth="2.5" fill="rgba(0,229,255,0.2)" />
                  </svg>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
                    <span className="font-semibold text-pink-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2P</span>
                    <span aria-hidden="true">·</span>
                    <span>45s Face Cam</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-white">
                    Neon Muncher
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Open wide to chomp neon snacks, clamp shut on bombs, and snap Shame Cam photos.
                  </p>
                </div>
              </div>

              <div className="px-4 pb-4">
                <Link
                  href="/?game=neon-muncher"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-pink-500 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-pink-400"
                >
                  <Smile className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Play Neon Muncher</span>
                </Link>
              </div>
            </article>

            {/* Playable Card 6: Six Seven */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-emerald-500/40 bg-[#0E131E] transition-colors hover:border-emerald-400">
              <div>
                <div className="relative h-28 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg viewBox="0 0 360 180" className="h-full w-full" aria-hidden="true">
                    <path d="M90 128 V50 M270 50 V128" stroke="rgba(148,163,184,0.35)" strokeWidth="3" strokeDasharray="6 6" />
                    <path d="M77 66 L90 48 L103 66 M257 112 L270 130 L283 112" stroke="#34D399" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <circle cx="90" cy="43" r="27" fill="rgba(52,211,153,0.15)" stroke="#34D399" strokeWidth="2.5" />
                    <circle cx="270" cy="137" r="27" fill="rgba(52,211,153,0.15)" stroke="#34D399" strokeWidth="2.5" />
                    <text x="90" y="52" fill="#D1FAE5" fontSize="25" fontWeight="800" textAnchor="middle">6</text>
                    <text x="270" y="146" fill="#D1FAE5" fontSize="25" fontWeight="800" textAnchor="middle">7</text>
                    <path d="M140 92 H220" stroke="#A78BFA" strokeWidth="3" strokeLinecap="round" />
                    <path d="M207 82 L220 92 L207 102" stroke="#A78BFA" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-slate-400">
                    <span className="font-semibold text-emerald-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>Solo</span>
                    <span aria-hidden="true">·</span>
                    <span>30s Alternating Moves</span>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-white">
                    Six Seven
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Alternate left wrist up/right wrist down for 6, then switch for 7. Play on webcam or practice with keys and touch.
                  </p>
                </div>
              </div>

              <div className="px-4 pb-4">
                <Link
                  href="/?game=six-seven"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-300"
                >
                  <Hand className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Play Six Seven</span>
                  <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
