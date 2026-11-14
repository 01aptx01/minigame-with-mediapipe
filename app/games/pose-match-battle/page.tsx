import React, { Suspense } from 'react';
import PoseMatchGame from '@/components/PoseMatchGame';

export default function PoseMatchBattlePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-[#07090F] text-sm font-medium text-slate-300">
          Loading Pose Match Battle...
        </div>
      }
    >
      <PoseMatchGame />
    </Suspense>
  );
}
