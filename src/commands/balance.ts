import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show your coin balance.'),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    const userId = interaction.user.id;
    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId });
    }
  await interaction.reply({ content: `You have **${user.coins}** coins.`, flags: 64 });
  },
};
