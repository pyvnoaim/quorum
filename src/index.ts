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
  PICK_SWEEP_MS,
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
  categoryRecord,
  headToHead,
  matchPlayers,
  recentMatches,
  seedPlayer,
  setPlayerElo,
  type Match,
  type MatchPlayer,
} from './db.js';
import {
  leaderboardMessage,
  rankLabel,
  useClient,
  liveEmbed,
  noContestEmbed,
  openEmbed,
  panelMessage,
  runningEmbed,
  pickEmbed,
  rematchRow,
  resultsEmbed,
  staleEmbed,
} from './embeds.js';
import { startWeb, profileUrl, ladderUrl, BOARDS, placeBoard } from './web.js';
import { kovaaksAccountForDiscordId, scoreInWindow, voltaicS5 } from './kovaaks.js';
import {
  advancePick,
  allRunsUsed,
  bandsInReach,
  canPlay,
  eloDeltas,
  forfeits,
  matchDeadline,
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
  // A match talks in its own private thread, so nothing here reads a voice
  // state. GuildMembers is the one addition and manual mode is why: staff hand
  // out the division roles there, so the role IS the rank, and naming somebody's
  // rank means reading their roles. Without it the bot only knows the roles of
  // people it has happened to see press a button - so a rank vanished from every
  // embed on restart and came back one player at a time.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const NO_LINK =
  "That account has no KovaaK's on file. Link your Discord inside KovaaK's (Settings → Discord) and try again - it's the only setup this bot needs.";
const KOVAAKS_DOWN =
  "Couldn't reach KovaaK's just now, so I can't check the account. Nothing is wrong on your end - try again in a moment.";

/** Which of the two failures it was. Telling someone to go link an account
 *  they already linked is worse than saying nothing. */
const QUEUES_PAUSED =
  "Queues are paused - staff have closed them for now. Matches already running play out.";

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

/** The roles an interaction's member holds, or none where the gateway handed
 *  back a partial member. */
function roleIds(member: Interaction['member']) {
  return member?.roles && 'cache' in member.roles ? [...member.roles.cache.keys()] : [];
}

/** Where a brand new player's rating starts, per the server's setting.
 *
 *  Only ever the FIRST rating: ensurePlayer never touches the Elo of someone it
 *  has seen before, so nothing here can rewrite a record. 'voltaic' falls back
 *  to flat when there is no S5 entry to read, which is most people.
 *
 *  'staff' reads the division role they are already wearing. Handing someone a
 *  bracket role IS staff saying where they belong, and starting them flat
 *  anyway put everybody on the same rating regardless of rank until somebody
 *  went and said it a second time in the dashboard. That pane still works, for
 *  a player with no role yet. */
async function seedFor(
  discordId: string,
  guildId: string,
  steamId: string | null,
  roleIds: string[] = [],
) {
  // Nothing to work out for someone already on the books - ensurePlayer would
  // ignore the answer, and asking the benchmark index anyway would put a second
  // network round trip in front of every single button press.
  if (getPlayer(discordId)) return undefined;
  const mode = getSeedMode(guildId);
  if (mode === 'staff') {
    const band = rankForRoles(getRanks(guildId), roleIds);
    if (band) return { elo: band.min_elo, from: band.name };
  }
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

/** Takes down the "match on" card in the queue channel. Every way a match can
 *  end goes through here, so the channel can't be left advertising a game that
 *  finished an hour ago. */
async function dropNotice(match: Match) {
  if (!match.notice_id) return;
  const channel = await client.channels.fetch(match.channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    const msg = await channel.messages.fetch(match.notice_id).catch(() => null);
    await msg?.delete().catch(() => {});
  }
  db.prepare('update match set notice_id = null where id = ?').run(match.id);
}

/** The match moves into its thread the moment it starts: bans, scores and Done
 *  all happen where only its players can see them. The call in the queue
 *  channel becomes a card saying a match is on - the Join button has to go
 *  either way, but deleting the message outright left the channel looking
 *  empty while a game was running in it.
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
      // Edited, not replaced: the card belongs where the call was, and posting
      // a fresh one would push the panel up the channel every single match.
      const seated = matchPlayers(match.id);
      const kept = await msg
        ?.edit({
          embeds: [
            runningEmbed(
              match,
              new Map(seated.map((r) => [r.discord_id, getPlayer(r.discord_id)!])),
            ),
          ],
          components: [],
        })
        .catch(() => null);
      if (kept) db.prepare('update match set notice_id = ? where id = ?').run(kept.id, match.id);
      else await msg?.delete().catch(() => {});
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
  } else if (next.phase.pool.length < phase.pool.length) {
    // A ban, and the only place one lands - the sweep's auto-ban comes through
    // here too. Recorded on its own because the rest of the shortlist was never
    // banned, it was just never picked. The length check is what tells a real
    // ban from advancePick shrugging off an index that isn't there.
    const bans: string[] = match.bans ? JSON.parse(match.bans) : [];
    db.prepare('update match set bans = ? where id = ?').run(
      JSON.stringify([...bans, phase.pool[index]]),
      match.id,
    );
  }
  // The clock means "how long this side has had the table", so it restarts on
  // every act - by a player or by the sweep. Left alone, it would still be
  // counting the previous round and the next side would get whatever seconds
  // were left over.
  db.prepare('update match set scenarios = ?, created_at = ? where id = ?').run(
    JSON.stringify(next.phase),
    Date.now(),
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

/** When this match ends, grace and floor included - see matchDeadline().
 *  A live row with no start time is broken; 0 dates it to the epoch so the
 *  sweep reaps it rather than leaving it live forever. */
function deadlineFor(match: Match) {
  return matchDeadline(match.started_at ?? 0, match.grace_from, getFormat(match.guild_id));
}

/** Opens the grace window the first time any one player has used every run.
 *  Stamped once and never moved: a second player finishing must not restart
 *  somebody else's clock. */
function openGrace(match: Match) {
  if (match.grace_from) return;
  const scenarios: string[] = JSON.parse(match.scenarios);
  const want = getFormat(match.guild_id).runs;
  const finished = matchPlayers(match.id).some((r) =>
    allRunsUsed(scenarios, [JSON.parse(r.run_counts ?? '{}') as Record<string, number>], want),
  );
  if (finished) db.prepare('update match set grace_from = ? where id = ?').run(Date.now(), match.id);
}

/** Reads the scores, then ends the match if nobody has a run left. Every path
 *  that refreshes goes through here, so a match can't sit finished-but-open
 *  waiting for the next tick. */
async function refreshMatch(match: Match) {
  await refreshScores(match);
  let fresh = getMatch(match.id)!;
  if (fresh.status === 'live') {
    openGrace(fresh);
    fresh = getMatch(match.id)!;
  }
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
  const want = getFormat(done.guild_id).runs;
  // Runs left unused score nothing, and against somebody who used all of theirs
  // the whole match does - see forfeits(). That is what stops a player fishing
  // out of unlimited resets, whether they sit on one run or write off a whole
  // scenario to buy the clock on the other two. A scenario never launched stays
  // null, so scorable() can still tell a no-show from a game somebody lost.
  const forfeited = forfeits(
    rows.map((r) => ({
      id: r.discord_id,
      scores: JSON.parse(r.scores) as Record<string, number | null>,
      runCounts: r.run_counts ? (JSON.parse(r.run_counts) as Record<string, number>) : null,
    })),
    scenarios,
    want,
  );
  const entrants = rows.map((r) => ({
    id: r.discord_id,
    elo: getPlayer(r.discord_id)!.elo,
    team: r.team,
    scores: forfeited.get(r.discord_id)!,
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

  // Worked out either way: an unranked match is still a match, and the card
  // still has to be able to say who took it and by how many rounds. What it
  // does NOT do is spend any of it.
  const placing = placings(scoring, scenarios);
  const rated = done.ranked !== 0;
  const deltas = rated
    ? eloDeltas(scoring, placing)
    : new Map(scoring.map((e) => [e.id, 0] as const));

  // Two sides can genuinely share first. Rounds are scored by PLACING and a
  // round they tie hands both the same points, so level on points is level on
  // the match - and writing that down as a win for each of them, which is what
  // this did, inflated both records and made a win rate that could run past the
  // games played. Elo needed no such fix: a shared placing is already worth 0.5
  // to each side in eloDeltas, which is exactly a draw.
  const sharedFirst = [...placing.values()].filter((p) => p === 1).length > 1;

  for (const entrant of scoring) {
    const place = placing.get(entrant.team)!;
    const delta = deltas.get(entrant.id)!;
    const first = place === 1;
    // Nothing was staked, so nothing is paid out: no rating, no W/L, no draw.
    // The scores are already saved on the match_player row above and the result
    // still posts - that is the whole of what an unranked match leaves behind.
    if (rated) {
      db.prepare(
        `update player set elo = elo + ?, wins = wins + ?, losses = losses + ?, draws = draws + ?
         where discord_id = ?`,
      ).run(
        delta,
        first && !sharedFirst ? 1 : 0,
        first ? 0 : 1,
        first && sharedFirst ? 1 : 0,
        entrant.id,
      );
    }
    // The placing is written either way - it is who won, and History reads it.
    // elo_before/elo_after stay null on an unranked row, which is also what
    // stops deleteMatch trying to hand back points nobody was ever given.
    db.prepare(
      `update match_player set placing = ?, elo_before = ?, elo_after = ?
       where match_id = ? and discord_id = ?`,
    ).run(
      place,
      rated ? entrant.elo : null,
      rated ? entrant.elo + delta : null,
      done.id,
      entrant.id,
    );
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
  // deletes what is inside it. The card in the queue channel is outside it.
  await dropNotice(match);
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
  await dropNotice(done);
  if (!posted) {
    await msg?.edit(message).catch(() => {});
  } else {
    await closeThread(done);
    // Deleting the thread took the message with it; without one it is still
    // sitting in the queue channel.
    if (!done.thread_id) await msg?.delete().catch(() => {});
  }
  // Not after an unranked one: no rating moved, so no rank can have changed,
  // and syncRankRoles fetches a member apiece to work that out the slow way.
  if (!voided && done.ranked !== 0) {
    await syncRankRoles(done.guild_id, rows.map((r) => r.discord_id));
  }
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
  for (const stale of stalled) {
    // Re-read: the row was measured before the awaits below, and the side it
    // was waiting on may well have pressed something since. Picking for
    // somebody who just picked for themselves is exactly what this must not do.
    const match = getMatch(stale.id);
    if (!match || match.status !== 'banning') continue;
    if (match.created_at >= Date.now() - getFormat(match.guild_id).pickTtlS * 1000) continue;
    const phase = pickState(match);
    // A phase this version can't read, or one with nothing left on the table,
    // can never be finished by anyone - by a player or by this sweep.
    if (!phase || !phase.pool.length) {
      await cancelMatch(match);
      continue;
    }
    applyPick(match, Math.floor(Math.random() * phase.pool.length));
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
      const body = panelMessage(panel.formats, guildId, panel.channel, panel.ranked !== false);
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

/** What each board last said, same trick as the panels above: a board only
 *  moves when a match ends or staff change something, so a quiet server costs
 *  no requests. Keyed by guild and board. */
const boardText = new Map<string, string>();
/** Ticks since boot, so one pass in ten checks the boards are still there. */
let boardPass = 0;

/** Keeps the standing boards standing.
 *
 *  Reposted, not just edited, when the message is gone - someone with Manage
 *  Messages can delete one, and a leaderboard channel with no leaderboard in it
 *  is the one state this feature must not settle into. */
async function refreshBoards() {
  // The memo says the TEXT has not changed, not that the message is still
  // there - so a board deleted on a server where nothing else is happening
  // would never come back. Every tenth pass looks anyway.
  // ponytail: a counter, not an event: messageDelete only fires for messages
  // discord.js happens to have cached, which a board posted last week is not.
  const look = boardPass++ % 10 === 0;
  for (const [guildId] of client.guilds.cache) {
    const cfg = getConfig(guildId);
    for (const board of BOARDS) {
      const where = cfg[board.channel];
      if (!where) continue;
      const bodies = board.build(guildId);
      // The whole board, not just the descriptions: the fields on the pool
      // boards, the count in the ladder's footer and the ladder's link button
      // all move without a line of the body changing - and a board whose only
      // change is a button nobody may follow any more still has to be edited.
      // How MANY messages counts too: a new difficulty is a message that is not
      // there yet, and every board under it saying the wrong thing.
      const next = JSON.stringify(bodies.map((b) => [b.embeds[0].data, b.components]));
      const key = `${guildId}:${board.channel}`;
      const unchanged = boardText.get(key) === next;
      if (unchanged && !look) continue;

      const channel = await client.channels.fetch(where).catch(() => null);
      if (!channel?.isTextBased() || !channel.isSendable()) continue;
      // Unchanged means this pass only came to check the board had not been
      // deleted: it costs the fetches and no edits.
      if (await placeBoard(guildId, board, channel, bodies, !unchanged))
        boardText.set(key, next);
    }
  }
}

async function tick() {
  await refreshPanels();
  await refreshBoards();
  await expireStaleCalls();
  const live = db
    .prepare("select * from match where status = 'live'")
    .all() as unknown as Match[];
  for (const match of live) {
    if (Date.now() >= deadlineFor(match)) {
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

/** Staff moved somebody's division, so their rating moves with it.
 *
 *  With staff-owned brackets the ROLE is the truth and the rating is the
 *  evidence inside it - so changing bracket starts that evidence again at the
 *  new floor. A promotion is not a player who is suddenly bottom of the whole
 *  ladder, and a demotion is not one who still sits above the bracket they
 *  came from.
 *
 *  Manual mode only. Automatic mode hands out these same roles ITSELF, off the
 *  rating, so a rating that then followed the role would chase its own tail.
 *  It cannot fight syncRankRoles either: that returns early in manual mode, so
 *  a division role there only ever moves because a person moved it. */
client.on('guildMemberUpdate', async (before, after) => {
  // This event fires for a nickname, an avatar, a timeout, any role at all - so
  // the free checks go first and the database is only asked once something
  // might actually have happened. Without the old roles there is no way to tell
  // a division change from a rename, and snapping a rating on a rename would be
  // the worst kind of wrong.
  if (before.partial) return;
  const guildId = after.guild.id;
  if (!guildAllowed(guildId)) return;
  // Same roles, whatever else moved. Cheaper than reading the ladder to find
  // out, and it is the case nearly every one of these events is.
  if (
    before.roles.cache.size === after.roles.cache.size &&
    before.roles.cache.every((r) => after.roles.cache.has(r.id))
  ) {
    return;
  }
  if (getRankMode(guildId) !== 'manual') return;
  const ranks = getRanks(guildId);
  // Compared as BANDS, not as role lists: handing someone a second role they
  // already outrank changes nothing, and neither should this.
  const was = rankForRoles(ranks, before.roles.cache.map((r) => r.id));
  const now = rankForRoles(ranks, after.roles.cache.map((r) => r.id));
  // No band now means staff took the division away rather than swapping it.
  // There is no floor to move to, and an unplaced player cannot queue anyway.
  if (!now || was?.id === now.id) return;
  // Nobody Quorum has on the books is nobody to move: an unplayed member is
  // seeded off this very role the first time they press anything.
  if (!getPlayer(after.id)) return;
  const moved = setPlayerElo(after.id, now.min_elo);
  if (!moved || moved.was === moved.now) return;
  // Logged, not announced. The role landing on them is already visible in
  // Discord and the rating following it is policy rather than a decision, so
  // there is nobody to attribute it to - unlike a rating edited on the
  // dashboard, which is somebody's choice and says whose.
  console.log(
    `${guildId}: ${moved.name} ${was?.name ?? 'unplaced'} -> ${now.name}, ` +
      `rating ${moved.was} -> ${moved.now}`,
  );
});

client.once('clientReady', async (c) => {
  for (const guild of c.guilds.cache.values()) await leaveIfNotAllowed(guild);
  // Everything that names a rank goes through here - see useClient().
  useClient(c);
  await c.application.commands.set([command.toJSON()]);
  startWeb(c, { concludeMatch, cancelMatch, syncRankRoles, refreshPanels });
  // Warmed after the bot is already answering, not before it. On a big server
  // this is a slow download, and blocking on it would hold the dashboard and
  // every slash command shut for as long as it took - to populate something
  // only rank LABELS need. After this GUILD_MEMBER_UPDATE keeps it current on
  // its own, so a role staff move lands on the next embed rather than whenever
  // that player next presses a button. A guild that refuses the fetch fills in
  // from interactions, as it did before there was an intent to ask with.
  void Promise.all(
    [...c.guilds.cache.values()].map((guild) => guild.members.fetch().catch(() => {})),
  );
  setInterval(() => void tick().catch(console.error), TICK_MS).unref();
  // Its own interval, not tick's: the pick timer is a number staff set, and
  // checked once a minute a 90s window really runs anywhere from 90s to 150s.
  // This one is a query and a filter on the few matches mid-ban, so running it
  // often costs nothing - unlike the panel and leaderboard edits in tick().
  setInterval(() => void expireStalePicks().catch(console.error), PICK_SWEEP_MS).unref();
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
    await i.reply(leaderboardMessage(i.guildId!, ladderUrl(i.guildId!)));
    return;
  }

  if (sub === 'stats') {
    const target = i.options.getUser('player') ?? i.user;
    const p = getPlayer(target.id);
    if (!p) {
      await i.reply({ content: 'No games played yet.', flags: MessageFlags.Ephemeral });
      return;
    }
    // Draws are games played, so they belong in the total the rate is over.
    const games = p.wins + p.losses + p.draws;
    const band = rankLabel(i.guildId!, target.id, p.elo, i.guild);
    // The title carries the link to their page - a card with a url on it is
    // one press, and the alternative is a naked link under the embed.
    const url = profileUrl(i.guildId!, target.id);
    const embed = new EmbedBuilder()
      .setTitle(p.kovaaks_username)
      .setURL(url)
      .setColor(0x5865f2)
      .setDescription(
        // One player, so the bracket can come off their role where Quorum has
        // seen them - unlike the leaderboard, there is no other row to be
        // inconsistent with.
        `**${p.elo}**${band ? ` ${band}` : ''}${games ? '' : ' · seeded ' + (p.seeded_from ?? 'flat')}\n${p.wins}W ${p.losses}L${p.draws ? ` ${p.draws}D` : ''}${games ? ` · ${Math.round((p.wins / games) * 100)}% over ${games}` : ''}`,
      );

    // What to grind, which is the one thing a rating cannot say. Rounds rather
    // than matches, so a category you carry a lost match on still counts for
    // you - see categoryRecord().
    const cats = categoryRecord(target.id, i.guildId!);
    if (cats.length) {
      embed.addFields({
        name: 'Rounds',
        value: cats.map((c) => `${c.main} **${c.won}**–${c.lost}`).join(' · '),
      });
    }

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

async function onButton(i: import('discord.js').ButtonInteraction) {
  const [, action, arg, extra] = i.customId.split(':');

  // 'pug:open:1v1' is the rated queue and 'pug:open:1v1:casual' the one with
  // nothing on it. Carried on the button rather than worked out from the
  // channel, so a panel reposted into the wrong place cannot quietly start
  // rating games nobody meant to play for.
  if (action === 'open') return onOpen(i, arg as Format, extra !== 'casual');
  if (action === 'notify') return onNotify(i);

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
    // Applied BEFORE the ack, so the read above and the write below sit in one
    // tick with no await between them. Deferring first hands the loop to the
    // next click, which then reads the same pre-pick row and overwrites the
    // first pick with its own - a double tap losing a ban.
    // ponytail: atomic because this is one process on a sync sqlite; a second
    // process would want the compare-and-swap finishMatch() uses.
    const next = applyPick(match, Number(extra));
    await i.deferUpdate();
    await editMatchMessage(next);
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
    // Taking one is queueing too. A call left open when staff paused would
    // otherwise still start a match, which is the one thing pausing is for.
    if (getConfig(match.guild_id).queues_paused) {
      await i.reply({ content: QUEUES_PAUSED, flags: MessageFlags.Ephemeral });
      return;
    }
    const account = await kovaaksAccountForDiscordId(i.user.id);
    if (account.kind !== 'found') {
      await i.reply({ content: lookupError(account.kind), flags: MessageFlags.Ephemeral });
      return;
    }
    // Seeded the same way the opener is: taking a call is as much a first game
    // as making one, and skipping it here parked every player who only ever
    // pressed Take on the flat rating whatever their bracket said.
    const player = ensurePlayer(
      i.user.id,
      account.username,
      account.steamId,
      await seedFor(i.user.id, match.guild_id, account.steamId, roleIds(i.member)),
    );
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

    if (match.ranked === 0) {
      // Nothing at stake, so nothing to protect: an unranked call takes anyone,
      // placed or not. This is the branch that lets a newcomer play at all.
      //
      // Tested for 0 rather than falsiness, so the gate fails CLOSED: a row
      // that somehow arrived without the column would be waved past every rank
      // check by `!match.ranked`, and letting the wrong people into a rated
      // match is the one direction this must never get wrong.
    } else if (match.division_role_id) {
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
    const mine = rows.find((r) => r.discord_id === i.user.id);
    if (!mine) {
      await i.reply({ content: 'Players only.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (match.status !== 'live') {
      await i.reply({ content: 'Already finished.', flags: MessageFlags.Ephemeral });
      return;
    }
    // Done gives up whatever runs are left, and unused runs score 0. Somebody
    // reading the button as "I have stopped playing" would zero two scenarios
    // with one press, so it asks first - once, and only when there is something
    // to lose. Someone who played the format out sees no prompt at all.
    const want = getFormat(match.guild_id).runs;
    const used = JSON.parse(mine.run_counts ?? '{}') as Record<string, number>;
    const short = (JSON.parse(match.scenarios) as string[]).filter(
      (s) => (used[s] ?? 0) < want,
    );
    const confirmed = extra === 'yes';
    if (short.length && !confirmed) {
      await i.reply({
        content:
          'Done gives up the runs you have left, and a scenario you did not finish scores **0**. ' +
          `You are short on ${short.map((s) => `**${s}** (${used[s] ?? 0}/${want})`).join(', ')}.`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`pug:done:${match.id}:yes`)
              .setLabel('Done anyway')
              .setStyle(ButtonStyle.Danger),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    db.prepare('update match_player set done = 1 where match_id = ? and discord_id = ?').run(
      match.id,
      i.user.id,
    );
    // Acknowledge whichever message the press came from. The confirm button
    // sits on an ephemeral prompt, so deferUpdate there would leave editReply
    // rewriting the prompt rather than the board in the thread.
    if (confirmed) {
      await i.update({ content: 'Done - the runs you had left score 0.', components: [] });
    } else {
      await i.deferUpdate();
    }
    // Everyone has to call it, so whoever is ahead can't end the match while
    // their opponent still has runs left. The clock covers the other way out.
    if (matchPlayers(match.id).every((r) => r.done)) await concludeMatch(getMatch(match.id)!);
    else if (confirmed) await editMatchMessage(getMatch(match.id)!);
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
  // This button hands a role to anyone who can see the panel, so it must only
  // ever hand out a role that carries nothing. A ping role pointed - by
  // mistake or otherwise - at one with permissions would make every member of
  // the server a moderator by pressing a button.
  const it = member.guild.roles.cache.get(role);
  if (!it || it.permissions.bitfield !== 0n || it.managed) {
    await i.reply({
      content: !it
        ? 'That notification role no longer exists - staff will need to pick another.'
        : 'That role carries permissions, so Quorum will not hand it out. ' +
          'A notification role should be able to do nothing but get pinged.',
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

async function onOpen(
  i: import('discord.js').ButtonInteraction,
  format: Format,
  ranked = true,
) {
  if (!FORMATS[format] || !i.guildId) {
    await i.reply({ content: 'Unknown format.', flags: MessageFlags.Ephemeral });
    return;
  }
  // Checked before the KovaaK's lookup: a paused queue is a no whatever the
  // account says, and there is no reason to spend a network hop finding out.
  if (getConfig(i.guildId).queues_paused) {
    await i.reply({ content: QUEUES_PAUSED, flags: MessageFlags.Ephemeral });
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
    await seedFor(i.user.id, i.guildId, account.steamId, roleIds(i.member)),
  );

  const ranks = getRanks(i.guildId);
  // Manual mode: the call is opened INTO a bracket - the channel's, or the one
  // the opener holds a role for in a shared channel. Nobody unplaced queues,
  // because placing people is the whole point of staff-owned brackets.
  //
  // ...except here, which is the one queue with no bracket to be in. Nothing is
  // at stake, so there is nothing to gate: an unranked call belongs to no
  // division, admits anyone, and is how somebody nobody has placed yet gets a
  // game at all - and how staff get the scores to place them on.
  const manual = getRankMode(i.guildId) === 'manual';
  const held = i.member?.roles && 'cache' in i.member.roles ? i.member.roles.cache : null;
  const division = manual && ranked
    ? ranks.find((r) => rankChannels(r).queue === i.channelId) ??
      rankForRoles(ranks, held?.map((r) => r.id) ?? [])
    : undefined;
  if (manual && ranked && !division?.discord_role_id) {
    await i.reply({
      content:
        'You need a division role to queue here - ask staff to place you. ' +
        'Unranked is open to everyone in the meantime.',
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
    ranked,
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
  // Gone from Discord is not "ping nobody": a deleted role would leave a raw
  // <@&id> at the top of every call and reach no one, so the brackets take it
  // back until staff pick another.
  const set = getConfig(i.guildId).ping_role_id;
  const optIn = set && i.guild?.roles.cache.has(set) ? set : null;
  // An unranked call pings NO role, and this is checked before the opt-in one
  // rather than after it. It belongs to no bracket, so there is no bracket to
  // summon - and the notify role is not a substitute for one either: somebody
  // asked to hear about games, not to be pulled out of whatever they are doing
  // for one that counts for nothing. It sits in a channel the whole server can
  // already see, which is the announcement.
  const mentions = !ranked
    ? []
    : optIn
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
  ranked = true,
) {
  const { lastInsertRowid } = db
    .prepare(
      `insert into match (guild_id, channel_id, host_id, format, division_role_id, ranked, created_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, channelId, hostId, format, divisionRoleId, ranked ? 1 : 0, Date.now());
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
    // Carried over, or a rematch of an unranked game would come back rated -
    // and it is posted straight into the channel with everyone pinged, so the
    // first anyone would know is a rating moving after a game they thought was
    // for nothing. An unplaced player could not have joined it either.
    old.ranked !== 0,
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
