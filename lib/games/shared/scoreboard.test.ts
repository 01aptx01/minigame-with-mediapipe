import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SCOREBOARD_ENTRIES,
  normalizePlayerName,
  recordMatchToScoreboard,
  type ScoreboardEntry,
} from './scoreboard';

test('normalizePlayerName trims whitespace, caps length, and uses fallback when blank', () => {
  assert.equal(normalizePlayerName('', 'Player 1'), 'Player 1');
  assert.equal(normalizePlayerName('   ', 'Solo Player'), 'Solo Player');
  assert.equal(normalizePlayerName('  Alice   Bob  ', 'Player 1'), 'Alice Bob');
  assert.equal(
    normalizePlayerName('VeryLongArcadeNickname12345', 'Player 1').length,
    18
  );
});

test('recordMatchToScoreboard sorts by highest score, caps at max entries, and tracks added ids', () => {
  const initial: ScoreboardEntry[] = Array.from({ length: MAX_SCOREBOARD_ENTRIES }, (_, i) => ({
    id: `old-${i}`,
    game: 'neon-slash-duel',
    mode: '1v1',
    name: `Bot ${i}`,
    score: (i + 1) * 50,
    detail: '1x',
    createdAt: 1000 + i,
  }));

  const { entries, addedIds } = recordMatchToScoreboard(
    initial,
    [
      {
        game: 'neon-slash-duel',
        mode: 'solo',
        name: 'Ace',
        score: 999,
        detail: '5x max',
      },
      {
        game: 'neon-slash-duel',
        mode: 'solo',
        name: 'Low',
        score: 10,
        detail: '1x max',
      },
    ],
    5000
  );

  assert.equal(entries.length, MAX_SCOREBOARD_ENTRIES);
  assert.equal(entries[0].name, 'Ace');
  assert.equal(entries[0].score, 999);
  assert.equal(addedIds.length, 1);
  assert.equal(addedIds[0], entries[0].id);
});
