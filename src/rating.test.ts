// ponytail: one runnable check, no framework. `npx tsx src/rating.test.ts`.
import assert from 'node:assert/strict';
import { DEFAULT_RANKS } from './config.js';
import { canPlay, eloDeltas, placings, rankName } from './rating.js';
import type { Entrant } from './rating.js';

const scenarios = ['a', 'b', 'c'];
const p = (id: string, elo: number, team: number, s: (number | null)[]): Entrant => ({
  id,
  elo,
  team,
  scores: { a: s[0], b: s[1], c: s[2] },
});

// 1v1: winner takes 2 of 3 rounds.
{
  const e = [p('win', 1000, 0, [100, 100, 50]), p('lose', 1000, 1, [90, 90, 60])];
  const placing = placings(e, scenarios);
  assert.equal(placing.get(0), 1);
  assert.equal(placing.get(1), 2);
  const d = eloDeltas(e, placing);
  assert.equal(d.get('win'), 16); // even ratings, K/2
  assert.equal(d.get('lose'), -16);
}

// Beating someone above you pays more than beating a peer, and losing to them
// barely costs - the headline rule of the rating system.
{
  const upset = [p('me', 1000, 0, [100, 100, 100]), p('them', 1400, 1, [1, 1, 1])];
  const gain = eloDeltas(upset, placings(upset, scenarios)).get('me')!;
  assert.ok(gain > 25, `upset gain ${gain} should be large`);

  const expected = [p('me', 1000, 0, [1, 1, 1]), p('them', 1400, 1, [100, 100, 100])];
  const loss = eloDeltas(expected, placings(expected, scenarios)).get('me')!;
  assert.ok(Math.abs(loss) < 6, `expected loss ${loss} should be small`);
}

// 2v2: team totals decide the round, both members move together.
{
  const e = [
    p('a1', 1000, 0, [60, 60, 60]),
    p('a2', 1000, 0, [60, 60, 60]),
    p('b1', 1000, 1, [50, 50, 50]),
    p('b2', 1000, 1, [50, 50, 50]),
  ];
  const placing = placings(e, scenarios);
  assert.equal(placing.get(0), 1);
  const d = eloDeltas(e, placing);
  assert.equal(d.get('a1'), d.get('a2'));
  assert.equal(d.get('a1'), -d.get('b1')!);
}

// Group FFA: measured against the whole lobby, so third of four still beats two.
{
  const e = [
    p('first', 1000, 0, [100, 100, 100]),
    p('second', 1000, 1, [90, 90, 90]),
    p('third', 1000, 2, [80, 80, 80]),
    p('last', 1000, 3, [70, 70, 70]),
  ];
  const placing = placings(e, scenarios);
  assert.deepEqual([...placing.values()], [1, 2, 3, 4]);
  const d = eloDeltas(e, placing);
  assert.ok(d.get('first')! > d.get('second')!);
  assert.ok(d.get('second')! > d.get('third')!);
  assert.ok(d.get('third')! > d.get('last')!);
  assert.ok(d.get('third')! < 0 && d.get('second')! > 0); // 2nd of 4 gains, 3rd loses
}

// A no-show scores 0 for that round rather than crashing the match.
{
  const e = [p('played', 1000, 0, [100, null, 100]), p('afk', 1000, 1, [null, null, null])];
  assert.equal(placings(e, scenarios).get(0), 1);
}

assert.equal(rankName(DEFAULT_RANKS, 1400), 'Champion');
assert.equal(rankName(DEFAULT_RANKS, 1050), 'Gold');
assert.equal(rankName(DEFAULT_RANKS, 700), 'Iron');
// an edited ladder arrives unsorted and with holes - still resolves
assert.equal(rankName([{ name: 'Top', min_elo: 2000 }, { name: 'Base', min_elo: 0 }], 2100), 'Top');
assert.equal(rankName([{ name: 'Top', min_elo: 2000 }, { name: 'Base', min_elo: 0 }], 500), 'Base');
assert.equal(rankName([{ name: 'Top', min_elo: 2000 }], 500), '');

assert.ok(canPlay('elite', 'advanced'));
assert.ok(!canPlay('elite', 'intermediate'));

console.log('rating ok');
