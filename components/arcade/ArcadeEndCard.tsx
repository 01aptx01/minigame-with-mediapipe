'use client';

import React from 'react';
import Link from 'next/link';
import { LeaderboardPanel } from '@/components/arcade/LeaderboardPanel';
import type { ScoreboardEntry, ScoreboardMode } from '@/lib/games/shared/scoreboard';

export interface EndPlayerCardData {
  name: string;
  score: number;
  metrics: string[];
}

interface ArcadeEndCardProps {
  winnerTitle: string;
  mode: ScoreboardMode;
  p1: EndPlayerCardData;
  p2?: EndPlayerCardData;
  topSlot?: React.ReactNode;
  scoreboard: ScoreboardEntry[];
  highlightIds: string[];
  onClearScoreboard: () => void;
  replayLabel: string;
  onReplay: () => void;
}

export function ArcadeEndCard({
  winnerTitle,
  mode,
  p1,
  p2,
  topSlot,
  scoreboard,
  highlightIds,
  onClearScoreboard,
  replayLabel,
  onReplay,
}: ArcadeEndCardProps) {
  return (
    <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0D121E] p-6 text-center shadow-2xl">
      <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">
        {winnerTitle}
      </h2>

      {topSlot}

      <div
        className={`mt-4 grid gap-3 text-left ${
          mode === 'solo' || !p2 ? 'grid-cols-1' : 'grid-cols-2'
        }`}
      >
        <div className="rounded-xl border border-cyan-500/35 bg-[#090E18] p-3.5">
          <div className="truncate text-xs font-bold tracking-wider text-cyan-400 uppercase">
            {p1.name}
          </div>
          <div className="mt-0.5 font-mono text-3xl font-bold text-white tabular-nums">
            {p1.score}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300 font-mono tabular-nums">
            {p1.metrics.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>
        </div>

        {mode === '1v1' && p2 && (
          <div className="rounded-xl border border-rose-500/35 bg-[#090E18] p-3.5">
            <div className="truncate text-xs font-bold tracking-wider text-rose-400 uppercase">
              {p2.name}
            </div>
            <div className="mt-0.5 font-mono text-3xl font-bold text-white tabular-nums">
              {p2.score}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-300 font-mono tabular-nums">
              {p2.metrics.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <LeaderboardPanel
        entries={scoreboard}
        highlightIds={highlightIds}
        onClear={onClearScoreboard}
      />

      <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          data-start="true"
          onClick={onReplay}
          className="flex-1 rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 whitespace-nowrap"
        >
          {replayLabel}
        </button>
        <Link
          href="/"
          className="flex-1 rounded-lg border border-slate-700 bg-[#121929] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-500 whitespace-nowrap"
        >
          Back to Hub
        </Link>
      </div>
    </div>
  );
}
