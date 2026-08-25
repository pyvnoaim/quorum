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
  resetRatings,
  getConfig,
  getFormat,
  getRankSpread,
  guildStats,
  categoryRecord,
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
  setPlayerElo,
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
const top = ranks[0].id;
const bottom = ranks[1].id;
const pool = setScenarios(G, [
  { category: 'Clicking', name: '1w4ts', main: 'Clicking', rank_ids: null },
  { category: 'Dynamic', name: 'Pasu VP', main: 'Clicking', rank_ids: [top] },
]);
// node:sqlite hands back null-prototype rows, so compare the fields
assert.equal(pool.length, 2);
assert.equal(pool[0].category, 'Clicking');
assert.equal(pool[0].name, '1w4ts');
assert.equal(pool[1].category, 'Dynamic', 'the sub keeps its own name');
assert.equal(pool[1].main, 'Clicking', 'and rolls up into its main');

// A category offered to named brackets is drawn by those and nobody else.
assert.deepEqual(pool[1].rank_ids, [top], 'the picked ranks survive the round trip');
assert.deepEqual(poolFor(pool, bottom).map((s) => s.name), ['1w4ts'], 'a bracket not named skips it');
assert.equal(poolFor(pool, top).length, 2, 'the one named draws both');
assert.deepEqual(poolFor(pool).map((s) => s.name), ['1w4ts'], 'no bracket takes the open rows');
// ...and a pool where nothing is offered to this bracket falls back to all of
// it rather than to a match with no scenarios in it.
assert.equal(
  poolFor([{ category: 'Clicking', name: 'x', main: 'Clicking', rank_ids: [top] }], bottom).length,
  1,
  'never an empty pool',
);

// Editing the ladder rewrites its rows, so a category named to a bracket has
// to follow its rank to the new id. Without that, changing one Elo floor
// silently empties every restricted category out of the pool.
{
  const moved = setRanks(G, [
    { id: ranks[0].id, name: 'Legend', min_elo: 1450, color: '#ff0000' },
    { id: ranks[1].id, name: 'Rookie', min_elo: 0, color: '#00ff00' },
  ]).ranks;
  assert.notEqual(moved[0].id, top, 'the rewrite really does re-issue ids');
  assert.deepEqual(
    getScenarios(G).find((s) => s.name === 'Pasu VP')!.rank_ids,
    [moved[0].id],
    'and the category came with it',
  );
  // A bracket that was deleted takes its claim with it rather than leaving a
  // dangling id behind, and a category left with none is open to everyone.
  const gone = setRanks(G, [{ id: moved[1].id, name: 'Rookie', min_elo: 0, color: '#00ff00' }]).ranks;
  assert.equal(getScenarios(G).find((s) => s.name === 'Pasu VP')!.rank_ids, null);
  assert.equal(poolFor(getScenarios(G), gone[0].id).length, 2, 'so it is back in the pool');
}

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

// The other half of the same job: correcting a rating that HAS been played for.
// u1 is sitting on 3 wins and 1400 from the re-seed refusal just above, which is
// exactly the row seeding will not touch and this one has to.
{
  const moved = setPlayerElo('u1', 1120);
  assert.deepEqual(moved, { name: 'fresh', was: 1400, now: 1120 }, 'it reports what it moved');
  assert.equal(getPlayer('u1')!.elo, 1120, 'the rating moves');
  assert.equal(getPlayer('u1')!.wins, 3, 'and the record that earned it does not');
  assert.equal(getPlayer('u1')!.seeded_from, 'Diamond', 'nor where they started');
  assert.equal(setPlayerElo('u1', 1120.6)!.now, 1121, 'and a fraction is rounded to a rating');
  assert.equal(setPlayerElo('nobody', 1000), null, 'a stranger is not moved into existence');
}

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
  // ...and one on h1's own side, who is not an opponent whatever the result
  db.prepare("insert into match_player (match_id, discord_id, team, placing) values (102,'h4',0,1)").run();
  for (const [id, name] of [['h1', 'One'], ['h2', 'Two'], ['h3', 'Three'], ['h4', 'Four']]) {
    ensurePlayer(id, name);
  }

  assert.deepEqual(headToHead('h1', 'h2', 'gh'), { wins: 2, losses: 1 });
  assert.deepEqual(headToHead('h2', 'h1', 'gh'), { wins: 1, losses: 2 }, 'and the other way round');
  assert.deepEqual(headToHead('h1', 'nobody', 'gh'), { wins: 0, losses: 0 }, 'never met');
  assert.deepEqual(headToHead('h1', 'h2', 'other'), { wins: 0, losses: 0 }, 'scoped to a server');

  const form = recentMatches('h1', 'gh');
  assert.deepEqual(form.map((m) => m.id), [103, 102, 101], 'newest first, no-contest left out');
  assert.equal(form[0].elo_after! - form[0].elo_before!, -16);
  // Who was on the other side, and only them: a team-mate is not an opponent.
  assert.deepEqual(
    form.find((m) => m.id === 101)!.opponents.map((o) => o.name).sort(),
    ['Three', 'Two'],
    'everyone on the other side',
  );
  assert.deepEqual(
    form.find((m) => m.id === 102)!.opponents.map((o) => o.name),
    ['Two'],
    'and nobody on their own',
  );
}

// Rounds by category: won where their side took the scenario, and filed under
// the main the pool says it belongs to.
{
  const C = 'gc';
  setScenarios(C, [
    { category: 'Static', name: 'Click1', main: 'Clicking', rank_ids: null },
    { category: 'Tracking', name: 'Track1', main: 'Tracking', rank_ids: null },
    { category: 'Switching', name: 'Sw1', main: 'Switching', rank_ids: null },
    { category: 'Clicking', name: 'Gone', main: 'Clicking', rank_ids: null },
  ]);
  const runs = getFormat(C).runs;
  const played = (score: number) => JSON.stringify({ Click1: score, Track1: score, Sw1: score });
  const counts = JSON.stringify({ Click1: runs, Track1: runs, Sw1: runs });
  const seed = (id: number, ranked: number, a: string, b: string) => {
    db.prepare(
      `insert into match (id, guild_id, channel_id, host_id, format, status, ended_at, scenarios, ranked)
       values (?,'gc','c','c1','1v1','done',?,'["Click1","Track1","Sw1"]',?)`,
    ).run(id, id, ranked);
    db.prepare(
      'insert into match_player (match_id, discord_id, team, placing, scores, run_counts) values (?,?,?,?,?,?)',
    ).run(id, 'c1', 0, 1, a, counts);
    db.prepare(
      'insert into match_player (match_id, discord_id, team, placing, scores, run_counts) values (?,?,?,?,?,?)',
    ).run(id, 'c2', 1, 2, b, counts);
  };
  // c1 takes every round of the first, c2 takes every round of the second, and
  // the third is a dead level draw - nobody's round.
  seed(400, 1, played(100), played(50));
  seed(401, 1, played(50), played(100));
  seed(402, 1, played(70), played(70));
  // ...and an unranked game moves nothing here either, the same as the W/L it
  // never wrote.
  seed(403, 0, played(100), played(10));

  assert.deepEqual(categoryRecord('c1', C), [
    { main: 'Clicking', won: 1, lost: 1 },
    { main: 'Tracking', won: 1, lost: 1 },
    { main: 'Switching', won: 1, lost: 1 },
  ]);
  assert.deepEqual(categoryRecord('c2', C), [
    { main: 'Clicking', won: 1, lost: 1 },
    { main: 'Tracking', won: 1, lost: 1 },
    { main: 'Switching', won: 1, lost: 1 },
  ], 'and the other side reads the mirror of it');
  assert.deepEqual(categoryRecord('c1', 'elsewhere'), [], 'scoped to a server');

  // A scenario dropped from the pool has no main left to file under, so its
  // rounds are left out rather than guessed at.
  setScenarios(C, [{ category: 'Static', name: 'Click1', main: 'Clicking', rank_ids: null }]);
  assert.deepEqual(categoryRecord('c1', C), [{ main: 'Clicking', won: 1, lost: 1 }]);
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

// A season reset: standings start over, the matches that made them do not.
{
  db.prepare(
    "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (900,'gr','c','r1','1v1','done',7000)",
  ).run();
  ensurePlayer('r1', 'R1');
  db.prepare(
    'insert into match_player (match_id, discord_id, team, placing) values (900,?,0,1)',
  ).run('r1');
  db.prepare("update player set elo = 1400, wins = 9, losses = 2, seeded_from = 'Legend' where discord_id = 'r1'").run();

  // Someone who also plays in another server keeps everything: the rating is
  // one global row, and this server's new season is not that server's.
  ensurePlayer('r2', 'R2');
  db.prepare(
    "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (901,'gr','c','r2','1v1','done',7000)",
  ).run();
  db.prepare(
    "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (902,'elsewhere','c','r2','1v1','done',7000)",
  ).run();
  for (const id of [901, 902]) {
    db.prepare(
      'insert into match_player (match_id, discord_id, team, placing) values (?,?,0,1)',
    ).run(id, 'r2');
  }
  db.prepare("update player set elo = 1300, wins = 4 where discord_id = 'r2'").run();

  assert.deepEqual(resetRatings('gr'), { reset: ['r1'], shared: 1 }, 'only the ones who play here alone');
  assert.equal(getPlayer('r2')!.elo, 1300, "another server's ladder is not this admin's to wipe");
  assert.equal(getPlayer('r2')!.wins, 4, 'record included');
  const back = getPlayer('r1')!;
  assert.equal(back.elo, 1050, 'back to the starting rating');
  assert.equal(back.wins + back.losses, 0, 'and unplayed again');
  assert.equal(back.seeded_from, null, 'so a starting rank can be set afresh');
  assert.ok(getMatch(900), 'the match itself stays - it is the record, not the rating');
  assert.deepEqual(resetRatings('gone'), { reset: [], shared: 0 }, 'a server with nobody resets nobody');

  // One player at a time, under the same rules: the shared one stays put.
  db.prepare("update player set elo = 1200, wins = 3 where discord_id = 'r1'").run();
  assert.deepEqual(resetRatings('gr', 'r1'), { reset: ['r1'], shared: 0 }, 'just that one');
  assert.equal(getPlayer('r1')!.elo, 1050, 'and only that one moved');
  assert.deepEqual(resetRatings('gr', 'r2'), { reset: [], shared: 1 }, 'not one who plays elsewhere');
  assert.equal(getPlayer('r2')!.elo, 1300, 'left exactly as it was');
  assert.deepEqual(resetRatings('gr', 'nobody'), { reset: [], shared: 0 }, 'nor a stranger');

  // Back to where they STARTED, not to the flat rating. Someone wearing an
  // Intermediate role starts at Intermediate's floor - and a reset that dropped
  // them on BASE_ELO left them two divisions above the role they still had on,
  // with nothing to put it right: seedFor only seeds a player it has never seen,
  // so the row surviving the reset meant nothing re-seeded them, ever.
  db.prepare("update player set elo = 900, wins = 4 where discord_id = 'r1'").run();
  resetRatings('gr', 'r1', new Map([['r1', { elo: 400, from: 'Intermediate' }]]));
  const reseeded = getPlayer('r1')!;
  assert.equal(reseeded.elo, 400, 'the division floor, not 1050');
  assert.equal(reseeded.seeded_from, 'Intermediate', 'and the row says where that came from');
  assert.equal(reseeded.wins, 0, 'still unplayed again');

  // Nobody in the map is still the flat rating - a server on flat seeding, or a
  // player wearing no division role at all.
  db.prepare("update player set elo = 900 where discord_id = 'r1'").run();
  resetRatings('gr', 'r1', new Map());
  assert.equal(getPlayer('r1')!.elo, 1050, 'unplaced falls back to flat');
  assert.equal(getPlayer('r1')!.seeded_from, null);
}

// A panel counts the channel it sits in, not the whole server - the same
// number under every bracket's panel was the bug.
{
  for (const [id, chan, ended] of [
    [910, 'novice', 8000],
    [911, 'novice', 9000],
    [912, 'elite', 9000],
  ] as [number, string, number][]) {
    db.prepare(
      "insert into match (id, guild_id, channel_id, host_id, format, status, ended_at) values (?,'gs',?,'p1','1v1','done',?)",
    ).run(id, chan, Date.now() - ended);
  }
  assert.equal(guildStats('gs').played, 3, 'the server has played three');
  assert.equal(guildStats('gs', 'novice').played, 2, 'novice two of them');
  assert.equal(guildStats('gs', 'elite').played, 1, 'and elite the other');
  assert.equal(guildStats('gs', 'nowhere').week, 0, 'a channel with none says none');
}

console.log('db ok');
