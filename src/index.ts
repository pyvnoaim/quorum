import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  UserSelectMenuBuilder,
  type Interaction,
} from 'discord.js';
import {
  CATEGORIES,
  FORMATS,
  RESULTS_CHANNEL_ID,
  ROUNDS,
  TIERS,
  TIER_SEED,
  type Format,
  type Tier,
} from './config.js';
import {
  db,
  ensurePlayer,
  getMatch,
  getPlayer,
  leaderboard,
  matchPlayers,
  type Match,
} from './db.js';
import { liveEmbed, lobbyEmbed, resultsEmbed } from './embeds.js';
import { kovaaksNameForDiscordId, scoreInWindow } from './kovaaks.js';
import { canPlay, eloDeltas, placings, rankName } from './rating.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const NO_LINK =
  "That account has no KovaaK's on file. Link your Discord inside KovaaK's (Settings → Discord) and try again — it's the only setup this bot needs.";

const command = new SlashCommandBuilder()
  .setName('pug')
  .setDescription('pick-up games')
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('open a game')
      .addStringOption((o) =>
        o
          .setName('format')
          .setDescription('1v1, 2v2 or a group game')
          .setRequired(true)
          .addChoices(...Object.keys(FORMATS).map((f) => ({ name: f, value: f }))),
      ),
  )
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
  )
  .setDefaultMemberPermissions(null);

/** One scenario per category, cycling, so a match is never three of the same
 *  thing. Falls back to whatever is left if the pool is smaller than ROUNDS. */
function rollScenarios() {
  const cats = Object.values(CATEGORIES);
  const out: string[] = [];
  for (let i = 0; out.length < ROUNDS && i < ROUNDS * cats.length; i++) {
    const pool = cats[i % cats.length].filter((s) => !out.includes(s));
    if (pool.length) out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

function render(match: Match) {
  const rows = matchPlayers(match.id);
  const players = new Map(rows.map((r) => [r.discord_id, getPlayer(r.discord_id)!]));
  const { max } = FORMATS[match.format];

  if (match.status === 'lobby') {
    return {
      embeds: [lobbyEmbed(match, rows, players)],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`pug:add:${match.id}`)
            .setPlaceholder('host: pick players')
            .setMinValues(1)
            .setMaxValues(Math.max(1, max - 1)),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`pug:accept:${match.id}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`pug:leave:${match.id}`)
            .setLabel('Leave')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`pug:begin:${match.id}`)
            .setLabel('Start')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`pug:cancel:${match.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    };
  }
  if (match.status === 'live') {
    return {
      embeds: [liveEmbed(match, rows, players)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`pug:refresh:${match.id}`)
            .setLabel('Refresh scores')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`pug:finish:${match.id}`)
            .setLabel('Finish')
            .setStyle(ButtonStyle.Success),
        ),
      ],
    };
  }
  return { embeds: [liveEmbed(match, rows, players)], components: [] };
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
  return { match: getMatch(done.id)!, deltas };
}

/** The match this user is currently in, in this guild. */
function activeMatchFor(discordId: string, guildId: string) {
  return db
    .prepare(
      `select m.* from match m join match_player p on p.match_id = m.id
       where p.discord_id = ? and m.guild_id = ? and m.status = 'live'
       order by m.id desc limit 1`,
    )
    .get(discordId, guildId) as Match | undefined;
}

client.once('clientReady', async (c) => {
  await c.application.commands.set([command.toJSON()]);
  console.log(`ready as ${c.user.tag}`);
});

client.on('interactionCreate', async (i: Interaction) => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'pug') await onCommand(i);
    else if (i.isUserSelectMenu() && i.customId.startsWith('pug:add:')) await onAddPlayers(i);
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
    const rows = leaderboard();
    const embed = new EmbedBuilder()
      .setTitle('Ladder')
      .setColor(0x5865f2)
      .setDescription(
        rows.length
          ? rows
              .map(
                (p, n) =>
                  `**${n + 1}.** <@${p.discord_id}> — **${p.elo}** ${rankName(p.elo)} · ${p.wins}W ${p.losses}L (${Math.round((p.wins / (p.wins + p.losses)) * 100)}%)`,
              )
              .join('\n')
          : '_no games played yet_',
      );
    await i.reply({ embeds: [embed] });
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
            `**${p.elo}** ${rankName(p.elo)} · ${p.tier} tier\n${p.wins}W ${p.losses}L${games ? ` · ${Math.round((p.wins / games) * 100)}% over ${games}` : ''}`,
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
    const name = await kovaaksNameForDiscordId(target.id);
    if (!name) {
      await i.reply({ content: NO_LINK, flags: MessageFlags.Ephemeral });
      return;
    }
    const existing = getPlayer(target.id);
    ensurePlayer(target.id, name, tier);
    // Re-seeding Elo on a tier change would wipe a played record, so it only
    // happens for someone who hasn't played yet.
    if (existing && existing.wins + existing.losses === 0) {
      db.prepare('update player set tier = ?, elo = ? where discord_id = ?').run(
        tier,
        TIER_SEED[tier],
        target.id,
      );
    } else if (existing) {
      db.prepare('update player set tier = ? where discord_id = ?').run(tier, target.id);
    }
    await i.reply(`<@${target.id}> is now **${tier}** tier.`);
    return;
  }

  if (sub === 'score') {
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
    return;
  }

  // start
  if (!i.guildId) {
    await i.reply({ content: 'Guild only.', flags: MessageFlags.Ephemeral });
    return;
  }
  const format = i.options.getString('format', true) as Format;
  const name = await kovaaksNameForDiscordId(i.user.id);
  if (!name) {
    await i.reply({ content: NO_LINK, flags: MessageFlags.Ephemeral });
    return;
  }
  ensurePlayer(i.user.id, name);
  const { lastInsertRowid } = db
    .prepare(
      'insert into match (guild_id, channel_id, host_id, format) values (?, ?, ?, ?)',
    )
    .run(i.guildId, i.channelId, i.user.id, format);
  const matchId = Number(lastInsertRowid);
  db.prepare(
    'insert into match_player (match_id, discord_id, accepted) values (?, ?, 1)',
  ).run(matchId, i.user.id);

  const match = getMatch(matchId)!;
  await i.reply(render(match));
  const msg = await i.fetchReply();
  db.prepare('update match set message_id = ? where id = ?').run(msg.id, matchId);
}

async function onAddPlayers(i: import('discord.js').UserSelectMenuInteraction) {
  const match = getMatch(Number(i.customId.split(':')[2]));
  if (!match || match.status !== 'lobby') {
    await i.reply({ content: 'That lobby is closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (i.user.id !== match.host_id) {
    await i.reply({ content: 'Only the host picks players.', flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferUpdate();

  const { max } = FORMATS[match.format];
  const problems: string[] = [];

  for (const user of i.users.values()) {
    const rows = matchPlayers(match.id);
    if (rows.some((r) => r.discord_id === user.id)) continue;
    if (user.bot) continue;
    if (rows.length >= max) {
      problems.push(`Lobby is full (${max}).`);
      break;
    }
    const name = await kovaaksNameForDiscordId(user.id);
    if (!name) {
      problems.push(`<@${user.id}> has no KovaaK's account linked to their Discord.`);
      continue;
    }
    const player = ensurePlayer(user.id, name);
    // Tier gate against everyone already in, not just the host - otherwise a
    // novice and an elite meet in the middle through an intermediate.
    const clash = rows
      .map((r) => getPlayer(r.discord_id)!)
      .find((other) => !canPlay(player.tier, other.tier));
    if (clash) {
      problems.push(
        `<@${user.id}> (${player.tier}) is too far from <@${clash.discord_id}> (${clash.tier}).`,
      );
      continue;
    }
    db.prepare('insert into match_player (match_id, discord_id) values (?, ?)').run(
      match.id,
      user.id,
    );
  }

  await i.editReply(render(getMatch(match.id)!));
  if (problems.length) {
    await i.followUp({ content: problems.join('\n'), flags: MessageFlags.Ephemeral });
  }
}

async function onButton(i: import('discord.js').ButtonInteraction) {
  const [, action, rawId] = i.customId.split(':');
  const match = getMatch(Number(rawId));
  if (!match) {
    await i.reply({ content: 'That match is gone.', flags: MessageFlags.Ephemeral });
    return;
  }
  const rows = matchPlayers(match.id);
  const me = rows.find((r) => r.discord_id === i.user.id);
  const isHost = i.user.id === match.host_id;

  if (action === 'accept') {
    if (!me) {
      await i.reply({ content: "You weren't invited to this one.", flags: MessageFlags.Ephemeral });
      return;
    }
    db.prepare(
      'update match_player set accepted = 1 where match_id = ? and discord_id = ?',
    ).run(match.id, i.user.id);
    await i.update(render(getMatch(match.id)!));
    return;
  }

  if (action === 'leave') {
    if (!me || isHost) {
      await i.reply({
        content: isHost ? 'The host cancels, not leaves.' : "You're not in this one.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    db.prepare('delete from match_player where match_id = ? and discord_id = ?').run(
      match.id,
      i.user.id,
    );
    await i.update(render(getMatch(match.id)!));
    return;
  }

  if (action === 'cancel') {
    if (!isHost) {
      await i.reply({ content: 'Host only.', flags: MessageFlags.Ephemeral });
      return;
    }
    db.prepare("update match set status = 'cancelled' where id = ?").run(match.id);
    await i.update({ content: 'Cancelled.', embeds: [], components: [] });
    return;
  }

  if (action === 'begin') {
    if (!isHost) {
      await i.reply({ content: 'Host only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const { min, max, teamSize } = FORMATS[match.format];
    const accepted = rows.filter((r) => r.accepted);
    if (accepted.length < min || accepted.length > max) {
      await i.reply({
        content: `${match.format} needs ${min}${max === min ? '' : `-${max}`} accepted players, you have ${accepted.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (teamSize > 1 && accepted.length % teamSize !== 0) {
      await i.reply({ content: 'Uneven teams.', flags: MessageFlags.Ephemeral });
      return;
    }
    const shuffled = [...accepted].sort(() => Math.random() - 0.5);
    shuffled.forEach((row, idx) => {
      db.prepare(
        'update match_player set team = ? where match_id = ? and discord_id = ?',
      ).run(Math.floor(idx / teamSize), match.id, row.discord_id);
    });
    // Anyone who never accepted is dropped rather than carried in at 0.
    db.prepare('delete from match_player where match_id = ? and accepted = 0').run(match.id);
    db.prepare(
      "update match set status = 'live', scenarios = ?, started_at = ? where id = ?",
    ).run(JSON.stringify(rollScenarios()), Date.now(), match.id);
    await i.update(render(getMatch(match.id)!));
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

  if (action === 'finish') {
    if (!isHost) {
      await i.reply({ content: 'Host only.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (match.status !== 'live') {
      await i.reply({ content: 'Already finished.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    const { match: done, deltas } = await finishMatch(match);
    const rowsDone = matchPlayers(done.id);
    const players = new Map(rowsDone.map((r) => [r.discord_id, getPlayer(r.discord_id)!]));
    const embed = resultsEmbed(done, rowsDone, players, deltas);

    await i.editReply({ embeds: [liveEmbed(done, rowsDone, players)], components: [] });
    const channelId = RESULTS_CHANNEL_ID ?? done.channel_id;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isSendable()) await channel.send({ embeds: [embed] });
    else await i.followUp({ embeds: [embed] });
  }
}

async function editMatchMessage(match: Match) {
  if (!match.message_id) return;
  const channel = await client.channels.fetch(match.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  const msg = await channel.messages.fetch(match.message_id).catch(() => null);
  await msg?.edit(render(match)).catch(() => {});
}

client.login(token);
