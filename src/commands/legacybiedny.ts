import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import { Bet } from '../db/bet';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('legacybiedny')
    .setDescription('Legacy coin bailout if you have 0 coins and no active bets.'),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();

    const userId = interaction.user.id;

    // Find user
    let user = await User.findOne({ userId });
    if (!user) {
      user = new User({ userId, coins: 0 });
    }

    // Check if user has 0 coins
    if (user.coins !== 0) {
      await interaction.reply({ content: `Masz jeszcze ${user.coins} monet. Komenda /legacybiedny jest tylko dla tych, którzy mają 0 monet!`, ephemeral: true });
      return;
    }

    // Check if user has active bets
    const activeBets = await Bet.find({ userId, resolved: false });
    if (activeBets.length > 0) {
      await interaction.reply({ content: `Masz ${activeBets.length} aktywnych zakładów. Komenda /legacybiedny jest dostępna tylko gdy nie masz aktywnych zakładów!`, ephemeral: true });
      return;
    }

    // Give user 250 coins and increment bankruptcy count
    user.coins = 250;
    user.bankruptcyCount = (user.bankruptcyCount || 0) + 1;
    await user.save();

    // Send public message
    await interaction.reply(`<@${userId}> wyzerował się **${user.bankruptcyCount}** ${user.bankruptcyCount === 1 ? 'raz' : user.bankruptcyCount < 5 ? 'razy' : 'razy'}! 💸\nOtrzymujesz 250 monet jako pomoc. Powodzenia! 🍀`);
  },
};
