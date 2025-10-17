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
                // Extract match date if present
                const dateMatch = content.match(/Match Date: (.+)/);
                let matchDate: Date | undefined = undefined;
                if (dateMatch) {
                    // Parse Polish date format: "18 października 16:15"
                    const polishMonths: {[key: string]: number} = {
                        'stycznia': 0, 'lutego': 1, 'marca': 2, 'kwietnia': 3, 'maja': 4, 'czerwca': 5,
                        'lipca': 6, 'sierpnia': 7, 'września': 8, 'października': 9, 'listopada': 10, 'grudnia': 11
                    };
                    const dateStr = dateMatch[1];
                    const parts = dateStr.match(/(\d+)\s+(\w+)\s+(\d+):(\d+)/);
                    if (parts) {
                        const day = parseInt(parts[1]);
                        const month = polishMonths[parts[2]];
                        const hour = parseInt(parts[3]);
                        const minute = parseInt(parts[4]);
                        if (month !== undefined) {
                            matchDate = new Date();
                            matchDate.setMonth(month);
                            matchDate.setDate(day);
                            matchDate.setHours(hour);
                            matchDate.setMinutes(minute);
                            matchDate.setSeconds(0);
                            matchDate.setMilliseconds(0);
                        }
                    }
                }
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
                    amount,
                    matchDate
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
                const dateInfo = matchDate ? `\nMatch Date: ${matchDate.toLocaleString('pl-PL', { 
                    timeZone: 'Europe/Warsaw',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit'
                })}` : '';
                const newContent = `**${eventName}** (League: ${league})${dateInfo}\nYou have **${user.coins}** coins.\nEnter your bet amount and click a button to bet:`;
                try {
                    await msg.edit({ content: newContent, components: msg.components });
                } catch {}
                await safeReply({ content: `Bet placed: **${amount}** coins on **${outcome}** (${odds}) for ${eventName} (${league}).`, ephemeral: true });
            }
        }
    },
};
