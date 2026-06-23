import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, ComponentType } from 'discord.js';
import { connectMongo } from '../db/mongo';
const { Bet } = require('../db/bet');
import { User } from '../db/user';
import {
    ApiFootballMatchResult,
    fetchApiFootballMatchResultByFixtureId,
    fetchApiFootballMatchResultsByDate
} from '../features/apiFootball';
import { fetchSofaScoreMatchesByDate } from '../features/fetchSofaScoreTodayMatches';
import dotenv from 'dotenv';
import { normalizeTeamName, settleBet } from '../utils/betResolution';
import { applyBetSettlementOnce, createSettlementBuckets } from '../utils/applyBetSettlement';
import { formatScore } from '../utils/scoreSettlement';
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

type ResolvableMatch = Pick<ApiFootballMatchResult, 'league' | 'home' | 'away' | 'homeScore' | 'awayScore' | 'status' | 'startTime'> & {
    source: 'API-Football' | 'SofaScore';
};

function toDateKey(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd}`;
}

function resultLookupDates(date: Date): Date[] {
    const dayMs = 24 * 60 * 60 * 1000;
    return [
        date,
        new Date(date.getTime() - dayMs),
        new Date(date.getTime() + dayMs)
    ];
}

function getEventDate(eventBets: any[]): Date {
    const betWithDate = eventBets.find((bet) => bet.matchDate);
    return betWithDate?.matchDate ? new Date(betWithDate.matchDate) : new Date();
}

function teamsMatch(fixture: Pick<ResolvableMatch, 'home' | 'away'>, home: string, away: string): boolean {
    const homeNorm = normalizeTeamName(home);
    const awayNorm = normalizeTeamName(away);
    const fixtureHomeNorm = normalizeTeamName(fixture.home);
    const fixtureAwayNorm = normalizeTeamName(fixture.away);

    return (fixtureHomeNorm === homeNorm && fixtureAwayNorm === awayNorm)
        || (fixtureHomeNorm === awayNorm && fixtureAwayNorm === homeNorm);
}

function getNumericProviderFixtureId(eventBets: any[]): string | undefined {
    return eventBets.find((bet) => bet.providerFixtureId && /^\d+$/.test(String(bet.providerFixtureId)))?.providerFixtureId;
}

async function findScoreSourceResult(eventBets: any[], home: string, away: string): Promise<ResolvableMatch | null> {
    const eventDate = getEventDate(eventBets);
    const providerFixtureId = getNumericProviderFixtureId(eventBets);
    if (providerFixtureId) {
        try {
            const fixture = await fetchApiFootballMatchResultByFixtureId(Number(providerFixtureId));
            if (fixture) return { ...fixture, source: 'API-Football' };
        } catch (err) {
            console.warn(`[ResolveApiBet] API-Football fixture lookup failed for ${providerFixtureId}:`, err);
        }
    }

    for (const lookupDate of resultLookupDates(eventDate)) {
        const apiDate = toDateKey(lookupDate);
        try {
            const matches = await fetchApiFootballMatchResultsByDate(apiDate);
            const fixture = matches.find((match) => teamsMatch(match, home, away));
            if (fixture) return { ...fixture, source: 'API-Football' };
        } catch (err) {
            console.warn(`[ResolveApiBet] API-Football date lookup failed for ${home} vs ${away} on ${apiDate}:`, err);
        }
    }

    for (const lookupDate of resultLookupDates(eventDate)) {
        const sofaDate = toDateKey(lookupDate);
        try {
            const sofaMatches = await fetchSofaScoreMatchesByDate(lookupDate);
            const sofaFixture = sofaMatches.find((match) => teamsMatch(match, home, away));
            if (sofaFixture) return { ...sofaFixture, source: 'SofaScore' };
        } catch (err) {
            console.warn(`[ResolveApiBet] SofaScore date lookup failed for ${home} vs ${away} on ${sofaDate}:`, err);
        }
    }

    return null;
}

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
                await eventInteraction.deferUpdate();
                const eventId = eventInteraction.values[0];
                const eventBets = unresolvedBets.filter((b:any) => b.eventId === eventId);
                if (eventBets.length === 0) {
                    await dm.send('No bets found for this event.');
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
                    await dm.send('Could not parse event name for teams.');
                    return;
                }
                await dm.send({ content: `Querying score sources for: ${home} vs ${away}` });
                let fixture;
                try {
                    fixture = await findScoreSourceResult(eventBets, home, away);
                } catch (err) {
                    await dm.send({ content: `Score source fetch error: ${err}` });
                    return;
                }
                if (!fixture) {
                    await dm.send(`No result found by API-Football or SofaScore for ${home} vs ${away}.`);
                    return;
                }
                await dm.send({ content: `${fixture.source} fixture: ${JSON.stringify(fixture)}` });
                // Determine result
                let result = '';
                let homeScore = fixture.homeScore, awayScore = fixture.awayScore;
                if (fixture.status === 'finished') {
                    if (homeScore != null && awayScore != null) {
                        if (homeScore > awayScore) result = home;
                        else if (awayScore > homeScore) result = away;
                        else result = 'DRAW';
                    } else {
                        await dm.send('Could not determine score for this match.');
                        return;
                    }
                } else {
                    await dm.send(`Match not finished yet. Status: ${fixture.status}`);
                    return;
                }
                const matchResult = {
                    homeTeam: fixture.home,
                    awayTeam: fixture.away,
                    homeScore,
                    awayScore
                };
                // Now resolve bets as in original resolvebet
                const buckets = createSettlementBuckets();
                
                for (const bet of eventBets) {
                    try {
                        const settlement = settleBet(bet, matchResult, home, away);
                        await applyBetSettlementOnce(bet, settlement, buckets);
                    } catch (err) { console.error('Resolve error:', err); }
                }
                const { winners, losers, refunded, scoreChanges } = buckets;
                
                // Send notification to Discord channel
                try {
                    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                    if (channelId) {
                        const notifChannel = await interaction.client.channels.fetch(channelId);
                        if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                            let message = `⚽ **Mecz rozstrzygnięty!**\n`;
                            message += `**${eventName}**\n`;
                            message += `🏆 Zwycięzca: **${result}** (${homeScore}-${awayScore})\n`;
                            message += `📊 Zakładów: ${eventBets.length}\n`;
                            
                            if (winners.length > 0) {
                                message += `\n🎉 **Zwycięzcy:** ${winners.length} graczy wygrało!\n`;
                                for (const w of winners) {
                                    const user = await User.findOne({ userId: w.userId });
                                    const username = user ? `<@${w.userId}>` : w.userId;
                                    message += `${username}: +${w.amount} coins (${w.outcome})\n`;
                                }
                            } else if (scoreChanges.length === 0) {
                                message += `\n😢 Brak zwycięzców w tym meczu.\n`;
                            }
                            
                            if (losers.length > 0) {
                                message += `\n😢 **Przegrani:** ${losers.length} graczy straciło swoje zakłady.\n`;
                                for (const l of losers) {
                                    const user = await User.findOne({ userId: l.userId });
                                    const username = user ? `<@${l.userId}>` : l.userId;
                                    message += `${username}: -${l.amount} coins (${l.outcome})\n`;
                                }
                            }

                            if (refunded.length > 0) {
                                message += `\n↩️ **Zwroty:** ${refunded.length} zakładów zwrócono.\n`;
                                for (const r of refunded) {
                                    const user = await User.findOne({ userId: r.userId });
                                    const username = user ? `<@${r.userId}>` : r.userId;
                                    message += `${username}: +0 coins (${r.outcome}, refund ${r.amount})\n`;
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
                    }
                } catch (err) {
                    console.error('Failed to send resolution notification:', err);
                }
                
                await dm.send(`Event resolved as: ${result} (score: ${homeScore}-${awayScore}). Winners paid out.`);
            } catch (err) {
                console.error('API Event collector error:', err);
                try {
                    await dm.send(`API resolve failed: ${err instanceof Error ? err.message : String(err)}`);
                } catch {}
            }
        });
    }
};
