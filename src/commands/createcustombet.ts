import { SlashCommandBuilder, ChatInputCommandInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { CustomEvent } from '../db/customEvent';
import { CustomBet } from '../db/customBet';
import { User } from '../db/user';
import dotenv from 'dotenv';
dotenv.config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('legacycreatecustombet')
        .setDescription('Legacy create a custom coin bet event (admin only)'),
    async execute(interaction: ChatInputCommandInteraction) {
        if (interaction.user.id !== process.env.ADMIN_USER_ID) {
            await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            return;
        }

        // Show modal for custom bet creation
        const modal = new ModalBuilder()
            .setCustomId('create_custom_bet_modal')
            .setTitle('Create Custom Bet');

        const titleInput = new TextInputBuilder()
            .setCustomId('bet_title')
            .setLabel('Bet Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Who will win the elections?')
            .setRequired(true);

        const outcomesInput = new TextInputBuilder()
            .setCustomId('bet_outcomes')
            .setLabel('Outcomes (comma-separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('e.g., Candidate A, Candidate B, Candidate C')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(outcomesInput)
        );

        await interaction.showModal(modal);
    }
};
