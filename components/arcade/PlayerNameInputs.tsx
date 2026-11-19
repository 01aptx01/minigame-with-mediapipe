'use client';

import React from 'react';

interface PlayerNameInputsProps {
  soloMode: boolean;
  p1Name: string;
  p2Name: string;
  onChangeP1Name: (value: string) => void;
  onChangeP2Name: (value: string) => void;
}

export function PlayerNameInputs({
  soloMode,
  p1Name,
  p2Name,
  onChangeP1Name,
  onChangeP2Name,
}: PlayerNameInputsProps) {
  return (
    <div
      className={`mt-4 grid w-full gap-2.5 text-left ${
        soloMode ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
      }`}
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
          {soloMode ? 'Player Name (Optional)' : 'P1 Name (Optional)'}
        </span>
        <input
          type="text"
          maxLength={18}
          value={p1Name}
          onChange={(e) => onChangeP1Name(e.target.value)}
          placeholder={soloMode ? 'Solo Player' : 'Player 1'}
          data-testid="p1-name-input"
          className="w-full rounded-lg border border-slate-700/80 bg-[#080C15] px-3 py-2 text-xs font-medium text-white placeholder:text-slate-400 focus:border-cyan-400"
        />
      </label>

      {!soloMode && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold tracking-wider text-rose-300 uppercase">
            P2 Name (Optional)
          </span>
          <input
            type="text"
            maxLength={18}
            value={p2Name}
            onChange={(e) => onChangeP2Name(e.target.value)}
            placeholder="Player 2"
            data-testid="p2-name-input"
            className="w-full rounded-lg border border-slate-700/80 bg-[#080C15] px-3 py-2 text-xs font-medium text-white placeholder:text-slate-400 focus:border-rose-400"
          />
        </label>
      )}
    </div>
  );
}
