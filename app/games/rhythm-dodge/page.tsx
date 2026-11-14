import React, { Suspense } from 'react';
import RhythmDodgeGame from '@/components/RhythmDodgeGame';

export default function RhythmDodgePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-[#07090F] text-sm font-medium text-slate-300">
          Loading Rhythm Dodge...
        </div>
      }
    >
      <RhythmDodgeGame />
    </Suspense>
  );
}
