import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_RANK_SPREAD,
  DEFAULT_RANKS,
  BASE_ELO,
  SEED_MODES,
  type Format,
  type SeedMode,
} from './config.js';

// ponytail: node:sqlite is in the stdlib (needs --experimental-sqlite on node 22),
// so there's no db dependency and no migration tool. Swap for Postgres if this
// ever runs on more than one host.
export const db = new DatabaseSync(process.env.DB_PATH ?? 'pug.db');

// The tick loop writes while the dashboard reads, and the default rollback
// journal makes those block each other. WAL plus synchronous=normal is the
// usual pair: a power cut can lose the last transaction, never the file.
db.exec('pragma journal_mode = wal');
db.exec('pragma synchronous = normal');

db.exec(`
  create table if not exists player (
    discord_id       text primary key,
    kovaaks_username text not null,
    tier             text not null default 'intermediate',
    seeded_from      text,
    elo              integer not null default 1050,
    wins             integer not null default 0,
    losses           integer not null default 0
  );
  create table if not exists match (
    id         integer primary key autoincrement,
    guild_id   text not null,
    channel_id text not null,
    message_id text,
    host_id    text not null,
    format     text not null,
    status     text not null default 'lobby',
    scenarios  text not null default '[]',
    created_at integer not null default 0,
    started_at integer,
    ended_at   integer,
    voice_channel_id text
  );
  create table if not exists match_player (
    match_id   integer not null,
    discord_id text not null,
    team       integer not null default 0,
    done       integer not null default 0,
    scores     text not null default '{}',
    placing    integer,
    elo_before integer,
    elo_after  integer,
    primary key (match_id, discord_id)
  );
  create table if not exists guild_config (
    guild_id           text primary key,
    panel_channel_id   text,
    results_channel_id text,
    ping_role_id       text,
    rank_spread        text
  );
  create table if not exists rank (
    id       integer primary key autoincrement,
    guild_id text not null,
    name     text not null,
    min_elo  integer not null,
    color    text not null default '#ffffff',
    discord_role_id text
  );
  create table if not exists scenario (
    id       integer primary key autoincrement,
    guild_id text not null,
    category text not null,
    name     text not null
  );
`);

db.exec(`
  create index if not exists idx_match_player_discord on match_player (discord_id);
  create index if not exists idx_match_guild_status on match (guild_id, status);
`);

// ponytail: one ALTER guarded by a try beats pulling in a migration tool for
// a single added column. Drop this once no old database is left anywhere.
for (const stmt of [
  'alter table guild_config add column rank_spread text',
  'alter table player add column steam_id text',
  'alter table player add column voltaic text',
  'alter table player add column voltaic_at integer',
  'alter table rank add column channels text',
  'alter table guild_config add column split_channels integer',
  'alter table guild_config add column rank_mode text',
  // Minutes an untaken call stays up. 0 is off - calls never expire - and null
  // means the server has never said, so CALL_TTL_MS decides.
  'alter table guild_config add column call_ttl_min integer',
  // 'flat' | 'staff' | 'voltaic'. Replaces rank_mode, which decided who owned
  // the rank ROLE; the bot always owns that now, and this decides only where a
  // player's rating STARTS.
  'alter table guild_config add column seed_mode text',
  'alter table player add column seeded_from text',
  // Split mode is one shared category now, not one per rank: these are the
  // category and the results channel inside it.
  'alter table guild_config add column split_category_id text',
  'alter table guild_config add column split_results_id text',
  'alter table match add column division_role_id text',
  // Replaces voice_channel_id, which stays behind holding dead ids: sqlite can
  // drop a column but not on a database someone might still roll back.
  'alter table match add column thread_id text',
  // `scenarios` shrinks in place as bans land, so what was banned is gone by
  // the time the match ends. History wants both halves.
  'alter table match add column ban_pool text',
]) {
  try {
    db.exec(stmt);
  } catch {
    /* already there */
  }
}

/** Replacing a list is delete-then-insert, and that has to be all-or-nothing:
 *  a throw halfway leaves a server with half a ladder. It is also the fsync
 *  difference between one write and five hundred. */
function tx<T>(fn: () => T): T {
  db.exec('begin');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (err) {
    db.exec('rollback');
    throw err;
  }
}

export interface Player {
  discord_id: string;
  kovaaks_username: string;
  /** From the same KovaaK's lookup as the username - it is what the benchmark
   *  index is keyed by. Null for anyone linked before this was stored. */
  steam_id: string | null;
  /** JSON {rank, difficulty} for their Voltaic S5 standing, or null for none. */
  voltaic: string | null;
  /** Stamped even when the answer was null, so "no benchmark" isn't re-fetched
   *  on every page load. */
  voltaic_at: number | null;
  /** Where their rating was seeded from, kept only so the dashboard can say so. */
  seeded_from: string | null;
  elo: number;
  wins: number;
  losses: number;
}

export function setVoltaic(discordId: string, value: { rank: string } | null) {
  db.prepare('update player set voltaic = ?, voltaic_at = ? where discord_id = ?').run(
    value ? JSON.stringify(value) : null,
    Date.now(),
    discordId,
  );
}
export interface Match {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  host_id: string;
  format: Format;
  status: 'lobby' | 'banning' | 'live' | 'done' | 'void' | 'cancelled';
  scenarios: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  /** The match's private thread, holding exactly its players. Null when the
   *  bot couldn't make one - the match runs regardless. */
  thread_id: string | null;
  ban_pool: string | null;
  /** The division this call belongs to, in manual mode: the Discord role its
   *  opener held. Resolved once at open time, so a role change mid-lobby can't
   *  move the goalposts under people already in. Null in automatic mode. */
  division_role_id: string | null;
}

export interface GuildConfig {
  guild_id: string;
  panel_channel_id: string | null;
  results_channel_id: string | null;
  ping_role_id: string | null;
  /** JSON: how many rank bands apart a queue lets people be, per format. */
  rank_spread: string | null;
  /** 1 = a queue channel per rank per format, instead of one shared channel. */
  split_channels: number | null;
  /** 'manual' = staff hand out the division roles and the bot never touches
   *  them; a player queues with the role they hold. Default 'auto': the bot
   *  assigns roles off Elo and the gate measures rank bands. */
  /** How a new player's first rating is decided: flat | staff | voltaic. */
  seed_mode: string | null;
  /** The one category split mode puts everything in, and the results channel
   *  inside it. Both owned by Quorum: it makes them and it deletes them. */
  split_category_id: string | null;
  split_results_id: string | null;
  /** Minutes before an untaken call is binned. 0 = never, null = the default. */
  call_ttl_min: number | null;
}

export const getSeedMode = (guildId: string): SeedMode => {
  const set = getConfig(guildId).seed_mode;
  return SEED_MODES.includes(set as SeedMode) ? (set as SeedMode) : 'flat';
};

/** The parsed gate, falling back to the defaults for anything unset or junk.
 *
 *  This is the only thing that decides who may queue with whom, and a rank
 *  channel is made visible to exactly the roles it admits - so what the
 *  dashboard says and what the channel shows are the same answer. */
export function getRankSpread(guildId: string): Record<Format, number> {
  const config = getConfig(guildId);
  const raw = config.rank_spread;
  let saved: Record<string, unknown> = {};
  try {
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* corrupt column falls back to the defaults rather than 500ing the page */
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_RANK_SPREAD).map(([format, fallback]) => {
      const value = Math.trunc(Number(saved[format]));
      return [format, Number.isFinite(value) && value >= 0 && value <= 6 ? value : fallback];
    }),
  ) as Record<Format, number>;
}

export function setRankSpread(guildId: string, spread: Record<string, number>) {
  setConfig(guildId, { rank_spread: JSON.stringify(spread) });
  return getRankSpread(guildId);
}

export interface Rank {
  id: number;
  guild_id: string;
  name: string;
  min_elo: number;
  color: string;
  discord_role_id: string | null;
  /** JSON {category, "1v1", "2v2", group, results} of Discord channel ids, for
   *  servers running a queue channel per rank. Null when they aren't. */
  channels: string | null;
}

/** What a rank owns in Discord. `queue` is the rank's own channel, holding one
 *  panel with every format's button. The rest is the old shape - a category and
 *  a channel per format per rank - kept only so a sync can still find those and
 *  delete them. */
export type RankChannels = Partial<Record<'queue' | 'category' | 'results' | Format, string>>;

export function rankChannels(rank: Rank): RankChannels {
  try {
    return rank.channels ? (JSON.parse(rank.channels) as RankChannels) : {};
  } catch {
    return {};
  }
}

export function setRankChannels(rankId: number, channels: RankChannels) {
  db.prepare('update rank set channels = ? where id = ?').run(
    Object.keys(channels).length ? JSON.stringify(channels) : null,
    rankId,
  );
}

export function getConfig(guildId: string): GuildConfig {
  return (
    (db.prepare('select * from guild_config where guild_id = ?').get(guildId) as
      | GuildConfig
      | undefined) ?? {
      guild_id: guildId,
      panel_channel_id: null,
      results_channel_id: null,
      ping_role_id: null,
      rank_spread: null,
      split_channels: null,
      seed_mode: null,
      split_category_id: null,
      split_results_id: null,
      call_ttl_min: null,
    }
  );
}

export function setConfig(guildId: string, patch: Partial<Omit<GuildConfig, 'guild_id'>>) {
  const next = { ...getConfig(guildId), ...patch };
  db.prepare(
    `insert into guild_config
       (guild_id, panel_channel_id, results_channel_id, ping_role_id,
        rank_spread, split_channels, seed_mode, call_ttl_min,
        split_category_id, split_results_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(guild_id) do update set
       panel_channel_id = excluded.panel_channel_id,
       results_channel_id = excluded.results_channel_id,
       ping_role_id = excluded.ping_role_id,
       rank_spread = excluded.rank_spread,
       split_channels = excluded.split_channels,
       seed_mode = excluded.seed_mode,
       call_ttl_min = excluded.call_ttl_min,
       split_category_id = excluded.split_category_id,
       split_results_id = excluded.split_results_id`,
  ).run(
    guildId,
    next.panel_channel_id,
    next.results_channel_id,
    next.ping_role_id,
    next.rank_spread,
    next.split_channels,
    next.seed_mode,
    next.call_ttl_min,
    next.split_category_id,
    next.split_results_id,
  );
  return next;
}

/** A server's rank ladder, highest first. Seeded from DEFAULT_RANKS on first
 *  read so a fresh server is never rankless, then owned by the dashboard. */
export function getRanks(guildId: string): Rank[] {
  const rows = db
    .prepare('select * from rank where guild_id = ? order by min_elo desc')
    .all(guildId) as unknown as Rank[];
  if (rows.length) return rows;
  for (const r of DEFAULT_RANKS) {
    db.prepare('insert into rank (guild_id, name, min_elo, color) values (?, ?, ?, ?)').run(
      guildId,
      r.name,
      r.min_elo,
      r.color,
    );
  }
  return db
    .prepare('select * from rank where guild_id = ? order by min_elo desc')
    .all(guildId) as unknown as Rank[];
}

/** Replaces the whole ladder in one go - the dashboard always sends the full
 *  list, which is far less code than per-row add/edit/delete endpoints and
 *  can't leave the ladder half-updated. Returns the roles no longer wanted so
 *  the caller can delete them in Discord. */
export function setRanks(
  guildId: string,
  ranks: { id?: number; name: string; min_elo: number; color: string }[],
) {
  const before = getRanks(guildId);
  const keptIds = new Set(ranks.map((r) => r.id).filter(Boolean));
  // Anything the removed rank left behind in Discord, not just its role - a
  // rank with channels and no role would otherwise leak them forever.
  const orphaned = before.filter((r) => !keptIds.has(r.id) && (r.discord_role_id || r.channels));

  const insert = db.prepare(
    `insert into rank (guild_id, name, min_elo, color, discord_role_id, channels)
     values (?, ?, ?, ?, ?, ?)`,
  );
  tx(() => {
    db.prepare('delete from rank where guild_id = ?').run(guildId);
    for (const r of ranks) {
      const previous = before.find((b) => b.id === r.id);
      insert.run(
        guildId,
        r.name,
        r.min_elo,
        r.color,
        previous?.discord_role_id ?? null,
        previous?.channels ?? null,
      );
    }
  });
  return { ranks: getRanks(guildId), orphaned };
}

export function setRankRole(rankId: number, roleId: string | null) {
  db.prepare('update rank set discord_role_id = ? where id = ?').run(roleId, rankId);
}

/** The scenario pool, seeded from DEFAULT_CATEGORIES then owned by the dashboard. */
export function getScenarios(guildId: string) {
  const read = () =>
    db.prepare('select category, name from scenario where guild_id = ? order by id').all(guildId) as
      | unknown as { category: string; name: string }[];
  const rows = read();
  if (rows.length) return rows;
  for (const [category, names] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const name of names) {
      db.prepare('insert into scenario (guild_id, category, name) values (?, ?, ?)').run(
        guildId,
        category,
        name,
      );
    }
  }
  return read();
}

export function setScenarios(guildId: string, rows: { category: string; name: string }[]) {
  const insert = db.prepare('insert into scenario (guild_id, category, name) values (?, ?, ?)');
  tx(() => {
    db.prepare('delete from scenario where guild_id = ?').run(guildId);
    for (const r of rows) insert.run(guildId, r.category, r.name);
  });
  return getScenarios(guildId);
}

/** Everything still in play in one server - the dashboard's match list. */
export function listOpenMatches(guildId: string) {
  return db
    .prepare(
      "select * from match where guild_id = ? and status in ('lobby', 'banning', 'live') order by id desc",
    )
    .all(guildId) as unknown as Match[];
}

/** Everyone who has been in a match in THIS server.
 *
 *  Ratings are global by design - one Elo across every server - but the list
 *  is not: without the guild filter, an admin of one server could read, and
 *  through seedPlayer rewrite, the record of players who have never set foot
 *  in it. Anyone linked but not yet queued here is reachable via `/pug seed`,
 *  which Discord already scopes to the server it was run in. */
export function playersInGuild(guildId: string) {
  return db
    .prepare(
      `select p.* from player p
       where exists (
         select 1 from match_player mp join match m on m.id = mp.match_id
         where mp.discord_id = p.discord_id and m.guild_id = ?
       )
       order by p.elo desc`,
    )
    .all(guildId) as unknown as Player[];
}

/** Moves an unplayed player's starting rating. Once someone has played, their
 *  record is the truth - re-seeding then would wipe it, so it does nothing. */
export function seedPlayer(discordId: string, elo: number, from: string) {
  const p = getPlayer(discordId);
  if (!p || p.wins + p.losses > 0) return false;
  db.prepare('update player set elo = ?, seeded_from = ? where discord_id = ?').run(
    Math.round(elo),
    from,
    discordId,
  );
  return true;
}
export interface MatchPlayer {
  match_id: number;
  discord_id: string;
  team: number;
  done: number;
  scores: string;
  placing: number | null;
  elo_before: number | null;
  elo_after: number | null;
}

export function getPlayer(discordId: string) {
  return db.prepare('select * from player where discord_id = ?').get(discordId) as
    | Player
    | undefined;
}

/** Upserts on first sighting at the rating the caller worked out. Later calls only
 *  refresh the KovaaK's name (it can be renamed) - never the Elo. */
export function ensurePlayer(
  discordId: string,
  kovaaksUsername: string,
  steamId: string | null = null,
  seed: { elo: number; from: string } = { elo: BASE_ELO, from: 'flat' },
) {
  const existing = getPlayer(discordId);
  if (existing) {
    // Both can change under us - a rename, or a steam id we only learned later
    // - but never the Elo.
    if (existing.kovaaks_username !== kovaaksUsername || (steamId && existing.steam_id !== steamId)) {
      db.prepare('update player set kovaaks_username = ?, steam_id = ? where discord_id = ?').run(
        kovaaksUsername,
        steamId ?? existing.steam_id,
        discordId,
      );
      return getPlayer(discordId)!;
    }
    return existing;
  }
  db.prepare(
    `insert into player (discord_id, kovaaks_username, steam_id, elo, seeded_from)
     values (?, ?, ?, ?, ?)`,
  ).run(discordId, kovaaksUsername, steamId, Math.round(seed.elo), seed.from);
  return getPlayer(discordId)!;
}

export function getMatch(id: number) {
  return db.prepare('select * from match where id = ?').get(id) as Match | undefined;
}

export function matchPlayers(matchId: number) {
  return db
    .prepare('select * from match_player where match_id = ? order by rowid')
    .all(matchId) as unknown as MatchPlayer[];
}

/** Finished matches, newest first, with everyone who played them. Two queries
 *  for the whole page rather than one per match - history is the one view that
 *  reads a lot of rows at once. Only 'done' counts: a cancelled or voided match
 *  was never played, and listing it as history would say it was. */
export function matchHistory(guildId: string, limit = 25) {
  const matches = db
    .prepare(
      `select * from match where guild_id = ? and status = 'done'
       order by ended_at desc, id desc limit ?`,
    )
    .all(guildId, limit) as unknown as Match[];
  if (!matches.length) return [];

  const holes = matches.map(() => '?').join(',');
  const rows = db
    .prepare(
      `select mp.*, p.kovaaks_username from match_player mp
       join player p on p.discord_id = mp.discord_id
       where mp.match_id in (${holes})
       order by mp.placing, mp.rowid`,
    )
    .all(...matches.map((m) => m.id)) as unknown as (MatchPlayer & {
    kovaaks_username: string;
  })[];

  const byMatch = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byMatch.get(row.match_id) ?? [];
    list.push(row);
    byMatch.set(row.match_id, list);
  }
  return matches.map((m) => ({ match: m, players: byMatch.get(m.id) ?? [] }));
}

/** The overview page's numbers. Two counts here; everything else it shows the
 *  dashboard already has on the wire. */
export function guildStats(guildId: string) {
  const one = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number }).n;
  return {
    played: one("select count(*) as n from match where guild_id = ? and status = 'done'", guildId),
    week: one(
      "select count(*) as n from match where guild_id = ? and status = 'done' and ended_at > ?",
      guildId,
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ),
    rated: one(
      `select count(*) as n from player p
       where p.wins + p.losses > 0 and exists (
         select 1 from match_player mp join match m on m.id = mp.match_id
         where mp.discord_id = p.discord_id and m.guild_id = ?
       )`,
      guildId,
    ),
  };
}

/** Everything a server configured, and nothing that belongs to a player.
 *
 *  Ratings are global and a finished match is the record of games people
 *  actually played, so both outlive the bot's stay - deleting them would edit
 *  other servers' ladders from here. */
export function purgeGuild(guildId: string) {
  tx(() => {
    for (const table of ['guild_config', 'rank', 'scenario']) {
      db.prepare(`delete from ${table} where guild_id = ?`).run(guildId);
    }
  });
}

export function leaderboard(guildId: string, limit = 20) {
  return db
    .prepare(
      `select p.* from player p
       where p.wins + p.losses > 0 and exists (
         select 1 from match_player mp join match m on m.id = mp.match_id
         where mp.discord_id = p.discord_id and m.guild_id = ?
       )
       order by p.elo desc, p.wins desc limit ?`,
    )
    .all(guildId, limit) as unknown as Player[];
}
