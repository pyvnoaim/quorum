// ponytail: one runnable check for the results table - padding and truncation
// are the kind of thing that only looks wrong once it is in front of people.
// `NODE_OPTIONS=--experimental-sqlite npx tsx src/embeds.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const { resultsEmbed } = await import('./embeds.js');

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

console.log('embeds ok');
