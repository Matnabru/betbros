import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';

function getSkewedRandom(min: number, max: number, skew: number = 2): number {
  // Skewed towards min (lower values more likely)
  let r = Math.pow(Math.random(), skew);
  return Math.floor(min + (max - min) * r);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('opencrate')
    .setDescription('Open a crate from your inventory to get coins!'),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    const userId = interaction.user.id;
    let user = await User.findOne({ userId });
    if (!user) {
      await interaction.reply({ content: 'You do not have a crate to open.', ephemeral: true });
      return;
    }
    // Find a crate in inventory
    const crateIdx = user.inventory.findIndex((item: any) => item.type === 'crate');
    if (crateIdx === -1) {
      await interaction.reply({ content: 'You do not have a crate to open.', ephemeral: true });
      return;
    }
    // Remove crate from inventory
    user.inventory.splice(crateIdx, 1);
    // Grant coins (skewed 10-200)
    const coins = getSkewedRandom(10, 200, 2);
    user.coins += coins;
    await user.save();
    await interaction.reply({ content: `You opened a crate and received **${coins}** coins!`, ephemeral: true });
  },
};
