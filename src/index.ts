import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const scrimCommand = new SlashCommandBuilder()
  .setName('scrim')
  .setDescription('post a scrim offer other teams can accept')
  .addStringOption((o) =>
    o.setName('when').setDescription('when, e.g. "2026-08-23 20:00" or "tonight"').setRequired(true),
  )
  .addStringOption((o) => o.setName('format').setDescription('e.g. bo3, 5v5'))
  .addStringOption((o) => o.setName('notes').setDescription('rank range, maps, anything else'));

// ponytail: the posted message IS the store — poster id rides in the button's
// custom_id, accepted-state is the edited embed. Add a DB when scrims need to be
// listed, searched or reminded about.
function whenText(raw: string) {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw; // ponytail: free text passes through untouched
  const s = Math.floor(ms / 1000);
  return `<t:${s}:F> (<t:${s}:R>)`; // ponytail: parsed in the bot host's timezone
}

client.once('clientReady', async (c) => {
  await c.application.commands.set([scrimCommand.toJSON()]);
  console.log(`ready as ${c.user.tag}`);
});

client.on('interactionCreate', async (i) => {
  if (i.isChatInputCommand() && i.commandName === 'scrim') {
    const embed = new EmbedBuilder()
      .setTitle('Scrim offer')
      .setColor(0x5865f2)
      .addFields(
        { name: 'When', value: whenText(i.options.getString('when', true)) },
        { name: 'Format', value: i.options.getString('format') ?? 'any', inline: true },
        { name: 'Posted by', value: `<@${i.user.id}>`, inline: true },
      );
    const notes = i.options.getString('notes');
    if (notes) embed.addFields({ name: 'Notes', value: notes });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`scrim:accept:${i.user.id}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),
    );
    await i.reply({ embeds: [embed], components: [row] });
    return;
  }

  if (i.isButton() && i.customId.startsWith('scrim:accept:')) {
    const posterId = i.customId.split(':')[2];
    if (i.user.id === posterId) {
      await i.reply({ content: 'You posted this one.', flags: MessageFlags.Ephemeral });
      return;
    }
    const embed = EmbedBuilder.from(i.message.embeds[0])
      .setColor(0x57f287)
      .addFields({ name: 'Accepted by', value: `<@${i.user.id}>` });
    await i.update({ embeds: [embed], components: [] });
    await i.followUp({ content: `<@${posterId}> <@${i.user.id}> — scrim locked in.` });
  }
});

client.login(token);
