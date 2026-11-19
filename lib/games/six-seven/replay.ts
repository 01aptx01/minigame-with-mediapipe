import {
  loadReplayClips,
  MAX_REPLAY_CLIPS,
  removeReplayClip,
  saveReplayClip,
  type LocalReplayClip,
  type ReplayStoreResult,
} from '@/lib/games/shared/replay-store';

export { addWebMDurationMetadata } from '@/lib/games/shared/replay-media';

export type SixSevenClip = LocalReplayClip;
export type SixSevenClipStoreResult = ReplayStoreResult<SixSevenClip>;

export const MAX_SIX_SEVEN_CLIPS = MAX_REPLAY_CLIPS;
export const SIX_SEVEN_CAPTURE_FPS = 24;

const DATABASE_NAME = 'six-seven-replay-clips';

/** Read the existing Six Seven local clip history without changing its database namespace. */
export function loadSixSevenClips(): Promise<SixSevenClipStoreResult> {
  return loadReplayClips<SixSevenClip>(DATABASE_NAME, MAX_SIX_SEVEN_CLIPS);
}

/** Save a Six Seven clip using the same persistent store and five-clip limit. */
export function saveSixSevenClip(clip: SixSevenClip): Promise<SixSevenClipStoreResult> {
  return saveReplayClip<SixSevenClip>(DATABASE_NAME, clip, MAX_SIX_SEVEN_CLIPS);
}

/** Remove a Six Seven clip from the existing device-local namespace. */
export function removeSixSevenClip(id: string): Promise<SixSevenClipStoreResult> {
  return removeReplayClip<SixSevenClip>(DATABASE_NAME, id, MAX_SIX_SEVEN_CLIPS);
}
