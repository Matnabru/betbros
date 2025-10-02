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
    .setName('crate')
    .setDescription('Claim and open your weekly crate for bonus coins!'),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    const userId = interaction.user.id;
    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId });
    }
    const now = new Date();
    const lastLootbox = user.lastLootbox || new Date(0);
    const weekMs = 3 * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastLootbox.getTime() < weekMs) {
      const next = new Date(lastLootbox.getTime() + weekMs);
      await interaction.reply({ content: `You already claimed your crate! Next crate available <t:${Math.floor(next.getTime()/1000)}:R>.`, ephemeral: true });
      return;
    }
    // Grant crate to inventory
    user.inventory.push({ type: 'crate', grantedAt: now });
    user.lastLootbox = now;
    await user.save();
    await interaction.reply({ content: 'You received a crate! Use `/opencrate` to open it and get coins.', ephemeral: true });
  },
};
