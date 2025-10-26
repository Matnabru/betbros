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
                const parts = interaction.customId.split('_');
                const eventId = parts[1];
                const outcomeIdx = parts[2];
                const timestamp = parts[3] ? parseInt(parts[3]) : 0;
                
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
                // Get match date from timestamp in customId
                const matchDate = timestamp > 0 ? new Date(timestamp * 1000) : undefined;
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
                // Create a unique eventId by combining API eventId with event name
                // This prevents duplicate eventIds when API reuses IDs
                const uniqueEventId = `${eventId}_${eventName.replace(/\s+/g, '_')}`;
                await Bet.create({
                    userId: interaction.user.id,
                    eventId: uniqueEventId,
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
            // Handle custom bet creation modal
            else if (interaction.customId === 'create_custom_bet_modal') {
                const { connectMongo } = require('../db/mongo');
                const { CustomEvent } = require('../db/customEvent');
                const { CustomBet } = require('../db/customBet');
                const { User } = require('../db/user');

                const title = interaction.fields.getTextInputValue('bet_title');
                const outcomesStr = interaction.fields.getTextInputValue('bet_outcomes');
                const outcomes = outcomesStr.split(',').map(o => o.trim()).filter(o => o.length > 0);

                if (outcomes.length < 2) {
                    await interaction.reply({ content: 'You must provide at least 2 outcomes.', ephemeral: true });
                    return;
                }

                await connectMongo();

                // Create unique event ID
                const customEventId = `custom_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                // Create initial pool for each outcome (virtual, not real bets)
                const initialPool: { [outcome: string]: number } = {};
                outcomes.forEach(outcome => {
                    initialPool[outcome] = 100;
                });

                // Create the custom event
                await CustomEvent.create({
                    customEventId,
                    title,
                    outcomes,
                    initialPool,
                    createdBy: interaction.user.id
                });

                // Send notification to channel
                try {
                    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                    if (channelId) {
                        const notifChannel = await interaction.client.channels.fetch(channelId);
                        if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                            let message = `🎲 **New Custom Bet Created!**\n`;
                            message += `**${title}**\n`;
                            message += `📊 Outcomes: ${outcomes.join(', ')}\n`;
                            message += `💰 Initial pool: ${100 * outcomes.length} coins (100 coins on each outcome)\n`;
                            message += `\nUse \`/custombet\` to place your bet!`;
                            
                            await (notifChannel as any).send({ content: message });
                        }
                    }
                } catch (err) {
                    console.error('Failed to send custom bet creation notification:', err);
                }

                await interaction.reply({ content: `Custom bet created: **${title}**\nOutcomes: ${outcomes.join(', ')}\nInitial pool: ${100 * outcomes.length} coins`, ephemeral: true });
            }
            // Handle custom bet placement modal
            else if (interaction.customId.startsWith('custombetmodal_')) {
                let responded = false;
                function safeReply(opts: any) {
                    if (responded) return;
                    responded = true;
                    return (interaction as any).reply(opts).catch(() => {
                        try { (interaction as any).followUp(opts); } catch {}
                    });
                }

                // Parse customId: custombetmodal_${customEventId}_${idx}
                // customEventId format: custom_${timestamp}_${random}
                const parts = interaction.customId.replace('custombetmodal_', '').split('_');
                // Last part is idx, rest is customEventId
                const outcomeIdx = parts[parts.length - 1];
                const customEventId = parts.slice(0, -1).join('_');
                
                const amountStr = interaction.fields.getTextInputValue('bet_amount');
                const amount = parseInt(amountStr);

                if (isNaN(amount) || amount <= 0) {
                    await safeReply({ content: 'Invalid bet amount.', ephemeral: true });
                    return;
                }

                if (!interaction.message) {
                    await safeReply({ content: 'Could not find bet message.', ephemeral: true });
                    return;
                }

                const msg = await interaction.channel?.messages.fetch(interaction.message.id);
                if (!msg) {
                    await safeReply({ content: 'Could not find bet message.', ephemeral: true });
                    return;
                }

                // Extract event title from message
                const content = msg.content;
                const titleMatch = content.match(/\*\*(.+)\*\*/);
                if (!titleMatch) {
                    await safeReply({ content: 'Could not parse event info.', ephemeral: true });
                    return;
                }
                const customEventTitle = titleMatch[1];

                const { connectMongo } = require('../db/mongo');
                const { CustomEvent } = require('../db/customEvent');
                const { CustomBet } = require('../db/customBet');
                const { User } = require('../db/user');

                await connectMongo();

                const event = await CustomEvent.findOne({ customEventId });
                if (!event) {
                    await safeReply({ content: 'Event not found.', ephemeral: true });
                    return;
                }

                if (event.resolved) {
                    await safeReply({ content: 'This event has already been resolved.', ephemeral: true });
                    return;
                }

                const outcome = event.outcomes[parseInt(outcomeIdx)];
                if (!outcome) {
                    await safeReply({ content: 'Invalid outcome.', ephemeral: true });
                    return;
                }

                let user = await User.findOne({ userId: interaction.user.id });
                if (!user) user = await User.create({ userId: interaction.user.id });

                if (user.coins < amount) {
                    await safeReply({ content: `You do not have enough coins. You have **${user.coins}**.`, ephemeral: true });
                    return;
                }

                // Calculate current odds before bet
                const existingBets = await CustomBet.find({ customEventId, resolved: false });
                const totalsByOutcome: { [key: string]: number } = {};
                
                // Initialize with initial pool (handle Map type)
                event.outcomes.forEach((o: string) => {
                    const poolValue = event.initialPool instanceof Map 
                        ? event.initialPool.get(o) 
                        : (event.initialPool as any)?.[o];
                    totalsByOutcome[o] = poolValue || 0;
                });
                
                // Add existing user bets
                existingBets.forEach((bet: any) => {
                    totalsByOutcome[bet.outcome] = (totalsByOutcome[bet.outcome] || 0) + bet.amount;
                });
                
                const totalPool = Object.values(totalsByOutcome).reduce((a, b) => a + b, 0);
                const newPool = totalPool + amount;
                const newOutcomeTotal = totalsByOutcome[outcome] + amount;
                const odds = newPool / newOutcomeTotal;

                user.coins -= amount;
                await user.save();

                await CustomBet.create({
                    userId: interaction.user.id,
                    customEventId,
                    customEventTitle,
                    outcome,
                    odds,
                    amount
                });

                // Send notification
                try {
                    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                    if (channelId) {
                        const notifChannel = await interaction.client.channels.fetch(channelId);
                        if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                            await (notifChannel as any).send({
                                content: `📝 <@${interaction.user.id}> placed a custom bet: **${amount}** coins on **${outcome}** (${odds.toFixed(2)}x) for **${customEventTitle}**`
                            });
                        }
                    }
                } catch (e) { console.error('Failed to send bet notification:', e); }

                // Update message with new coin balance
                const newContent = `**${customEventTitle}**\nYou have **${user.coins}** coins.\nCurrent total pool: **${newPool}** coins\nEnter your bet amount and click a button to bet:`;
                try {
                    await msg.edit({ content: newContent, components: msg.components });
                } catch {}

                await safeReply({ content: `Custom bet placed: **${amount}** coins on **${outcome}** (${odds.toFixed(2)}x) for ${customEventTitle}.`, ephemeral: true });
            }
        }
    },
};
