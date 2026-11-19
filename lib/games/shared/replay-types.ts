import type { LocalReplayClip } from '@/lib/games/shared/replay-store';

export type ArcadeReplayClip = LocalReplayClip & {
  gameId: string;
  gameName: string;
};
