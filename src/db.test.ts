// ponytail: one runnable check, no framework.
// `NODE_OPTIONS=--experimental-sqlite npx tsx src/db.test.ts`
process.env.DB_PATH = ':memory:';
import assert from 'node:assert/strict';

const {
  deleteMatch,
  ensurePlayer,
  getMatch,
  getPlayer,
  matchPlayers,
  getRanks,
  getScenarios,
  getRankMode,
  poolFor,
  getConfig,
  getFormat,
  getRankSpread,
  guildStats,
  headToHead,
  ladderSize,
  leaderboard,
  recentMatches,
  rankChannels,
  setConfig,
  setFormat,
  setRankChannels,
  setRankSpread,
  playersInGuild,
  setRankRole,
  setRanks,
  setScenarios,
  seedPlayer,
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

// Scenario pool: seeded, then owned by whatever the dashboard sends. The
// shipped groups are both switching, so that is the main they file under.
const seededPool = getScenarios(G);
assert.equal(seededPool.length, 16);
assert.ok(seededPool.every((s) => s.main === 'Switching'), 'the defaults file under one main');
// A subcategory keeps its own name and rolls up into the main it was filed
// under - that is the whole two-level shape.
const pool = setScenarios(G, [
  { category: 'Clicking', name: '1w4ts', main: 'Clicking', min_elo: 0 },
  { category: 'Dynamic', name: 'Pasu VP', main: 'Clicking', min_elo: 1500 },
]);
// node:sqlite hands back null-prototype rows, so compare the fields
assert.equal(pool.length, 2);
assert.equal(pool[0].category, 'Clicking');
assert.equal(pool[0].name, '1w4ts');
assert.equal(pool[1].category, 'Dynamic', 'the sub keeps its own name');
assert.equal(pool[1].main, 'Clicking', 'and rolls up into its main');

// A category held back to a rank is only drawn by brackets at or above it.
assert.deepEqual(poolFor(pool, 0).map((s) => s.name), ['1w4ts'], 'the low bracket skips it');
assert.equal(poolFor(pool, 1500).length, 2, 'the high one draws both');
// ...and a floor that would leave a bracket with nothing to play falls back to
// the whole pool rather than to a match with no scenarios in it.
assert.equal(
  poolFor([{ category: 'Clicking', name: 'x', main: 'Clicking', min_elo: 1500 }], 0).length,
  1,
  'never an empty pool',
);

// Ranks are Quorum's to move until a server says otherwise.
assert.equal(getRankMode(G), 'auto');
setConfig(G, { rank_mode: 'manual' });
assert.equal(getRankMode(G), 'manual', 'staff own the brackets once set');
setConfig(G, { rank_mode: null });

// Seeding sets the starting rating - but only for someone who hasn't played,
// or it would wipe a real record.
ensurePlayer('u1', 'fresh');
assert.equal(getPlayer('u1')!.elo, 1050, 'a new player starts flat');
assert.equal(seedPlayer('u1', 1275, 'Diamond'), true);
assert.equal(getPlayer('u1')!.elo, 1275);
assert.equal(getPlayer('u1')!.seeded_from, 'Diamond');
db.prepare('update player set wins = 3, elo = 1400 where discord_id = ?').run('u1');
assert.equal(seedPlayer('u1', 950, 'Silver'), false, 'a played record refuses a re-seed');
assert.equal(getPlayer('u1')!.elo, 1400, 'and keeps its rating');

// A seed at creation is honoured, and never moved by a later sighting.
ensurePlayer('u2', 'seeded', null, { elo: 1190, from: 'Voltaic Master' });
assert.equal(getPlayer('u2')!.elo, 1190);
ensurePlayer('u2', 'seeded-renamed', null, { elo: 850, from: 'flat' });
assert.equal(getPlayer('u2')!.elo, 1190, 'ensurePlayer never re-seeds someone it has seen');
assert.equal(getPlayer('u2')!.kovaaks_username, 'seeded-renamed', 'but it does track a rename');

// Ratings are global, the player LIST is not. Without the guild filter an
// admin of one server could read - and through seedPlayer rewrite - the record of
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

// The standing leaderboard is one page of that ladder plus a count of how many
// pages there are. The count has to be of the whole ladder, not of the page in
// hand, or the last page draws a Next button with nothing behind it.
for (let n = 0; n < 12; n++) {
  ensurePlayer(`pg${n}`, `pager${n}`, null, { elo: 1000 + n, from: 'flat' });
  db.prepare(
    "insert into match (id, guild_id, channel_id, host_id, format, status) values (?,'gpage','c',?,'1v1','done')",
  ).run(300 + n, `pg${n}`);
  db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(300 + n, `pg${n}`);
}
db.prepare("update player set wins = 1 where discord_id like 'pg%'").run();

assert.equal(ladderSize('gpage'), 12, 'every ranked player is counted, page or no page');
assert.equal(ladderSize('gA'), 1, "and only the players who have been in it");
const page1 = leaderboard('gpage', 10, 0);
const page2 = leaderboard('gpage', 10, 10);
assert.equal(page1.length, 10);
assert.equal(page2.length, 2, 'the last page is however much is left');
assert.equal(page1[0].discord_id, 'pg11', 'highest rated first');
assert.deepEqual(
  page2.map((p) => p.discord_id),
  ['pg1', 'pg0'],
  'and the second page carries on where the first stopped',
);

// Channels follow the ladder exactly as roles do: a surviving rank keeps its
// channels across a rewrite, a removed one hands them back to be deleted.
const [keepId, dropId] = getRanks('gc').slice(0, 2).map((r) => r.id);
setRankChannels(keepId, { queue: 'ch-keep' });
setRankChannels(dropId, { queue: 'ch-drop' });
const rewritten = setRanks('gc', [
  { id: keepId, name: 'Renamed', min_elo: 1400, color: '#ffffff' },
  { name: 'Brand New', min_elo: 0, color: '#000000' },
]);
const kept = rewritten.ranks.find((r) => r.name === 'Renamed')!;
assert.equal(rankChannels(kept).queue, 'ch-keep', 'a renamed rank keeps its channel');
assert.deepEqual(
  rankChannels(rewritten.ranks.find((r) => r.name === 'Brand New')!),
  {},
  'a new rank starts with none',
);
assert.ok(
  rewritten.orphaned.some((r) => rankChannels(r).queue === 'ch-drop'),
  'a deleted rank hands its channels back for cleanup',
);

// The saved spread is the only thing that decides the gate: a rank channel is
// made visible to exactly the roles it admits, so the two cannot disagree.
setRankSpread('gc', { '1v1': 2 });
assert.deepEqual(getRankSpread('gc'), { '1v1': 2 }, 'stored spread applies');
setRankSpread('gc', { '1v1': 0 });
assert.equal(getRankSpread('gc')['1v1'], 0, 'and a per-format spread is kept per format');
// a format that is turned off is not carried back in from a stored spread
setRankSpread('gc', { '1v1': 1, '2v2': 3 });
assert.deepEqual(getRankSpread('gc'), { '1v1': 1 }, 'only live formats come back');

// The format's knobs: clamped on the way out, and only the known keys survive
// the trip in - the patch comes off the wire.
{
  const shipped = getFormat('gf');
  assert.equal(shipped.rounds, 3);
  assert.equal(shipped.runs, 3);
  assert.equal(setFormat('gf', { runs: 5 }).runs, 5, 'a value in bounds is kept');
  assert.equal(setFormat('gf', { runs: 99 }).runs, 3, 'out of bounds falls back to the default');
  assert.equal(getFormat('gf').rounds, 3, 'and the rest of the format is untouched');
  // junk keys, and a patch that is not even an object, must not reach the column
  setFormat('gf', { pickPool: 4, nonsense: 'x' } as never);
  setFormat('gf', 'oops' as never);
  assert.deepEqual(Object.keys(getFormat('gf')).sort(), Object.keys(shipped).sort());
  assert.equal(getFormat('gf').pickPool, 4, 'the real key still landed');
  assert.ok(!(getConfig('gf').format_cfg ?? '').includes('nonsense'), 'nothing else is stored');
}

// The claim behind startMatch and finishMatch. Force-finish, the last Done and
// the clock can all reach the same match, each holding a row that went stale
// while it awaited - so the transition, not the read, is what decides. Second
// caller gets nothing, and the game is scored once.
db.prepare(
  "insert into match (id, guild_id, channel_id, host_id, format, status) values (93,'gA','c','inA','1v1','live')",
).run();
const claim = () =>
  Number(
    db
      .prepare("update match set status = 'done', ended_at = ? where id = ? and status = 'live'")
      .run(Date.now(), 93).changes,
  );
assert.equal(claim(), 1, 'the first caller wins the match');
assert.equal(claim(), 0, 'the second has nothing to score');

// Head-to-head and recent form, off the rows a finished match already writes.
{
  const seed = (id: number, ended: number, aPlace: number | null, bPlace: number | null) => {
    db.prepare(
      "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (?,'gh','c','h1','1v1','done',?)",
    ).run(id, ended);
    db.prepare(
      'insert into match_player (match_id, discord_id, team, placing, elo_before, elo_after) values (?,?,0,?,1000,?)',
    ).run(id, 'h1', aPlace, 1000 + (aPlace === 1 ? 16 : -16));
    db.prepare(
      'insert into match_player (match_id, discord_id, team, placing, elo_before, elo_after) values (?,?,1,?,1000,?)',
    ).run(id, 'h2', bPlace, 1000 + (bPlace === 1 ? 16 : -16));
  };
  seed(101, 1000, 1, 2);
  seed(102, 2000, 1, 2);
  seed(103, 3000, 2, 1);
  // a no-contest: no placings, so it is nobody's win and nobody's last game
  seed(104, 4000, null, null);
  // a third player h1 never met
  db.prepare("insert into match_player (match_id, discord_id, team, placing) values (101,'h3',1,2)").run();

  assert.deepEqual(headToHead('h1', 'h2', 'gh'), { wins: 2, losses: 1 });
  assert.deepEqual(headToHead('h2', 'h1', 'gh'), { wins: 1, losses: 2 }, 'and the other way round');
  assert.deepEqual(headToHead('h1', 'nobody', 'gh'), { wins: 0, losses: 0 }, 'never met');
  assert.deepEqual(headToHead('h1', 'h2', 'other'), { wins: 0, losses: 0 }, 'scoped to a server');

  const form = recentMatches('h1', 'gh');
  assert.deepEqual(form.map((m) => m.id), [103, 102, 101], 'newest first, no-contest left out');
  assert.equal(form[0].elo_after! - form[0].elo_before!, -16);
}

// Deleting a match hands back exactly what it paid out - rating and record
// both - and a row that was never scored has nothing to hand back.
{
  ensurePlayer('d1', 'D1');
  ensurePlayer('d2', 'D2');
  db.prepare("update player set elo = 1016, wins = 1, losses = 0 where discord_id = 'd1'").run();
  db.prepare("update player set elo = 984, wins = 0, losses = 1 where discord_id = 'd2'").run();
  db.prepare(
    "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (200,'gd','c','d1','1v1','done',5000)",
  ).run();
  db.prepare(
    'insert into match_player (match_id, discord_id, team, placing, elo_before, elo_after) values (200,?,?,?,?,?)',
  ).run('d1', 0, 1, 1000, 1016);
  db.prepare(
    'insert into match_player (match_id, discord_id, team, placing, elo_before, elo_after) values (200,?,?,?,?,?)',
  ).run('d2', 1, 2, 1000, 984);
  // a no-show: no placing, so finishMatch never moved their rating either
  ensurePlayer('d3', 'D3');
  const before3 = getPlayer('d3')!.elo;
  db.prepare("insert into match_player (match_id, discord_id, team) values (200,'d3',1)").run();

  deleteMatch(200);
  assert.equal(getPlayer('d1')!.elo, 1000, 'the winner gives the points back');
  assert.equal(getPlayer('d1')!.wins, 0, 'and the win with them');
  assert.equal(getPlayer('d2')!.elo, 1000, 'the loser gets theirs back');
  assert.equal(getPlayer('d2')!.losses, 0, 'and the loss');
  assert.equal(getPlayer('d3')!.elo, before3, 'an unscored row moves nothing');
  assert.equal(getMatch(200), undefined, 'and the match is gone');
  assert.equal(matchPlayers(200).length, 0, 'with its rows');

  // A record can never be driven negative by a delete that half-matches.
  db.prepare(
    "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (201,'gd','c','d1','1v1','done',6000)",
  ).run();
  db.prepare(
    'insert into match_player (match_id, discord_id, team, placing, elo_before, elo_after) values (201,?,?,?,?,?)',
  ).run('d1', 0, 1, 1000, 1016);
  deleteMatch(201);
  assert.equal(getPlayer('d1')!.wins, 0, 'wins floor at zero');
}

console.log('db ok');
