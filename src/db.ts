import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_RANKS,
  TIER_SEED,
  type Format,
  type Tier,
} from './config.js';

// ponytail: node:sqlite is in the stdlib (needs --experimental-sqlite on node 22),
// so there's no db dependency and no migration tool. Swap for Postgres if this
// ever runs on more than one host.
export const db = new DatabaseSync(process.env.DB_PATH ?? 'pug.db');

db.exec(`
  create table if not exists player (
    discord_id       text primary key,
    kovaaks_username text not null,
    tier             text not null default 'intermediate',
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
    voice_category_id  text,
    ping_role_id       text
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

export interface Player {
  discord_id: string;
  kovaaks_username: string;
  tier: Tier;
  elo: number;
  wins: number;
  losses: number;
}
export interface Match {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  host_id: string;
  format: Format;
  status: 'lobby' | 'live' | 'done' | 'cancelled';
  scenarios: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  voice_channel_id: string | null;
}

export interface GuildConfig {
  guild_id: string;
  panel_channel_id: string | null;
  results_channel_id: string | null;
  voice_category_id: string | null;
  ping_role_id: string | null;
}

export interface Rank {
  id: number;
  guild_id: string;
  name: string;
  min_elo: number;
  color: string;
  discord_role_id: string | null;
}

export function getConfig(guildId: string): GuildConfig {
  return (
    (db.prepare('select * from guild_config where guild_id = ?').get(guildId) as
      | GuildConfig
      | undefined) ?? {
      guild_id: guildId,
      panel_channel_id: null,
      results_channel_id: null,
      voice_category_id: null,
      ping_role_id: null,
    }
  );
}

export function setConfig(guildId: string, patch: Partial<Omit<GuildConfig, 'guild_id'>>) {
  const next = { ...getConfig(guildId), ...patch };
  db.prepare(
    `insert into guild_config
       (guild_id, panel_channel_id, results_channel_id, voice_category_id, ping_role_id)
     values (?, ?, ?, ?, ?)
     on conflict(guild_id) do update set
       panel_channel_id = excluded.panel_channel_id,
       results_channel_id = excluded.results_channel_id,
       voice_category_id = excluded.voice_category_id,
       ping_role_id = excluded.ping_role_id`,
  ).run(
    guildId,
    next.panel_channel_id,
    next.results_channel_id,
    next.voice_category_id,
    next.ping_role_id,
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
  const orphaned = before.filter((r) => !keptIds.has(r.id) && r.discord_role_id);

  db.prepare('delete from rank where guild_id = ?').run(guildId);
  for (const r of ranks) {
    const previous = before.find((b) => b.id === r.id);
    db.prepare(
      'insert into rank (guild_id, name, min_elo, color, discord_role_id) values (?, ?, ?, ?, ?)',
    ).run(guildId, r.name, r.min_elo, r.color, previous?.discord_role_id ?? null);
  }
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
  db.prepare('delete from scenario where guild_id = ?').run(guildId);
  for (const r of rows) {
    db.prepare('insert into scenario (guild_id, category, name) values (?, ?, ?)').run(
      guildId,
      r.category,
      r.name,
    );
  }
  return getScenarios(guildId);
}

/** Everything still in play in one server - the dashboard's match list. */
export function listOpenMatches(guildId: string) {
  return db
    .prepare(
      "select * from match where guild_id = ? and status in ('lobby', 'live') order by id desc",
    )
    .all(guildId) as unknown as Match[];
}

export function listPlayers() {
  return db
    .prepare('select * from player order by elo desc')
    .all() as unknown as Player[];
}

export function setTier(discordId: string, tier: Tier) {
  const p = getPlayer(discordId);
  if (!p) return;
  // Re-seeding Elo would wipe a played record, so it only moves someone who
  // hasn't played yet.
  if (p.wins + p.losses === 0) {
    db.prepare('update player set tier = ?, elo = ? where discord_id = ?').run(
      tier,
      TIER_SEED[tier],
      discordId,
    );
  } else {
    db.prepare('update player set tier = ? where discord_id = ?').run(tier, discordId);
  }
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

/** Upserts on first sighting, seeding Elo from the tier. Later calls only
 *  refresh the KovaaK's name (it can be renamed) - never the Elo. */
export function ensurePlayer(discordId: string, kovaaksUsername: string, tier: Tier = 'intermediate') {
  const existing = getPlayer(discordId);
  if (existing) {
    if (existing.kovaaks_username !== kovaaksUsername) {
      db.prepare('update player set kovaaks_username = ? where discord_id = ?').run(
        kovaaksUsername,
        discordId,
      );
      existing.kovaaks_username = kovaaksUsername;
    }
    return existing;
  }
  db.prepare(
    'insert into player (discord_id, kovaaks_username, tier, elo) values (?, ?, ?, ?)',
  ).run(discordId, kovaaksUsername, tier, TIER_SEED[tier]);
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

export function leaderboard(limit = 20) {
  return db
    .prepare(
      'select * from player where wins + losses > 0 order by elo desc, wins desc limit ?',
    )
    .all(limit) as unknown as Player[];
}
