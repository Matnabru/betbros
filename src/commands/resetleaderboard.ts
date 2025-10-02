import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import dotenv from 'dotenv';

dotenv.config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetleaderboard')
  .setDescription('Reset all users on this server to 1000 coins (only for authorized user)'),
  async execute(interaction: ChatInputCommandInteraction) {
    // Only allow specific user
    if (interaction.user.id !== process.env.ADMIN_USER_ID) {
      await interaction.reply({ content: 'You are not allowed to use this command.', flags: 64 });
      return;
    }
    await connectMongo();
    // Optionally, only reset users who are in this guild
    // For now, reset all users
    await User.updateMany({}, { $set: { coins: 1000 } });
    await interaction.reply('Leaderboard has been reset. All users now have 1000 coins.');
  },
};
