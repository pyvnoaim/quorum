import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type Interaction,
} from 'discord.js';
import {
  BAN_POOL,
  BAN_TTL_MS,
  CALL_TTL_MS,
  FORMATS,
  MATCH_TTL_MS,
  ROUNDS,
  TICK_MS,
  TIERS,
  type Format,
  type Tier,
} from './config.js';
import {
  db,
  ensurePlayer,
  getConfig,
  getMatch,
  getPlayer,
  getRankSpread,
  getRanks,
  getScenarios,
  leaderboard,
  matchPlayers,
  setTier,
  type Match,
  type MatchPlayer,
} from './db.js';
import { banEmbed, liveEmbed, openEmbed, resultsEmbed } from './embeds.js';
import { startWeb } from './web.js';
import { kovaaksAccountForDiscordId, scoreInWindow } from './kovaaks.js';
import { bandsInReach, banTurn, canPlay, eloDeltas, placings, rankFor, rankName } from './rating.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');

const client = new Client({
  // GuildVoiceStates is what makes member.voice.channel readable - without it
  // nobody can be dragged into the match VC.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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
  .setName('pug')
  .setDescription('pick-up games')
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
      .setName('tier')
      .setDescription('set a player’s tier (staff)')
      .addUserOption((o) => o.setName('player').setDescription('who').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('tier')
          .setDescription('their bracket')
          .setRequired(true)
          .addChoices(...TIERS.map((t) => ({ name: t, value: t }))),
      ),
  );

/** One scenario per category, cycling, so a match is never three of the same
 *  thing. Falls back to whatever is left if the pool is smaller than ROUNDS. */
function rollScenarios(guildId: string, want = ROUNDS) {
  const pool = getScenarios(guildId);
  const cats = [...new Set(pool.map((s) => s.category))].map((c) =>
    pool.filter((s) => s.category === c).map((s) => s.name),
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

/** Whose turn it is, and how many bans are left. Both fall out of how much of
 *  the pool is gone, so a ban phase stores nothing beyond the pool itself. */
function banState(match: Match) {
  const pool: string[] = JSON.parse(match.scenarios);
  return { pool, ...banTurn(pool.length, BAN_POOL, ROUNDS) };
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
    const { pool, turn, left } = banState(match);
    // Discord allows five buttons a row, and BAN_POOL is small.
    const rowsOfFive = pool.reduce<string[][]>((acc, name, n) => {
      if (n % 5 === 0) acc.push([]);
      acc[acc.length - 1].push(name);
      return acc;
    }, []);
    return {
      embeds: [banEmbed(match, rows, players, turn, left)],
      components: rowsOfFive.map((group, groupIdx) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          group.map((name, n) =>
            new ButtonBuilder()
              // the index into the pool, not the name - a scenario name is
              // longer than a custom id is allowed to be.
              .setCustomId(`pug:ban:${match.id}:${groupIdx * 5 + n}`)
              .setLabel(name.length > 78 ? name.slice(0, 77) + '…' : name)
              .setStyle(ButtonStyle.Secondary),
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

/** A throwaway voice channel per match, deleted when it ends. Only someone
 *  already sitting in voice can be moved - the rest get the channel link in the
 *  match message, which is the best Discord allows. */
async function openVoice(guild: Guild, match: Match, rows: MatchPlayer[]) {
  const category = getConfig(guild.id).voice_category_id;
  if (!category) return null;
  const channel = await guild.channels
    .create({
      name: `${match.format} #${match.id}`,
      type: ChannelType.GuildVoice,
      parent: category,
      userLimit: rows.length,
    })
    .catch(() => null);
  if (!channel) return null;

  await Promise.all(
    rows.map(async (r) => {
      const member = await guild.members.fetch(r.discord_id).catch(() => null);
      if (member?.voice.channel) await member.voice.setChannel(channel).catch(() => {});
    }),
  );
  return channel.id;
}

async function startMatch(guild: Guild, match: Match) {
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
  const voiceId = await openVoice(guild, match, rows);
  db.prepare('update match set voice_channel_id = ? where id = ?').run(voiceId, match.id);

  // Group has no two sides to alternate between, and a pool no bigger than the
  // round count has nothing to ban - either way, roll and play.
  // A short pool can't fill BAN_POOL, and whose turn it is is derived from how
  // much of BAN_POOL is gone - so anything less just plays a plain roll.
  const pool = rollScenarios(guild.id, BAN_POOL);
  if (match.format === 'group' || pool.length < BAN_POOL) {
    return beginPlay(getMatch(match.id)!, rollScenarios(guild.id));
  }
  // created_at is reused as "when the current pre-game phase began": the lobby
  // sweep only ever reads it for status 'lobby', and the ban sweep wants
  // exactly this. Without the bump, a call that sat open an hour would have
  // every ban auto-fired the instant it filled.
  db.prepare(
    "update match set status = 'banning', scenarios = ?, created_at = ? where id = ?",
  ).run(JSON.stringify(pool), Date.now(), match.id);
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

/** Removes one scenario and, if that was the last ban, starts the match. */
function applyBan(match: Match, index: number) {
  const { pool } = banState(match);
  if (index < 0 || index >= pool.length) return match;
  pool.splice(index, 1);
  if (pool.length <= ROUNDS) return beginPlay(match, pool);
  db.prepare('update match set scenarios = ? where id = ?').run(JSON.stringify(pool), match.id);
  return getMatch(match.id)!;
}

/** Reads every player's best in-window run off KovaaK's. A score already on
 *  record is never overwritten by a null - the window only grows, so a missing
 *  answer means KovaaK's blinked, not that the run vanished. */
async function refreshScores(match: Match) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const end = match.ended_at ?? Date.now();
  await Promise.all(
    matchPlayers(match.id).map(async (row) => {
      const player = getPlayer(row.discord_id)!;
      const scores = JSON.parse(row.scores) as Record<string, number | null>;
      await Promise.all(
        scenarios.map(async (scenario) => {
          const res = await scoreInWindow(
            player.kovaaks_username,
            scenario,
            match.started_at!,
            end,
          );
          if (res.ok && res.score !== null) scores[scenario] = res.score;
          else if (!(scenario in scores)) scores[scenario] = null;
        }),
      );
      db.prepare('update match_player set scores = ? where match_id = ? and discord_id = ?').run(
        JSON.stringify(scores),
        match.id,
        row.discord_id,
      );
    }),
  );
}

async function finishMatch(match: Match) {
  db.prepare('update match set status = ?, ended_at = ? where id = ?').run(
    'done',
    Date.now(),
    match.id,
  );
  const done = getMatch(match.id)!;
  await refreshScores(done);

  const rows = matchPlayers(done.id);
  const entrants = rows.map((r) => ({
    id: r.discord_id,
    elo: getPlayer(r.discord_id)!.elo,
    team: r.team,
    scores: JSON.parse(r.scores) as Record<string, number | null>,
  }));
  const placing = placings(entrants, JSON.parse(done.scenarios));
  const deltas = eloDeltas(entrants, placing);

  for (const entrant of entrants) {
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

  if (done.voice_channel_id) {
    const vc = await client.channels.fetch(done.voice_channel_id).catch(() => null);
    if (vc?.isVoiceBased()) await vc.delete().catch(() => {});
  }
  return { match: getMatch(done.id)!, deltas };
}

/** One PATCH per member: keep every role that isn't a rank role, add the one
 *  they've earned. Never roles.set([rankRole]) - that would strip everything
 *  else they hold. */
async function syncRankRoles(guildId: string, discordIds: string[]) {
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
  if (match.message_id) {
    const channel = await client.channels.fetch(match.channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      const msg = await channel.messages.fetch(match.message_id).catch(() => null);
      await msg?.delete().catch(() => {});
    }
  }
  if (match.voice_channel_id) {
    const vc = await client.channels.fetch(match.voice_channel_id).catch(() => null);
    if (vc?.isVoiceBased()) await vc.delete().catch(() => {});
  }
}

/** Ends a match and cleans up after it. The Done button and the clock both
 *  route through here, so there is exactly one place that posts a result. */
async function concludeMatch(match: Match) {
  const { match: done, deltas } = await finishMatch(match);
  const rows = matchPlayers(done.id);
  const players = new Map(rows.map((r) => [r.discord_id, getPlayer(r.discord_id)!]));
  const embed = resultsEmbed(done, rows, players, deltas);

  const channelId = getConfig(done.guild_id).results_channel_id ?? done.channel_id;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const posted = channel?.isSendable() ? await channel.send({ embeds: [embed] }).catch(() => null) : null;

  if (done.message_id) {
    const home = await client.channels.fetch(done.channel_id).catch(() => null);
    if (home?.isTextBased()) {
      const msg = await home.messages.fetch(done.message_id).catch(() => null);
      // The call message goes away once the result lives elsewhere; if posting
      // failed it becomes the result instead, so nobody loses the scores.
      if (posted) await msg?.delete().catch(() => {});
      else await msg?.edit({ embeds: [embed], components: [] }).catch(() => {});
    }
  }
  await syncRankRoles(done.guild_id, rows.map((r) => r.discord_id));
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

/** An open call nobody took in an hour is stale - drop it and delete its
 *  message, so the queue channel only ever shows calls that are actually live. */
async function expireStaleCalls() {
  const stale = db
    .prepare("select * from match where status = 'lobby' and created_at < ?")
    .all(Date.now() - CALL_TTL_MS) as unknown as Match[];
  for (const match of stale) {
    db.prepare("update match set status = 'cancelled' where id = ?").run(match.id);
    if (!match.message_id) continue;
    const channel = await client.channels.fetch(match.channel_id).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const msg = await channel.messages.fetch(match.message_id).catch(() => null);
    await msg?.delete().catch(() => {});
  }
}

/** A side that walks away would hold the lobby forever, so the bot bans for
 *  them. Random, not "first in the list" - a predictable auto-ban is a strategy. */
async function expireStaleBans() {
  const stalled = db
    .prepare("select * from match where status = 'banning' and created_at < ?")
    .all(Date.now() - BAN_TTL_MS) as unknown as Match[];
  for (const match of stalled) {
    const { pool } = banState(match);
    const next = applyBan(match, Math.floor(Math.random() * pool.length));
    // reset the clock so the next side gets its own full window
    if (next.status === 'banning') {
      db.prepare('update match set created_at = ? where id = ?').run(Date.now(), match.id);
    }
    await editMatchMessage(getMatch(match.id)!);
  }
}

async function tick() {
  await expireStaleCalls();
  await expireStaleBans();
  const live = db
    .prepare("select * from match where status = 'live'")
    .all() as unknown as Match[];
  for (const match of live) {
    if (Date.now() - (match.started_at ?? 0) >= MATCH_TTL_MS) {
      await concludeMatch(match);
      continue;
    }
    await refreshScores(match);
    await editMatchMessage(getMatch(match.id)!);
  }
}

client.once('clientReady', async (c) => {
  await c.application.commands.set([command.toJSON()]);
  startWeb(c, { concludeMatch, cancelMatch });
  setInterval(() => void tick().catch(console.error), TICK_MS).unref();
  console.log(`ready as ${c.user.tag}`);
});

client.on('interactionCreate', async (i: Interaction) => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'pug') await onCommand(i);
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
    // this server's ladder, not every server's - the rank names below come
    // from this guild's ranks, so the rows must too.
    const rows = leaderboard(i.guildId!);
    const ranks = getRanks(i.guildId!);
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Ladder')
          .setColor(0x5865f2)
          .setDescription(
            rows.length
              ? rows
                  .map(
                    (p, n) =>
                      `**${n + 1}.** <@${p.discord_id}> - **${p.elo}** ${rankName(ranks, p.elo)} · ${p.wins}W ${p.losses}L (${Math.round((p.wins / (p.wins + p.losses)) * 100)}%)`,
                  )
                  .join('\n')
              : '_no games played yet_',
          ),
      ],
    });
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
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(p.kovaaks_username)
          .setColor(0x5865f2)
          .setDescription(
            `**${p.elo}** ${rankName(getRanks(i.guildId!), p.elo)} · ${p.tier} tier\n${p.wins}W ${p.losses}L${games ? ` · ${Math.round((p.wins / games) * 100)}% over ${games}` : ''}`,
          ),
      ],
    });
    return;
  }

  if (sub === 'tier') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({ content: 'Staff only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const target = i.options.getUser('player', true);
    const tier = i.options.getString('tier', true) as Tier;
    const account = await kovaaksAccountForDiscordId(target.id);
    if (account.kind !== 'found') {
      await i.reply({ content: lookupError(account.kind), flags: MessageFlags.Ephemeral });
      return;
    }
    ensurePlayer(target.id, account.username, account.steamId, tier);
    setTier(target.id, tier);
    await i.reply(`<@${target.id}> is now **${tier}** tier.`);
    return;
  }

  // score
  const match = activeMatchFor(i.user.id, i.guildId!);
  if (!match) {
    await i.reply({ content: "You're not in a live match.", flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await refreshScores(match);
  const fresh = getMatch(match.id)!;
  await i.editReply(render(fresh));
  await editMatchMessage(fresh);
}

async function onButton(i: import('discord.js').ButtonInteraction) {
  const [, action, arg, extra] = i.customId.split(':');

  if (action === 'open') return onOpen(i, arg as Format);

  const match = getMatch(Number(arg));
  if (!match) {
    await i.reply({ content: 'That match is gone.', flags: MessageFlags.Ephemeral });
    return;
  }
  const rows = matchPlayers(match.id);
  const isOpener = i.user.id === match.host_id;

  if (action === 'ban') {
    if (match.status !== 'banning') {
      await i.reply({ content: 'Banning is over for that one.', flags: MessageFlags.Ephemeral });
      return;
    }
    const mine = rows.find((r) => r.discord_id === i.user.id);
    if (!mine) {
      await i.reply({ content: "You're not in that match.", flags: MessageFlags.Ephemeral });
      return;
    }
    const { turn } = banState(match);
    if (mine.team !== turn) {
      await i.reply({ content: "Not your side's ban.", flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    await editMatchMessage(applyBan(match, Number(extra)));
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
    // Rank gate against everyone already in, not just the opener - otherwise
    // two people a band apart each meet in the middle through a third.
    const ranks = getRanks(match.guild_id);
    const spread = getRankSpread(match.guild_id)[match.format];
    const clash = rows
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
    db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(
      match.id,
      i.user.id,
    );

    const full = matchPlayers(match.id).length >= FORMATS[match.format].max;
    await i.deferUpdate();
    const next = full ? await startMatch(i.guild!, match) : getMatch(match.id)!;
    await i.editReply(render(next));
    return;
  }

  if (action === 'cancel') {
    if (!isOpener) {
      await i.reply({ content: 'Only whoever opened it can cancel.', flags: MessageFlags.Ephemeral });
      return;
    }
    db.prepare("update match set status = 'cancelled' where id = ?").run(match.id);
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
    await refreshScores(match);
    await i.editReply(render(getMatch(match.id)!));
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
  const opener = ensurePlayer(i.user.id, account.username, account.steamId);

  const { lastInsertRowid } = db
    .prepare(
      'insert into match (guild_id, channel_id, host_id, format, created_at) values (?, ?, ?, ?, ?)',
    )
    .run(i.guildId, i.channelId, i.user.id, format, Date.now());
  const matchId = Number(lastInsertRowid);
  db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(
    matchId,
    i.user.id,
  );

  // Ping the bands this queue would actually admit, rather than everyone. That
  // is the whole reason not to split the queue into a channel per rank: the
  // notification is targeted, the pool of takers stays whole.
  const reach = bandsInReach(
    getRanks(i.guildId),
    opener.elo,
    getRankSpread(i.guildId)[format],
  )
    .map((r) => r.discord_role_id)
    .filter((id): id is string => !!id);
  // the configured role is an opt-in "tell me about every call", on top.
  const always = getConfig(i.guildId).ping_role_id;
  const mentions = [...new Set([...(always ? [always] : []), ...reach])];

  await i.reply({
    ...render(getMatch(matchId)!),
    ...(mentions.length
      ? {
          content: mentions.map((id) => `<@&${id}>`).join(' '),
          allowedMentions: { roles: mentions },
        }
      : {}),
  });
  const msg = await i.fetchReply();
  db.prepare('update match set message_id = ? where id = ?').run(msg.id, matchId);
}

async function editMatchMessage(match: Match) {
  if (!match.message_id) return;
  const channel = await client.channels.fetch(match.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const msg = await channel.messages.fetch(match.message_id).catch(() => null);
  await msg?.edit(render(match)).catch(() => {});
}

client.login(token);
