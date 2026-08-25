// ponytail: one runnable check, no framework. `npx tsx src/rating.test.ts`.
import assert from 'node:assert/strict';
import { DEFAULT_RANKS, ROUNDS } from './config.js';
import {
  advancePick,
  allRunsUsed,
  bandsInReach,
  scenarioWinners,
  rankForRoles,
  pickTurn,
  canPlay,
  eloDeltas,
  placings,
  rankName,
  scorable,
} from './rating.js';
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

// Nobody ran anything: every side ties at 0 and a tie shares the better
// placing, so scoring this hands EVERYONE first place - and a win each. That
// is why finishMatch voids a match with no scores instead of rating it.
{
  const e = [p('a', 1000, 0, [null, null, null]), p('b', 1000, 1, [null, null, null])];
  const placing = placings(e, scenarios);
  assert.equal(placing.get(0), 1);
  assert.equal(placing.get(1), 1, 'an unplayed match ties at first - it must never be scored');
  const d = eloDeltas(e, placing);
  assert.equal(d.get('a'), 0);
  assert.equal(d.get('b'), 0);
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

// A missed scenario scores 0 for that round rather than crashing the match.
{
  const e = [p('played', 1000, 0, [100, null, 100]), p('most', 1000, 1, [90, 90, null])];
  assert.equal(placings(e, scenarios).get(0), 1);
}

// Missing EVERY scenario is not a loss, it is a game that never happened. The
// no-show must not hand their opponent free Elo, and must not eat a loss for it.
{
  const e = [p('played', 1000, 0, [100, 100, 100]), p('afk', 1000, 1, [null, null, null])];
  assert.deepEqual(scorable(e), [], '1v1 with one side absent is no contest');
  assert.deepEqual(
    scorable([p('a', 1000, 0, [null, null, null]), p('b', 1000, 1, [null, null, null])]),
    [],
    'and so is nobody running anything - what finishMatch voids',
  );

  // A 2v2 with one absent teammate is still a real match - it just is not
  // scored for them. Their side keeps the round totals it earned without them.
  const four = [
    p('a1', 1000, 0, [120, 120, 120]),
    p('afk', 1000, 0, [null, null, null]),
    p('b1', 1000, 1, [50, 50, 50]),
    p('b2', 1000, 1, [50, 50, 50]),
  ];
  const played = scorable(four);
  assert.deepEqual(played.map((x) => x.id), ['a1', 'b1', 'b2']);
  assert.equal(placings(played, scenarios).get(0), 1, 'their side still won the rounds');
  assert.equal(eloDeltas(played, placings(played, scenarios)).get('afk'), undefined, 'no delta');
}

// What ends a match on its own: everyone's runs in, on every scenario.
{
  const full = { a: 3, b: 3, c: 3 };
  assert.ok(allRunsUsed(scenarios, [full, full], 3), 'both players played it out');
  assert.ok(!allRunsUsed(scenarios, [full, { a: 3, b: 2, c: 3 }], 3), 'one run short is not done');
  assert.ok(!allRunsUsed(scenarios, [full, { a: 3, b: 3 }], 3), 'a scenario never touched is not done');
  assert.ok(!allRunsUsed(scenarios, [full, {}], 3), 'a no-show never ends the match - the clock does');
  // Running extra is nobody's problem: only the first three ever counted.
  assert.ok(allRunsUsed(scenarios, [{ a: 5, b: 3, c: 4 }, full], 3), 'more than asked still counts');
  // A server that runs one run per scenario ends after one.
  assert.ok(allRunsUsed(scenarios, [{ a: 1, b: 1, c: 1 }, { a: 1, b: 2, c: 1 }], 1));
  assert.ok(!allRunsUsed(scenarios, [], 3), 'a match with nobody in it is not finished');
  assert.ok(!allRunsUsed([], [full], 3), 'nor one with nothing to play');
}

assert.equal(rankName(DEFAULT_RANKS, 1400), 'Champion');
assert.equal(rankName(DEFAULT_RANKS, 1050), 'Gold');
assert.equal(rankName(DEFAULT_RANKS, 700), 'Iron');
// an edited ladder arrives unsorted and with holes - still resolves
assert.equal(rankName([{ name: 'Top', min_elo: 2000 }, { name: 'Base', min_elo: 0 }], 2100), 'Top');
assert.equal(rankName([{ name: 'Top', min_elo: 2000 }, { name: 'Base', min_elo: 0 }], 500), 'Base');
assert.equal(rankName([{ name: 'Top', min_elo: 2000 }], 500), '');

// rank gate: spread counts bands, not Elo, so an edited ladder moves it too
const ladder = [
  { name: 'Gold', min_elo: 1200 },
  { name: 'Silver', min_elo: 1100 },
  { name: 'Bronze', min_elo: 1000 },
  { name: 'Iron', min_elo: 0 },
];
assert.ok(canPlay(ladder, 1250, 1210, 0), 'same band, spread 0');
assert.ok(!canPlay(ladder, 1250, 1150, 0), 'one band apart, spread 0');
assert.ok(canPlay(ladder, 1250, 1150, 1), 'one band apart, spread 1');
assert.ok(!canPlay(ladder, 1250, 1050, 1), 'two bands apart, spread 1');
assert.ok(canPlay(ladder, 1250, 1050, 2), 'two bands apart, spread 2');
// an unsorted ladder must gate the same way the dashboard's does
assert.ok(!canPlay([...ladder].reverse(), 1250, 1150, 0), 'order must not matter');

// Pinged bands and admitted bands must be the same set. If they drift, a call
// either pings people it will turn away or hides itself from people it wants.
for (const spread of [0, 1, 2]) {
  for (const elo of [1300, 1250, 1150, 1050, 900, 0]) {
    const reach = bandsInReach(ladder, elo, spread).map((r) => r.name);
    const admitted = ladder
      .filter((r) => canPlay(ladder, elo, r.min_elo, spread))
      .map((r) => r.name);
    assert.deepEqual(
      [...reach].sort(),
      [...admitted].sort(),
      `ping and gate disagree at elo ${elo}, spread ${spread}`,
    );
  }
}
assert.deepEqual(bandsInReach(ladder, 1250, 0).map((r) => r.name), ['Gold']);
assert.deepEqual(bandsInReach(ladder, 1250, 1).map((r) => r.name), ['Gold', 'Silver']);
assert.deepEqual(bandsInReach([], 1250, 1), [], 'no ladder, nothing to ping');

// The pick phase, one scenario at a time out of a shortlist of five.
{
  // Scenario 1 belongs to side 0: it bans first, side 1 bans back, side 0 picks.
  const one = [5, 4, 3].map((left) => pickTurn(0, left, 5));
  assert.deepEqual(one.map((s) => s.action), ['ban', 'ban', 'pick']);
  assert.deepEqual(one.map((s) => s.turn), [0, 1, 0], 'picker bans first, opponent last');
  assert.deepEqual(one.map((s) => s.bansLeft), [2, 1, 0]);

  // Scenario 2 hands the pick to the other side, and the ban order with it.
  const two = [5, 4, 3].map((left) => pickTurn(1, left, 5));
  assert.deepEqual(two.map((s) => s.turn), [1, 0, 1], 'the pick alternates');
  assert.equal(two[2].action, 'pick');

  // Whoever picks bans first: the last ban is always the opponent's, so the
  // pick is made against their ban rather than after their information.
  for (const picked of [0, 1]) {
    const steps = [5, 4].map((left) => pickTurn(picked, left, 5));
    assert.equal(steps[0].turn, picked % 2);
    assert.notEqual(steps[1].turn, picked % 2);
  }

  // A shortlist too thin for two bans still has to end in something playable.
  assert.deepEqual(pickTurn(0, 2, 2), { action: 'ban', picker: 0, turn: 0, bansLeft: 1 });
  assert.equal(pickTurn(0, 1, 2).action, 'pick', 'one left is the pick, not a third ban');
  assert.equal(pickTurn(0, 1, 1).action, 'pick', 'a single candidate is simply played');
}

// A whole 1v1 pick phase, start to finish: ban ban pick, ban ban pick, roll.
{
  const pools: Record<string, string[]> = {
    Speed: ['s1', 's2', 's3', 's4', 's5'],
    Evasive: ['e1', 'e2', 'e3', 'e4', 'e5'],
    Precision: ['p1', 'p2', 'p3', 'p4', 'p5'],
  };
  // deterministic stand-in for the db roll: take from the front, minus what is
  // already locked in.
  const roll = (category: string, want: number, taken: string[]) =>
    (pools[category] ?? []).filter((s) => !taken.includes(s)).slice(0, want);

  const cats = ['Speed', 'Evasive', 'Precision'];
  let phase = { picked: [], cats, pool: roll('Speed', 5, []), size: 5 } as {
    picked: string[];
    cats: string[];
    pool: string[];
    size: number;
  };
  const acted: number[] = [];
  let scenarios: string[] = [];

  // Always take index 0, so what survives says exactly which step did what.
  for (let step = 0; step < 6; step++) {
    acted.push(pickTurn(phase.picked.length, phase.pool.length, phase.size).turn);
    const next = advancePick(phase, 0, roll);
    if ('scenarios' in next) {
      scenarios = next.scenarios;
      break;
    }
    phase = next.phase;
  }

  assert.deepEqual(acted, [0, 1, 0, 1, 0, 1], 'side 0 opens each scenario, sides alternate');

  // A pool emptied mid-match plays what is settled instead of stalling in a
  // phase with no buttons in it.
  const stranded = advancePick(
    { picked: ['s3'], cats, pool: ['e1', 'e2'], size: 5 },
    0,
    () => [],
  );
  assert.deepEqual(stranded, { scenarios: ['s3', 'e1'] }, 'the pick still counts');
  assert.deepEqual(
    scenarios,
    ['s3', 'e3', 'p1'],
    'two bans off the front then the pick, per category, and the last is rolled',
  );
  assert.equal(new Set(scenarios).size, ROUNDS, 'three distinct scenarios');
}

console.log('rating ok');

// Manual mode reads the bracket off the roles someone holds, highest first, so
// a stale lower role left on them cannot demote them.
const withRoles = [
  { name: 'Champion', min_elo: 1400, discord_role_id: 'r-champ' },
  { name: 'Novice', min_elo: 0, discord_role_id: 'r-nov' },
];
assert.equal(rankForRoles(withRoles, ['r-nov', 'r-champ'])!.name, 'Champion');
assert.equal(rankForRoles(withRoles, ['r-nov'])!.name, 'Novice');
assert.equal(rankForRoles(withRoles, ['other']), undefined, 'unplaced is not a bracket');

// Who took each scenario, which is what a 2-1 on the result card counts.
const duel = [
  { id: 'a', elo: 1000, team: 0, scores: { s1: 100, s2: 50, s3: 10 } },
  { id: 'b', elo: 1000, team: 1, scores: { s1: 90, s2: 50, s3: null } },
];
assert.deepEqual(
  scenarioWinners(duel, ['s1', 's2', 's3']),
  [0, null, 0],
  'a tie is nobody, and an unplayed scenario still goes to whoever scored',
);
assert.deepEqual(
  scenarioWinners(duel, ['never played']),
  [null],
  'a scenario nobody scored on was won by nobody',
);
