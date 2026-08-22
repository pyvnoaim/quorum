import { EmbedBuilder } from 'discord.js';
import { FORMATS, type Format } from './config.js';
import type { Match, MatchPlayer, Player } from './db.js';
import { rankName } from './rating.js';

const BLURPLE = 0x5865f2;
const GREEN = 0x57f287;

export function lobbyEmbed(match: Match, rows: MatchPlayer[], players: Map<string, Player>) {
  const { min, max } = FORMATS[match.format as Format];
  const list = rows.length
    ? rows
        .map((r) => {
          const p = players.get(r.discord_id);
          const mark = r.accepted ? '✅' : '⏳';
          return `${mark} <@${r.discord_id}> · ${p ? `${p.elo} ${rankName(p.elo)} · ${p.tier}` : ''}`;
        })
        .join('\n')
    : '_nobody yet_';

  return new EmbedBuilder()
    .setTitle(`${match.format} lobby`)
    .setColor(BLURPLE)
    .setDescription(list)
    .setFooter({
      text: `${rows.filter((r) => r.accepted).length}/${rows.length} accepted · needs ${min}${max === min ? '' : `-${max}`} players · host: start when everyone's in`,
    });
}

export function liveEmbed(match: Match, rows: MatchPlayer[], players: Map<string, Player>) {
  const scenarios: string[] = JSON.parse(match.scenarios);
  const teams = [...new Set(rows.map((r) => r.team))];

  const embed = new EmbedBuilder()
    .setTitle(`${match.format} · live`)
    .setColor(BLURPLE)
    .setDescription(
      `Play these, in any order, then the host hits **Finish**. Your best run on each while the match is open counts — nothing to submit.\n\n${scenarios
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
          return `<@${r.discord_id}>\n\`${line}\``;
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
          value: `<@${r.discord_id}> · **${p.elo}** ${rankName(p.elo)} (${delta >= 0 ? '+' : ''}${delta})\n\`${scenarios
            .map((s) => scores[s]?.toFixed(0) ?? '–')
            .join(' · ')}\``,
        };
      }),
    );
}
