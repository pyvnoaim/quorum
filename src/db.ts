import { DatabaseSync } from 'node:sqlite';
import { TIER_SEED, type Format, type Tier } from './config.js';

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
    voice_category_id  text
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
    }
  );
}

export function setConfig(guildId: string, patch: Partial<Omit<GuildConfig, 'guild_id'>>) {
  const next = { ...getConfig(guildId), ...patch };
  db.prepare(
    `insert into guild_config (guild_id, panel_channel_id, results_channel_id, voice_category_id)
     values (?, ?, ?, ?)
     on conflict(guild_id) do update set
       panel_channel_id = excluded.panel_channel_id,
       results_channel_id = excluded.results_channel_id,
       voice_category_id = excluded.voice_category_id`,
  ).run(guildId, next.panel_channel_id, next.results_channel_id, next.voice_category_id);
  return next;
}
export interface MatchPlayer {
  match_id: number;
  discord_id: string;
  team: number;
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
