import { Client, Interaction, ModalSubmitInteraction } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

module.exports = {
    name: 'interactionCreate',
    once: false,
    async execute(interaction: Interaction, client: Client) {
        if (interaction.isChatInputCommand()) {
            const command = (client as any).commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
                }
            }
        } else if (interaction.isModalSubmit()) {
            // Handle bet modal from showodds
            if (interaction.customId.startsWith('betmodal_')) {
                // Defensive: If interaction is expired, catch and inform user
                let responded = false;
                function safeReply(opts: any) {
                    if (responded) return;
                    responded = true;
                    return (interaction as any).reply(opts).catch(() => {
                        // If reply fails, try followUp (if possible)
                        try { (interaction as any).followUp(opts); } catch {}
                    });
                }
                const [ , eventId, outcomeIdx ] = interaction.customId.split('_');
                const amountStr = interaction.fields.getTextInputValue('bet_amount');
                const amount = parseInt(amountStr);
                if (isNaN(amount) || amount <= 0) {
                    await safeReply({ content: 'Invalid bet amount.', ephemeral: true });
                    return;
                }
                // Find the original message to get event/outcome info
                if (!interaction.message) {
                    await safeReply({ content: 'Could not find bet message.', ephemeral: true });
                    return;
                }
                const msg = await interaction.channel?.messages.fetch(interaction.message.id);
                if (!msg) {
                    await safeReply({ content: 'Could not find bet message.', ephemeral: true });
                    return;
                }
                // Extract event info from message content (hacky, but works for now)
                const content = msg.content;
                const eventMatch = content.match(/\*\*(.+)\*\* \(League: (.+)\)/);
                if (!eventMatch) {
                    await safeReply({ content: 'Could not parse event info.', ephemeral: true });
                    return;
                }
                const eventName = eventMatch[1];
                const league = eventMatch[2];
                // Get outcome name and odds from button label
                const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
                const row = msg.components[0] as InstanceType<typeof ActionRowBuilder>;
                const btn = row.components[parseInt(outcomeIdx)] as InstanceType<typeof ButtonBuilder>;
                const label = btn.label || btn.data?.label || '';
                const outcomeMatch = label.match(/(.+) \((\d+(?:\.\d+)?)\)/);
                if (!outcomeMatch) {
                    await safeReply({ content: 'Could not parse outcome info.', ephemeral: true });
                    return;
                }
                const outcome = outcomeMatch[1];
                const odds = parseFloat(outcomeMatch[2]);
                // Mongo
                const { connectMongo } = require('../db/mongo');
                const { User } = require('../db/user');
                const { Bet } = require('../db/bet');
                await connectMongo();
                let user = await User.findOne({ userId: interaction.user.id });
                if (!user) user = await User.create({ userId: interaction.user.id });
                if (user.coins < amount) {
                    await safeReply({ content: `You do not have enough coins. You have **${user.coins}**.`, ephemeral: true });
                    return;
                }
                user.coins -= amount;
                await user.save();
                await Bet.create({
                    userId: interaction.user.id,
                    eventId,
                    eventName,
                    league,
                    outcome,
                    odds,
                    amount
                });
                // Send bet notification to the specified channel
                try {
                    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                    if (!channelId) {
                        console.error('NOTIFICATION_CHANNEL_ID not set in environment variables');
                        throw new Error('Channel ID not configured');
                    }
                    const notifChannel = await interaction.client.channels.fetch(channelId);
                    if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                        await (notifChannel as any).send({
                            content: `📝 <@${interaction.user.id}> placed a bet: **${amount}** coins on **${outcome}** (${odds}) for **${eventName}** (${league})`
                        });
                    }
                } catch (e) { console.error('Failed to send bet notification:', e); }
                // Update the original message to refresh coin balance and keep buttons enabled
                const newContent = `**${eventName}** (League: ${league})\nYou have **${user.coins}** coins.\nEnter your bet amount and click a button to bet:`;
                try {
                    await msg.edit({ content: newContent, components: msg.components });
                } catch {}
                await safeReply({ content: `Bet placed: **${amount}** coins on **${outcome}** (${odds}) for ${eventName} (${league}).`, ephemeral: true });
            }
        }
    },
};
