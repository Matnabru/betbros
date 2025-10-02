import { SlashCommandBuilder, ChatInputCommandInteraction, User as DiscordUser } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { Bet } from '../db/bet';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bets')
    .setDescription('Show all active bets for a user or everyone.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view bets for (leave empty for all)')
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    const targetUser = interaction.options.getUser('user');
    let bets;
    if (targetUser) {
      bets = await Bet.find({ userId: targetUser.id, resolved: false });
    } else {
      bets = await Bet.find({ resolved: false });
    }
    if (!bets.length) {
      await interaction.reply({ content: 'No active bets found.', ephemeral: true });
      return;
    }
    let desc = bets.map(bet =>
      `<@${bet.userId}>: **${bet.amount}** coins on **${bet.outcome}** (${bet.odds}) for **${bet.eventName}** (${bet.league})`
    ).join('\n');
    await interaction.reply({ content: `**Active Bets:**\n${desc}` });
  },
};
