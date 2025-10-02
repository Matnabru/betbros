import { SlashCommandBuilder, ChatInputCommandInteraction, User as DiscordUser } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { Bet } from '../db/bet';
import { BetType } from '../types/bet';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mybets')
    .setDescription('Show active bets for yourself or another user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view bets for (leave empty for yourself)')
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    await interaction.deferReply({ ephemeral: true });
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const bets: BetType[] = await Bet.find({ userId: targetUser.id, resolved: false });
    if (!bets.length) {
      await interaction.editReply({ content: `No active bets found for <@${targetUser.id}>.` });
      return;
    }
    let desc: string = bets.map((bet: BetType) =>
      `**${bet.amount}** coins on **${bet.outcome}** (${bet.odds}) for **${bet.eventName}** (${bet.league})`
    ).join('\n');
    await interaction.editReply({ content: `**Active Bets for <@${targetUser.id}>:**\n${desc}` });
  },
};
