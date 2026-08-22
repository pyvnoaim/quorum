// ponytail: one runnable check, no framework.
// `NODE_OPTIONS=--experimental-sqlite npx tsx src/db.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const {
  ensurePlayer,
  getPlayer,
  getRanks,
  getScenarios,
  getConfig,
  getRankSpread,
  guildStats,
  leaderboard,
  rankChannels,
  setConfig,
  setRankChannels,
  setRankSpread,
  playersInGuild,
  setRankRole,
  setRanks,
  setScenarios,
  setTier,
  db,
} = await import('./db.js');
const { rankFor } = await import('./rating.js');

const G = '111';

// A fresh server gets the default ladder rather than no ranks at all.
const seeded = getRanks(G);
assert.equal(seeded.length, 7);
assert.equal(seeded[0].name, 'Champion');
assert.equal(seeded.at(-1)!.name, 'Iron');
assert.ok(seeded[0].min_elo > seeded[1].min_elo, 'highest band first');

// An edited ladder keeps the Discord role of every rank that survived, and
// hands back the roles of the ones that didn't so the caller can delete them.
setRankRole(seeded[0].id, 'role-champion');
setRankRole(seeded.at(-1)!.id, 'role-iron');
const { ranks, orphaned } = setRanks(G, [
  { id: seeded[0].id, name: 'Legend', min_elo: 1500, color: '#ff0000' },
  { name: 'Rookie', min_elo: 0, color: '#00ff00' },
]);
assert.equal(ranks.length, 2);
assert.equal(ranks[0].name, 'Legend');
assert.equal(ranks[0].discord_role_id, 'role-champion', 'renamed rank keeps its role');
assert.equal(ranks[1].discord_role_id, null, 'a new rank has no role yet');
assert.deepEqual(
  orphaned.map((r) => r.discord_role_id),
  ['role-iron'],
  'the deleted rank returns its role for cleanup',
);

// The ladder still resolves after being rewritten.
assert.equal(rankFor(ranks, 1600)!.name, 'Legend');
assert.equal(rankFor(ranks, 10)!.name, 'Rookie');

// Ranks are per server: editing one leaves another alone.
assert.equal(getRanks('222').length, 7);

// Scenario pool: seeded, then owned by whatever the dashboard sends.
assert.equal(getScenarios(G).length, 16);
const pool = setScenarios(G, [{ category: 'Clicking', name: '1w4ts' }]);
// node:sqlite hands back null-prototype rows, so compare the fields
assert.equal(pool.length, 1);
assert.equal(pool[0].category, 'Clicking');
assert.equal(pool[0].name, '1w4ts');

// Tier sets the starting rating - but only for someone who hasn't played, or a
// promotion would wipe a real record.
ensurePlayer('u1', 'fresh');
setTier('u1', 'elite');
assert.equal(getPlayer('u1')!.elo, 1275);
db.prepare('update player set wins = 3, elo = 1400 where discord_id = ?').run('u1');
setTier('u1', 'novice');
assert.equal(getPlayer('u1')!.elo, 1400, 'a played record survives a tier change');
assert.equal(getPlayer('u1')!.tier, 'novice');

// Ratings are global, the player LIST is not. Without the guild filter an
// admin of one server could read - and through setTier rewrite - the record of
// players who have never been in it.
ensurePlayer('inA', 'playerA');
ensurePlayer('inB', 'playerB');
db.prepare(
  "insert into match (id, guild_id, channel_id, host_id, format, status) values (91,'gA','c','inA','1v1','done')",
).run();
db.prepare(
  "insert into match (id, guild_id, channel_id, host_id, format, status) values (92,'gB','c','inB','1v1','done')",
).run();
db.prepare("insert into match_player (match_id, discord_id) values (91,'inA')").run();
db.prepare("insert into match_player (match_id, discord_id) values (92,'inB')").run();
db.prepare("update player set wins = 1 where discord_id in ('inA','inB')").run();

assert.deepEqual(
  playersInGuild('gA').map((p) => p.discord_id),
  ['inA'],
  'a server sees only players who have been in it',
);
assert.deepEqual(
  leaderboard('gB').map((p) => p.discord_id),
  ['inB'],
  'the ladder is scoped too',
);
assert.equal(guildStats('gA').rated, 1, 'and so is the rated count');

// Channels follow the ladder exactly as roles do: a surviving rank keeps its
// channels across a rewrite, a removed one hands them back to be deleted.
const [keepId, dropId] = getRanks('gc').slice(0, 2).map((r) => r.id);
setRankChannels(keepId, { category: 'cat-keep', results: 'res-keep' });
setRankChannels(dropId, { category: 'cat-drop', results: 'res-drop' });
const rewritten = setRanks('gc', [
  { id: keepId, name: 'Renamed', min_elo: 1400, color: '#ffffff' },
  { name: 'Brand New', min_elo: 0, color: '#000000' },
]);
const kept = rewritten.ranks.find((r) => r.name === 'Renamed')!;
assert.equal(rankChannels(kept).category, 'cat-keep', 'a renamed rank keeps its channels');
assert.deepEqual(
  rankChannels(rewritten.ranks.find((r) => r.name === 'Brand New')!),
  {},
  'a new rank starts with none',
);
assert.ok(
  rewritten.orphaned.some((r) => rankChannels(r).category === 'cat-drop'),
  'a deleted rank hands its channels back for cleanup',
);

// Split mode forces the gate to zero however the spread was saved - the channel
// name is the promise, so nothing may quietly widen it.
setRankSpread('gc', { '1v1': 2, '2v2': 2, group: 2 });
assert.equal(getRankSpread('gc')['2v2'], 2, 'stored spread applies while sharing one channel');
setConfig('gc', { split_channels: 1 });
assert.deepEqual(getRankSpread('gc'), { '1v1': 0, '2v2': 0, group: 0 }, 'split forces same-rank');
setConfig('gc', { split_channels: 0 });
assert.equal(getRankSpread('gc')['2v2'], 2, 'and the saved spread survives being turned off');

console.log('db ok');
