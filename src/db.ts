import { DatabaseSync } from 'node:sqlite';
import {
  BAN_TTL_MS,
  DEFAULT_CATEGORIES,
  DEFAULT_RANK_SPREAD,
  DEFAULT_RANKS,
  BASE_ELO,
  GRACE_MS,
  MAIN_CATEGORIES,
  MATCH_TTL_MS,
  MIN_MATCH_MS,
  PICK_POOL,
  ROUNDS,
  RUNS_PER_SCENARIO,
  SEED_MODES,
  type Format,
  type SeedMode,
} from './config.js';
// rating.ts reads nothing but config, so scoring can be reused down here
// without the two files ever pointing at each other.
import { forfeits, scenarioWinners } from './rating.js';

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
    losses           integer not null default 0,
    draws            integer not null default 0
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
  'alter table match_player add column pb text',
  'alter table match_player add column run_counts text',
  // When the first player used every run - the moment the rest of the lobby
  // goes on a clock. Null while nobody has finished, which is also every match
  // that was already live when this shipped: those keep the plain TTL.
  'alter table match add column grace_from integer',
  // The "match on" card left in the queue channel once the call moved into its
  // thread, so it can be taken down when the match ends.
  'alter table match add column notice_id text',
  // 1 = nobody can open or take a call here. Matches already running are not
  // touched: pausing is for the queue, not for a game in progress.
  'alter table guild_config add column queues_paused integer',
  'alter table guild_config add column format_cfg text',
  // Where the queue panels are, so the tick can keep their counts honest.
  'alter table guild_config add column panel_msgs text',
  // Optional: where the bot says what staff changed, so players hear about a
  // new scenario pool from the server rather than from losing a match on it.
  'alter table guild_config add column announce_channel_id text',
  // Which ranks a scenario is offered to: a JSON array of rank ids, or null
  // for every rank. Named ranks rather than a threshold, because "hard
  // switching is for Challenger and Master" is not a floor - the brackets that
  // play a thing are the brackets someone picked, and they need not be a run.
  'alter table scenario add column rank_ids text',
  // Two sides can finish a match dead level - and until this column they were
  // both written down as a win, which inflated every record it touched and made
  // a win rate a number that could exceed the games played. An existing row
  // defaults to 0: matches already drawn stay counted the old way rather than
  // being guessed at, and only a draw from here is recorded as one.
  'alter table player add column draws integer not null default 0',
  // 0 = played for nothing. The scores are still read, still posted and still
  // kept, but no rating moves and no W/L is written - so somebody staff have
  // not placed yet can play, and be judged on what they actually scored. Every
  // match that existed before this was rated, hence the default.
  'alter table match add column ranked integer not null default 1',
  // The unranked queue's channel. Its own, and not one of the bracket channels:
  // those are private to their roles, so the players this queue exists for -
  // the ones with no role yet - can see none of them.
  'alter table guild_config add column split_unranked_id text',
  // 1 = run an unranked queue alongside the brackets. Off by default and off
  // on every server that upgrades into it: it means a channel appearing, and a
  // channel nobody asked for is not a thing to hand somebody on a redeploy.
  'alter table guild_config add column unranked_enabled integer',
  // Which of the three fixed mains a category rolls up into. A category named
  // after a main is its own main; everything else is a subcategory of one.
  'alter table scenario add column main text',
  // Optional: the one role the Quorum category shows to. Null = the whole
  // server sees it.
  'alter table guild_config add column visible_role_id text',
  // Optional: a channel holding one standing leaderboard message, and the id of
  // that message so the tick can edit it rather than post a second one.
  'alter table guild_config add column leaderboard_channel_id text',
  'alter table guild_config add column leaderboard_msg_id text',
]) {
  try {
    db.exec(stmt);
  } catch {
    /* already there */
  }
}

// Backfill, not part of the ALTER above: the ALTER throws once the column is
// there, which would skip this on every boot but the first. Idempotent, and it
// only ever touches rows written before the column existed.
db.exec(
  `update scenario set main = case
     when category in ('Clicking', 'Tracking', 'Switching') then category
     else 'Switching'
   end
   where main is null`,
);

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
  /** Matches that ended dead level. Not a loss and not a win: scoring is by
   *  placing, so two sides can genuinely share first. */
  draws: number;
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
  /** When the first player used every run on every scenario, opening the grace
   *  window for everyone else. Null until somebody does. */
  grace_from: number | null;
  /** The card left where the call was, saying a match is on. Null before the
   *  match starts, and where there is no thread to move into. */
  notice_id: string | null;
  /** The match's private thread, holding exactly its players. Null when the
   *  bot couldn't make one - the match runs regardless. */
  thread_id: string | null;
  ban_pool: string | null;
  /** The division this call belongs to, in manual mode: the Discord role its
   *  opener held. Resolved once at open time, so a role change mid-lobby can't
   *  move the goalposts under people already in. Null in automatic mode. */
  division_role_id: string | null;
  /** 0 = nothing is at stake. Scores are read and kept exactly as they are for
   *  a rated match, but no Elo moves and no W/L is written - which is what lets
   *  a player staff have not placed yet get a game at all. */
  ranked: number;
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
  rank_mode: string | null;
  /** How a new player's first rating is decided: flat | staff | voltaic. */
  seed_mode: string | null;
  /** The one category split mode puts everything in, and the results channel
   *  inside it. Both owned by Quorum: it makes them and it deletes them. */
  split_category_id: string | null;
  split_results_id: string | null;
  /** The unranked queue's channel, also Quorum's own. Open to whoever can see
   *  the category rather than locked to a bracket - see syncRankChannels. */
  split_unranked_id: string | null;
  /** 1 = the unranked queue exists. Null or 0 = it does not, and its channel
   *  is removed the same way a deleted rank's is. */
  unranked_enabled: number | null;
  /** Minutes before an untaken call is binned. 0 = never, null = the default. */
  call_ttl_min: number | null;
  /** JSON: the format's own knobs - see getFormat(). Null = every default. */
  format_cfg: string | null;
  /** JSON: the panels this server has up - see getPanels(). */
  panel_msgs: string | null;
  /** 1 = queues are paused: no new calls, and no taking an open one. Live
   *  matches play on. */
  queues_paused: number | null;
  /** Where setup changes are announced. Null = don't announce. */
  announce_channel_id: string | null;
  /** Where the standing leaderboard lives, and the message it is. Null = the
   *  server doesn't want one. The message id is Quorum's, not the server's: it
   *  edits that message every tick and deletes it when the channel changes. */
  leaderboard_channel_id: string | null;
  leaderboard_msg_id: string | null;
  /** Who may see the Quorum category, and so the results channel inside it.
   *  Null = the whole server. A queue channel is private to its rank whatever
   *  this says - see syncRankChannelsToDiscord(). */
  visible_role_id: string | null;
}

/** Who owns the division roles. 'manual' means staff do: the bot never adds or
 *  removes one, so a loss can never drop somebody out of the bracket they were
 *  put in - or off the ladder entirely. Ratings still move underneath, as the
 *  evidence staff promote on. */
export const getRankMode = (guildId: string): 'auto' | 'manual' =>
  getConfig(guildId).rank_mode === 'manual' ? 'manual' : 'auto';

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

/** The knobs of the match format itself, per server. */
export interface FormatConfig {
  /** Scenarios in a match. The last one is always the random roll. */
  rounds: number;
  /** Runs counted per scenario - the best of the first this many. */
  runs: number;
  /** Candidates offered per pick, before the two bans. */
  pickPool: number;
  /** Seconds a side gets to ban or pick before the bot does it for them. */
  pickTtlS: number;
  /** Minutes before a live match force-finishes on whatever KovaaK's has. */
  matchTtlMin: number;
  /** Minutes the rest of the lobby gets once the first player has used every
   *  run. See matchDeadline(). */
  graceMin: number;
  /** Minutes a match always runs for, whatever the grace says. 0 turns the
   *  floor off and lets a fast finisher end it as early as the grace allows. */
  minMatchMin: number;
}

/** Bounds, not taste: outside these the format stops working rather than
 *  becoming a different format. Five candidates is one Discord row of buttons,
 *  and two is the fewest a ban-then-pick can start from. */
const FORMAT_BOUNDS: Record<keyof FormatConfig, [number, number]> = {
  rounds: [1, 5],
  runs: [1, 10],
  pickPool: [2, 5],
  pickTtlS: [15, 600],
  matchTtlMin: [5, 240],
  graceMin: [1, 240],
  minMatchMin: [0, 240],
};

const FORMAT_DEFAULTS: FormatConfig = {
  rounds: ROUNDS,
  runs: RUNS_PER_SCENARIO,
  pickPool: PICK_POOL,
  pickTtlS: Math.round(BAN_TTL_MS / 1000),
  matchTtlMin: Math.round(MATCH_TTL_MS / 60000),
  graceMin: Math.round(GRACE_MS / 60000),
  minMatchMin: Math.round(MIN_MATCH_MS / 60000),
};

/** The format as this server runs it, falling back to the shipped default for
 *  anything unset or out of bounds - the same shape as the rank spread, and for
 *  the same reason: a junk column must never be able to stop a match. */
export function getFormat(guildId: string): FormatConfig {
  let saved: Record<string, unknown> = {};
  try {
    const raw = getConfig(guildId).format_cfg;
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* corrupt column falls back to the defaults rather than 500ing the page */
  }
  return Object.fromEntries(
    (Object.keys(FORMAT_DEFAULTS) as (keyof FormatConfig)[]).map((key) => {
      const [lo, hi] = FORMAT_BOUNDS[key];
      const value = Math.trunc(Number(saved[key]));
      return [key, Number.isFinite(value) && value >= lo && value <= hi ? value : FORMAT_DEFAULTS[key]];
    }),
  ) as unknown as FormatConfig;
}

/** Saves whatever is in bounds and keeps what is not - getFormat is the one
 *  place that decides, so a bad number never reaches a match.
 *
 *  Only the known keys are taken: `patch` comes off the wire, and spreading it
 *  whole would let anything with a Manage Server role park arbitrary keys - or,
 *  for a string, a character per index - in the column forever. */
export function setFormat(guildId: string, patch: Partial<FormatConfig>) {
  const next = { ...getFormat(guildId) };
  for (const key of Object.keys(FORMAT_DEFAULTS) as (keyof FormatConfig)[]) {
    const value = (patch as Record<string, unknown>)?.[key];
    if (value != null) next[key] = Math.trunc(Number(value));
  }
  setConfig(guildId, { format_cfg: JSON.stringify(next) });
  return getFormat(guildId);
}

/** A panel this server has up: which message, in which channel, carrying which
 *  formats. Split mode puts one in every rank's queue channel, each with a
 *  single format, so one id would never have been enough. */
export interface PanelRef {
  channel: string;
  message: string;
  formats: Format[];
  /** false on the unranked queue's panel. Remembered rather than worked out
   *  from the channel, so the tick rewrites the panel it actually found there -
   *  refreshing every panel as a rated one would quietly turn the unranked
   *  queue into a rated one on the next minute. Absent on rows written before
   *  the unranked queue existed, which were all rated. */
  ranked?: boolean;
}

export function getPanels(guildId: string): PanelRef[] {
  try {
    const raw = getConfig(guildId).panel_msgs;
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as PanelRef[]).filter((p) => p?.channel && p?.message) : [];
  } catch {
    return [];
  }
}

/** One panel per channel: posting a new one replaces whatever was there, which
 *  is also what makes "Post panel" safe to press twice. */
export function setPanel(guildId: string, panel: PanelRef) {
  const kept = getPanels(guildId).filter((p) => p.channel !== panel.channel);
  setConfig(guildId, { panel_msgs: JSON.stringify([...kept, panel]) });
}

/** Forgets a panel whose message or channel is gone, so the tick stops chasing
 *  it every minute. */
export function dropPanel(guildId: string, channelId: string) {
  const kept = getPanels(guildId).filter((p) => p.channel !== channelId);
  setConfig(guildId, { panel_msgs: JSON.stringify(kept) });
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
      rank_mode: null,
      seed_mode: null,
      split_category_id: null,
      split_results_id: null,
      split_unranked_id: null,
      unranked_enabled: null,
      call_ttl_min: null,
      format_cfg: null,
      panel_msgs: null,
      queues_paused: null,
      announce_channel_id: null,
      visible_role_id: null,
      leaderboard_channel_id: null,
      leaderboard_msg_id: null,
    }
  );
}

export function setConfig(guildId: string, patch: Partial<Omit<GuildConfig, 'guild_id'>>) {
  const next = { ...getConfig(guildId), ...patch };
  db.prepare(
    `insert into guild_config
       (guild_id, panel_channel_id, results_channel_id, ping_role_id,
        rank_spread, split_channels, rank_mode, seed_mode, call_ttl_min,
        split_category_id, split_results_id, split_unranked_id, unranked_enabled,
        format_cfg, panel_msgs, queues_paused,
        announce_channel_id, visible_role_id, leaderboard_channel_id, leaderboard_msg_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(guild_id) do update set
       panel_channel_id = excluded.panel_channel_id,
       results_channel_id = excluded.results_channel_id,
       ping_role_id = excluded.ping_role_id,
       rank_spread = excluded.rank_spread,
       split_channels = excluded.split_channels,
       rank_mode = excluded.rank_mode,
       seed_mode = excluded.seed_mode,
       call_ttl_min = excluded.call_ttl_min,
       split_category_id = excluded.split_category_id,
       split_results_id = excluded.split_results_id,
       split_unranked_id = excluded.split_unranked_id,
       unranked_enabled = excluded.unranked_enabled,
       format_cfg = excluded.format_cfg,
       panel_msgs = excluded.panel_msgs,
       queues_paused = excluded.queues_paused,
       announce_channel_id = excluded.announce_channel_id,
       visible_role_id = excluded.visible_role_id,
       leaderboard_channel_id = excluded.leaderboard_channel_id,
       leaderboard_msg_id = excluded.leaderboard_msg_id`,
  ).run(
    guildId,
    next.panel_channel_id,
    next.results_channel_id,
    next.ping_role_id,
    next.rank_spread,
    next.split_channels,
    next.rank_mode,
    next.seed_mode,
    next.call_ttl_min,
    next.split_category_id,
    next.split_results_id,
    next.split_unranked_id,
    next.unranked_enabled,
    next.format_cfg,
    next.panel_msgs,
    next.queues_paused,
    next.announce_channel_id,
    next.visible_role_id,
    next.leaderboard_channel_id,
    next.leaderboard_msg_id,
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
    // Rewriting the rows re-issues their ids, so anything stored BY id has to
    // be carried across with them. The role and the channels come along on the
    // row itself; scenario.rank_ids is a reference from another table, and
    // leaving it behind quietly empties every bracket-restricted category out
    // of the pool - a rank edit as small as a floor would do it.
    const remap = new Map<number, number>();
    const reclaim = db.prepare('update scenario set rank_ids = ? where id = ?');
    for (const r of ranks) {
      const previous = before.find((b) => b.id === r.id);
      const { lastInsertRowid } = insert.run(
        guildId,
        r.name,
        r.min_elo,
        r.color,
        previous?.discord_role_id ?? null,
        previous?.channels ?? null,
      );
      if (r.id != null) remap.set(r.id, Number(lastInsertRowid));
    }
    for (const row of db
      .prepare('select id, rank_ids from scenario where guild_id = ? and rank_ids is not null')
      .all(guildId) as unknown as { id: number; rank_ids: string }[]) {
      // A rank that was deleted drops out rather than being kept as a dangling
      // id, and a category left with nothing goes back to being offered to all.
      const next = (parseRankIds(row.rank_ids) ?? [])
        .map((id) => remap.get(id))
        .filter((id): id is number => id != null);
      reclaim.run(next.length ? JSON.stringify(next) : null, row.id);
    }
  });
  return { ranks: getRanks(guildId), orphaned };
}

export function setRankRole(rankId: number, roleId: string | null) {
  db.prepare('update rank set discord_role_id = ? where id = ?').run(roleId, rankId);
}

/** A scenario in the pool: the category it is filed under, and the main that
 *  category rolls up into. For a category named after a main the two match. */
export interface PoolRow {
  category: string;
  name: string;
  main: string;
  /** The ranks this is offered to, by rank id, or null for every rank. Set per
   *  category in the dashboard; the rows carry it the same way they carry
   *  `main`, so one filter answers both. */
  rank_ids: number[] | null;
}

/** The scenarios a queue in this rank draws from: the ones offered to every
 *  rank, plus the ones this bracket was named in. A bracket that ends up with
 *  nothing falls back to the whole pool - a bracket with no scenarios must not
 *  be a bracket with no matches. Unknown bracket takes the unrestricted rows,
 *  since a scenario picked for two brackets should not leak into a third. */
export function poolFor(pool: PoolRow[], rankId?: number): PoolRow[] {
  const mine = pool.filter(
    (s) => !s.rank_ids?.length || (rankId != null && s.rank_ids.includes(rankId)),
  );
  return mine.length ? mine : pool;
}

/** Junk in this column reads as "every rank", which is what every row was
 *  before it existed - the pool is a list of scenarios, and a bad parse must
 *  not be a match with nothing to play. */
function parseRankIds(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const out = JSON.parse(raw);
    return Array.isArray(out) && out.length ? out.filter((n) => typeof n === 'number') : null;
  } catch {
    return null;
  }
}

/** The scenario pool, seeded from DEFAULT_CATEGORIES then owned by the dashboard. */
export function getScenarios(guildId: string): PoolRow[] {
  const read = (): PoolRow[] =>
    (
      db
        .prepare(
          'select category, name, main, rank_ids from scenario where guild_id = ? order by id',
        )
        .all(guildId) as unknown as (Omit<PoolRow, 'rank_ids'> & { rank_ids: string | null })[]
    ).map((r) => ({ ...r, rank_ids: parseRankIds(r.rank_ids) }));
  const rows = read();
  if (rows.length) return rows;
  for (const cat of DEFAULT_CATEGORIES) {
    for (const name of cat.scenarios) {
      db.prepare('insert into scenario (guild_id, category, name, main) values (?, ?, ?, ?)').run(
        guildId,
        cat.name,
        name,
        cat.main,
      );
    }
  }
  return read();
}

export function setScenarios(guildId: string, rows: PoolRow[]) {
  const insert = db.prepare(
    'insert into scenario (guild_id, category, name, main, rank_ids) values (?, ?, ?, ?, ?)',
  );
  tx(() => {
    db.prepare('delete from scenario where guild_id = ?').run(guildId);
    for (const r of rows) {
      insert.run(
        guildId,
        r.category,
        r.name,
        r.main,
        r.rank_ids?.length ? JSON.stringify(r.rank_ids) : null,
      );
    }
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
 *  in it. Anyone linked but not yet queued here is reachable via `/scrim seed`,
 *  which Discord already scopes to the server it was run in. */
/** Season reset: every rating in this server back to the start, and everyone
 *  unplayed again so the seeding rules apply to them afresh.
 *
 *  The matches stay. They are the record of what happened, which a new season
 *  does not undo - only the standings start over. Returns who was reset, so the
 *  caller can put their rank roles back where the new ratings say. */
export function resetRatings(
  guildId: string,
  only?: string,
  /** Where each player should land, by id - the same answer seeding would give
   *  if they were arriving for the first time. Anyone missing from it falls
   *  back to BASE_ELO.
   *
   *  Passed in rather than worked out here because the answer lives in Discord:
   *  with staff-owned brackets a player's starting rating is the floor of the
   *  division role they are wearing, and this file cannot see a role. Without
   *  it a reset put everyone on BASE_ELO and left them there - seedFor only
   *  ever seeds a player it has never seen, so the row surviving the reset
   *  meant nothing re-seeded them, ever. */
  seeds?: Map<string, { elo: number; from: string }>,
): { reset: string[]; shared: number } {
  // A rating is GLOBAL - one row per player, whatever server they earned it in.
  // So this resets only the people who play here and nowhere else: one server's
  // new season must not wipe another server's ladder, and the admin pressing
  // this has no authority over a server they are not in.
  const eligible = (
    db
      .prepare(
        `select p.discord_id from player p
         where exists (
           select 1 from match_player mp join match m on m.id = mp.match_id
           where mp.discord_id = p.discord_id and m.guild_id = ?
         ) and not exists (
           select 1 from match_player mp join match m on m.id = mp.match_id
           where mp.discord_id = p.discord_id and m.guild_id <> ?
         )`,
      )
      .all(guildId, guildId) as unknown as { discord_id: string }[]
  ).map((r) => r.discord_id);
  // One player or the whole server, same rules either way - a single reset is
  // the same act done to one row.
  const ids = only ? eligible.filter((id) => id === only) : eligible;
  const here = only
    ? playersInGuild(guildId).filter((p) => p.discord_id === only)
    : playersInGuild(guildId);

  const stmt = db.prepare(
    'update player set elo = ?, wins = 0, losses = 0, draws = 0, seeded_from = ? where discord_id = ?',
  );
  tx(() => {
    for (const id of ids) {
      // Back to where they STARTED, which is not the same as back to the flat
      // rating: someone wearing an Intermediate role starts at Intermediate's
      // floor, and a reset that put them on BASE_ELO handed them a rating two
      // divisions above the role they are still wearing.
      const seed = seeds?.get(id);
      stmt.run(seed ? Math.round(seed.elo) : BASE_ELO, seed?.from ?? null, id);
    }
  });
  return { reset: ids, shared: here.length - ids.length };
}

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
  // Draws count as having played. Without them a match that ended level left a
  // record seeding would happily write over.
  if (!p || p.wins + p.losses + p.draws > 0) return false;
  db.prepare('update player set elo = ?, seeded_from = ? where discord_id = ?').run(
    Math.round(elo),
    from,
    discordId,
  );
  return true;
}

/** Moves a rating that has already been played for, and leaves the record that
 *  earned it alone.
 *
 *  Deliberately NOT seedPlayer with the guard removed. Seeding refuses anyone
 *  who has played, and that refusal is what stops a re-seed quietly erasing a
 *  season - it has to keep refusing. This is the other half of the job: staff
 *  correcting a placement that was wrong, where the wins, the losses and every
 *  match already in History are all still true and only the number is not.
 *
 *  Returns what moved, so the change can be said out loud. A rating edited in
 *  silence is the one thing on the dashboard nobody could ever spot after the
 *  fact - it looks exactly like a match result. */
export function setPlayerElo(discordId: string, elo: number) {
  const p = getPlayer(discordId);
  if (!p) return null;
  const now = Math.round(elo);
  db.prepare('update player set elo = ? where discord_id = ?').run(now, discordId);
  return { name: p.kovaaks_username, was: p.elo, now };
}
export interface MatchPlayer {
  match_id: number;
  discord_id: string;
  team: number;
  done: number;
  scores: string;
  /** JSON {scenario: best score before this match, or null for none}, captured
   *  on the first score refresh so it can't drift as they play. Null on a row
   *  from before this was recorded. */
  pb: string | null;
  /** JSON {scenario: runs put in so far}. A match ends itself when everyone has
   *  used all of them - see allRunsUsed(). Null on an older row. */
  run_counts: string | null;
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

/** Undoes a finished match and forgets it: every rating point and every W/L it
 *  handed out goes back where it came from.
 *
 *  Only rows with a placing were ever scored - finishMatch writes the three
 *  columns and the W/L in one go, so reverting exactly that set keeps them in
 *  step and a no-show's untouched record stays untouched.
 *
 *  Later matches are NOT recomputed. Elo is path-dependent, so the exact answer
 *  is replaying the ladder from the start - this is the cheap one that keeps the
 *  totals honest, and deleting a match is a rare staff correction rather than
 *  something that happens every night. */
export function deleteMatch(matchId: number) {
  tx(() => {
    const rows = matchPlayers(matchId);
    // Whether this match was a draw, read back the way it was written: more than
    // one TEAM on placing 1. Counting rows would not do it - both members of a
    // winning 2v2 are placing 1 and that is a win, not a draw.
    const drawn = new Set(rows.filter((r) => r.placing === 1).map((r) => r.team)).size > 1;
    for (const r of rows) {
      if (r.placing == null || r.elo_before == null || r.elo_after == null) continue;
      const first = r.placing === 1;
      // max(0, ...) so a half-reverted row can never drive a record negative.
      db.prepare(
        `update player set elo = elo - ?,
           wins = max(0, wins - ?), losses = max(0, losses - ?), draws = max(0, draws - ?)
         where discord_id = ?`,
      ).run(
        r.elo_after - r.elo_before,
        first && !drawn ? 1 : 0,
        first ? 0 : 1,
        first && drawn ? 1 : 0,
        r.discord_id,
      );
    }
    db.prepare('delete from match_player where match_id = ?').run(matchId);
    db.prepare('delete from match where id = ?').run(matchId);
  });
}

/** How the two have gone against each other, from `a`'s side. Only matches they
 *  played on opposite sides count - being on the same team says nothing about
 *  which of them is better. */
export function headToHead(a: string, b: string, guildId: string) {
  const row = db
    .prepare(
      `select
         sum(case when x.placing < y.placing then 1 else 0 end) as wins,
         sum(case when x.placing > y.placing then 1 else 0 end) as losses
       from match_player x
       join match_player y on y.match_id = x.match_id and y.discord_id = ? and y.team <> x.team
       join match m on m.id = x.match_id
       where x.discord_id = ? and m.guild_id = ?
         and x.placing is not null and y.placing is not null`,
    )
    .get(b, a, guildId) as { wins: number | null; losses: number | null };
  return { wins: row?.wins ?? 0, losses: row?.losses ?? 0 };
}

/** Their last few finished games, and who was on the other side of each. A
 *  no-show is left out on purpose: it has no placing, because nothing was
 *  scored - and so is a team-mate, who says nothing about how the game went.
 *
 *  Two queries whatever the limit, the same shape matchHistory uses. */
export function recentMatches(discordId: string, guildId: string, limit = 5) {
  const rows = db
    .prepare(
      `select m.id, m.format, m.ended_at, p.placing, p.team, p.elo_before, p.elo_after
       from match_player p join match m on m.id = p.match_id
       where p.discord_id = ? and m.guild_id = ? and p.placing is not null
       order by m.ended_at desc limit ?`,
    )
    .all(discordId, guildId, limit) as unknown as {
    id: number;
    format: string;
    ended_at: number | null;
    placing: number;
    team: number;
    elo_before: number | null;
    elo_after: number | null;
  }[];
  if (!rows.length) return rows.map((r) => ({ ...r, opponents: [] as Opponent[] }));

  const holes = rows.map(() => '?').join(',');
  const others = db
    .prepare(
      `select mp.match_id, mp.discord_id, mp.team, pl.kovaaks_username
       from match_player mp join player pl on pl.discord_id = mp.discord_id
       where mp.match_id in (${holes}) and mp.discord_id <> ?`,
    )
    .all(...rows.map((r) => r.id), discordId) as unknown as {
    match_id: number;
    discord_id: string;
    team: number;
    kovaaks_username: string;
  }[];

  return rows.map((r) => ({
    ...r,
    opponents: others
      .filter((o) => o.match_id === r.id && o.team !== r.team)
      .map((o) => ({ id: o.discord_id, name: o.kovaaks_username })),
  }));
}

export interface Opponent {
  id: string;
  name: string;
}

/** Rounds won and lost per main category, over every rated match they finished.
 *
 *  ROUNDS, not matches: taking Tracking in a match you lost still says you can
 *  track, and "what should I be grinding" is a per-category question. Read off
 *  the same forfeited scores and the same scenarioWinners() the result card
 *  prints, so the breakdown and the scoreline can never disagree.
 *
 *  Unranked games are left out, the same as the W/L they never wrote. A
 *  scenario since dropped from the pool has no main left to file under and is
 *  skipped rather than guessed at, and so is a round nobody took. */
export function categoryRecord(discordId: string, guildId: string) {
  const rows = db
    .prepare(
      `select m.id, m.scenarios, p.discord_id, p.team, p.scores, p.run_counts
       from match m join match_player p on p.match_id = m.id
       where m.guild_id = ? and m.status = 'done' and m.ranked <> 0
         and m.id in (select match_id from match_player
                      where discord_id = ? and placing is not null)`,
    )
    .all(guildId, discordId) as unknown as (Pick<Match, 'id' | 'scenarios'> &
    Pick<MatchPlayer, 'discord_id' | 'team' | 'scores' | 'run_counts'>)[];

  const byMatch = new Map<number, typeof rows>();
  for (const r of rows) byMatch.set(r.id, [...(byMatch.get(r.id) ?? []), r]);

  const mainOf = new Map(getScenarios(guildId).map((s) => [s.name, s.main]));
  const want = getFormat(guildId).runs;
  const tally = new Map(MAIN_CATEGORIES.map((m) => [m as string, { won: 0, lost: 0 }]));

  for (const group of byMatch.values()) {
    const me = group.find((r) => r.discord_id === discordId);
    if (!me) continue;
    const scenarios = JSON.parse(group[0].scenarios) as string[];
    const scores = forfeits(
      group.map((r) => ({
        id: r.discord_id,
        scores: JSON.parse(r.scores) as Record<string, number | null>,
        runCounts: r.run_counts ? (JSON.parse(r.run_counts) as Record<string, number>) : null,
      })),
      scenarios,
      want,
    );
    const won = scenarioWinners(
      group.map((r) => ({ id: r.discord_id, elo: 0, team: r.team, scores: scores.get(r.discord_id)! })),
      scenarios,
    );
    scenarios.forEach((name, at) => {
      const row = tally.get(mainOf.get(name) ?? '');
      if (!row || won[at] === null) return;
      if (won[at] === me.team) row.won++;
      else row.lost++;
    });
  }

  return [...tally]
    .map(([main, r]) => ({ main, ...r }))
    .filter((r) => r.won + r.lost > 0);
}

/** The overview page's numbers. Two counts here; everything else it shows the
 *  dashboard already has on the wire. */
export function guildStats(guildId: string, channelId?: string) {
  const one = (sql: string, ...args: (string | number)[]) =>
    (db.prepare(sql).get(...args) as { n: number }).n;
  // A panel sits in ONE bracket's channel and counts that bracket's matches:
  // the same server-wide number under every panel told a Novice how busy the
  // Elite queue was. Left off, it is the whole server, which is what the
  // dashboard wants.
  const here = channelId ? ' and channel_id = ?' : '';
  const where = channelId ? [guildId, channelId] : [guildId];
  return {
    played: one(
      `select count(*) as n from match where guild_id = ?${here} and status = 'done'`,
      ...where,
    ),
    week: one(
      `select count(*) as n from match where guild_id = ?${here} and status = 'done' and ended_at > ?`,
      ...where,
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ),
    // A 'lobby' is a call nobody has taken: one person waiting on somebody
    // else, which is not a match and must not be counted as one. The two used
    // to be a single number, so a panel with one open call announced "1 match
    // up right now" and sent people looking for a game that did not exist.
    running: one(
      `select count(*) as n from match where guild_id = ?${here} and status in ('banning','live')`,
      ...where,
    ),
    // Counted separately because it is the one a reader can act on: a call
    // waiting is an invitation, where a match in play is just news.
    waiting: one(
      `select count(*) as n from match where guild_id = ?${here} and status = 'lobby'`,
      ...where,
    ),
    rated: one(
      `select count(*) as n from player p
       where p.wins + p.losses + p.draws > 0 and exists (
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

export function leaderboard(guildId: string, limit = 20, offset = 0) {
  return db
    .prepare(
      `select p.* from player p
       where p.wins + p.losses + p.draws > 0 and exists (
         select 1 from match_player mp join match m on m.id = mp.match_id
         where mp.discord_id = p.discord_id and m.guild_id = ?
       )
       order by p.elo desc, p.wins desc limit ? offset ?`,
    )
    .all(guildId, limit, offset) as unknown as Player[];
}

/** How many players the ladder has, which is how many pages it is. Counted
 *  rather than measured off a fetched page: the last page has to know it is the
 *  last one before it is drawn, or the Next button lies. */
export function ladderSize(guildId: string): number {
  const row = db
    .prepare(
      `select count(*) as n from player p
       where p.wins + p.losses + p.draws > 0 and exists (
         select 1 from match_player mp join match m on m.id = mp.match_id
         where mp.discord_id = p.discord_id and m.guild_id = ?
       )`,
    )
    .get(guildId) as { n: number };
  return row?.n ?? 0;
}
