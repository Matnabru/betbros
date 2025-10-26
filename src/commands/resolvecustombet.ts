import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, ComponentType } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { CustomEvent } from '../db/customEvent';
import { CustomBet } from '../db/customBet';
import { User } from '../db/user';
import dotenv from 'dotenv';
dotenv.config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resolvecustombet')
        .setDescription('Resolve a custom bet event (admin only)'),
    async execute(interaction: ChatInputCommandInteraction) {
        if (interaction.user.id !== process.env.ADMIN_USER_ID) {
            await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            return;
        }

        await interaction.reply({ content: 'Check your DMs to resolve a custom bet!', ephemeral: true });
        const user = interaction.user;
        const dm = await user.createDM();

        await connectMongo();

        // Get all unresolved custom events
        const unresolvedEvents = await CustomEvent.find({ resolved: false });

        if (unresolvedEvents.length === 0) {
            await dm.send('No unresolved custom bets found.');
            return;
        }

        // Show select menu for event selection
        const eventOptions = unresolvedEvents.map(event => ({
            label: event.title.slice(0, 100),
            value: event.customEventId
        }));

        const eventSelect = new StringSelectMenuBuilder()
            .setCustomId('resolve_custom_event')
            .setPlaceholder('Select an event to resolve')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(eventOptions);

        const eventRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventSelect);

        await dm.send({
            content: 'Select the custom bet event to resolve:',
            components: [eventRow]
        });

        // Wait for event selection
        const eventCollector = dm.createMessageComponentCollector({
            filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_custom_event',
            componentType: ComponentType.StringSelect,
            time: 60000
        });

        eventCollector.once('collect', async (eventInteraction: StringSelectMenuInteraction) => {
            try {
                const customEventId = eventInteraction.values[0];
                const event = unresolvedEvents.find(e => e.customEventId === customEventId);

                if (!event) {
                    await eventInteraction.reply({ content: 'Event not found.', ephemeral: true });
                    return;
                }

                // Show outcome selection
                const outcomeOptions = event.outcomes.map(outcome => ({
                    label: outcome,
                    value: outcome
                }));

                outcomeOptions.push({ label: 'Cancel/Refund all bets', value: 'REFUND' });

                const outcomeSelect = new StringSelectMenuBuilder()
                    .setCustomId('resolve_custom_outcome')
                    .setPlaceholder('Select the winning outcome')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(outcomeOptions);

                const outcomeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(outcomeSelect);

                await eventInteraction.reply({
                    content: `**${event.title}**\nSelect the winning outcome:`,
                    components: [outcomeRow],
                    ephemeral: true
                });

                // Wait for outcome selection
                const outcomeCollector = dm.createMessageComponentCollector({
                    filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_custom_outcome',
                    componentType: ComponentType.StringSelect,
                    time: 60000
                });

                outcomeCollector.once('collect', async (outcomeInteraction: StringSelectMenuInteraction) => {
                    try {
                        const winningOutcome = outcomeInteraction.values[0];

                        const eventBets = await CustomBet.find({ customEventId: event.customEventId, resolved: false });

                        if (winningOutcome === 'REFUND') {
                            // Refund all bets
                            for (const bet of eventBets) {
                                try {
                                    const betUser = await User.findOne({ userId: bet.userId });
                                    if (betUser) {
                                        betUser.coins += bet.amount;
                                        await betUser.save();
                                    }
                                    bet.resolved = true;
                                    bet.won = null;
                                    await bet.save();
                                } catch (err) {
                                    console.error('Refund error:', err);
                                }
                            }

                            event.resolved = true;
                            event.winningOutcome = null;
                            await event.save();

                            await outcomeInteraction.reply({ content: 'All bets refunded and event cancelled.', ephemeral: true });
                        } else {
                            // Calculate total pool and payouts
                            const totalsByOutcome: { [key: string]: number } = {};
                            
                            // Initialize with initial pool (handle Map type)
                            event.outcomes.forEach(outcome => {
                                const poolValue = event.initialPool instanceof Map 
                                    ? event.initialPool.get(outcome) 
                                    : (event.initialPool as any)?.[outcome];
                                totalsByOutcome[outcome] = poolValue || 0;
                            });

                            // Add user bets
                            eventBets.forEach(bet => {
                                totalsByOutcome[bet.outcome] = (totalsByOutcome[bet.outcome] || 0) + bet.amount;
                            });

                            const totalPool = Object.values(totalsByOutcome).reduce((a, b) => a + b, 0);
                            const winningTotal = totalsByOutcome[winningOutcome] || 0;

                            const winners: Array<{userId: string, amount: number, outcome: string}> = [];
                            const losers: Array<{userId: string, amount: number, outcome: string}> = [];

                            // Resolve all bets
                            for (const bet of eventBets) {
                                try {
                                    if (bet.outcome === winningOutcome) {
                                        // Winner - calculate payout based on pool
                                        const betUser = await User.findOne({ userId: bet.userId });
                                        if (betUser) {
                                            const payout = winningTotal > 0 ? Math.round((bet.amount / winningTotal) * totalPool) : bet.amount;
                                            betUser.coins += payout;
                                            await betUser.save();
                                            winners.push({ userId: bet.userId, amount: payout - bet.amount, outcome: bet.outcome });
                                        }
                                        bet.won = true;
                                    } else {
                                        // Loser
                                        losers.push({ userId: bet.userId, amount: bet.amount, outcome: bet.outcome });
                                        bet.won = false;
                                    }
                                    bet.resolved = true;
                                    await bet.save();
                                } catch (err) {
                                    console.error('Resolve error:', err);
                                }
                            }

                            event.resolved = true;
                            event.winningOutcome = winningOutcome;
                            await event.save();

                            // Send notification to Discord channel
                            try {
                                const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                                if (channelId) {
                                    const notifChannel = await interaction.client.channels.fetch(channelId);
                                    if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                                        let message = `🎲 **Custom Bet Resolved!**\n`;
                                        message += `**${event.title}**\n`;
                                        message += `🏆 Winner: **${winningOutcome}**\n`;
                                        message += `📊 Total bets: ${eventBets.length}\n`;
                                        message += `💰 Total pool: ${totalPool} coins\n`;
                                        
                                        if (winners.length > 0) {
                                            message += `\n🎉 **Winners:** ${winners.length} players won!\n`;
                                            for (const w of winners) {
                                                message += `<@${w.userId}>: +${w.amount} coins (${w.outcome})\n`;
                                            }
                                        } else {
                                            message += `\n😢 No winners in this bet.\n`;
                                        }
                                        
                                        if (losers.length > 0) {
                                            message += `\n😢 **Losers:** ${losers.length} players lost their bets.\n`;
                                            for (const l of losers) {
                                                message += `<@${l.userId}>: -${l.amount} coins (${l.outcome})\n`;
                                            }
                                        }
                                        
                                        await (notifChannel as any).send({ content: message });
                                    }
                                }
                            } catch (err) {
                                console.error('Failed to send resolution notification:', err);
                            }

                            await outcomeInteraction.reply({ 
                                content: `Custom bet resolved! Winner: **${winningOutcome}**\nWinners: ${winners.length}, Losers: ${losers.length}`, 
                                ephemeral: true 
                            });
                        }
                    } catch (err) {
                        console.error('Outcome collector error:', err);
                    }
                });
            } catch (err) {
                console.error('Event collector error:', err);
            }
        });
    }
};
