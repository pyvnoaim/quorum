import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type Guild,
} from "discord.js";
import {
  FORMATS,
  PANEL_FORMATS,
  ROUNDS,
  RUNS_PER_SCENARIO,
  type Format,
} from "./config.js";
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
} from "./db.js";
import {
  allRunsUsed,
  forfeits,
  matchDeadline,
  rankFor,
  rankForRoles,
  rankName,
  scenarioWinners,
} from "./rating.js";

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;

/** Buttons in as few rows as Discord allows - five to a row, so the panel's
 *  formats and its Notify sit side by side instead of stacking. */
function rows(buttons: ButtonBuilder[]) {
  return Array.from({ length: Math.ceil(buttons.length / 5) }, (_, i) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i * 5, i * 5 + 5)),
  );
}

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
const footer = () => ({ text: "powered by kova" });
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
    action: "ban" | "pick";
    turn: number;
    bansLeft: number;
  },
) {
  const { rounds, pickTtlS } = getFormat(match.guild_id);
  const side = rows
    .filter((r) => r.team === phase.turn)
    .map((r) => `<@${r.discord_id}>`);
  const slot = phase.picked.length + 1;
  const locked = phase.picked
    .map((s, n) => `**${n + 1}.** \`${s}\``)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(`${match.format} · scenario ${slot} of ${rounds}`)
    .setColor(BLURPLE)
    .setDescription(
      (locked ? `${locked}\n\n` : "") +
        `${side.join(" and ")} ${phase.action === "ban" ? "bans one" : "picks one"} ` +
        `from **${phase.cats[phase.picked.length] ?? "the pool"}**` +
        (phase.action === "ban"
          ? `. ${phase.bansLeft} ban${phase.bansLeft === 1 ? "" : "s"} before the pick.`
          : " to play.") +
        `\n\nScenario ${rounds} is a random roll - nobody picks it. ` +
        `Nobody acts within **${pickTtlS}s** and the bot ${phase.action}s at random.\n\n` +
        phase.pool.map((s) => `\`${s}\``).join("\n"),
    )
    .setFooter(footer());
}

/** A match whose stored pick phase predates this version of the bot. It cannot
 *  be finished, so it says so instead of showing buttons that do nothing. */
export function staleEmbed(match: Match) {
  return new EmbedBuilder()
    .setTitle(`${match.format} · dropped`)
    .setColor(GREY)
    .setDescription(
      "This match was mid-pick when the bot was updated. Open a new call.",
    )
    .setFooter(footer());
}

/** What the call becomes once it fills: a match is on, here are the players,
 *  it ends about then. The buttons go with it - the game itself is in a private
 *  thread, so there is nothing left in the channel to press.
 *
 *  It replaces the call in place rather than being a second message. The point
 *  is that a queue channel with a game running should say so instead of going
 *  quiet, not that it should grow a message every time one starts. Taken down
 *  when the match ends, so what is on screen is only ever what is happening. */
export function runningEmbed(match: Match, players: Map<string, Player>) {
  const names = [...players.values()].map((p) => p.kovaaks_username);
  const deadline = Math.floor(
    matchDeadline(match.started_at ?? Date.now(), match.grace_from, getFormat(match.guild_id)) /
      1000,
  );
  return new EmbedBuilder()
    .setTitle(`${match.format} in play`)
    .setColor(matchColor(match))
    .setDescription(
      // "up to", not "at": the card is written once and the grace window can
      // pull the real deadline in later. An outer bound stays true either way.
      `**${names.join("** vs **")}**\n\nPlaying in their own thread` +
        `${match.started_at ? ` · up to <t:${deadline}:R>` : ""}. The result posts itself.`,
    )
    .setFooter(footer());
}

/** The open call: "someone is looking for a 1v1". Fills up, then starts itself. */
export function openEmbed(
  match: Match,
  rows: MatchPlayer[],
  players: Map<string, Player>,
) {
  const { max } = FORMATS[match.format as Format];

  return new EmbedBuilder()
    // Said on the call itself, not only on the panel above it. This is the
    // message somebody presses Take on, and a rematch lands here too - so what
    // is at stake has to be readable without scrolling up to find out.
    .setTitle(`Looking for a ${match.format}${match.ranked === 0 ? " · unranked" : ""}`)
    .setColor(matchColor(match))
    .setDescription(
      // How many seats are left is the whole point of this message, so it goes
      // in the body at full size rather than in the grey line under it.
      `**${rows.length}/${max}** · starts the moment it fills\n\n` +
        rows
          .map((r) => {
            const p = players.get(r.discord_id)!;
            const band = rankLabel(match.guild_id, r.discord_id, p.elo);
            return `<@${r.discord_id}> · **${p.elo}**${band ? ` ${band}` : ""}`;
          })
          .join("\n"),
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
    .setTitle("Setup changed")
    .setColor(BLURPLE)
    .setDescription(
      `${lines.map((l) => `· ${l}`).join("\n")}\n\nChanged by <@${byId}>.`,
    )
    .setFooter(footer());
}

/** The queue panel: three beats, because that is the whole game - press the
 *  button, play in the thread, the scores arrive on their own.
 *
 *  The numbers all come from the server itself, so the panel can neither
 *  promise a match it doesn't run nor claim a queue nobody is in. The last line
 *  is the one that moves; the tick edits this message when it changes. */
export function panelMessage(
  formats: readonly Format[] = PANEL_FORMATS,
  guildId?: string,
  channelId?: string,
  ranked = true,
) {
  const { rounds, runs } = guildId
    ? getFormat(guildId)
    : { rounds: ROUNDS, runs: RUNS_PER_SCENARIO };
  const buttons = formats.map((f) => `**${f}**`).join(" or ");
  // This channel's numbers, not the server's: a panel in #novice saying what
  // #elite has been up to is a number nobody in front of it can act on.
  const stats = guildId ? guildStats(guildId, channelId) : null;
  // Paused: the panel has to say so where the button is, not only refuse the
  // press. A greyed button with no reason next to it reads as a broken bot.
  const paused = !!(guildId && getConfig(guildId).queues_paused);
  // What is up right now, and only the halves of it that are true. A call
  // nobody has taken is never folded into the match count: it is not a match,
  // and it is the one thing on this panel a reader can act on - so an open call
  // says so, instead of being announced as a game already being played.
  const now = stats
    ? [
        stats.running
          ? `**${stats.running}** ${stats.running === 1 ? "match" : "matches"} up right now`
          : "",
        stats.waiting
          ? `**${stats.waiting}** ${stats.waiting === 1 ? "call" : "calls"} waiting for an opponent`
          : "",
      ].filter(Boolean)
    : [];
  // An empty ladder is worth saying out loud - "0 played" reads as broken,
  // where "be the first" reads as an invitation. But only when there is truly
  // nothing here: a server with a call up has something better to say.
  const pulse = !stats
    ? ""
    : stats.played === 0 && !now.length
      ? "\n\nNobody has played here yet. Be the first."
      : "\n\n" +
        [stats.played ? `**${stats.week}** played this week` : "", ...now]
          .filter(Boolean)
          .join(" · ");

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(
          ranked
            ? formats.length === 1
              ? `Quorum · ${formats[0]}`
              : "Quorum"
            : `Quorum · unranked`,
        )
        .setColor(paused ? GREY : ranked ? BLURPLE : GREY)
        .setDescription(
          (paused
            ? "**Queues are paused.** Staff have closed them for now - nothing new can be " +
              "opened or taken until they are back on. Matches already running play out.\n\n"
            : "") +
            (ranked
              ? ""
              : "**Nothing is at stake here.** No rating moves and no win or loss is " +
                "recorded - but every score is read and kept the same way, so this is " +
                "also where staff can see what you actually shoot before placing you.\n\n") +
            `Press ${buttons}. Your call goes up here, and the first person to take it plays you.\n\n` +
            `You get a private thread to yourselves. Ban and pick **${rounds} scenarios** in it, ` +
            `**${runs} runs each**.\n\n` +
            `Scores are read straight off KovaaK's. Nothing to submit, nothing to screenshot, ` +
            `nothing to argue about.` +
            pulse,
        )
        .setFooter(footer()),
    ],
    components: rows([
      ...formats.map((f) =>
        new ButtonBuilder()
          // The stake rides on the button, not on the channel - see onButton().
          .setCustomId(ranked ? `pug:open:${f}` : `pug:open:${f}:casual`)
          .setLabel(ranked ? f : `${f} unranked`)
          .setStyle(ranked ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(paused),
      ),
      // Only where there is a role to opt into. Self-serve, because the
      // alternative is a second bot for role buttons or an admin handing out a
      // notification role one person at a time.
      ...(guildId && getConfig(guildId).ping_role_id
        ? [
            new ButtonBuilder()
              .setCustomId("pug:notify")
              .setLabel("Notify me")
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),
    ]),
  };
}

/** What to call someone's rank.
 *
 *  With staff-owned brackets the ROLE is the bracket, so a name read off Elo
 *  would print one nobody is in - a Champion who has had a bad month is still
 *  Champion. The GuildMembers intent is what makes that answerable at all; where
 *  a member still cannot be resolved it says nothing, because a rating on its
 *  own beats a confident wrong bracket.
 *
 *  The guild argument is only an override for a caller that already holds one -
 *  everything else goes through the client below, because a rank the caller had
 *  to remember to make resolvable is one three call sites out of four forgot. */
export function rankLabel(
  guildId: string,
  discordId: string,
  elo: number,
  guild?: Guild | null,
) {
  const ranks = getRanks(guildId);
  if (getRankMode(guildId) !== "manual") return rankName(ranks, elo);
  const where = guild ?? client?.guilds.cache.get(guildId) ?? null;
  const held = where?.members.cache.get(discordId)?.roles.cache;
  return held
    ? (rankForRoles(ranks, held.map((r) => r.id) as string[])?.name ?? "")
    : "";
}

/** The client, handed over once at boot.
 *
 *  In manual mode a rank IS a Discord role, so naming one needs the member -
 *  and threading a Guild down through every embed that shows a rank is exactly
 *  how the call embed, the leaderboard and the result card all came to leave it
 *  out and print nothing at all. One accessor set once, and no call site can
 *  get it wrong. Null before boot and under test, where rankLabel falls back to
 *  saying nothing, which is what it did everywhere before. */
let client: Client | null = null;
export const useClient = (c: Client) => {
  client = c;
};

/** Discord's "Unknown Message" (10008) - the one refusal that means a message
 *  really is gone, rather than that we could not reach it just now.
 *
 *  Every other failure has to be read as "still there". The standing
 *  leaderboard reposts itself when its message has been deleted, and a rate
 *  limit or a blip taken for a deletion leaves two boards in the channel with
 *  only one of them ever updated again. */
export const messageGone = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: number }).code === 10008;

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
    // Draws are games. Left out of the total they would put the rate over what
    // was actually played; counted as wins they would flatter it.
    const games = p.wins + p.losses + p.draws;
    const rate = games ? ` (${Math.round((p.wins / games) * 100)}%)` : "";
    // The top three are the only rows worth a marker - a medal beside eleventh
    // place is decoration, and it pushes the name out of line with the rest.
    const place = ["🥇", "🥈", "🥉"][n] ?? `**${n + 1}.**`;
    const band = rankLabel(guildId, p.discord_id, p.elo);
    return (
      `${place} <@${p.discord_id}> - **${p.elo}**${band ? ` ${band}` : ""} · ` +
      // The D only shows on a record that has one - most never will, and a
      // column of "0D" down the board is noise for a thing that rarely happens.
      `${p.wins}W ${p.losses}L${p.draws ? ` ${p.draws}D` : ""}${rate}`
    );
  };

  const embed = new EmbedBuilder()
    .setTitle("Ladder")
    .setColor(BLURPLE)
    .setDescription(
      rows.length
        ? rows.map((p, n) => line(p, at * LADDER_PAGE + n)).join("\n")
        : "_no games played yet_",
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
              .setLabel("Back")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(at === 0),
            new ButtonBuilder()
              .setCustomId(`pug:lb:${at + 1}`)
              .setLabel("Next")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(at >= pages - 1),
          ),
        ]
      : [];

  return { embeds: [embed], components };
}

export function liveEmbed(
  match: Match,
  rows: MatchPlayer[],
  players: Map<string, Player>,
) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const teams = [...new Set(rows.map((r) => r.team))];
  // Read once: this is a config row off disk, and the board renders it per
  // player, per scenario, every tick.
  const fmt = getFormat(match.guild_id);
  const runs = fmt.runs;
  const scores = new Map(
    rows.map((r) => [
      r.discord_id,
      JSON.parse(r.scores) as Record<string, number | null>,
    ]),
  );
  // Who is ahead on each scenario RIGHT NOW, counted exactly as the result will
  // count it. A lead that changes when the match ends would be a different
  // scoreboard, not a live one - so the forfeit counts here too: a scenario
  // somebody is still short on is a scenario they are currently losing, and the
  // board has to say that while there is still time to fix it. The cell keeps
  // showing what they actually ran, next to the count that explains the star.
  const forfeited = forfeits(
    rows.map((r) => ({
      id: r.discord_id,
      scores: scores.get(r.discord_id)!,
      runCounts: r.run_counts ? (JSON.parse(r.run_counts) as Record<string, number>) : null,
    })),
    scenarios,
    runs,
  );
  const ahead = scenarioWinners(
    rows.map((r) => ({
      id: r.discord_id,
      elo: 0,
      team: r.team,
      scores: forfeited.get(r.discord_id)!,
    })),
    scenarios,
  );
  const tally = new Map(
    teams.map((t) => [t, ahead.filter((w) => w === t).length]),
  );
  const side = (team: number) =>
    rows
      .filter((r) => r.team === team)
      .map((r) => players.get(r.discord_id)?.kovaaks_username ?? "someone")
      .join(" & ");

  // Discord renders this relative and per-viewer, so nobody has to work out
  // what time zone the deadline was written in.
  const deadline = Math.floor(
    matchDeadline(match.started_at ?? Date.now(), match.grace_from, fmt) / 1000,
  );
  // The running score in the title, so the state of the game is the first thing
  // read rather than something worked out from six numbers.
  const [a, b] = teams;
  const lead =
    teams.length !== 2 || !ahead.some(Boolean)
      ? "ongoing"
      : tally.get(a) === tally.get(b)
        ? `level ${tally.get(a)}–${tally.get(b)}`
        : tally.get(a)! > tally.get(b)!
          ? `${side(a)} leads ${tally.get(a)}–${tally.get(b)}`
          : `${side(b)} leads ${tally.get(b)}–${tally.get(a)}`;

  const embed = new EmbedBuilder()
    .setTitle(`${match.format} · ${lead}`)
    .setColor(BLURPLE)
    .setDescription(
      `**${runs} run${runs === 1 ? "" : "s"} per scenario**, best of them counts - a later one ` +
        `does not, and a scenario you stop short on scores **0**. Play all ${scenarios.length} ` +
        `out: against somebody who did, a short scenario forfeits the **whole match**, not just ` +
        `that round. Play them in any order; scores ` +
        `update on their own.\n\nThe result posts itself once everyone has run all ` +
        `${scenarios.length}, or <t:${deadline}:R> either way - and that clock ` +
        `${match.grace_from ? "is running: somebody has finished" : "closes in once the first of you finishes"}. ` +
        `**Done** gives up the runs you have left.` +
        "\n```\n" +
        scoreTable(
          scenarios,
          rows.map((r) => {
            const used = JSON.parse(r.run_counts ?? "{}") as Record<
              string,
              number
            >;
            return {
              head: players.get(r.discord_id)?.kovaaks_username ?? "?",
              cell: (s: string) => {
                const score = scores.get(r.discord_id)![s];
                const runsOn = used[s] ?? 0;
                // The run count shows while it is still short - a scenario they
                // have finished with is just a score, and what is left to play
                // is what the reader is looking for. Zero shows too, now that
                // stopping short scores 0: "0/3" is the warning.
                const shown = score?.toFixed(0) ?? "–";
                const star =
                  score != null && ahead[scenarios.indexOf(s)] === r.team
                    ? "*"
                    : "";
                return runsOn < runs ? `${shown}${star} ${runsOn}/${runs}` : shown + star;
              },
            };
          }),
        ) +
        "\n```",
    );

  // The scores moved into the board above, so a side is down to the one thing
  // the board cannot say: whether they have called it a night.
  for (const team of teams) {
    const members = rows.filter((r) => r.team === team);
    embed.addFields({
      name: teams.length > 1 && members.length > 1 ? `Team ${team + 1}` : "​",
      value: members
        .map(
          (r) => `${r.done ? "✅ done" : "· still playing"} <@${r.discord_id}>`,
        )
        .join("\n"),
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
      `${rows.map((r) => `<@${r.discord_id}>`).join(" and ")} - nobody ran a scenario, ` +
        "so nothing was rated. No Elo moved and the match is not on anyone's record.",
    )
    .setFooter(footer());
}

/** Width in characters, not code units: a KovaaK's name with an emoji in it
 *  occupies one column, and padEnd would count it as two and misalign the row
 *  under it. */
const glyphCount = (text: string) => [...text].length;

/** Fits a name into a fixed column, so a long name cannot shove a whole table
 *  sideways on a phone. Cut names keep a marker, or a truncation reads as the
 *  name itself. */
const fit = (text: string, width: number) => {
  // by character, not by code unit: slicing a KovaaK's name with an emoji in it
  // halfway through a surrogate pair prints a broken glyph.
  const glyphs = [...text];
  return (
    glyphs.length > width ? glyphs.slice(0, width - 1).join("") + "…" : text
  ).padEnd(width);
};

/** Pads to a column width by character, so an emoji in a name still leaves the
 *  scores under each other. */
const pad = (text: string, width: number) =>
  text + " ".repeat(Math.max(0, width - glyphCount(text)));

/** The scoreboard both the live card and the result share: one row per
 *  scenario, one column per player, everything aligned so a number can be read
 *  against the scenario it was set on. */
function scoreTable(
  scenarios: string[],
  cols: { head: string; cell: (s: string) => string }[],
) {
  const widths = cols.map((c) =>
    Math.max(
      6,
      c.head.slice(0, 8).length,
      ...scenarios.map((s) => c.cell(s).length),
    ),
  );
  // The scenario column is never cut. Every other name on this card is carried
  // in full somewhere else - the players are named in the fields below - but a
  // scenario is named HERE and nowhere else, and half a name is not something
  // anyone can go and find in KovaaK's. So it is sized to the longest name in
  // the match: on a narrow screen the block scrolls sideways, which is a swipe,
  // where a cut name is a scenario nobody can look up.
  const nameWidth = Math.max(8, ...scenarios.map(glyphCount));
  const row = (
    name: string,
    cell: (c: (typeof cols)[number], n: number) => string,
  ) =>
    // The space sits outside the column, not inside it: a name that fills its
    // column whole would otherwise run straight into the first score.
    (
      pad(name, nameWidth) +
      " " +
      cols.map((c, n) => cell(c, n).padEnd(widths[n])).join(" ")
    ).trimEnd();

  return [
    row("SCENARIO", (c, n) => fit(c.head.toUpperCase(), widths[n])),
    ...scenarios.map((s) => row(s, (c) => c.cell(s))),
  ].join("\n");
}

export function resultsEmbed(
  match: Match,
  rows: MatchPlayer[],
  players: Map<string, Player>,
  deltas: Map<string, number>,
) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  // Only an explicit 0 is unranked. The column defaults to 1 and every row that
  // existed before it was added was rated, so anything else - including a row
  // that never carried the field - is a rated match.
  const rated = match.ranked !== 0;
  const ordered = [...rows].sort(
    (a, b) => (a.placing ?? 99) - (b.placing ?? 99),
  );
  const medal = ["🥇", "🥈", "🥉"];
  // The forfeited view, not the raw one: a scenario somebody stopped short on
  // scored 0 in the maths, so the scoreline, the stars and the personal-best
  // count all have to read it as 0 too. The card and the result are the same
  // sum counted twice, and they must never disagree.
  const want = getFormat(match.guild_id).runs;
  const used = (r: MatchPlayer) =>
    r.run_counts ? (JSON.parse(r.run_counts) as Record<string, number>) : null;
  // Who played the format out, in row order - the same test forfeits() applies.
  const playedOut = rows.map((r) => {
    const c = used(r);
    return !c || allRunsUsed(scenarios, [c], want);
  });
  const scores = forfeits(
    rows.map((r) => ({
      id: r.discord_id,
      scores: JSON.parse(r.scores) as Record<string, number | null>,
      runCounts: used(r),
    })),
    scenarios,
    want,
  );
  const bests = new Map(
    rows.map((r) => [
      r.discord_id,
      JSON.parse(r.pb ?? "{}") as Record<string, number | null>,
    ]),
  );

  // Who took each scenario, so the card can say 2-1. Same team totals the
  // placings were worked out from - the scoreline and the medals cannot
  // disagree, because they are the same sum counted twice.
  const won = scenarioWinners(
    rows.map((r) => ({
      id: r.discord_id,
      elo: 0,
      team: r.team,
      scores: scores.get(r.discord_id)!,
    })),
    scenarios,
  );
  const teams = [...new Set(ordered.map((r) => r.team))];
  const tally = new Map(
    teams.map((t) => [t, won.filter((w) => w === t).length]),
  );
  const named = (team: number) =>
    ordered
      .filter((r) => r.team === team)
      .map((r) => players.get(r.discord_id)!.kovaaks_username)
      .join(" & ");

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
    if (score == null) return "–";
    // The star is the scenario's winner, which is what the scoreline counts.
    return (
      score.toFixed(0) +
      (won[scenarios.indexOf(scenario)] === r.team ? "*" : "")
    );
  };
  const table = scoreTable(
    scenarios,
    ordered.map((r) => ({
      head: players.get(r.discord_id)!.kovaaks_username,
      cell: (s: string) => cell(r, s),
    })),
  );

  const fields = ordered.map((r) => {
    const p = players.get(r.discord_id)!;
    const band = rankLabel(match.guild_id, r.discord_id, p.elo);
    const delta = deltas.get(r.discord_id) ?? 0;
    const pbs = scenarios.filter((s) => {
      const now = scores.get(r.discord_id)![s];
      const prior = bests.get(r.discord_id)![s];
      return now != null && prior != null && now - prior >= 1;
    }).length;
    // Why a 0 is a 0. Without this the card shows someone losing a scenario
    // they were winning, and the only explanation is in the rules text of a
    // message that has already been deleted with the thread.
    const counts = used(r);
    const short = counts
      ? scenarios.filter((s) => (counts[s] ?? 0) > 0 && (counts[s] ?? 0) < want)
      : [];
    // ...and why a whole row of them is a whole row. See forfeits().
    const gaveUp = playedOut.some(Boolean) && !playedOut[rows.indexOf(r)];
    return {
      name: `${r.placing == null ? "·" : (medal[r.placing - 1] ?? `#${r.placing}`)} ${p.kovaaks_username}`,
      value:
        `<@${r.discord_id}> · **${p.elo}**${band ? ` ${band}` : ""} ` +
        // No delta on an unranked row rather than a "(+0)", which reads as a
        // rated game that happened to be worth nothing.
        `${
          r.placing == null
            ? "· _no scores, not rated_"
            : rated
              ? `(${delta >= 0 ? "+" : ""}${delta})`
              : ""
        }` +
        (pbs ? `\n_${pbs} personal best${pbs === 1 ? "" : "s"}_` : "") +
        (gaveUp
          ? `\n_forfeited the match - did not play all ${scenarios.length} out_`
          : short.length
            ? `\n_forfeited ${short.length} scenario${short.length === 1 ? "" : "s"} - runs left unused_`
            : ""),
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
  const rolled = offered.length
    ? scenarios.filter((s) => !offered.includes(s))
    : [];
  const shown = banned.slice(0, 6);
  const draft = [
    banned.length
      ? `**Banned** ${shown.join(", ")}${banned.length > shown.length ? ` +${banned.length - shown.length} more` : ""}`
      : "",
    rolled.length ? `**Rolled** ${rolled.join(", ")}` : "",
  ]
    .filter(Boolean)
    // A line each: the ban list wraps to three lines on its own, and "Rolled"
    // hanging off the end of it read as one more banned scenario.
    .join("\n");

  return new EmbedBuilder()
    .setTitle(rated ? title : `${title} · unranked`)
    .setColor(rated ? GREEN : GREY)
    .setDescription(
      "```\n" +
        table +
        "\n```" +
        // Said on the result, not only on the panel they queued from: the card
        // outlives the thread, and somebody reading it later has no other way to
        // tell why nobody's rating moved.
        (rated ? "" : "\n_Unranked - no rating moved and no record was kept._") +
        (draft ? `\n${draft}` : ""),
    )
    .addFields(fields)
    .setFooter(footer());
}

/** The result message's one button. It opens a plain call - same rank gate,
 *  same Join - so nothing about a rematch skips a step. */
export const rematchRow = (match: Match) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pug:rematch:${match.id}`)
      .setLabel("Rematch")
      .setStyle(ButtonStyle.Secondary),
  );
