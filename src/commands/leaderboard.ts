import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import { Bet } from '../db/bet';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the top 10 users by coin balance.'),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    const users = await User.find();
    if (!users.length) {
      await interaction.reply('No users found.');
      return;
    }
    // For each user, get the sum of unresolved bet amounts
    const userIds = users.map(u => u.userId);
    const bets = await Bet.aggregate([
      { $match: { userId: { $in: userIds }, resolved: false } },
      { $group: { _id: '$userId', locked: { $sum: '$amount' } } }
    ]);
    const lockedMap = new Map(bets.map(b => [b._id, b.locked]));
    // Compute total for each user and sort by total descending
    const usersWithTotals = users.map(u => {
      const locked = lockedMap.get(u.userId) || 0;
      const total = u.coins + locked;
      return { ...u.toObject(), locked, total };
    });
    usersWithTotals.sort((a, b) => b.total - a.total);
    const topUsers = usersWithTotals.slice(0, 10);
    // Fetch nicknames from Discord guild
    const nicknames = await Promise.all(topUsers.map(async (u) => {
      try {
        const member = await interaction.guild?.members.fetch(u.userId);
        return member ? member.displayName : `Unknown (${u.userId})`;
      } catch {
        return `Unknown (${u.userId})`;
      }
    }));
    let desc = topUsers.map((u, i) => {
      const nickname = nicknames[i];
      return `#${i + 1} ${nickname} — **${u.total}**${u.locked > 0 ? ` (**${u.locked}**)` : ''}`;
    }).join('\n');
    await interaction.reply({ content: `**Leaderboard:** **Total** (In bets)\n${desc}` });
  },
};
