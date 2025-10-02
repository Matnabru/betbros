import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, ComponentType } from 'discord.js';
import { connectMongo } from '../db/mongo';
const { Bet } = require('../db/bet');
import { User } from '../db/user';
import dotenv from 'dotenv';
dotenv.config();

module.exports = {
	data: new SlashCommandBuilder()
		.setName('resolvebet')
		.setDescription('Resolve a bet event (admin only)'),
	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.user.id !== process.env.ADMIN_USER_ID) {
			await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
			return;
		}
		await interaction.reply({ content: 'Check your DMs to resolve a bet event!', ephemeral: true });
		const user = interaction.user;
		const dm = await user.createDM();
		await connectMongo();

		// 1. Get all unresolved events
		const unresolvedBets = await Bet.find({ resolved: false });
		const events = Array.from(new Map(unresolvedBets.map((b:any) => [b.eventId, b])).values());
		if (events.length === 0) {
			await dm.send('No unresolved events found.');
			return;
		}

		// 2. Show multiselect for event selection
		const eventOptions = events.map((ev:any) => ({
			label: `${ev.eventName} (${ev.league})`,
			value: ev.eventId
		}));
		const eventSelect = new StringSelectMenuBuilder()
			.setCustomId('resolve_event')
			.setPlaceholder('Select an event to resolve')
			.setMinValues(1)
			.setMaxValues(1)
			.addOptions(eventOptions);
		const eventRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventSelect);
		await dm.send({
			content: 'Select the event to resolve:',
			components: [eventRow]
		});

		// 3. Wait for event selection
		const eventCollector = dm.createMessageComponentCollector({
			filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_event',
			componentType: ComponentType.StringSelect,
			time: 60000
		});

		eventCollector.once('collect', async (eventInteraction: StringSelectMenuInteraction) => {
			try {
				const eventId = eventInteraction.values[0];
				const eventBets = unresolvedBets.filter((b:any) => b.eventId === eventId);
				if (eventBets.length === 0) {
					try { await eventInteraction.reply({ content: 'No bets found for this event.', ephemeral: true }); } catch (err) { console.error('Reply error:', err); }
					return;
				}
				// Get all unique outcomes (clubs) for this event
				const outcomes = Array.from(new Set(eventBets.map((b:any) => b.outcome)));
				// 4. Show multiselect for result selection
				const resultOptions = outcomes.map(o => ({ label: String(o), value: String(o) }));
				resultOptions.push({ label: 'Draw', value: 'DRAW' });
				resultOptions.push({ label: 'Remove bet (refund all)', value: 'REFUND' });
				const resultSelect = new StringSelectMenuBuilder()
					.setCustomId('resolve_result')
					.setPlaceholder('Select the result for this event')
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(...resultOptions);
				const resultRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(resultSelect);
				try {
					await eventInteraction.reply({
						content: 'Select the result for this event:',
						components: [resultRow],
						ephemeral: true
					});
				} catch (err) {
					console.error('Reply error:', err);
				}

				// 5. Wait for result selection
				const resultCollector = dm.createMessageComponentCollector({
					filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_result',
					componentType: ComponentType.StringSelect,
					time: 60000
				});
				resultCollector.once('collect', async (resultInteraction: StringSelectMenuInteraction) => {
					try {
						const result = resultInteraction.values[0];
						if (result === 'REFUND') {
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
								} catch (err) { console.error('Refund error:', err); }
							}
							try { await resultInteraction.reply({ content: 'All bets refunded and event removed.', ephemeral: true }); } catch (err) { console.error('Reply error:', err); }
						} else {
							// Resolve bets: pay out winners, mark losers
							for (const bet of eventBets) {
								try {
									if (bet.outcome === result || (result === 'DRAW' && bet.outcome === 'Draw')) {
										// Winner
										const betUser = await User.findOne({ userId: bet.userId });
										if (betUser) {
											const payout = Math.round(bet.amount * bet.odds);
											betUser.coins += payout;
											await betUser.save();
										}
										bet.won = true;
									} else {
										bet.won = false;
									}
									bet.resolved = true;
									await bet.save();
								} catch (err) { console.error('Resolve error:', err); }
							}
							try { await resultInteraction.reply({ content: `Event resolved as: ${result}. Winners paid out.`, ephemeral: true }); } catch (err) { console.error('Reply error:', err); }
						}
					} catch (err) {
						console.error('Result collector error:', err);
					}
				});
			} catch (err) {
				console.error('Event collector error:', err);
			}
		});
	}
};
