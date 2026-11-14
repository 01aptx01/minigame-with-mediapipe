'use client';

import React from 'react';
import { Trash2, Trophy } from 'lucide-react';
import type { ScoreboardEntry } from '@/lib/games/shared/scoreboard';

interface LeaderboardPanelProps {
  entries: ScoreboardEntry[];
  highlightIds: string[];
  onClear: () => void;
}

export function LeaderboardPanel({
  entries,
  highlightIds,
  onClear,
}: LeaderboardPanelProps) {
  const visible = entries.slice(0, 5);
  const highlightSet = new Set(highlightIds);

  return (
    <div
      data-testid="scoreboard-panel"
      className="mt-4 rounded-xl border border-slate-800 bg-[#090D16] p-3.5 text-left"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-amber-300 uppercase">
          <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Arcade Scoreboard</span>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            title="Clear scoreboard"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-300"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="py-2 text-center text-xs text-slate-500">No scores recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((entry, idx) => {
            const isNew = highlightSet.has(entry.id);
            return (
              <li
                key={entry.id}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${
                  isNew
                    ? 'border border-cyan-500/40 bg-cyan-500/10'
                    : 'bg-[#0D1320]/80'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`w-5 shrink-0 font-mono font-bold ${
                      idx === 0
                        ? 'text-amber-300'
                        : idx === 1
                        ? 'text-slate-200'
                        : idx === 2
                        ? 'text-amber-600'
                        : 'text-slate-500'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <span className="truncate font-semibold text-white">{entry.name}</span>
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 uppercase">
                    {entry.mode}
                  </span>
                  {isNew && (
                    <span className="shrink-0 font-mono text-[10px] font-bold text-cyan-300">
                      NEW
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2.5 font-mono tabular-nums">
                  <span className="text-[11px] text-slate-400">{entry.detail}</span>
                  <span className="font-bold text-white">{entry.score}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
