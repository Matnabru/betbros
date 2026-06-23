import {
	ActionRowBuilder,
	ChatInputCommandInteraction,
	ComponentType,
	ModalBuilder,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js';
import { connectMongo } from '../db/mongo';
const { Bet } = require('../db/bet');
import dotenv from 'dotenv';
import { MatchResult, settleBet } from '../utils/betResolution';
import { applyBetSettlementOnce, createSettlementBuckets, SettlementBuckets } from '../utils/applyBetSettlement';
import { formatScore } from '../utils/scoreSettlement';

dotenv.config();

function parseTeams(eventName: string): { home: string; away: string } | null {
	const match = eventName.match(/(.+) vs (.+)/i);
	if (!match) return null;

	return {
		home: match[1].trim(),
		away: match[2].trim()
	};
}

function parseScore(input: string): { homeScore: number; awayScore: number } | null {
	const match = input.trim().match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
	if (!match) return null;

	return {
		homeScore: Number(match[1]),
		awayScore: Number(match[2])
	};
}

function winnerFromScore(home: string, away: string, homeScore: number, awayScore: number): string {
	if (homeScore > awayScore) return home;
	if (awayScore > homeScore) return away;
	return 'DRAW';
}

function hasScoreBasedMarket(eventBets: any[]): boolean {
	return eventBets.some((bet) => ['exact_score', 'draw_no_bet', 'btts', 'total_goals'].includes(bet.market));
}

async function refundBets(eventBets: any[]): Promise<SettlementBuckets & { resolvedCount: number }> {
	const buckets = createSettlementBuckets();
	let resolvedCount = 0;

	for (const bet of eventBets) {
		try {
			if (await applyBetSettlementOnce(bet, 'void', buckets)) resolvedCount++;
		} catch (err) {
			console.error('Refund error:', err);
		}
	}

	return { ...buckets, resolvedCount };
}

async function resolveBetsWithScore(eventBets: any[], home: string, away: string, homeScore: number, awayScore: number) {
	const matchResult: MatchResult = {
		homeTeam: home,
		awayTeam: away,
		homeScore,
		awayScore
	};
	const buckets = createSettlementBuckets();
	let resolvedCount = 0;

	for (const bet of eventBets) {
		try {
			const settlement = settleBet(bet, matchResult, home, away);
			if (await applyBetSettlementOnce(bet, settlement, buckets)) resolvedCount++;
		} catch (err) {
			console.error('Resolve error:', err);
		}
	}

	return {
		result: winnerFromScore(home, away, homeScore, awayScore),
		resolvedCount,
		...buckets
	};
}

async function sendResolutionNotification(
	interaction: ChatInputCommandInteraction,
	eventName: string,
	result: string,
	scoreText: string | null,
	eventBets: any[],
	winners: Array<{ userId: string; amount: number; outcome: string }>,
	losers: Array<{ userId: string; amount: number; outcome: string }>,
	refunded: Array<{ userId: string; amount: number; outcome: string }>,
	scoreChanges: Array<{ userId: string; delta: number; outcome: string }>
) {
	const channelId = process.env.NOTIFICATION_CHANNEL_ID;
	if (!channelId) return;

	const notifChannel = await interaction.client.channels.fetch(channelId);
	if (!notifChannel || !notifChannel.isTextBased() || !('send' in notifChannel)) return;

	let message = `⚽ **Mecz rozstrzygnięty!**\n`;
	message += `**${eventName}**\n`;
	message += `🏆 Wynik: **${result}**${scoreText ? ` (${scoreText})` : ''}\n`;
	message += `📊 Zakładów: ${eventBets.length}\n`;

	if (winners.length > 0) {
		message += `\n🎉 **Legacy coin wins:**\n`;
		for (const winner of winners) {
			message += `<@${winner.userId}>: +${winner.amount} coins (${winner.outcome})\n`;
		}
	}

	if (losers.length > 0) {
		message += `\n😢 **Legacy coin losses:**\n`;
		for (const loser of losers) {
			message += `<@${loser.userId}>: -${loser.amount} coins (${loser.outcome})\n`;
		}
	}

	if (refunded.length > 0) {
		message += `\n↩️ **Legacy refunds:**\n`;
		for (const refund of refunded) {
			message += `<@${refund.userId}>: +0 coins (${refund.outcome}, refund ${refund.amount})\n`;
		}
	}

	if (scoreChanges.length > 0) {
		message += `\n📈 **Score:**\n`;
		for (const change of scoreChanges) {
			const sign = change.delta > 0 ? '+' : '';
			message += `<@${change.userId}>: ${sign}${formatScore(change.delta)} pts (${change.outcome})\n`;
		}
	}

	await (notifChannel as any).send({ content: message });
}

function buildResolveOptions(eventName: string, eventBets: any[]) {
	if (hasScoreBasedMarket(eventBets)) {
		return [
			{ label: 'Resolve by final score', value: 'SCORE' },
			{ label: 'Remove bet (refund/void all)', value: 'REFUND' }
		];
	}

	const teams = parseTeams(eventName);
	const teamOptions = teams
		? [teams.home, teams.away]
		: Array.from(new Set(eventBets.map((bet: any) => bet.outcome).filter((outcome: string) => outcome !== 'Draw')));
	const options = [
		...teamOptions.map((team) => ({ label: String(team).slice(0, 100), value: String(team).slice(0, 100) })),
		{ label: 'Draw', value: 'DRAW' },
		{ label: 'Remove bet (refund/void all)', value: 'REFUND' }
	];
	const seen = new Set<string>();

	return options.filter((option) => {
		if (seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	}).slice(0, 25);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('resolvebet')
		.setDescription('Manually resolve a bet event (admin only)'),
	async execute(interaction: ChatInputCommandInteraction) {
		if (interaction.user.id !== process.env.ADMIN_USER_ID) {
			await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
			return;
		}

		await interaction.reply({ content: 'Check your DMs to resolve a bet event!', ephemeral: true });
		const user = interaction.user;
		const dm = await user.createDM();
		await connectMongo();

		const unresolvedBets = await Bet.find({ resolved: false });
		const events = Array.from(new Map(unresolvedBets.map((bet: any) => [bet.eventId, bet])).values());
		if (events.length === 0) {
			await dm.send('No unresolved events found.');
			return;
		}

		const eventSelect = new StringSelectMenuBuilder()
			.setCustomId('resolve_event')
			.setPlaceholder('Select an event to resolve')
			.setMinValues(1)
			.setMaxValues(1)
			.addOptions(events.slice(0, 25).map((event: any) => ({
				label: `${event.eventName} (${event.league})`.slice(0, 100),
				value: event.eventId
			})));

		await dm.send({
			content: 'Select the event to resolve:',
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventSelect)]
		});

		const eventCollector = dm.createMessageComponentCollector({
			filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_event',
			componentType: ComponentType.StringSelect,
			time: 60000
		});

		eventCollector.once('collect', async (eventInteraction: StringSelectMenuInteraction) => {
			try {
				const eventId = eventInteraction.values[0];
				const eventBets = unresolvedBets.filter((bet: any) => bet.eventId === eventId);
				if (eventBets.length === 0) {
					await eventInteraction.reply({ content: 'No bets found for this event.', ephemeral: true });
					return;
				}

				const resultSelect = new StringSelectMenuBuilder()
					.setCustomId('resolve_result')
					.setPlaceholder('How should this event be resolved?')
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(buildResolveOptions(eventBets[0].eventName, eventBets));

				await eventInteraction.reply({
					content: 'Select manual resolution method/result:',
					components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(resultSelect)],
					ephemeral: true
				});

				const resultCollector = dm.createMessageComponentCollector({
					filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_result',
					componentType: ComponentType.StringSelect,
					time: 60000
				});

				resultCollector.once('collect', async (resultInteraction: StringSelectMenuInteraction) => {
					try {
						const selected = resultInteraction.values[0];
						const eventName = eventBets[0].eventName;

						if (selected === 'REFUND') {
							await refundBets(eventBets);
							await resultInteraction.reply({ content: 'All bets voided/refunded and event removed.', ephemeral: true });
							return;
						}

						if (selected === 'SCORE') {
							const teams = parseTeams(eventName);
							if (!teams) {
								await resultInteraction.reply({ content: 'Could not parse event teams from event name.', ephemeral: true });
								return;
							}

							const modalId = `resolve_score_${Date.now()}`;
							const modal = new ModalBuilder()
								.setCustomId(modalId)
								.setTitle('Resolve By Final Score');
							const scoreInput = new TextInputBuilder()
								.setCustomId('final_score')
								.setLabel(`${teams.home} - ${teams.away}`)
								.setStyle(TextInputStyle.Short)
								.setPlaceholder('e.g. 2-1')
								.setRequired(true);
							modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(scoreInput));

							await resultInteraction.showModal(modal);
							const modalInteraction = await resultInteraction.awaitModalSubmit({
								filter: (submit) => submit.user.id === user.id && submit.customId === modalId,
								time: 5 * 60 * 1000
							});
							await modalInteraction.deferReply({ ephemeral: true });

							const score = parseScore(modalInteraction.fields.getTextInputValue('final_score'));
							if (!score) {
								await modalInteraction.editReply({ content: 'Invalid score. Use home-away format, for example `2-1`.' });
								return;
							}

							const resolved = await resolveBetsWithScore(eventBets, teams.home, teams.away, score.homeScore, score.awayScore);
							try {
								await sendResolutionNotification(
									interaction,
									eventName,
									resolved.result,
									`${score.homeScore}-${score.awayScore}`,
									eventBets,
									resolved.winners,
									resolved.losers,
									resolved.refunded,
									resolved.scoreChanges
								);
							} catch (err) {
								console.error('Failed to send resolution notification:', err);
							}

							await modalInteraction.editReply({
								content: `Event resolved by final score: **${teams.home} ${score.homeScore}-${score.awayScore} ${teams.away}**.`
							});
							return;
						}

						if (hasScoreBasedMarket(eventBets)) {
							await resultInteraction.reply({
								content: 'This event has score-derived markets. Choose **Resolve by final score** so exact score, BTTS, totals, and DNB settle correctly.',
								ephemeral: true
							});
							return;
						}

						const buckets = createSettlementBuckets();
						for (const bet of eventBets) {
							const won = bet.outcome === selected || (selected === 'DRAW' && bet.outcome === 'Draw');
							await applyBetSettlementOnce(bet, won ? 'won' : 'lost', buckets);
						}

						try {
							await sendResolutionNotification(
								interaction,
								eventName,
								selected,
								null,
								eventBets,
								buckets.winners,
								buckets.losers,
								buckets.refunded,
								buckets.scoreChanges
							);
						} catch (err) {
							console.error('Failed to send resolution notification:', err);
						}

						await resultInteraction.reply({ content: `Event resolved as: ${selected}.`, ephemeral: true });
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
