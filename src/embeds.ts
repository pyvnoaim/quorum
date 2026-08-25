import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
} from 'discord.js';
import { FORMATS, PANEL_FORMATS, ROUNDS, RUNS_PER_SCENARIO, type Format } from './config.js';
import {
  getConfig,
  getFormat,
  getPlayer,
  getRankMode,
  getRanks,
  guildStats,
  ladderSize,
  leaderboard,
  type Match,
  type MatchPlayer,
  type Player,
} from './db.js';
import { rankFor, rankForRoles, rankName, scenarioWinners } from './rating.js';

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;

/** The bar down the left of a CALL is the colour of the rank it is for -
 *  whoever opened it. A call pings the bands around it, but it belongs to one
 *  of them, and that band's colour is already what the ladder, the roles and
 *  the channels are painted in. Only the call: past that point the colour has
 *  a job of its own, saying whether a match is running, scored, or neither.
 *  Falls back to blurple for a host who has somehow left the ladder. */
function matchColor(match: Match) {
  const ranks = getRanks(match.guild_id);
  const host = getPlayer(match.host_id);
  // A call that carries its own division is painted in that bracket's colour:
  // with staff-owned brackets the role is the truth, not the rating under it.
  const band = match.division_role_id
    ? ranks.find((r) => r.discord_role_id === match.division_role_id)
    : host
      ? rankFor(ranks, host.elo)
      : undefined;
  const parsed = band?.color ? Number.parseInt(band.color.slice(1), 16) : NaN;
  return Number.isFinite(parsed) ? parsed : BLURPLE;
}

/** Every embed ends the same way, and says nothing else down there. Anything a
 *  player has to ACT on belongs in the body at full size - the footer is 12px
 *  grey, which is where a rule goes to be missed. */
const footer = () => ({ text: 'powered by kova' });
const GREY = 0x99aab5;

/** The pick phase: one scenario at a time, each out of its own category's
 *  shortlist. Everything shown is derived from the stored phase, so the embed
 *  and the buttons can never disagree about whose turn it is. */
export function pickEmbed(
  match: Match,
  rows: MatchPlayer[],
  phase: {
    picked: string[];
    cats: string[];
    pool: string[];
    action: 'ban' | 'pick';
    turn: number;
    bansLeft: number;
  },
) {
  const { rounds, pickTtlS } = getFormat(match.guild_id);
  const side = rows.filter((r) => r.team === phase.turn).map((r) => `<@${r.discord_id}>`);
  const slot = phase.picked.length + 1;
  const locked = phase.picked.map((s, n) => `**${n + 1}.** \`${s}\``).join('\n');

  return new EmbedBuilder()
    .setTitle(`${match.format} · scenario ${slot} of ${rounds}`)
    .setColor(BLURPLE)
    .setDescription(
      (locked ? `${locked}\n\n` : '') +
        `${side.join(' and ')} ${phase.action === 'ban' ? 'bans one' : 'picks one'} ` +
        `from **${phase.cats[phase.picked.length] ?? 'the pool'}**` +
        (phase.action === 'ban'
          ? `. ${phase.bansLeft} ban${phase.bansLeft === 1 ? '' : 's'} before the pick.`
          : ' to play.') +
        `\n\nScenario ${rounds} is a random roll - nobody picks it. ` +
        `Nobody acts within **${pickTtlS}s** and the bot ${phase.action}s at random.\n\n` +
        phase.pool.map((s) => `\`${s}\``).join('\n'),
    )
    .setFooter(footer());
}

/** A match whose stored pick phase predates this version of the bot. It cannot
 *  be finished, so it says so instead of showing buttons that do nothing. */
export function staleEmbed(match: Match) {
  return new EmbedBuilder()
    .setTitle(`${match.format} · dropped`)
    .setColor(GREY)
    .setDescription('This match was mid-pick when the bot was updated. Open a new call.')
    .setFooter(footer());
}

/** The open call: "someone is looking for a 1v1". Fills up, then starts itself. */
export function openEmbed(match: Match, rows: MatchPlayer[], players: Map<string, Player>) {
  const { max } = FORMATS[match.format as Format];

  return new EmbedBuilder()
    .setTitle(`Looking for a ${match.format}`)
    .setColor(matchColor(match))
    .setDescription(
      // How many seats are left is the whole point of this message, so it goes
      // in the body at full size rather than in the grey line under it.
      `**${rows.length}/${max}** · starts the moment it fills\n\n` +
        rows
          .map((r) => {
            const p = players.get(r.discord_id)!;
            const band = rankLabel(match.guild_id, r.discord_id, p.elo);
            return `<@${r.discord_id}> · **${p.elo}**${band ? ` ${band}` : ''}`;
          })
          .join('\n'),
    )
    .setFooter(footer());
}

/** What staff just changed, for the announcements channel.
 *
 *  Names the change rather than saying "settings were updated": a player who
 *  cannot see what moved has learned nothing, and will find out by losing a
 *  match on a scenario nobody told them about. Attributed, because a rule
 *  change with a name on it is one people can ask about. */
export function changeEmbed(lines: string[], byId: string) {
  return new EmbedBuilder()
    .setTitle('Setup changed')
    .setColor(BLURPLE)
    .setDescription(`${lines.map((l) => `· ${l}`).join('\n')}\n\nChanged by <@${byId}>.`)
    .setFooter(footer());
}

/** The queue panel: three beats, because that is the whole game - press the
 *  button, play in the thread, the scores arrive on their own.
 *
 *  The numbers all come from the server itself, so the panel can neither
 *  promise a match it doesn't run nor claim a queue nobody is in. The last line
 *  is the one that moves; the tick edits this message when it changes. */
export function panelMessage(formats: readonly Format[] = PANEL_FORMATS, guildId?: string) {
  const { rounds, runs } = guildId
    ? getFormat(guildId)
    : { rounds: ROUNDS, runs: RUNS_PER_SCENARIO };
  const buttons = formats.map((f) => `**${f}**`).join(' or ');
  const stats = guildId ? guildStats(guildId) : null;
  // An empty ladder is worth saying out loud - "0 played" reads as broken,
  // where "be the first" reads as an invitation.
  const pulse = !stats
    ? ''
    : stats.played === 0
      ? '\n\nNobody has played yet. Be the first.'
      : `\n\n**${stats.week}** played this week · **${stats.running}** ` +
        `${stats.running === 1 ? 'match' : 'matches'} up right now`;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(formats.length === 1 ? `Quorum · ${formats[0]}` : 'Quorum')
        .setColor(BLURPLE)
        .setDescription(
          `Press ${buttons}. Your call goes up here, and the first person to take it plays you.\n\n` +
            `You get a private thread to yourselves. Ban and pick **${rounds} scenarios** in it, ` +
            `**${runs} runs each**.\n\n` +
            `Scores are read straight off KovaaK's. Nothing to submit, nothing to screenshot, ` +
            `nothing to argue about.` +
            pulse,
        )
        .setFooter(footer()),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        formats.map((f) =>
          new ButtonBuilder().setCustomId(`pug:open:${f}`).setLabel(f).setStyle(ButtonStyle.Primary),
        ),
      ),
      // Only where there is a role to opt into. Self-serve, because the
      // alternative is a second bot for role buttons or an admin handing out a
      // notification role one person at a time.
      ...(guildId && getConfig(guildId).ping_role_id
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId('pug:notify')
                .setLabel('Notify me')
                .setStyle(ButtonStyle.Secondary),
            ),
          ]
        : []),
    ],
  };
}

/** What to call someone's rank.
 *
 *  With staff-owned brackets the ROLE is the bracket, so a name read off Elo
 *  would print one nobody is in - a Champion who has had a bad month is still
 *  Champion. Quorum runs on the Guilds intent alone and so only knows the roles
 *  of people it has actually seen; where it cannot see them it says nothing,
 *  because a rating on its own beats a confident wrong bracket.
 *
 *  Pass the guild only where every row can be resolved the same way. The
 *  leaderboard deliberately does not: half a board labelled and half not reads
 *  as a bug. */
export function rankLabel(guildId: string, discordId: string, elo: number, guild?: Guild | null) {
  const ranks = getRanks(guildId);
  if (getRankMode(guildId) !== 'manual') return rankName(ranks, elo);
  const held = guild?.members.cache.get(discordId)?.roles.cache;
  return held ? (rankForRoles(ranks, held.map((r) => r.id) as string[])?.name ?? '') : '';
}

/** Discord's "Unknown Message" (10008) - the one refusal that means a message
 *  really is gone, rather than that we could not reach it just now.
 *
 *  Every other failure has to be read as "still there". The standing
 *  leaderboard reposts itself when its message has been deleted, and a rate
 *  limit or a blip taken for a deletion leaves two boards in the channel with
 *  only one of them ever updated again. */
export const messageGone = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 10008;

/** Ten to a page: a phone shows about that many lines of a Discord embed before
 *  it starts scrolling, and a leaderboard you have to scroll is one nobody
 *  reads past third place. */
export const LADDER_PAGE = 10;

/** The ladder, one page of it, with the buttons that turn the page.
 *
 *  Drawn from the database on every call rather than from a stored page, so a
 *  board someone left open overnight and a board posted this second say the
 *  same thing. The page number rides in the button's id - there is nowhere else
 *  to keep it that survives a restart, and it is the only state a page has. */
export function leaderboardMessage(guildId: string, page = 0) {
  const total = ladderSize(guildId);
  const pages = Math.max(1, Math.ceil(total / LADDER_PAGE));
  // Clamped, not trusted: the id comes back off a button that may be older than
  // the last three players to leave the ladder.
  const at = Math.min(Math.max(page, 0), pages - 1);
  const rows = leaderboard(guildId, LADDER_PAGE, at * LADDER_PAGE);

  const line = (p: Player, n: number) => {
    const games = p.wins + p.losses;
    const rate = games ? ` (${Math.round((p.wins / games) * 100)}%)` : '';
    // The top three are the only rows worth a marker - a medal beside eleventh
    // place is decoration, and it pushes the name out of line with the rest.
    const place = ['🥇', '🥈', '🥉'][n] ?? `**${n + 1}.**`;
    const band = rankLabel(guildId, p.discord_id, p.elo);
    return `${place} <@${p.discord_id}> - **${p.elo}**${band ? ` ${band}` : ''} · ` +
      `${p.wins}W ${p.losses}L${rate}`;
  };

  const embed = new EmbedBuilder()
    .setTitle('Ladder')
    .setColor(BLURPLE)
    .setDescription(
      rows.length
        ? rows.map((p, n) => line(p, at * LADDER_PAGE + n)).join('\n')
        : '_no games played yet_',
    )
    .setFooter({
      text: total
        ? `Page ${at + 1} of ${pages} · ${total} ranked · powered by kova`
        : footer().text,
    });

  // A one-page ladder gets no buttons at all: two dead controls under it say
  // there is more to see when there isn't.
  const components =
    pages > 1
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`pug:lb:${at - 1}`)
              .setLabel('Back')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(at === 0),
            new ButtonBuilder()
              .setCustomId(`pug:lb:${at + 1}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(at >= pages - 1),
          ),
        ]
      : [];

  return { embeds: [embed], components };
}

export function liveEmbed(match: Match, rows: MatchPlayer[], players: Map<string, Player>) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const teams = [...new Set(rows.map((r) => r.team))];

  // Discord renders this relative and per-viewer, so nobody has to work out
  // what time zone the deadline was written in.
  const { runs, matchTtlMin } = getFormat(match.guild_id);
  const deadline = Math.floor(
    ((match.started_at ?? Date.now()) + matchTtlMin * 60_000) / 1000,
  );
  const embed = new EmbedBuilder()
    .setTitle(`${match.format} · ongoing`)
    .setColor(BLURPLE)
    .setDescription(
      `**${runs} run${runs === 1 ? '' : 's'} per scenario**, best of them counts - one more does ` +
        `not, so there is nothing to gain by grinding. Play them in any order; scores update on ` +
        `their own.\n\nThe result posts itself once everyone has run all ${scenarios.length}, ` +
        `or <t:${deadline}:R> either way. **Done** ends it early for both of you.\n\n${scenarios
          .map((s, i) => `**${i + 1}.** ${s}`)
          .join('\n')}`,
    );

  for (const team of teams) {
    const members = rows.filter((r) => r.team === team);
    embed.addFields({
      name: teams.length > 1 && members.length > 1 ? `Team ${team + 1}` : '​',
      value: members
        .map((r) => {
          const scores = JSON.parse(r.scores) as Record<string, number | null>;
          const used = JSON.parse(r.run_counts ?? '{}') as Record<string, number>;
          // The run count only shows while it is still short - a scenario they
          // have finished with is just a score, and what is left to play is
          // what the reader is looking for.
          const line = scenarios
            .map((s) => {
              const score = scores[s]?.toFixed(0) ?? '–';
              const n = used[s] ?? 0;
              return n > 0 && n < runs ? `${score} ${n}/${runs}` : score;
            })
            .join(' · ');
          return `${r.done ? '✅' : '·'} <@${r.discord_id}>\n\`${line}\``;
        })
        .join('\n'),
      inline: true,
    });
  }
  return embed.setFooter(footer());
}

/** Nobody posted a score. Said plainly, because the alternative - a results
 *  embed full of dashes - reads as a game that was played and lost. */
export function noContestEmbed(match: Match, rows: MatchPlayer[]) {
  return new EmbedBuilder()
    .setTitle(`${match.format} · no result`)
    .setColor(GREY)
    .setDescription(
      `${rows.map((r) => `<@${r.discord_id}>`).join(' and ')} - nobody ran a scenario, ` +
        "so nothing was rated. No Elo moved and the match is not on anyone's record.",
    )
    .setFooter(footer());
}

/** Fits a name into a fixed column, so a long scenario cannot shove a whole
 *  table sideways on a phone. Cut names keep a marker, or a truncation reads as
 *  the scenario's actual name. */
const fit = (text: string, width: number) =>
  (text.length > width ? text.slice(0, width - 1) + '…' : text).padEnd(width);

export function resultsEmbed(
  match: Match,
  rows: MatchPlayer[],
  players: Map<string, Player>,
  deltas: Map<string, number>,
) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const ordered = [...rows].sort((a, b) => (a.placing ?? 99) - (b.placing ?? 99));
  const medal = ['🥇', '🥈', '🥉'];
  const scores = new Map(
    rows.map((r) => [r.discord_id, JSON.parse(r.scores) as Record<string, number | null>]),
  );
  const bests = new Map(
    rows.map((r) => [r.discord_id, JSON.parse(r.pb ?? '{}') as Record<string, number | null>]),
  );

  // Who took each scenario, so the card can say 2-1. Same team totals the
  // placings were worked out from - the scoreline and the medals cannot
  // disagree, because they are the same sum counted twice.
  const won = scenarioWinners(
    rows.map((r) => ({ id: r.discord_id, elo: 0, team: r.team, scores: scores.get(r.discord_id)! })),
    scenarios,
  );
  const teams = [...new Set(ordered.map((r) => r.team))];
  const tally = new Map(teams.map((t) => [t, won.filter((w) => w === t).length]));
  const named = (team: number) =>
    ordered
      .filter((r) => r.team === team)
      .map((r) => players.get(r.discord_id)!.kovaaks_username)
      .join(' & ');

  // "ness beats Jay 3-1" - the one thing the card never said. Two sides only:
  // past that a scoreline needs a table of its own, and the fields below are
  // already that table.
  const top = ordered.filter((r) => r.placing === 1).map((r) => r.team);
  const win = [...new Set(top)];
  const title =
    teams.length === 2 && win.length === 1
      ? `${named(win[0])} beats ${named(teams.find((t) => t !== win[0])!)} ` +
        `${tally.get(win[0])}–${tally.get(teams.find((t) => t !== win[0])!)} · ${match.format}`
      : teams.length === 2 && win.length === 2
        ? `${named(teams[0])} draws ${named(teams[1])} ${tally.get(teams[0])}–${tally.get(teams[1])} · ${match.format}`
        : `${match.format} · results`;

  // One column per player, aligned, so a score can be read against the
  // scenario it was set on rather than counted out of a row of numbers. Names
  // are cut to keep the block inside a phone's width; the fields below carry
  // them in full.
  const cell = (r: MatchPlayer, scenario: string) => {
    const score = scores.get(r.discord_id)![scenario];
    if (score == null) return '–';
    // The star is the scenario's winner, which is what the scoreline counts.
    return score.toFixed(0) + (won[scenarios.indexOf(scenario)] === r.team ? '*' : '');
  };
  const widths = ordered.map((r) =>
    Math.max(
      6,
      players.get(r.discord_id)!.kovaaks_username.slice(0, 8).length,
      ...scenarios.map((s) => cell(r, s).length),
    ),
  );
  const table = [
    'SCENARIO'.padEnd(20) +
      ordered
        .map((r, n) => fit(players.get(r.discord_id)!.kovaaks_username.toUpperCase(), widths[n]))
        .join(' ')
        .trimEnd(),
    ...scenarios.map(
      (s) =>
        // 19 and a space, not 20: a name that fills its column whole would
        // otherwise run straight into the first score.
        fit(s, 19) + ' ' +
        ordered
          .map((r, n) => cell(r, s).padEnd(widths[n]))
          .join(' ')
          .trimEnd(),
    ),
  ].join('\n');

  const fields = ordered.map((r) => {
    const p = players.get(r.discord_id)!;
    const band = rankLabel(match.guild_id, r.discord_id, p.elo);
    const delta = deltas.get(r.discord_id) ?? 0;
    const pbs = scenarios.filter((s) => {
      const now = scores.get(r.discord_id)![s];
      const prior = bests.get(r.discord_id)![s];
      return now != null && prior != null && now - prior >= 1;
    }).length;
    return {
      name: `${r.placing == null ? '·' : (medal[r.placing - 1] ?? `#${r.placing}`)} ${p.kovaaks_username}`,
      value:
        `<@${r.discord_id}> · **${p.elo}**${band ? ` ${band}` : ''} ` +
        `${r.placing == null ? '· _no scores, not rated_' : `(${delta >= 0 ? '+' : ''}${delta})`}` +
        (pbs ? `\n_${pbs} personal best${pbs === 1 ? '' : 's'}_` : ''),
      inline: true,
    };
  });

  // What was on the table and never played. Everything offered is in ban_pool,
  // so what is in there and not in the match was struck out - and a scenario in
  // the match that was never offered is the last round, which is rolled rather
  // than picked. Worth saying: the card has always shown all three as if they
  // were chosen the same way.
  const offered: string[] = match.ban_pool ? JSON.parse(match.ban_pool) : [];
  const banned = [...new Set(offered.filter((s) => !scenarios.includes(s)))];
  const rolled = offered.length ? scenarios.filter((s) => !offered.includes(s)) : [];
  const shown = banned.slice(0, 6);
  const draft = [
    banned.length
      ? `**Banned** ${shown.join(', ')}${banned.length > shown.length ? ` +${banned.length - shown.length} more` : ''}`
      : '',
    rolled.length ? `**Rolled** ${rolled.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(GREEN)
    .setDescription('```\n' + table + '\n```' + (draft ? `\n${draft}` : ''))
    .addFields(fields)
    .setFooter(footer());
}

/** The result message's one button. It opens a plain call - same rank gate,
 *  same Join - so nothing about a rematch skips a step. */
export const rematchRow = (match: Match) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pug:rematch:${match.id}`)
      .setLabel('Rematch')
      .setStyle(ButtonStyle.Secondary),
  );
