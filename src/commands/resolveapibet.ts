import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, ComponentType } from 'discord.js';
import { connectMongo } from '../db/mongo';
const { Bet } = require('../db/bet');
import { User } from '../db/user';
import fetch from 'node-fetch';
import { fetchSofaScoreTodayMatches } from '../features/fetchSofaScoreTodayMatches';
import { leagueApiFootballMap } from '../leagueApiFootballMap';
import { findFixtureByTeamsOnDate } from '../features/findFixtureByTeamsOnDate';
import dotenv from 'dotenv';
// Keep leagueOptions in sync with bet.js
const leagueOptions = [
    { label: 'La Liga (Spain)', value: 'soccer_spain_la_liga' },
    { label: 'Premier League', value: 'soccer_epl' },
    { label: 'Ekstraklasa (Poland)', value: 'soccer_poland_ekstraklasa' },
    { label: 'FA Cup', value: 'soccer_fa_cup' },
    { label: 'FIFA World Cup Qualifiers - Europe', value: 'soccer_fifa_world_cup_qualifiers_europe' },
    { label: 'FIFA World Cup Winner', value: 'soccer_fifa_world_cup_winner' },
    { label: 'UEFA Champions League', value: 'soccer_uefa_champs_league' },
    { label: 'UEFA Europa Conference League', value: 'soccer_uefa_europa_conference_league' },
    { label: 'UEFA Europa League', value: 'soccer_uefa_europa_league' }
];

dotenv.config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resolveapibet')
        .setDescription('Resolve a bet event using API-Football (admin only)'),
    async execute(interaction: ChatInputCommandInteraction) {
        if (interaction.user.id !== process.env.ADMIN_USER_ID) {
            await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            return;
        }
        await interaction.reply({ content: 'Check your DMs to resolve a bet event (API)!', ephemeral: true });
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
            .setCustomId('resolve_api_event')
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
            filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'resolve_api_event',
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
                // Extract home and away team from eventName
                const eventName = eventBets[0].eventName;
                let home = '', away = '';
                const match = eventName.match(/(.+) vs (.+)/i);
                if (match) {
                    home = match[1].trim();
                    away = match[2].trim();
                } else {
                    await eventInteraction.reply({ content: 'Could not parse event name for teams.', ephemeral: true });
                    return;
                }
                // Use today's date for the query
                const date = new Date().toISOString().slice(0, 10);
                await dm.send({ content: `Querying SofaScore for: ${home} vs ${away}, Date: ${date}` });
                let matches;
                try {
                    matches = await fetchSofaScoreTodayMatches();
                } catch (err) {
                    await dm.send({ content: `SofaScore fetch error: ${err}` });
                    return;
                }
                // Find exact match for home and away
                const fixture = matches.find((m:any) => m.home === home && m.away === away);
                if (!fixture) {
                    await eventInteraction.reply({ content: `No result found by SofaScore for ${home} vs ${away}.`, ephemeral: true });
                    return;
                }
                await dm.send({ content: `SofaScore fixture: ${JSON.stringify(fixture)}` });
                // Determine result
                let result = '';
                let homeScore = fixture.homeScore, awayScore = fixture.awayScore;
                if (fixture.status === 'finished') {
                    if (homeScore != null && awayScore != null) {
                        if (homeScore > awayScore) result = home;
                        else if (awayScore > homeScore) result = away;
                        else result = 'DRAW';
                    } else {
                        await eventInteraction.reply({ content: `Could not determine score for this match.`, ephemeral: true });
                        return;
                    }
                } else {
                    await eventInteraction.reply({ content: `Match not finished yet.`, ephemeral: true });
                    return;
                }
                // Now resolve bets as in original resolvebet
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
                await eventInteraction.reply({ content: `Event resolved as: ${result} (score: ${homeScore}-${awayScore}). Winners paid out.`, ephemeral: true });
            } catch (err) {
                console.error('API Event collector error:', err);
            }
        });
    }
};
