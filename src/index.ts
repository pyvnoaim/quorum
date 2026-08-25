import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import {
  guildAllowed,
  CALL_TTL_MS,
  FORMATS,
  MAIN_CATEGORIES,
  ROUNDS,
  TICK_MS,
  BASE_ELO,
  VOLTAIC_SEED,
  type Format,
} from './config.js';
import {
  db,
  ensurePlayer,
  dropPanel,
  getConfig,
  getFormat,
  getMatch,
  getPanels,
  getPlayer,
  getSeedMode,
  getRankSpread,
  getRanks,
  getRankMode,
  poolFor,
  rankChannels,
  getScenarios,
  headToHead,
  matchPlayers,
  recentMatches,
  seedPlayer,
  setConfig,
  type Match,
  type MatchPlayer,
} from './db.js';
import {
  leaderboardMessage,
  rankLabel,
  liveEmbed,
  messageGone,
  noContestEmbed,
  openEmbed,
  panelMessage,
  pickEmbed,
  rematchRow,
  resultsEmbed,
  staleEmbed,
} from './embeds.js';
import { startWeb } from './web.js';
import { kovaaksAccountForDiscordId, scoreInWindow, voltaicS5 } from './kovaaks.js';
import {
  advancePick,
  allRunsUsed,
  bandsInReach,
  canPlay,
  eloDeltas,
  pickTurn,
  placings,
  rankFor,
  rankForRoles,
  rankName,
  scorable,
  type PickPhase,
} from './rating.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');

const client = new Client({
  // Guilds alone. A match talks in its own private thread now, so nothing here
  // reads a voice state and no second intent has to be justified.
  intents: [GatewayIntentBits.Guilds],
});

const NO_LINK =
  "That account has no KovaaK's on file. Link your Discord inside KovaaK's (Settings → Discord) and try again - it's the only setup this bot needs.";
const KOVAAKS_DOWN =
  "Couldn't reach KovaaK's just now, so I can't check the account. Nothing is wrong on your end - try again in a moment.";

/** Which of the two failures it was. Telling someone to go link an account
 *  they already linked is worse than saying nothing. */
const lookupError = (kind: 'not-linked' | 'unreachable') =>
  kind === 'unreachable' ? KOVAAKS_DOWN : NO_LINK;

const command = new SlashCommandBuilder()
  .setName('scrim')
  .setDescription("KovaaK's scrims")
  // In a server or nowhere. Every subcommand reads i.guildId, and in a DM that
  // is null - which reaches getRanks as a null guild_id and trips the NOT NULL
  // on the insert, so the whole command answers "That broke".
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('score').setDescription('refresh the scoreboard'))
  .addSubcommand((s) =>
    s
      .setName('stats')
      .setDescription('rating & record')
      .addUserOption((o) => o.setName('player').setDescription('defaults to you')),
  )
  .addSubcommand((s) => s.setName('leaderboard').setDescription('show the ladder'))
  .addSubcommand((s) =>
    s
      .setName('seed')
      .setDescription('set where a player rating starts (staff)')
      .addUserOption((o) => o.setName('player').setDescription('who').setRequired(true))
      .addStringOption((o) =>
        o.setName('rank').setDescription('the rank to start them at').setRequired(true),
      ),
  );

/** The rank a call belongs to: its division in manual mode, otherwise the rank
 *  that owns the channel it was opened in. Undefined in a shared channel on
 *  automatic ranks, where nothing but the players decides the level. */
function callRank(match: Match) {
  const ranks = getRanks(match.guild_id);
  return (
    (match.division_role_id &&
      ranks.find((r) => r.discord_role_id === match.division_role_id)) ||
    ranks.find((r) => rankChannels(r).queue === match.channel_id)
  );
}

/** The slice of the pool this match plays from: what its bracket was named in,
 *  plus everything offered to every rank. With no bracket to go on, the rank
 *  the host's rating falls in stands in for one. */
function matchPool(match: Match) {
  const ranks = getRanks(match.guild_id);
  const host = getPlayer(match.host_id);
  const band = callRank(match) ?? (host ? rankFor(ranks, host.elo) : undefined);
  return poolFor(getScenarios(match.guild_id), band?.id);
}

/** One scenario per main, cycling, so a match is never three of the same
 *  thing. Falls back to whatever is left if the pool is smaller than ROUNDS. */
function rollScenarios(match: Match, want = ROUNDS) {
  const pool = matchPool(match);
  // Only mains a server has actually put scenarios under: an empty Tracking
  // would otherwise take a round and roll nothing into it.
  const cats = MAIN_CATEGORIES.filter((m) => pool.some((s) => s.main === m)).map((m) =>
    pool.filter((s) => s.main === m).map((s) => s.name),
  );
  const out: string[] = [];
  // round-robin over categories so the roll spreads across them, however many
  // are asked for. Stops early when the pool runs dry rather than looping.
  for (let i = 0; out.length < want && i < want * cats.length; i++) {
    const pool = cats[i % cats.length].filter((s) => !out.includes(s));
    if (pool.length) out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

const shuffle = <T>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

/** One MAIN per scenario, in a random order - the order is part of the format,
 *  since knowing you finish on tracking is worth something in the picks before
 *  it. Subcategories are filing, not rounds: a server that splits Clicking into
 *  Static and Dynamic still plays one Clicking scenario, drawn from both.
 *
 *  Only mains the pool actually has scenarios under, and a server with fewer of
 *  those than ROUNDS sees one come round again rather than no match at all. */
function rollCategories(match: Match, want = ROUNDS) {
  const pool = matchPool(match);
  const all = shuffle(MAIN_CATEGORIES.filter((m) => pool.some((s) => s.main === m)));
  if (!all.length) return [];
  return Array.from({ length: want }, (_, i) => all[i % all.length]);
}

/** Candidates from one main, minus anything already locked in - every scenario
 *  filed under it, whichever subcategory it sits in. A main with nothing left to
 *  offer falls back to the whole pool: a thin main must not be able to leave a
 *  match with no scenario to play. */
function shortlist(match: Match, main: string, want: number, taken: string[]) {
  const pool = matchPool(match).filter((s) => !taken.includes(s.name));
  const mine = pool.filter((s) => s.main === main);
  return shuffle((mine.length ? mine : pool).map((s) => s.name)).slice(0, want);
}

/** The pick phase, or null when the stored shape is a plain array - a match
 *  that was mid-ban under the older format. Nothing can drive those to an end,
 *  so callers cancel them rather than throwing on every tick. */
function pickState(match: Match) {
  const raw: unknown = JSON.parse(match.scenarios);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('pool' in raw)) return null;
  const phase = raw as PickPhase;
  return { ...phase, ...pickTurn(phase.picked.length, phase.pool.length, phase.size) };
}

function render(match: Match) {
  const rows = matchPlayers(match.id);
  const players = new Map(rows.map((r) => [r.discord_id, getPlayer(r.discord_id)!]));

  if (match.status === 'lobby') {
    return {
      embeds: [openEmbed(match, rows, players)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`pug:join:${match.id}`)
            .setLabel('Join')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`pug:cancel:${match.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    };
  }
  if (match.status === 'banning') {
    const phase = pickState(match);
    // Nothing left to drive: the sweep cancels these, and until it does the
    // message says so rather than showing dead buttons.
    if (!phase) return { embeds: [staleEmbed(match)], components: [] };
    // Discord allows five buttons a row, and PICK_POOL is five.
    const rowsOfFive = phase.pool.reduce<string[][]>((acc, name, n) => {
      if (n % 5 === 0) acc.push([]);
      acc[acc.length - 1].push(name);
      return acc;
    }, []);
    return {
      embeds: [pickEmbed(match, rows, phase)],
      components: rowsOfFive.map((group, groupIdx) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          group.map((name, n) =>
            new ButtonBuilder()
              // the index into the pool, not the name - a scenario name is
              // longer than a custom id is allowed to be.
              .setCustomId(`pug:pick:${match.id}:${groupIdx * 5 + n}`)
              .setLabel(name.length > 78 ? name.slice(0, 77) + '…' : name)
              .setStyle(phase.action === 'ban' ? ButtonStyle.Danger : ButtonStyle.Success),
          ),
        ),
      ),
    };
  }

  return {
    embeds: [liveEmbed(match, rows, players)],
    components:
      match.status === 'live'
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`pug:refresh:${match.id}`)
                .setLabel('Refresh scores')
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId(`pug:done:${match.id}`)
                .setLabel('Done')
                .setStyle(ButtonStyle.Success),
            ),
          ]
        : [],
  };
}

/** Where a brand new player's rating starts, per the server's setting.
 *
 *  Only ever the FIRST rating: ensurePlayer never touches the Elo of someone it
 *  has seen before, so nothing here can rewrite a record. 'staff' seeds flat
 *  and waits - staff move them from the players pane before they play - and
 *  'voltaic' falls back to flat when there is no S5 entry to read, which is
 *  most people. */
async function seedFor(discordId: string, guildId: string, steamId: string | null) {
  // Nothing to work out for someone already on the books - ensurePlayer would
  // ignore the answer, and asking the benchmark index anyway would put a second
  // network round trip in front of every single button press.
  if (getPlayer(discordId)) return undefined;
  const mode = getSeedMode(guildId);
  if (mode !== 'voltaic' || !steamId) return { elo: BASE_ELO, from: mode };
  const s5 = await voltaicS5(steamId);
  const seed = s5 ? VOLTAIC_SEED[s5.rank] : undefined;
  return s5 && seed ? { elo: seed, from: `Voltaic ${s5.rank}` } : { elo: BASE_ELO, from: 'flat' };
}

/** A private thread per match, holding exactly its players, deleted when the
 *  match ends.
 *
 *  It hangs off the channel the call was made in, so there is nothing to
 *  configure and a split server's threads land in the right rank's channel on
 *  their own. Everyone in the match is added by id - unlike a voice channel,
 *  nobody has to already be somewhere for that to work. */
async function openThread(guild: Guild, match: Match, rows: MatchPlayer[]) {
  const channel = guild.channels.cache.get(match.channel_id);
  if (channel?.type !== ChannelType.GuildText) return null;
  const thread = await channel.threads
    .create({
      name: `${match.format} #${match.id}`,
      type: ChannelType.PrivateThread,
      // nobody drags a friend into someone else's match
      invitable: false,
      autoArchiveDuration: 1440,
    })
    .catch((err: Error) => {
      console.error(`match ${match.id}: no thread in ${match.channel_id}:`, err.message);
      return null;
    });
  if (!thread) return null;

  await Promise.all(rows.map((r) => thread.members.add(r.discord_id).catch(() => {})));
  return thread.id;
}

/** Threads are deleted rather than archived: an archived one still sits in the
 *  channel's list, and a season of those is a channel nobody can find anything
 *  in. The result embed is the record, and it lives in the results channel. */
async function closeThread(match: Match) {
  if (!match.thread_id) return;
  const thread = await client.channels.fetch(match.thread_id).catch(() => null);
  if (thread?.isThread()) await thread.delete().catch(() => {});
}

async function startMatch(guild: Guild, match: Match) {
  // One caller wins the transition. Two Joins landing in the same tick both see
  // a full lobby, and starting twice shuffles the teams twice and leaks the
  // first thread. created_at moves with it because from here it means
  // "when the ban phase began", which is what the sweep reads.
  const claimed = db
    .prepare("update match set status = 'banning', created_at = ? where id = ? and status = 'lobby'")
    .run(Date.now(), match.id);
  if (!claimed.changes) return getMatch(match.id)!;

  const rows = matchPlayers(match.id);
  const { teamSize } = FORMATS[match.format];
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  shuffled.forEach((row, idx) => {
    db.prepare('update match_player set team = ? where match_id = ? and discord_id = ?').run(
      Math.floor(idx / teamSize),
      match.id,
      row.discord_id,
    );
  });
  const threadId = await openThread(guild, match, rows);
  db.prepare('update match set thread_id = ? where id = ?').run(threadId, match.id);

  // Who picks first is already decided: the shuffle above put someone on side
  // 0, and side 0 holds the first pick. Nothing else to randomise.
  //
  // A shortlist of one has nothing to ban or pick, and more than two sides has
  // nobody to alternate with - either way the match just plays a plain roll
  // rather than stalling on setup.
  const fmt = getFormat(guild.id);
  const cats = rollCategories(match, fmt.rounds);
  const first = shortlist(match, cats[0] ?? '', fmt.pickPool, []);
  // sides from the shuffle above, not from `rows` - those were read before the
  // teams were written, so every one of them still says 0.
  const sides = Math.ceil(shuffled.length / teamSize);
  if (first.length < 2 || sides !== 2) {
    return moveIntoThread(beginPlay(getMatch(match.id)!, rollScenarios(match, fmt.rounds)));
  }
  const phase: PickPhase = { picked: [], cats, pool: first, size: first.length };
  // ban_pool is the record of everything that was on the table; the dashboard
  // reads what was banned out of it as "offered, then not played". Each
  // shortlist is appended to it as it is rolled.
  db.prepare('update match set scenarios = ?, ban_pool = ? where id = ?').run(
    JSON.stringify(phase),
    JSON.stringify(first),
    match.id,
  );
  return moveIntoThread(getMatch(match.id)!);
}

/** The match moves into its thread the moment it starts: bans, scores and Done
 *  all happen where only its players can see them. The call in the queue
 *  channel has done its whole job by filling up, so it goes - leaving it would
 *  put a dead Join button under a game already in progress.
 *
 *  No thread means no move. Everything carries on in the channel exactly as it
 *  did before, because a match that can't be private is still a match. */
async function moveIntoThread(match: Match) {
  if (!match.thread_id) return match;
  const thread = await client.channels.fetch(match.thread_id).catch(() => null);
  if (!thread?.isThread()) return match;
  const posted = await thread.send(render(match)).catch(() => null);
  if (!posted) return match;

  const call = match.message_id;
  db.prepare('update match set message_id = ? where id = ?').run(posted.id, match.id);
  if (call) {
    const home = await client.channels.fetch(match.channel_id).catch(() => null);
    if (home?.isTextBased()) {
      const msg = await home.messages.fetch(call).catch(() => null);
      await msg?.delete().catch(() => {});
    }
  }
  return getMatch(match.id)!;
}

/** Locks the scenarios in and starts the clock. started_at is what the score
 *  lookup measures from, so it is stamped here and nowhere earlier - a run
 *  during the ban phase must not count. */
function beginPlay(match: Match, scenarios: string[]) {
  db.prepare("update match set status = 'live', scenarios = ?, started_at = ? where id = ?").run(
    JSON.stringify(scenarios),
    Date.now(),
    match.id,
  );
  return getMatch(match.id)!;
}

/** Takes one scenario off the table - as a ban or as the pick, whichever the
 *  phase is on. A pick either opens the next scenario's shortlist or, once the
 *  last one is picked, rolls the final scenario at random and starts the match. */
function applyPick(match: Match, index: number) {
  const phase = pickState(match);
  if (!phase) return match;
  const fmt = getFormat(match.guild_id);
  const next = advancePick(
    phase,
    index,
    (category, want, taken) => shortlist(match, category, want, taken),
    fmt.rounds,
    fmt.pickPool,
  );
  if ('scenarios' in next) return beginPlay(match, next.scenarios);

  // A pick opens a fresh shortlist, and everything ever on the table goes into
  // ban_pool - the dashboard reads what was banned back out of it as "offered,
  // then not played".
  if (next.phase.picked.length !== phase.picked.length) {
    const offered: string[] = match.ban_pool ? JSON.parse(match.ban_pool) : [];
    db.prepare('update match set ban_pool = ? where id = ?').run(
      JSON.stringify([...offered, ...next.phase.pool]),
      match.id,
    );
  }
  db.prepare('update match set scenarios = ? where id = ?').run(
    JSON.stringify(next.phase),
    match.id,
  );
  return getMatch(match.id)!;
}

/** Reads every player's best in-window run off KovaaK's. A score already on
 *  record is never overwritten by a null - the window only grows, so a missing
 *  answer means KovaaK's blinked, not that the run vanished. */
async function refreshScores(match: Match) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const end = match.ended_at ?? Date.now();
  const want = getFormat(match.guild_id).runs;
  await Promise.all(
    matchPlayers(match.id).map(async (row) => {
      const player = getPlayer(row.discord_id)!;
      const scores = JSON.parse(row.scores) as Record<string, number | null>;
      const pb = JSON.parse(row.pb ?? '{}') as Record<string, number | null>;
      const runs = JSON.parse(row.run_counts ?? '{}') as Record<string, number>;
      await Promise.all(
        scenarios.map(async (scenario) => {
          const res = await scoreInWindow(
            player.kovaaks_username,
            scenario,
            match.started_at!,
            end,
            want,
          );
          // Settled the moment the run cap is reached: KovaaK's only hands back
          // the last 50 runs, so someone grinding a scenario past that would
          // eventually push their real first three off the end of the page and
          // start scoring on later ones. Their score stops moving instead.
          const settled = (runs[scenario] ?? 0) >= want;
          if (res.ok && res.score !== null && !settled) scores[scenario] = res.score;
          else if (!(scenario in scores)) scores[scenario] = null;
          // Their best before the match, kept from the first answer only: the
          // 50-run page it comes out of slides forward as they play, so asking
          // again later would quietly lower the bar they had to beat.
          if (res.ok && !(scenario in pb)) pb[scenario] = res.prior;
          // Runs only ever go up. A blink from KovaaK's must not read as
          // "they un-played it" and re-open a match that had finished.
          if (res.ok) runs[scenario] = Math.max(runs[scenario] ?? 0, res.runs);
        }),
      );
      db.prepare(
        `update match_player set scores = ?, pb = ?, run_counts = ?
         where match_id = ? and discord_id = ?`,
      ).run(
        JSON.stringify(scores),
        JSON.stringify(pb),
        JSON.stringify(runs),
        match.id,
        row.discord_id,
      );
    }),
  );
}

/** Whether this match has nothing left to play - see allRunsUsed(). */
function nothingLeftToPlay(match: Match) {
  return allRunsUsed(
    JSON.parse(match.scenarios),
    matchPlayers(match.id).map((r) => JSON.parse(r.run_counts ?? '{}') as Record<string, number>),
    getFormat(match.guild_id).runs,
  );
}

/** Reads the scores, then ends the match if nobody has a run left. Every path
 *  that refreshes goes through here, so a match can't sit finished-but-open
 *  waiting for the next tick. */
async function refreshMatch(match: Match) {
  await refreshScores(match);
  const fresh = getMatch(match.id)!;
  if (fresh.status === 'live' && nothingLeftToPlay(fresh)) {
    await concludeMatch(fresh);
    return getMatch(match.id)!;
  }
  return fresh;
}

async function finishMatch(match: Match) {
  // Force-finish from the dashboard, the last Done, and the clock can all land
  // on the same live match - and the row every caller holds went stale the
  // moment it awaited. Only whoever moves it off 'live' gets to score it;
  // handing out Elo twice for one game is not something a rating recovers from.
  const claimed = db
    .prepare("update match set status = 'done', ended_at = ? where id = ? and status = 'live'")
    .run(Date.now(), match.id);
  if (!claimed.changes) return null;
  const done = getMatch(match.id)!;
  await refreshScores(done);

  const rows = matchPlayers(done.id);
  const scenarios: string[] = JSON.parse(done.scenarios);
  const entrants = rows.map((r) => ({
    id: r.discord_id,
    elo: getPlayer(r.discord_id)!.elo,
    team: r.team,
    scores: JSON.parse(r.scores) as Record<string, number | null>,
  }));

  // Only whoever actually ran something is scored - see scorable(). Not-played
  // counts as 0, so leaving a no-show in hands their opponent free Elo for a
  // game nobody turned up to, and hands them a loss for it. Their row keeps a
  // null placing, which is what marks it "not rated" in the result.
  //
  // With fewer than two sides left there was no contest at all. That is its own
  // end state: no Elo, no W/L, and not a played match.
  const scoring = scorable(entrants);
  if (!scoring.length) {
    db.prepare("update match set status = 'void' where id = ?").run(done.id);
    return { match: getMatch(done.id)!, deltas: new Map<string, number>(), voided: true };
  }

  const placing = placings(scoring, scenarios);
  const deltas = eloDeltas(scoring, placing);

  for (const entrant of scoring) {
    const place = placing.get(entrant.team)!;
    const delta = deltas.get(entrant.id)!;
    // ponytail: a win is placing 1, everything else is a loss - no draws column
    // until someone actually ties for first and complains.
    db.prepare(
      `update player set elo = elo + ?, wins = wins + ?, losses = losses + ? where discord_id = ?`,
    ).run(delta, place === 1 ? 1 : 0, place === 1 ? 0 : 1, entrant.id);
    db.prepare(
      `update match_player set placing = ?, elo_before = ?, elo_after = ?
       where match_id = ? and discord_id = ?`,
    ).run(place, entrant.elo, entrant.elo + delta, done.id, entrant.id);
  }

  // The thread outlives this on purpose - concludeMatch still has to reach the
  // match message inside it if the result can't be posted anywhere else.
  return { match: getMatch(done.id)!, deltas, voided: false };
}

/** One PATCH per member: keep every role that isn't a rank role, add the one
 *  they've earned. Never roles.set([rankRole]) - that would strip everything
 *  else they hold. */
async function syncRankRoles(guildId: string, discordIds: string[]) {
  // Manual mode: staff own the brackets. Ratings still move underneath - they
  // are the evidence a promotion is made on - but nothing here moves a role,
  // so one bad night can't drop somebody out of the bracket they were put in.
  if (getRankMode(guildId) === 'manual') return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const ranks = getRanks(guildId).filter((r) => r.discord_role_id);
  if (!ranks.length) return;
  const rankRoleIds = new Set(ranks.map((r) => r.discord_role_id!));

  for (const id of discordIds) {
    const player = getPlayer(id);
    const member = await guild.members.fetch(id).catch(() => null);
    if (!player || !member) continue;
    const target = rankFor(ranks, player.elo)?.discord_role_id ?? null;
    // @everyone is in the cache and is not a role you may assign.
    const keep = member.roles.cache
      .filter((r) => r.id !== guild.id && !rankRoleIds.has(r.id))
      .map((r) => r.id);
    const next = target ? [...keep, target] : keep;
    const held = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id);
    if (next.length === held.length && next.every((r) => held.includes(r))) continue;
    await member.roles.set(next).catch(() => {});
  }
}

/** Kills a match without a result: no Elo, no placings, nothing posted. The
 *  staff escape hatch for a lobby that went wrong. */
async function cancelMatch(match: Match) {
  db.prepare("update match set status = 'cancelled', ended_at = ? where id = ?").run(
    Date.now(),
    match.id,
  );
  if (match.message_id && !match.thread_id) {
    const channel = await client.channels.fetch(match.channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(match.message_id).catch(() => null);
      await msg?.delete().catch(() => {});
    }
  }
  // With a thread there is no separate message to chase: deleting the thread
  // deletes what is inside it.
  await closeThread(match);
}

/** Ends a match and cleans up after it. The Done button and the clock both
 *  route through here, so there is exactly one place that posts a result. */
async function concludeMatch(match: Match) {
  const finished = await finishMatch(match);
  // somebody else already scored it
  if (!finished) return;
  const { match: done, deltas, voided } = finished;
  const rows = matchPlayers(done.id);
  const players = new Map(rows.map((r) => [r.discord_id, getPlayer(r.discord_id)!]));
  const embed = voided ? noContestEmbed(done, rows) : resultsEmbed(done, rows, players, deltas);

  // One channel for every result, whatever the queues are split into. Split
  // mode makes its own inside the Quorum category and uses that; the server's
  // own choice is left alone so it comes back when the mode goes off. Falling
  // back to the call's channel means a result is never lost to a deleted or
  // misconfigured target.
  const cfg = getConfig(done.guild_id);
  const channelId = cfg.split_results_id ?? done.channel_id;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const message = { embeds: [embed], components: [rematchRow(done)] };
  const posted = channel?.isSendable() ? await channel.send(message).catch(() => null) : null;

  // The thread is the match, and once the result lives elsewhere it has nothing
  // left to say. If posting failed it becomes the record instead - the scores
  // must not go down with it.
  const home = await client.channels.fetch(done.thread_id ?? done.channel_id).catch(() => null);
  const msg =
    done.message_id && home?.isTextBased()
      ? await home.messages.fetch(done.message_id).catch(() => null)
      : null;
  if (!posted) {
    await msg?.edit(message).catch(() => {});
  } else {
    await closeThread(done);
    // Deleting the thread took the message with it; without one it is still
    // sitting in the queue channel.
    if (!done.thread_id) await msg?.delete().catch(() => {});
  }
  if (!voided) await syncRankRoles(done.guild_id, rows.map((r) => r.discord_id));
}

function activeMatchFor(discordId: string, guildId: string) {
  return db
    .prepare(
      `select m.* from match m join match_player p on p.match_id = m.id
       where p.discord_id = ? and m.guild_id = ? and m.status = 'live'
       order by m.id desc limit 1`,
    )
    .get(discordId, guildId) as Match | undefined;
}

/** An open call nobody took is stale - drop it and delete its message, so the
 *  queue channel only ever shows calls that are actually live.
 *
 *  How long that takes is the server's call, so the cutoff cannot be one
 *  subtraction in the query any more: every open call is read and measured
 *  against its OWN guild's window. A guild that has turned it off keeps its
 *  calls up until someone takes or cancels them. */
async function expireStaleCalls() {
  const open = db
    .prepare("select * from match where status = 'lobby'")
    .all() as unknown as Match[];
  const stale = open.filter((m) => {
    const set = getConfig(m.guild_id).call_ttl_min;
    if (set === 0) return false;
    const ttl = set == null ? CALL_TTL_MS : set * 60 * 1000;
    return m.created_at < Date.now() - ttl;
  });
  for (const match of stale) {
    db.prepare("update match set status = 'cancelled' where id = ?").run(match.id);
    if (!match.message_id) continue;
    const channel = await client.channels.fetch(match.channel_id).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const msg = await channel.messages.fetch(match.message_id).catch(() => null);
    await msg?.delete().catch(() => {});
  }
}

/** A side that walks away would hold the lobby forever, so the bot acts for
 *  them - ban or pick, whichever is due. Random, not "first in the list": a
 *  predictable auto-pick is a strategy. */
async function expireStalePicks() {
  const picking = db
    .prepare("select * from match where status = 'banning'")
    .all() as unknown as Match[];
  // Each guild's own window, same as the call sweep above.
  const stalled = picking.filter(
    (m) => m.created_at < Date.now() - getFormat(m.guild_id).pickTtlS * 1000,
  );
  for (const match of stalled) {
    const phase = pickState(match);
    // A phase this version can't read, or one with nothing left on the table,
    // can never be finished by anyone - by a player or by this sweep.
    if (!phase || !phase.pool.length) {
      await cancelMatch(match);
      continue;
    }
    const next = applyPick(match, Math.floor(Math.random() * phase.pool.length));
    // reset the clock so the next side gets its own full window
    if (next.status === 'banning') {
      db.prepare('update match set created_at = ? where id = ?').run(Date.now(), match.id);
    }
    await editMatchMessage(getMatch(match.id)!);
  }
}

/** What each panel last said, by message id. The counts move only when a match
 *  starts or ends, so comparing before fetching means a quiet server costs
 *  nothing at all - no request, no edit, no rate limit spent on saying the same
 *  thing sixty times an hour. Empty after a restart, which costs one edit. */
const panelText = new Map<string, string>();

/** Keeps the panels' counts honest. A panel whose message or channel is gone is
 *  forgotten rather than chased every minute. */
async function refreshPanels() {
  for (const [guildId] of client.guilds.cache) {
    for (const panel of getPanels(guildId)) {
      const body = panelMessage(panel.formats, guildId);
      const next = body.embeds[0].data.description ?? '';
      if (panelText.get(panel.message) === next) continue;

      const channel = await client.channels.fetch(panel.channel).catch(() => null);
      const msg = channel?.isTextBased()
        ? await channel.messages.fetch(panel.message).catch(() => null)
        : null;
      if (!msg) {
        dropPanel(guildId, panel.channel);
        panelText.delete(panel.message);
        continue;
      }
      await msg.edit(body).catch(() => {});
      panelText.set(panel.message, next);
    }
  }
}

/** What each server's board last said, same trick as the panels above: the
 *  ladder only moves when a match ends, so a quiet server costs no requests. */
const ladderText = new Map<string, string>();
/** Ticks since boot, so one pass in ten checks the board is still there. */
let ladderPass = 0;

/** Keeps the standing leaderboard standing.
 *
 *  Reposted, not just edited, when the message is gone - someone with Manage
 *  Messages can delete it, and a leaderboard channel with no leaderboard in it
 *  is the one state this feature must not settle into. */
async function refreshLeaderboards() {
  // The memo says the TEXT has not changed, not that the message is still
  // there - so a board deleted on a server where nothing else is happening
  // would never come back. Every tenth pass looks anyway.
  // ponytail: a counter, not an event: messageDelete only fires for messages
  // discord.js happens to have cached, which a board posted last week is not.
  const look = ladderPass++ % 10 === 0;
  for (const [guildId] of client.guilds.cache) {
    const cfg = getConfig(guildId);
    if (!cfg.leaderboard_channel_id) continue;
    const body = leaderboardMessage(guildId);
    // Footer as well as body: the page count and the number of ranked players
    // live down there, and both move without a single row changing.
    const next = `${body.embeds[0].data.description ?? ''}|${body.embeds[0].data.footer?.text ?? ''}`;
    const unchanged = ladderText.get(guildId) === next;
    if (unchanged && !look) continue;

    const channel = await client.channels.fetch(cfg.leaderboard_channel_id).catch(() => null);
    if (!channel?.isTextBased() || !channel.isSendable()) continue;
    let msg = null;
    if (cfg.leaderboard_msg_id) {
      try {
        msg = await channel.messages.fetch(cfg.leaderboard_msg_id);
      } catch (err) {
        // Deleted for good is a repost. Anything else - a rate limit, a blip -
        // leaves this guild alone until the next tick rather than risking a
        // second board beside the first.
        if (!messageGone(err)) continue;
      }
    }
    if (msg) {
      // Still up and still saying the right thing: this pass only came here to
      // check it had not been deleted, so it costs one fetch and no edit.
      if (unchanged) continue;
      // Remembered as posted only if it actually went through: a channel that
      // refuses one edit - permissions changed under us, Discord having a
      // moment - should be tried again next tick, not written off as current.
      const edited = await msg.edit(body).then(() => true, () => false);
      if (!edited) continue;
    } else {
      const posted = await channel.send(body).catch(() => null);
      setConfig(guildId, { leaderboard_msg_id: posted?.id ?? null });
      if (!posted) continue;
    }
    ladderText.set(guildId, next);
  }
}

async function tick() {
  await refreshPanels();
  await refreshLeaderboards();
  await expireStaleCalls();
  await expireStalePicks();
  const live = db
    .prepare("select * from match where status = 'live'")
    .all() as unknown as Match[];
  for (const match of live) {
    if (Date.now() - (match.started_at ?? 0) >= getFormat(match.guild_id).matchTtlMin * 60_000) {
      await concludeMatch(match);
      continue;
    }
    const fresh = await refreshMatch(match);
    if (fresh.status === 'live') await editMatchMessage(fresh);
  }
}

/** Leaves anywhere it isn't wanted. Checked on join AND on boot: the bot can
 *  be added while it is offline, and it can be added back after being removed. */
async function leaveIfNotAllowed(guild: Guild) {
  if (guildAllowed(guild.id)) return false;
  console.log(`leaving ${guild.name} (${guild.id}): not in ALLOWED_GUILD_IDS`);
  await guild.leave().catch(() => {});
  return true;
}

client.on('guildCreate', (guild) => void leaveIfNotAllowed(guild).catch(console.error));

client.once('clientReady', async (c) => {
  for (const guild of c.guilds.cache.values()) await leaveIfNotAllowed(guild);
  await c.application.commands.set([command.toJSON()]);
  startWeb(c, { concludeMatch, cancelMatch, syncRankRoles });
  setInterval(() => void tick().catch(console.error), TICK_MS).unref();
  console.log(`ready as ${c.user.tag}`);
});

client.on('interactionCreate', async (i: Interaction) => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'scrim') await onCommand(i);
    else if (i.isButton() && i.customId.startsWith('pug:')) await onButton(i);
  } catch (err) {
    console.error(err);
    if (i.isRepliable() && !i.replied && !i.deferred) {
      await i
        .reply({ content: 'That broke. Try again.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

async function onCommand(i: import('discord.js').ChatInputCommandInteraction) {
  const sub = i.options.getSubcommand();

  if (sub === 'leaderboard') {
    // this server's ladder, not every server's - the rank names inside come
    // from this guild's ranks, so the rows must too.
    await i.reply(leaderboardMessage(i.guildId!));
    return;
  }

  if (sub === 'stats') {
    const target = i.options.getUser('player') ?? i.user;
    const p = getPlayer(target.id);
    if (!p) {
      await i.reply({ content: 'No games played yet.', flags: MessageFlags.Ephemeral });
      return;
    }
    const games = p.wins + p.losses;
    const band = rankLabel(i.guildId!, target.id, p.elo, i.guild);
    const embed = new EmbedBuilder()
      .setTitle(p.kovaaks_username)
      .setColor(0x5865f2)
      .setDescription(
        // One player, so the bracket can come off their role where Quorum has
        // seen them - unlike the leaderboard, there is no other row to be
        // inconsistent with.
        `**${p.elo}**${band ? ` ${band}` : ''}${games ? '' : ' · seeded ' + (p.seeded_from ?? 'flat')}\n${p.wins}W ${p.losses}L${games ? ` · ${Math.round((p.wins / games) * 100)}% over ${games}` : ''}`,
      );

    const recent = recentMatches(target.id, i.guildId!);
    if (recent.length) {
      embed.addFields({
        name: `Last ${recent.length}`,
        value: recent
          .map((m) => {
            const delta = (m.elo_after ?? 0) - (m.elo_before ?? 0);
            const when = m.ended_at ? ` · <t:${Math.floor(m.ended_at / 1000)}:R>` : '';
            return `${m.placing === 1 ? '✅' : '❌'} ${m.format} · ${delta >= 0 ? '+' : ''}${delta}${when}`;
          })
          .join('\n'),
      });
    }
    // Only worth a field when they have actually met - "0W 0L" against everyone
    // you look up is noise.
    if (target.id !== i.user.id) {
      const h2h = headToHead(i.user.id, target.id, i.guildId!);
      if (h2h.wins + h2h.losses) {
        embed.addFields({ name: 'Against you', value: `${h2h.wins}W ${h2h.losses}L` });
      }
    }
    await i.reply({ embeds: [embed] });
    return;
  }

  if (sub === 'seed') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const target = i.options.getUser('player', true);
    const wanted = i.options.getString('rank', true).trim().toLowerCase();
    const ranks = getRanks(i.guildId!);
    const rank = ranks.find((r) => r.name.toLowerCase() === wanted);
    if (!rank) {
      await i.reply({
        content: `No rank called that. This server has: ${ranks.map((r) => r.name).join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const account = await kovaaksAccountForDiscordId(target.id);
    if (account.kind !== 'found') {
      await i.reply({ content: lookupError(account.kind), flags: MessageFlags.Ephemeral });
      return;
    }
    ensurePlayer(target.id, account.username, account.steamId, {
      elo: rank.min_elo,
      from: rank.name,
    });
    // Seeding an existing player only lands while they are unplayed. Saying so
    // beats appearing to work and changing nothing.
    if (!seedPlayer(target.id, rank.min_elo, rank.name)) {
      const p = getPlayer(target.id);
      await i.reply({
        content: `<@${target.id}> has already played (${p?.wins ?? 0}W ${p?.losses ?? 0}L), so their rating is their own now.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // Their role now, not after their first match: a split server's rank
    // channel is private to its role, so a seeded player holding none would be
    // seeded into a queue they cannot see.
    await syncRankRoles(i.guildId!, [target.id]);
    // In manual mode that call deliberately did nothing - the roles are staff's,
    // and a seed that quietly hands one out would be the bot moving people again.
    await i.reply(
      `<@${target.id}> starts at **${rank.min_elo}** (${rank.name}).` +
        (getRankMode(i.guildId!) === 'manual'
          ? ` Give them the ${rank.name} role yourself - divisions are staff-owned here.`
          : ''),
    );
    return;
  }

  // score
  const match = activeMatchFor(i.user.id, i.guildId!);
  if (!match) {
    await i.reply({ content: "You're not in a live match.", flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const fresh = await refreshMatch(match);
  await i.editReply(render(fresh));
  // A match that just ended has posted its result and taken its thread with it,
  // so there is nothing left in there to edit.
  if (fresh.status === 'live') await editMatchMessage(fresh);
}

/** Page two of a leaderboard nobody else asked for.
 *
 *  Pressing Next on the board in the channel does NOT turn that message over -
 *  it is one message the whole server is looking at, and a page that moves
 *  under everyone whenever anyone reads it is a page nobody can read. The press
 *  answers privately instead, and from there Back and Next edit that private
 *  copy, which is yours to move. The board in the channel stays on the page it
 *  exists to show. */
async function onLeaderboardPage(i: import('discord.js').ButtonInteraction, page: number) {
  const body = leaderboardMessage(i.guildId!, Number.isFinite(page) ? page : 0);
  if (i.message.flags.has(MessageFlags.Ephemeral)) await i.update(body);
  else await i.reply({ ...body, flags: MessageFlags.Ephemeral });
}

async function onButton(i: import('discord.js').ButtonInteraction) {
  const [, action, arg, extra] = i.customId.split(':');

  if (action === 'open') return onOpen(i, arg as Format);
  if (action === 'notify') return onNotify(i);
  // Not a match id, so it has to answer before the lookup below turns it into
  // "That match is gone."
  if (action === 'lb') return onLeaderboardPage(i, Number(arg));

  const match = getMatch(Number(arg));
  if (!match) {
    await i.reply({ content: 'That match is gone.', flags: MessageFlags.Ephemeral });
    return;
  }
  const rows = matchPlayers(match.id);
  const isOpener = i.user.id === match.host_id;

  if (action === 'rematch') return onRematch(i, match);

  // 'ban' is what the buttons on an older message carry; same step either way.
  if (action === 'pick' || action === 'ban') {
    if (match.status !== 'banning') {
      await i.reply({ content: 'That one is past picking.', flags: MessageFlags.Ephemeral });
      return;
    }
    const mine = rows.find((r) => r.discord_id === i.user.id);
    if (!mine) {
      await i.reply({ content: "You're not in that match.", flags: MessageFlags.Ephemeral });
      return;
    }
    const phase = pickState(match);
    if (!phase) {
      await i.reply({
        content: 'That match was mid-pick when the bot changed under it, so it has been dropped.',
        flags: MessageFlags.Ephemeral,
      });
      await cancelMatch(match);
      return;
    }
    if (mine.team !== phase.turn) {
      await i.reply({
        content: `Not your ${phase.action}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.deferUpdate();
    await editMatchMessage(applyPick(match, Number(extra)));
    return;
  }

  if (action === 'join') {
    if (match.status !== 'lobby') {
      await i.reply({ content: 'That one already started.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (rows.some((r) => r.discord_id === i.user.id)) {
      await i.reply({ content: "You're already in it.", flags: MessageFlags.Ephemeral });
      return;
    }
    const account = await kovaaksAccountForDiscordId(i.user.id);
    if (account.kind !== 'found') {
      await i.reply({ content: lookupError(account.kind), flags: MessageFlags.Ephemeral });
      return;
    }
    const player = ensurePlayer(i.user.id, account.username, account.steamId);
    const ranks = getRanks(match.guild_id);

    // The lookup above is a network hop and Join is a button people double-tap,
    // so everything read before it is stale. Re-read, or two people race into a
    // lobby with one seat and the rank gate below checks against the wrong list.
    const seated = matchPlayers(match.id);
    if (getMatch(match.id)!.status !== 'lobby' || seated.length >= FORMATS[match.format].max) {
      await i.reply({ content: 'That one just filled.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (seated.some((r) => r.discord_id === i.user.id)) {
      await i.reply({ content: "You're already in it.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (match.division_role_id) {
      // Manual mode: the call carries its division, so the gate is roles all
      // the way down - nothing here reads Elo. The spread still applies, in
      // ladder positions: at 1 the bracket either side may join too.
      const spread = getRankSpread(match.guild_id)[match.format];
      const home = ranks.find((r) => r.discord_role_id === match.division_role_id);
      // A division whose rank has since left the ladder gets the role it was
      // opened with and nothing else. Reaching bands around a floor of 0 would
      // open a Champion call to the bottom of the ladder, which is the one way
      // this gate must never fail.
      const admits = new Set(
        home
          ? bandsInReach(ranks, home.min_elo, spread)
              .map((r) => r.discord_role_id)
              .filter((id): id is string => !!id)
          : [match.division_role_id],
      );
      const held = i.member?.roles && 'cache' in i.member.roles ? i.member.roles.cache : null;
      if (!held?.some((r) => admits.has(r.id))) {
        await i.reply({
          content: `That queue is <@&${match.division_role_id}>${
            spread ? ` and the ${spread === 1 ? 'bracket' : `${spread} brackets`} either side` : ''
          } only.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
    } else {
      // Rank gate against everyone already in, not just the opener - otherwise
      // two people a band apart each meet in the middle through a third.
      const spread = getRankSpread(match.guild_id)[match.format];
      const clash = seated
        .map((r) => getPlayer(r.discord_id)!)
        .find((other) => !canPlay(ranks, player.elo, other.elo, spread));
      if (clash) {
        await i.reply({
          content:
            `This queue is ${spread === 0 ? 'one rank only' : `within ${spread} rank${spread > 1 ? 's' : ''}`}` +
            `. You're ${rankName(ranks, player.elo)}, they're ${rankName(ranks, clash.elo)}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
    db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(
      match.id,
      i.user.id,
    );

    const full = matchPlayers(match.id).length >= FORMATS[match.format].max;
    await i.deferUpdate();
    const next = full ? await startMatch(i.guild!, match) : getMatch(match.id)!;
    // A started match has moved into its thread and taken the call message with
    // it - there is nothing left here to edit.
    if (next.status === 'lobby' || !next.thread_id) await i.editReply(render(next));
    return;
  }

  if (action === 'cancel') {
    if (!isOpener) {
      await i.reply({ content: 'Only whoever opened it can cancel.', flags: MessageFlags.Ephemeral });
      return;
    }
    // Only a lobby can be cancelled, and the check has to be in the UPDATE:
    // `match` was read before the Join handler's KovaaK's lookup could finish,
    // so a call that filled in that window still reads 'lobby' here. Without
    // the guard, Cancel lands on a live match and takes the game with it.
    const killed = db
      .prepare("update match set status = 'cancelled', ended_at = ? where id = ? and status = 'lobby'")
      .run(Date.now(), match.id);
    if (!killed.changes) {
      await i.reply({ content: 'That one already started.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    await i.message.delete().catch(() => {});
    return;
  }

  if (action === 'refresh') {
    if (match.status !== 'live') {
      await i.reply({ content: 'That match is over.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    const fresh = await refreshMatch(match);
    // Concluding deleted the thread this message lived in; editing it now would
    // only fail.
    if (fresh.status === 'live') await i.editReply(render(fresh));
    return;
  }

  if (action === 'done') {
    if (!rows.some((r) => r.discord_id === i.user.id)) {
      await i.reply({ content: 'Players only.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (match.status !== 'live') {
      await i.reply({ content: 'Already finished.', flags: MessageFlags.Ephemeral });
      return;
    }
    db.prepare('update match_player set done = 1 where match_id = ? and discord_id = ?').run(
      match.id,
      i.user.id,
    );
    await i.deferUpdate();
    // Everyone has to call it, so whoever is ahead can't end the match while
    // their opponent still has runs left. The clock covers the other way out.
    if (matchPlayers(match.id).every((r) => r.done)) await concludeMatch(getMatch(match.id)!);
    else await i.editReply(render(getMatch(match.id)!));
  }
}

/** Opting in and out of queue pings, on the panel where the queues are.
 *
 *  The bot owns this one role and nothing else about the member: never
 *  roles.set(), which would strip everything they hold, and never a role the
 *  server has not named as its ping role. */
async function onNotify(i: import('discord.js').ButtonInteraction) {
  const role = i.guildId ? getConfig(i.guildId).ping_role_id : null;
  const member = i.member && 'cache' in (i.member.roles ?? {}) ? (i.member as GuildMember) : null;
  if (!role || !member) {
    await i.reply({
      content: 'No notification role is set up here.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const had = member.roles.cache.has(role);
  const done = await (had ? member.roles.remove(role) : member.roles.add(role)).then(
    () => true,
    () => false,
  );
  await i.reply({
    content: !done
      ? "Couldn't change that role - Quorum may sit below it in the role list."
      : had
        ? "Done - you won't be pinged for new queues."
        : "Done - you'll be pinged when a queue goes up where you can see it.",
    flags: MessageFlags.Ephemeral,
  });
}

async function onOpen(i: import('discord.js').ButtonInteraction, format: Format) {
  if (!FORMATS[format] || !i.guildId) {
    await i.reply({ content: 'Unknown format.', flags: MessageFlags.Ephemeral });
    return;
  }
  const account = await kovaaksAccountForDiscordId(i.user.id);
  if (account.kind !== 'found') {
    await i.reply({ content: lookupError(account.kind), flags: MessageFlags.Ephemeral });
    return;
  }
  const opener = ensurePlayer(
    i.user.id,
    account.username,
    account.steamId,
    await seedFor(i.user.id, i.guildId, account.steamId),
  );

  const ranks = getRanks(i.guildId);
  // Manual mode: the call is opened INTO a bracket - the channel's, or the one
  // the opener holds a role for in a shared channel. Nobody unplaced queues,
  // because placing people is the whole point of staff-owned brackets.
  const manual = getRankMode(i.guildId) === 'manual';
  const held = i.member?.roles && 'cache' in i.member.roles ? i.member.roles.cache : null;
  const division = manual
    ? ranks.find((r) => rankChannels(r).queue === i.channelId) ??
      rankForRoles(ranks, held?.map((r) => r.id) ?? [])
    : undefined;
  if (manual && !division?.discord_role_id) {
    await i.reply({
      content: 'You need a division role to queue - ask staff to place you.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const match = createCall(
    i.guildId,
    i.channelId,
    i.user.id,
    format,
    division?.discord_role_id ?? null,
  );

  // Ping the bands this queue would actually admit, rather than everyone. That
  // is the whole reason not to split the queue into a channel per rank: the
  // notification is targeted, the pool of takers stays whole.
  //
  // In split mode the CHANNEL is the rank, so the ping is centred on it and not
  // on the opener's rating - a fresh Champion still sitting at base Elo opening
  // in #champion must not summon the bottom of the ladder.
  const owner = division ?? ranks.find((r) => rankChannels(r).queue === i.channelId);
  // An opt-in role REPLACES the bracket roles rather than adding to them: a
  // server that has one has decided a queue ping is something you ask for, and
  // pinging the bracket as well would be the thing they opted out of. It still
  // only reaches the right people - the call is posted in a bracket's channel,
  // and Discord does not notify anyone about a channel they cannot see.
  const optIn = getConfig(i.guildId).ping_role_id;
  const mentions = optIn
    ? [optIn]
    : [
        ...new Set(
          bandsInReach(ranks, owner?.min_elo ?? opener.elo, getRankSpread(i.guildId)[format])
            .map((r) => r.discord_role_id)
            .filter((id): id is string => !!id),
        ),
      ];

  await i.reply({
    ...render(match),
    ...(mentions.length
      ? {
          content: mentions.map((id) => `<@&${id}>`).join(' '),
          allowedMentions: { roles: mentions },
        }
      : {}),
  });
  const msg = await i.fetchReply();
  db.prepare('update match set message_id = ? where id = ?').run(msg.id, match.id);
}

/** A lobby row with its opener already seated. The panel and Rematch both land
 *  here, so a call is created in exactly one place. */
function createCall(
  guildId: string,
  channelId: string,
  hostId: string,
  format: Format,
  divisionRoleId: string | null = null,
) {
  const { lastInsertRowid } = db
    .prepare(
      `insert into match (guild_id, channel_id, host_id, format, division_role_id, created_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, channelId, hostId, format, divisionRoleId, Date.now());
  const id = Number(lastInsertRowid);
  db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(id, hostId);
  return getMatch(id)!;
}

/** Rematch: a fresh call back in the queue channel the last one came from, with
 *  the players of that match pinged instead of the rank roles.
 *
 *  Deliberately NOT a lobby that seats everyone and starts itself - a rematch
 *  nobody agreed to is a match with an empty seat in it. Everyone presses Join
 *  again, which also keeps the rank gate and the fill-to-start doing their job. */
async function onRematch(i: import('discord.js').ButtonInteraction, old: Match) {
  const was = matchPlayers(old.id);
  if (!was.some((r) => r.discord_id === i.user.id)) {
    await i.reply({
      content: 'Only someone who played it can call a rematch.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = await client.channels.fetch(old.channel_id).catch(() => null);
  if (!channel?.isSendable()) {
    await i.reply({
      content: 'That queue channel is gone, so there is nowhere to post it.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const match = createCall(
    old.guild_id,
    old.channel_id,
    i.user.id,
    old.format,
    old.division_role_id,
  );
  const others = was.map((r) => r.discord_id).filter((id) => id !== i.user.id);
  const msg = await channel.send({
    ...render(match),
    ...(others.length
      ? { content: others.map((id) => `<@${id}>`).join(' '), allowedMentions: { users: others } }
      : {}),
  });
  db.prepare('update match set message_id = ? where id = ?').run(msg.id, match.id);
  await i.reply({
    content: `Rematch is up in <#${old.channel_id}>.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function editMatchMessage(match: Match) {
  if (!match.message_id) return;
  // A started match lives in its thread; only a lobby is still in the channel.
  const channel = await client.channels.fetch(match.thread_id ?? match.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const msg = await channel.messages.fetch(match.message_id).catch(() => null);
  await msg?.edit(render(match)).catch(() => {});
}

client.login(token);
