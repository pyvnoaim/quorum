import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BAN_TTL_MS, FORMATS, MATCH_TTL_MS, PANEL_FORMATS, type Format } from './config.js';
import { getRanks, type Match, type MatchPlayer, type Player } from './db.js';
import { rankName } from './rating.js';

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;

/** The ban phase. The pool shrinks in place, so the embed only ever needs the
 *  match row - there is nothing else to read. */
export function banEmbed(
  match: Match,
  rows: MatchPlayer[],
  players: Map<string, Player>,
  turn: number,
  left: number,
) {
  const pool: string[] = JSON.parse(match.scenarios);
  const side = rows.filter((r) => r.team === turn).map((r) => `<@${r.discord_id}>`);
  return new EmbedBuilder()
    .setTitle(`${match.format} · banning`)
    .setColor(BLURPLE)
    .setDescription(
      `${side.join(' and ')} ${side.length > 1 ? 'ban' : 'bans'} one. ` +
        `${left} ban${left === 1 ? '' : 's'} to go.\n\n` +
        pool.map((s) => `\`${s}\``).join('\n'),
    )
    .setFooter({
      text: `nobody bans within ${Math.round(BAN_TTL_MS / 1000)}s and the bot bans at random`,
    });
}

/** The open call: "someone is looking for a 1v1". Fills up, then starts itself. */
export function openEmbed(match: Match, rows: MatchPlayer[], players: Map<string, Player>) {
  const { max } = FORMATS[match.format as Format];
  const opener = players.get(match.host_id);
  const ranks = getRanks(match.guild_id);

  return new EmbedBuilder()
    .setTitle(`Looking for a ${match.format}`)
    .setColor(BLURPLE)
    .setDescription(
      rows
        .map((r) => {
          const p = players.get(r.discord_id)!;
          return `<@${r.discord_id}> · **${p.elo}** ${rankName(ranks, p.elo)}`;
        })
        .join('\n'),
    )
    .setFooter({
      text: `${rows.length}/${max} · ${opener?.tier ?? ''} tier · starts the moment it fills`,
    });
}

/** The panel is one static message that never changes - its buttons carry the
 *  format, so it survives restarts with nothing stored about it. */
export function panelMessage(formats: readonly Format[] = PANEL_FORMATS) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(formats.length === 1 ? `Quorum · ${formats[0]}` : 'Quorum')
        .setColor(BLURPLE)
        .setDescription(
          "Pick a format and the bot posts your call in this channel. When someone takes it you'll be pulled into a voice channel and your scenarios go up.\n\nScores are read from KovaaK's - there's nothing to submit.",
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        formats.map((f) =>
          new ButtonBuilder().setCustomId(`pug:open:${f}`).setLabel(f).setStyle(ButtonStyle.Primary),
        ),
      ),
    ],
  };
}

export function liveEmbed(match: Match, rows: MatchPlayer[], players: Map<string, Player>) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const teams = [...new Set(rows.map((r) => r.team))];

  const voice = match.voice_channel_id ? `\nVoice: <#${match.voice_channel_id}>` : '';
  // Discord renders this relative and per-viewer, so nobody has to work out
  // what time zone the deadline was written in.
  const deadline = Math.floor(((match.started_at ?? Date.now()) + MATCH_TTL_MS) / 1000);
  const embed = new EmbedBuilder()
    .setTitle(`${match.format} · ongoing`)
    .setColor(BLURPLE)
    .setDescription(
      `Play these in any order - scores update on their own. Hit **Done** when you've finished; results post once everyone has, or <t:${deadline}:R> either way.${voice}\n\n${scenarios
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
          const line = scenarios.map((s) => scores[s]?.toFixed(0) ?? '–').join(' · ');
          return `${r.done ? '✅' : '·'} <@${r.discord_id}>\n\`${line}\``;
        })
        .join('\n'),
      inline: true,
    });
  }
  return embed;
}

export function resultsEmbed(
  match: Match,
  rows: MatchPlayer[],
  players: Map<string, Player>,
  deltas: Map<string, number>,
) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const ordered = [...rows].sort((a, b) => (a.placing ?? 99) - (b.placing ?? 99));
  const medal = ['🥇', '🥈', '🥉'];
  const ranks = getRanks(match.guild_id);

  return new EmbedBuilder()
    .setTitle(`${match.format} · results`)
    .setColor(GREEN)
    .setDescription(scenarios.join(' · '))
    .addFields(
      ordered.map((r) => {
        const p = players.get(r.discord_id)!;
        const delta = deltas.get(r.discord_id) ?? 0;
        const scores = JSON.parse(r.scores) as Record<string, number | null>;
        return {
          name: `${medal[(r.placing ?? 1) - 1] ?? `#${r.placing}`} ${p.kovaaks_username}`,
          value: `<@${r.discord_id}> · **${p.elo}** ${rankName(ranks, p.elo)} (${delta >= 0 ? '+' : ''}${delta})\n\`${scenarios
            .map((s) => scores[s]?.toFixed(0) ?? '–')
            .join(' · ')}\``,
        };
      }),
    );
}
