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
  // everything ever offered: what is in here and not played was banned, and
  // what was played without being offered was rolled.
  ban_pool: JSON.stringify([scenarios[0], 'Ground Plaza Small', 'popcorn Voltaic', scenarios[1]]),
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
assert.ok(
  table.every((line) => line.length > 20 && line[20] !== ' '),
  'the name column is 20 wide and the first score starts right after it',
);
assert.ok(table[2].startsWith('Whisphere Small &'), 'a long name is cut, not wrapped');
assert.ok(table[2].includes('… '), 'and a cut name still leaves a gap before the score');

// The star marks who took each scenario, which is what the scoreline counts.
assert.equal(table.filter((l) => l.includes('*')).length, 3, 'ness took all three');
assert.ok(!table[0].includes('*'), 'the header is not a result');

// The draft: what was struck out, and the round nobody chose.
assert.ok(description!.includes('**Banned** Ground Plaza Small, popcorn Voltaic'));
assert.ok(description!.includes('**Rolled** pasu small reload'), 'the rolled round says so');

assert.equal(fields!.length, 2);
assert.ok(fields![0].value.includes('(+15)'));
assert.ok(fields![0].value.includes('1 personal best'), 'and only the ones actually beaten');
assert.ok(fields![1].value.includes('(-15)'));
assert.ok(!fields![0].value.includes('forfeited'), 'a row with no run counts forfeits nothing');

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

console.log('embeds ok');
