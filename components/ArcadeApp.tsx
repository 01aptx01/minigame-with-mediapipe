'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import ArcadeHub from '@/components/ArcadeHub';

const GameLoadingFallback = () => (
  <div className="flex h-screen w-screen items-center justify-center bg-arcade-background text-sm font-medium text-slate-300">
    Loading Arcade Stage...
  </div>
);

const NeonSlashGame = dynamic(() => import('@/components/NeonSlashGame'), {
  ssr: false,
  loading: GameLoadingFallback,
});
const PoseMatchGame = dynamic(() => import('@/components/PoseMatchGame'), {
  ssr: false,
  loading: GameLoadingFallback,
});
const RhythmDodgeGame = dynamic(() => import('@/components/RhythmDodgeGame'), {
  ssr: false,
  loading: GameLoadingFallback,
});
const SorcerersDuelGame = dynamic(() => import('@/components/SorcerersDuelGame'), {
  ssr: false,
  loading: GameLoadingFallback,
});
const NeonMuncherGame = dynamic(() => import('@/components/NeonMuncherGame'), {
  ssr: false,
  loading: GameLoadingFallback,
});
const SixSevenGame = dynamic(() => import('@/components/SixSevenGame'), {
  ssr: false,
  loading: GameLoadingFallback,
});

export default function ArcadeApp() {
  const searchParams = useSearchParams();
  const activeGame = searchParams.get('game');

  switch (activeGame) {
    case 'neon-slash-duel':
      return <NeonSlashGame />;
    case 'pose-match-battle':
      return <PoseMatchGame />;
    case 'rhythm-dodge':
      return <RhythmDodgeGame />;
    case 'sorcerers-duel':
      return <SorcerersDuelGame />;
    case 'neon-muncher':
      return <NeonMuncherGame />;
    case 'six-seven':
      return <SixSevenGame />;
    default:
      return <ArcadeHub />;
  }
}
