import { Client, Interaction, ModalSubmitInteraction } from 'discord.js';
import dotenv from 'dotenv';
import { decodeBetModalId, encodeBetButtonId } from '../utils/betButtonIds';

dotenv.config();

function marketFromButtonCode(marketCode: string): 'match_winner' | 'draw_no_bet' | 'btts' | 'total_goals' {
    if (marketCode === 'dnb') return 'draw_no_bet';
    if (marketCode === 'btts') return 'btts';
    if (marketCode === 'tot' || marketCode === 'atot') return 'total_goals';
    return 'match_winner';
}

function providerMarketIdFromButtonCode(marketCode: string): string {
    if (marketCode === 'dnb') return 'draw_no_bet';
    if (marketCode === 'btts') return 'btts';
    if (marketCode === 'tot') return 'totals';
    if (marketCode === 'atot') return 'alternate_totals';
    return 'h2h';
}

function marketLabelFromButtonCode(marketCode: string): string | undefined {
    if (marketCode === 'dnb') return 'Draw no bet';
    if (marketCode === 'btts') return 'Both teams to score';
    if (marketCode === 'tot') return 'Match goals';
    if (marketCode === 'atot') return 'More match goals';
    return undefined;
}

function outcomeFromButtonChoice(
    choiceCode: string,
    homeTeam?: string,
    awayTeam?: string
): string {
    if (choiceCode === 'h') return homeTeam || 'Home';
    if (choiceCode === 'd') return 'Draw';
    if (choiceCode === 'a') return awayTeam || 'Away';
    if (choiceCode === 'y') return 'Yes';
    if (choiceCode === 'n') return 'No';
    if (choiceCode === 'o') return 'Over';
    if (choiceCode === 'u') return 'Under';
    return 'Unknown';
}

function findButtonLabel(message: any, customId: string, fallbackIndex?: string): string {
    for (const row of message.components || []) {
        for (const component of row.components || []) {
            const data = component.data || component;
            if (data.custom_id === customId || data.customId === customId) {
                return data.label || component.label || '';
            }
        }
    }

    if (fallbackIndex !== undefined) {
        const firstRow = message.components?.[0];
        const component = firstRow?.components?.[parseInt(fallbackIndex, 10)];
        return component?.label || component?.data?.label || '';
    }

    return '';
}

async function acknowledgeModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    if (interaction.deferred || interaction.replied) return true;

    try {
        await interaction.deferReply({ ephemeral: true });
        return true;
    } catch (err) {
        console.error('Failed to acknowledge modal interaction:', err);
        return false;
    }
}

async function safeModalReply(interaction: ModalSubmitInteraction, content: string) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, ephemeral: true });
        }
    } catch (err) {
        console.error('Failed to respond to modal interaction:', err);
    }
}

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
            if (interaction.customId.startsWith('betmodal_') || interaction.customId.startsWith('betmodal2|')) {
                if (!(await acknowledgeModal(interaction))) return;
                const safeReply = (content: string) => safeModalReply(interaction, content);
                const parsedButtonBet = decodeBetModalId(interaction.customId);
                const parts = interaction.customId.split('_');
                let provider = 'api-football';
                let eventId = parts[1];
                let outcomeIdx = parts[2];
                let timestamp = parts[3] ? parseInt(parts[3]) : 0;
                if (parts.length >= 5 && ['api-football', 'the-odds-api'].includes(parts[1])) {
                    provider = parts[1];
                    eventId = parts[2];
                    outcomeIdx = parts[3];
                    timestamp = parts[4] ? parseInt(parts[4]) : 0;
                }
                if (parsedButtonBet) {
                    provider = parsedButtonBet.provider;
                    eventId = parsedButtonBet.eventId;
                    outcomeIdx = String(parsedButtonBet.index);
                    timestamp = parsedButtonBet.timestamp;
                }
                
                const amountStr = interaction.fields.getTextInputValue('bet_amount');
                const amount = parseInt(amountStr);
                if (isNaN(amount) || amount <= 0) {
                    await safeReply('Invalid bet amount.');
                    return;
                }
                // Find the original message to get event/outcome info
                if (!interaction.message) {
                    await safeReply('Could not find bet message.');
                    return;
                }
                const msg = await interaction.channel?.messages.fetch(interaction.message.id);
                if (!msg) {
                    await safeReply('Could not find bet message.');
                    return;
                }
                // Extract event info from message content (hacky, but works for now)
                const content = msg.content;
                const eventMatch = content.match(/\*\*(.+)\*\* \(League: (.+)\)/);
                if (!eventMatch) {
                    await safeReply('Could not parse event info.');
                    return;
                }
                const eventName = eventMatch[1];
                const league = eventMatch[2];
                const bookmaker = content.match(/Bookmaker:\s+\*\*(.+?)\*\*/)?.[1];
                const teamsMatch = eventName.match(/(.+) vs (.+)/i);
                const homeTeam = teamsMatch ? teamsMatch[1].trim() : undefined;
                const awayTeam = teamsMatch ? teamsMatch[2].trim() : undefined;
                // Get match date from timestamp in customId
                const matchDate = timestamp > 0 ? new Date(timestamp * 1000) : undefined;
                const sourceButtonId = parsedButtonBet
                    ? encodeBetButtonId(parsedButtonBet)
                    : undefined;
                const label = sourceButtonId
                    ? findButtonLabel(msg, sourceButtonId)
                    : findButtonLabel(msg, '', outcomeIdx);
                const outcomeMatch = label.match(/(.+) \((\d+(?:\.\d+)?)\)$/);
                if (!outcomeMatch) {
                    await safeReply('Could not parse outcome info.');
                    return;
                }
                const market = parsedButtonBet
                    ? marketFromButtonCode(parsedButtonBet.marketCode)
                    : 'match_winner';
                const outcome = parsedButtonBet
                    ? outcomeFromButtonChoice(parsedButtonBet.choiceCode, homeTeam, awayTeam)
                    : outcomeMatch[1];
                const marketLine = parsedButtonBet?.point;
                const providerMarketId = parsedButtonBet
                    ? providerMarketIdFromButtonCode(parsedButtonBet.marketCode)
                    : undefined;
                const marketLabel = parsedButtonBet
                    ? marketLabelFromButtonCode(parsedButtonBet.marketCode)
                    : undefined;
                const outcomeDisplay = market === 'total_goals' && typeof marketLine === 'number'
                    ? `${marketLabel || 'Match goals'}: ${outcome} ${marketLine}`
                    : marketLabel
                        ? `${marketLabel}: ${outcome}`
                        : outcome;
                const odds = parseFloat(outcomeMatch[2]);
                // Mongo
                const { connectMongo } = require('../db/mongo');
                const { User } = require('../db/user');
                const { Bet } = require('../db/bet');
                await connectMongo();
                let user = await User.findOne({ userId: interaction.user.id });
                if (!user) user = await User.create({ userId: interaction.user.id });
                if (user.coins < amount) {
                    await safeReply(`You do not have enough coins. You have **${user.coins}**.`);
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
                    market,
                    provider,
                    providerFixtureId: eventId,
                    providerMarketId,
                    marketLabel,
                    marketLine,
                    bookmaker,
                    homeTeam,
                    awayTeam,
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
                            content: `📝 <@${interaction.user.id}> placed a bet: **${amount}** coins on **${outcomeDisplay}** (${odds}) for **${eventName}** (${league})`
                        });
                    }
                } catch (e) { console.error('Failed to send bet notification:', e); }
                const newContent = content.replace(
                    /You have \*\*[^*]+\*\* coins\./,
                    `You have **${user.coins}** coins.`
                );
                try {
                    await msg.edit({ content: newContent, components: msg.components });
                } catch {}
                await safeReply(`Bet placed: **${amount}** coins on **${outcomeDisplay}** (${odds}) for ${eventName} (${league}).`);
            }
            // Handle custom bet creation modal
            else if (interaction.customId === 'create_custom_bet_modal') {
                if (!(await acknowledgeModal(interaction))) return;
                const { connectMongo } = require('../db/mongo');
                const { CustomEvent } = require('../db/customEvent');
                const { CustomBet } = require('../db/customBet');
                const { User } = require('../db/user');

                const title = interaction.fields.getTextInputValue('bet_title');
                const outcomesStr = interaction.fields.getTextInputValue('bet_outcomes');
                const outcomes = outcomesStr.split(',').map(o => o.trim()).filter(o => o.length > 0);

                if (outcomes.length < 2) {
                    await safeModalReply(interaction, 'You must provide at least 2 outcomes.');
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
                            message += `\nUse \`/legacycustombet\` to place your bet!`;
                            
                            await (notifChannel as any).send({ content: message });
                        }
                    }
                } catch (err) {
                    console.error('Failed to send custom bet creation notification:', err);
                }

                await safeModalReply(interaction, `Custom bet created: **${title}**\nOutcomes: ${outcomes.join(', ')}\nInitial pool: ${100 * outcomes.length} coins`);
            }
            // Handle custom bet placement modal
            else if (interaction.customId.startsWith('custombetmodal_')) {
                if (!(await acknowledgeModal(interaction))) return;
                const safeReply = (content: string) => safeModalReply(interaction, content);

                // Parse customId: custombetmodal_${customEventId}_${idx}
                // customEventId format: custom_${timestamp}_${random}
                const parts = interaction.customId.replace('custombetmodal_', '').split('_');
                // Last part is idx, rest is customEventId
                const outcomeIdx = parts[parts.length - 1];
                const customEventId = parts.slice(0, -1).join('_');
                
                const amountStr = interaction.fields.getTextInputValue('bet_amount');
                const amount = parseInt(amountStr);

                if (isNaN(amount) || amount <= 0) {
                    await safeReply('Invalid bet amount.');
                    return;
                }

                if (!interaction.message) {
                    await safeReply('Could not find bet message.');
                    return;
                }

                const msg = await interaction.channel?.messages.fetch(interaction.message.id);
                if (!msg) {
                    await safeReply('Could not find bet message.');
                    return;
                }

                // Extract event title from message
                const content = msg.content;
                const titleMatch = content.match(/\*\*(.+)\*\*/);
                if (!titleMatch) {
                    await safeReply('Could not parse event info.');
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
                    await safeReply('Event not found.');
                    return;
                }

                if (event.resolved) {
                    await safeReply('This event has already been resolved.');
                    return;
                }

                const outcome = event.outcomes[parseInt(outcomeIdx)];
                if (!outcome) {
                    await safeReply('Invalid outcome.');
                    return;
                }

                let user = await User.findOne({ userId: interaction.user.id });
                if (!user) user = await User.create({ userId: interaction.user.id });

                if (user.coins < amount) {
                    await safeReply(`You do not have enough coins. You have **${user.coins}**.`);
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

                await safeReply(`Custom bet placed: **${amount}** coins on **${outcome}** (${odds.toFixed(2)}x) for ${customEventTitle}.`);
            }
        }
    },
};
