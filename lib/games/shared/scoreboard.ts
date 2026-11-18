export type GameSlug =
  | 'neon-slash-duel'
  | 'pose-match-battle'
  | 'rhythm-dodge'
  | 'sorcerers-duel'
  | 'neon-muncher'
  | 'six-seven';
export type ScoreboardMode = '1v1' | 'solo';

export interface ScoreboardEntry {
  id: string;
  game: GameSlug;
  mode: ScoreboardMode;
  name: string;
  score: number;
  detail: string;
  createdAt: number;
}

export const MAX_SCOREBOARD_ENTRIES = 8;

export function normalizePlayerName(raw: string | undefined, fallback: string): string {
  const cleaned = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return fallback;
  return cleaned.slice(0, 18);
}

export function sortScoreboardEntries(entries: ScoreboardEntry[]): ScoreboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAt - a.createdAt;
  });
}

export function recordMatchToScoreboard(
  existing: ScoreboardEntry[],
  incoming: Array<Omit<ScoreboardEntry, 'id' | 'createdAt'>>,
  nowMs: number = Date.now()
): { entries: ScoreboardEntry[]; addedIds: string[] } {
  const created: ScoreboardEntry[] = incoming.map((item, idx) => ({
    ...item,
    id: `${nowMs}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: nowMs + idx,
  }));

  const sorted = sortScoreboardEntries([...existing, ...created]).slice(
    0,
    MAX_SCOREBOARD_ENTRIES
  );
  const keptSet = new Set(sorted.map((e) => e.id));
  const addedIds = created.filter((e) => keptSet.has(e.id)).map((e) => e.id);

  return { entries: sorted, addedIds };
}

function getStorageKey(game: GameSlug): string {
  return `wparty_scoreboard_v1_${game}`;
}

export function loadScoreboard(game: GameSlug): ScoreboardEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(game));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortScoreboardEntries(
      parsed.filter(
        (item): item is ScoreboardEntry =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.score === 'number'
      )
    ).slice(0, MAX_SCOREBOARD_ENTRIES);
  } catch {
    return [];
  }
}

export function saveScoreboard(game: GameSlug, entries: ScoreboardEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getStorageKey(game), JSON.stringify(entries));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function clearScoreboard(game: GameSlug): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getStorageKey(game));
  } catch {
    // Ignore errors
  }
}
