import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import { Bet } from '../db/bet';
import dotenv from 'dotenv';

dotenv.config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateleaderboard')
    .setDescription('Update and print the leaderboard to the leaderboard channel (admin only)'),
  async execute(interaction: ChatInputCommandInteraction) {
    // Only allow specific user (replace with your admin ID or add permission checks as needed)
    if (interaction.user.id !== process.env.ADMIN_USER_ID) {
      await interaction.reply({ content: 'You are not allowed to use this command.', flags: 64 });
      return;
    }
    await connectMongo();
    const topUsers = await User.find().sort({ coins: -1 }).limit(20);
    if (!topUsers.length) {
      await interaction.reply('No users found.');
      return;
    }
    // For each user, get the sum of unresolved bet amounts
    const userIds = topUsers.map(u => u.userId);
    const bets = await Bet.aggregate([
      { $match: { userId: { $in: userIds }, resolved: false } },
      { $group: { _id: '$userId', locked: { $sum: '$amount' } } }
    ]);
    const lockedMap = new Map(bets.map(b => [b._id, b.locked]));
    let desc = topUsers.map((u, i) => {
      const locked = lockedMap.get(u.userId) || 0;
      return `#${i + 1} <@${u.userId}> — **${u.coins}**${locked > 0 ? ` (**${locked}**)` : ''} coins`;
    }).join('\n');
    // Replace with your leaderboard channel ID
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
    if (!channelId) {
      await interaction.reply({ content: 'Leaderboard channel ID not set in environment variables.', ephemeral: true });
      return;
    }
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: 'Leaderboard channel not found.', ephemeral: true });
      return;
    }
    await (channel as any).send({ content: `**Leaderboard:**\n${desc}` });
    await interaction.reply({ content: 'Leaderboard updated!', ephemeral: true });
  },
};
