'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { useMediaPipe } from '@/contexts/MediaPipeContext';

/** Camera guidance stays visible on the hub and every game's start screen. */
export function CameraHelp() {
  const [fullPageUrl, setFullPageUrl] = useState('');
  const [embedded, setEmbedded] = useState(false);
  const game = useSearchParams().get('game');
  const {
    cameraStatus, cameraError, modelStatus, poseModelStatus, faceModelStatus,
    initializeModel, initializePoseModel, initializeFaceModel,
  } = useMediaPipe();
  useEffect(() => {
    setEmbedded(window.self !== window.top);
    setFullPageUrl(window.location.href);
  }, [game]);

  const poseGame = game === 'pose-match-battle' || game === 'rhythm-dodge';
  const status = poseGame ? poseModelStatus : game === 'neon-muncher' ? faceModelStatus : modelStatus;
  const retryModel = poseGame ? initializePoseModel : game === 'neon-muncher' ? initializeFaceModel : initializeModel;

  if (!embedded && !cameraError && cameraStatus !== 'requesting' && cameraStatus !== 'starting' && status !== 'error') return null;
  return (
    <div className="mt-3 w-full rounded-lg border border-slate-700 bg-[#090D16] p-3 text-left text-xs leading-relaxed text-slate-300">
      <div role="status" aria-live="polite">
        {cameraError ? <p>{cameraError}</p> : cameraStatus === 'starting' ? (
          <p>Camera permission is granted. Starting the video… If it does not start, the button will let you retry.</p>
        ) : cameraStatus === 'requesting' ? (
          <p>Allow Camera in your browser’s permission prompt. If it is hidden, check the camera icon beside the address bar.</p>
        ) : embedded ? <p>Playing inside a preview? Open the full page to give the game camera access.</p> : null}
        {status === 'error' && (
          <p className="mt-1">Tracking could not load. Check your connection and browser graphics support, then retry tracking.</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {embedded && fullPageUrl && (
          <a href={fullPageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-cyan-400 px-3 py-2 font-semibold text-slate-950 hover:bg-cyan-300">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open full page for webcam
          </a>
        )}
        {status === 'error' && (
          <button type="button" onClick={() => void retryModel()} className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-2 text-slate-200 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Retry tracking
          </button>
        )}
      </div>
    </div>
  );
}
