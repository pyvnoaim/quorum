// ponytail: one runnable check for the results table - padding and truncation
// are the kind of thing that only looks wrong once it is in front of people.
// `NODE_OPTIONS=--experimental-sqlite npx tsx src/embeds.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const { liveEmbed, resultsEmbed } = await import('./embeds.js');

const scenarios = ['domiSwitch Harder', 'Whisphere Small & Slow', 'pasu small reload'];
const match = {
  id: 1,
  guild_id: 'g',
  format: '1v1',
  scenarios: JSON.stringify(scenarios),
  // everything ever offered - a scenario in here that was neither banned nor
  // played was simply not picked, and what was played without being offered at
  // all was rolled.
  ban_pool: JSON.stringify([
    scenarios[0],
    'Ground Plaza Small',
    'popcorn Voltaic',
    'Bounce 180 Tracking',
    scenarios[1],
  ]),
  // ...and the two somebody actually struck out.
  bans: JSON.stringify(['Ground Plaza Small', 'popcorn Voltaic']),
} as unknown as Parameters<typeof resultsEmbed>[0];

const rows = [
  {
    discord_id: 'a',
    team: 0,
    placing: 1,
    scores: JSON.stringify({ [scenarios[0]]: 5087, [scenarios[1]]: 11410, [scenarios[2]]: 68 }),
    pb: JSON.stringify({ [scenarios[1]]: 11100 }),
  },
  {
    discord_id: 'b',
    team: 1,
    placing: 2,
    scores: JSON.stringify({ [scenarios[0]]: 3882, [scenarios[1]]: 11320, [scenarios[2]]: 52 }),
    pb: JSON.stringify({}),
  },
] as unknown as Parameters<typeof resultsEmbed>[1];

const players = new Map([
  ['a', { discord_id: 'a', kovaaks_username: 'ness', elo: 1081 }],
  ['b', { discord_id: 'b', kovaaks_username: 'Jay', elo: 1019 }],
]) as unknown as Parameters<typeof resultsEmbed>[2];

const embed = resultsEmbed(match, rows, players, new Map([['a', 15], ['b', -15]]));
const { title, description, fields } = embed.data;

// The scoreline the card never had: who won, and how many scenarios by.
assert.equal(title, 'ness beats Jay 3–0 · 1v1');

const table = description!.split('```')[1].trim().split('\n');
assert.equal(table.length, 4, 'a header and one row per scenario');
// Every score starts at the same column, whatever the scenario is called -
// which is the whole point of the block.
const nameWidth = Math.max(8, ...scenarios.map((s) => s.length));
assert.ok(
  table.every((line) => line.length > nameWidth + 1 && line[nameWidth + 1] !== ' '),
  'the name column fits the longest scenario and the first score starts right after it',
);
// A scenario is named here and nowhere else on the card, so it is never cut:
// half a name is not something anybody can go and look up in KovaaK's.
assert.ok(
  table[2].startsWith('Whisphere Small & Slow '),
  'the longest name is printed whole, with a gap before the score',
);
assert.ok(
  table.slice(1).every((line) => !line.includes('…')),
  'no scenario name is truncated',
);

// The star marks who took each scenario, which is what the scoreline counts.
assert.equal(table.filter((l) => l.includes('*')).length, 3, 'ness took all three');
assert.ok(!table[0].includes('*'), 'the header is not a result');

// The draft: what was struck out, and the round nobody chose.
assert.ok(description!.includes('**Banned** Ground Plaza Small, popcorn Voltaic'));
assert.ok(
  !description!.includes('Bounce 180 Tracking'),
  'a scenario that was offered and never picked was not banned',
);
assert.ok(description!.includes('**Rolled** pasu small reload'), 'the rolled round says so');

assert.equal(fields!.length, 2);
assert.ok(fields![0].value.includes('(+15)'));
assert.ok(fields![0].value.includes('1 personal best'), 'and only the ones actually beaten');
assert.ok(fields![1].value.includes('(-15)'));
assert.ok(!fields![0].value.includes('forfeited'), 'a row with no run counts forfeits nothing');

// Unranked: the same scoreboard, and none of the consequences. The card has to
// say so itself - it outlives the thread and the panel it was queued from, so a
// reader has no other way to tell why nobody's rating moved.
{
  const e = resultsEmbed(
    { ...match, ranked: 0 } as unknown as typeof match,
    rows,
    players,
    new Map([['a', 0], ['b', 0]]),
  );
  assert.ok(e.data.title!.endsWith('· unranked'), `title says so, got ${e.data.title}`);
  assert.ok(e.data.description!.includes('no rating moved'), 'and the body explains it');
  assert.ok(e.data.description!.includes('```'), 'the scoreboard is still there');
  assert.ok(
    e.data.fields!.every((f) => !f.value.includes('(+0)') && !f.value.includes('(-0)')),
    'no delta at all, rather than a (+0) that reads as a rated game worth nothing',
  );
  // ...and the rated card is untouched by any of it.
  assert.ok(!embed.data.title!.includes('unranked'), 'a rated match says nothing about it');
  assert.ok(embed.data.fields![0].value.includes('(+15)'), 'and still shows its delta');
}

// Runs left unused score 0, and the card has to say so - otherwise it shows
// somebody losing a scenario the numbers say they won. The scoreline reads the
// forfeited scores too: the table and the result are one sum counted twice.
{
  // placings come out of the same forfeited scores, so the short player is
  // second here - a fixture that kept them first would be a card that can't
  // happen.
  const short = [
    { ...rows[0], placing: 2, run_counts: JSON.stringify({ [scenarios[0]]: 1, [scenarios[1]]: 3, [scenarios[2]]: 3 }) },
    { ...rows[1], placing: 1, run_counts: JSON.stringify({ [scenarios[0]]: 3, [scenarios[1]]: 3, [scenarios[2]]: 3 }) },
  ] as unknown as typeof rows;
  const e = resultsEmbed(match, short, players, new Map([['a', 15], ['b', -15]]));
  // Short on one scenario against somebody who played all three out: the whole
  // match goes, not just that round. Otherwise writing off a scenario to spend
  // the clock fishing the other two is a 2-1 win.
  assert.equal(e.data.title, 'Jay beats ness 3–0 · 1v1', 'a scenario short is a match short');
  const row = e.data.description!.split('```')[1].trim().split('\n')[1];
  assert.ok(/\b0\b/.test(row) && !row.includes('5087'), 'the fished score is shown as the 0 it scored');
  const card = (name: string) => e.data.fields!.find((f) => f.name.includes(name))!.value;
  assert.ok(card('ness').includes('forfeited the match'), 'and the card says why');
  assert.ok(!card('Jay').includes('forfeited'), 'the player who played it out is clean');

  // The live board counts a lead exactly as the result will count it, forfeits
  // included - otherwise it tells someone they are winning a scenario they are
  // about to score 0 on, which is the one moment they could still fix it.
  const live = liveEmbed(
    { ...match, started_at: 0, grace_from: null } as unknown as typeof match,
    short,
    players,
  );
  assert.ok(live.data.title!.includes('3–0'), `live lead tracks the result, got ${live.data.title}`);
  const cells = live.data.description!.split('```')[1].trim().split('\n')[1];
  assert.ok(cells.includes('5087') && cells.includes('1/3'), 'but the cell still shows the real run');

  // ...but only against someone who played it out. Two half-played sides are
  // scored on what they ran: there is nobody here to have forfeited to, and
  // wiping both would hand two people a win apiece for playing nothing.
  const neither = [
    { ...short[0], placing: 1 },
    { ...rows[1], placing: 2, run_counts: JSON.stringify({ [scenarios[0]]: 3, [scenarios[1]]: 3, [scenarios[2]]: 1 }) },
  ] as unknown as typeof rows;
  const n = resultsEmbed(match, neither, players, new Map([['a', 15], ['b', -15]]));
  assert.equal(n.data.title, 'ness beats Jay 2–1 · 1v1', 'per-scenario forfeits, one each');
  assert.ok(n.data.fields!.every((f) => !f.value.includes('forfeited the match')));
}

// The standing board: the format's numbers and every scenario in the pool, on
// one message players can read without Manage Server.
{
  const { rulesMessage } = await import('./embeds.js');
  const MAINS = [...(await import('./config.js')).MAIN_CATEGORIES] as string[];
  const { getFormat, getScenarios, setFormat } = await import('./db.js');
  const fmt = setFormat('g2', { rounds: 3, runs: 3, pickPool: 5 });
  const [board] = rulesMessage('g2').embeds;
  const text = board.data.description!;
  assert.ok(text.includes('**3**') && text.includes('**5**'), `rounds and pool, got ${text}`);
  // Three offered minus the two bans, not the five that were rolled - the
  // number a player is actually choosing from.
  assert.ok(text.includes('**3** left of **5**'), `what the picker sees, got ${text}`);
  assert.equal(fmt.pickPool, 5);

  const pool = getScenarios('g2');
  const cats = new Set(pool.map((s) => s.category));
  assert.equal(board.data.fields!.length, cats.size, 'a field per category');
  assert.ok(
    board.data.fields!.every((f) => f.value.length <= 1024),
    'no field is over what Discord takes',
  );
  const first = pool[0];
  const its = board.data.fields!.find((f) => f.value.includes(first.name))!;
  assert.ok(its, 'every scenario is listed');
  // The main it rolls for, then the category: "one per main" is the format, so
  // a heading that names only the category leaves a reader guessing.
  assert.ok(
    its.name.startsWith(`${first.main} · ${first.category}`),
    `a scenario sits under its main and its category, got ${its.name}`,
  );
  const mains = board.data.fields!.map((f) => f.name.split(' · ')[0]);
  assert.deepEqual(mains, [...mains].sort((a, b) => MAINS.indexOf(a) - MAINS.indexOf(b)),
    'and the categories are grouped by main, not left in pool order');

  // One scenario, no picking: the ban-and-pick sentence would be a lie.
  setFormat('g2', { rounds: 1 });
  assert.ok(rulesMessage('g2').embeds[0].data.description!.startsWith('**One** scenario'));
  setFormat('g2', { rounds: getFormat('g').rounds });

  // A pool edited past what Discord takes. Over any of its limits the message
  // is REJECTED, so the board would vanish rather than come out short - which
  // is the one way this feature fails silently.
  const { setScenarios } = await import('./db.js');
  setScenarios(
    'g2',
    Array.from({ length: 40 }, (_, c) =>
      Array.from({ length: 30 }, (_, n) => ({
        category: `Category number ${c}`,
        name: `a scenario with a fairly long name ${c}-${n}`,
        main: 'Clicking',
        rank_ids: null,
      })),
    ).flat(),
  );
  const big = rulesMessage('g2').embeds[0].data;
  const size =
    big.description!.length +
    big.fields!.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(big.fields!.length <= 25, `got ${big.fields!.length} fields`);
  assert.ok(size < 6000, `the whole embed fits, got ${size}`);
  assert.ok(
    big.fields!.every((f) => f.name.length <= 256 && f.value.length <= 1024),
    'and every field does too',
  );
  assert.ok(big.fields!.at(-1)!.name.includes('more categories'), 'what was cut says so');
}

console.log('embeds ok');
