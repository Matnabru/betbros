import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ComponentType,
    Interaction,
    ModalBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import { getApiFootballLeagueLabel, getDefaultFootballSeason, getSoccerLeagueByApiFootballId, soccerLeagues } from '../config/leagues';
import { fetchMatchWinnerOddsByLeague, MatchWinnerMarket } from '../features/apiFootball';
import {
    fetchOddsCheckerWorldCupCorrectScoreOdds,
    OddsCheckerCorrectScoreOdd
} from '../features/oddsChecker';
import { formatMatchWinnerButtonLabel, orderMatchWinnerOutcomes } from '../utils/matchWinnerOdds';
import {
    BetButtonChoiceCode,
    BetButtonMarketCode,
    encodeBetButtonId
} from '../utils/betButtonIds';

dotenv.config();

interface OddsApiOutcome {
    name: string;
    price: number;
    point?: number;
}

interface OddsApiEventMarket {
    key: string;
    outcomes: OddsApiOutcome[];
}

interface OddsApiEventBookmaker {
    title?: string;
    key?: string;
    markets?: OddsApiEventMarket[];
}

interface OddsApiEventDetails {
    bookmakers?: OddsApiEventBookmaker[];
}

interface FixtureMarketPreview {
    marketKey: string;
    outcomes: OddsApiOutcome[];
}

interface BetButtonOption {
    label: string;
    marketCode: BetButtonMarketCode;
    choiceCode: BetButtonChoiceCode;
    point?: number;
}

type BetComponentRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

const ODDS_API_FIXTURE_MARKETS = [
    'h2h',
    'h2h_3_way',
    'draw_no_bet',
    'btts',
    'totals',
    'alternate_totals'
];
const WORLD_CUP_LEAGUE_ID = 1;

function scoreValue(homeScore: number, awayScore: number): string {
    return `${homeScore}-${awayScore}`;
}

function formatMatchDate(date: Date): string {
    return date.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function scoreOptionSort(a: OddsCheckerCorrectScoreOdd, b: OddsCheckerCorrectScoreOdd): number {
    return a.odds - b.odds
        || (a.homeScore + a.awayScore) - (b.homeScore + b.awayScore)
        || a.homeScore - b.homeScore
        || a.awayScore - b.awayScore;
}

function formatExactScoreLabel(odd: OddsCheckerCorrectScoreOdd): string {
    return `${odd.outcome} (${odd.odds.toFixed(2)})`.slice(0, 100);
}

function buildExactScoreRow(event: MatchWinnerMarket, odds: OddsCheckerCorrectScoreOdd[]): ActionRowBuilder<StringSelectMenuBuilder> | null {
    if (!odds.length) return null;

    const bestByScore = new Map<string, OddsCheckerCorrectScoreOdd>();
    for (const odd of odds) {
        const key = scoreValue(odd.homeScore, odd.awayScore);
        const existing = bestByScore.get(key);
        if (!existing || odd.odds > existing.odds) {
            bestByScore.set(key, odd);
        }
    }

    const options = Array.from(bestByScore.values())
        .sort(scoreOptionSort)
        .slice(0, 25)
        .map((odd) => ({
            label: formatExactScoreLabel(odd),
            description: `${event.homeTeam} ${odd.outcome} ${event.awayTeam} | ${odd.bookmaker}`.slice(0, 100),
            value: scoreValue(odd.homeScore, odd.awayScore)
        }));

    if (!options.length) return null;

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`exactscore|${encodeURIComponent(String(event.fixtureId)).slice(0, 80)}`)
            .setPlaceholder('Exact score odds (OddsChecker)')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options)
    );
}

function disableComponentRows(rows: BetComponentRow[]): BetComponentRow[] {
    return rows.map((row) => {
        const disabledRow = new ActionRowBuilder<any>();

        row.components.forEach((component: any) => {
            const type = component.data?.type ?? component.type;
            if (type === 2) {
                disabledRow.addComponents(ButtonBuilder.from(component).setDisabled(true));
            } else if (type === 3) {
                disabledRow.addComponents(StringSelectMenuBuilder.from(component).setDisabled(true));
            }
        });

        return disabledRow as BetComponentRow;
    });
}

function summarizeOddsApiError(body: string): string {
    try {
        const parsed = JSON.parse(body);
        return parsed.message || parsed.error || parsed.error_code || body.slice(0, 300);
    } catch {
        return body.slice(0, 300);
    }
}

function choiceCodeForMatchWinner(outcome: string, homeTeam: string, awayTeam: string): BetButtonChoiceCode {
    const normalized = outcome.trim().toLowerCase();
    if (normalized === 'draw' || normalized === 'x' || normalized === 'tie') return 'd';
    if (normalized === homeTeam.trim().toLowerCase()) return 'h';
    if (normalized === awayTeam.trim().toLowerCase()) return 'a';
    return 'h';
}

function choiceCodeForMarketOutcome(outcome: OddsApiOutcome): BetButtonChoiceCode | null {
    const normalized = outcome.name.trim().toLowerCase();
    if (normalized === 'yes') return 'y';
    if (normalized === 'no') return 'n';
    if (normalized === 'over') return 'o';
    if (normalized === 'under') return 'u';
    return null;
}

function marketCodeForProviderMarket(marketKey: string): BetButtonMarketCode | null {
    if (marketKey === 'draw_no_bet') return 'dnb';
    if (marketKey === 'btts') return 'btts';
    if (marketKey === 'totals') return 'tot';
    if (marketKey === 'alternate_totals') return 'atot';
    return null;
}

async function fetchExactScoreOddsForBetScreen(event: MatchWinnerMarket): Promise<OddsCheckerCorrectScoreOdd[]> {
    if (event.leagueId !== WORLD_CUP_LEAGUE_ID || !process.env.SCRAPE_DO_TOKEN) return [];

    try {
        const market = await fetchOddsCheckerWorldCupCorrectScoreOdds(event.homeTeam, event.awayTeam);
        console.log(`[BetFlow] OddsChecker Correct Score ${event.homeTeam} vs ${event.awayTeam}: ${market.odds.length} outcomes`);
        return market.odds;
    } catch (err) {
        console.warn(`[BetFlow] OddsChecker Correct Score failed for ${event.homeTeam} vs ${event.awayTeam}:`, err);
        return [];
    }
}

async function findLatestExactScoreOdd(
    event: MatchWinnerMarket,
    homeScore: number,
    awayScore: number
): Promise<OddsCheckerCorrectScoreOdd | null> {
    const odds = await fetchExactScoreOddsForBetScreen(event);
    const matchingOdds = odds.filter((odd) => odd.homeScore === homeScore && odd.awayScore === awayScore);
    if (!matchingOdds.length) return null;

    return matchingOdds.reduce((best, current) => current.odds > best.odds ? current : best);
}

function buildFixtureBetRows(
    event: MatchWinnerMarket,
    matchWinnerOutcomes: BetButtonOption[],
    fixtureMarkets: FixtureMarketPreview[]
): ActionRowBuilder<ButtonBuilder>[] {
    const timestamp = Math.floor(event.matchDate.getTime() / 1000);
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let optionIndex = 0;

    const addRow = (options: BetButtonOption[]) => {
        if (!options.length || rows.length >= 5) return;

        const row = new ActionRowBuilder<ButtonBuilder>();
        options.slice(0, 5).forEach((option) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(encodeBetButtonId({
                        provider: event.provider,
                        eventId: String(event.fixtureId),
                        index: optionIndex++,
                        timestamp,
                        marketCode: option.marketCode,
                        choiceCode: option.choiceCode,
                        point: option.point
                    }))
                    .setLabel(option.label.slice(0, 80))
                    .setStyle(ButtonStyle.Primary)
            );
        });
        rows.push(row);
    };

    addRow(matchWinnerOutcomes);

    for (const market of fixtureMarkets) {
        const marketCode = marketCodeForProviderMarket(market.marketKey);
        if (!marketCode) continue;

        const options = market.outcomes
            .map((outcome): BetButtonOption | null => {
                const choiceCode = choiceCodeForMarketOutcome(outcome);
                if (!choiceCode) return null;

                const point = typeof outcome.point === 'number' ? outcome.point : undefined;
                const pointText = typeof point === 'number' ? ` ${point}` : '';
                const prefix = marketCode === 'dnb'
                    ? 'DNB '
                    : marketCode === 'btts'
                        ? 'BTTS '
                        : '';

                return {
                    label: `${prefix}${outcome.name}${pointText} (${Number(outcome.price).toFixed(2)})`,
                    marketCode,
                    choiceCode,
                    point
                };
            })
            .filter((option): option is BetButtonOption => Boolean(option));

        addRow(options);
    }

    return rows;
}

async function fetchTheOddsApiFixtureMarkets(
    sportKey: string,
    eventId: string,
    preferredBookmaker: string
): Promise<FixtureMarketPreview[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?apiKey=${encodeURIComponent(apiKey)}&regions=eu&markets=${encodeURIComponent(ODDS_API_FIXTURE_MARKETS.join(','))}&oddsFormat=decimal`;
    const res = await fetch(url);
    console.log(`[BetFlow] The Odds API fixture markets ${sportKey}/${eventId}: status ${res.status} ${res.statusText}`);
    if (!res.ok) {
        const errorBody = await res.text();
        console.warn(`[BetFlow] The Odds API fixture markets failed: ${summarizeOddsApiError(errorBody)}`);
        return [];
    }

    const data = await res.json() as OddsApiEventDetails;
    const bookmakers = data.bookmakers || [];
    const previews: FixtureMarketPreview[] = [];

    for (const marketKey of ODDS_API_FIXTURE_MARKETS) {
        if (marketKey === 'h2h_3_way' && previews.some((preview) => preview.marketKey === 'h2h')) {
            continue;
        }

        const withMarket = bookmakers
            .map((bookmaker) => ({
                bookmaker,
                market: bookmaker.markets?.find((market) => market.key === marketKey)
            }))
            .filter((item): item is { bookmaker: OddsApiEventBookmaker; market: OddsApiEventMarket } =>
                Boolean(item.market?.outcomes?.length)
            );
        if (!withMarket.length) continue;

        const preferred = withMarket.find((item) => item.bookmaker.title === preferredBookmaker);
        const selected = preferred || withMarket
            .slice()
            .sort((a, b) => (b.market.outcomes?.length || 0) - (a.market.outcomes?.length || 0))[0];

        previews.push({
            marketKey,
            outcomes: selected.market.outcomes
                .filter((outcome) => Number.isFinite(Number(outcome.price)))
                .slice(0, 8)
        });
    }

    return previews;
}

async function fetchTheOddsApiMatchWinnerOdds(
    leagueId: number,
    sportKey: string
): Promise<MatchWinnerMarket[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) {
        console.warn(`[BetFlow] ODDS_API_KEY is not set; cannot use The Odds API fallback for ${sportKey}.`);
        return [];
    }

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu&markets=h2h&oddsFormat=decimal`;
    const res = await fetch(url);
    console.log(`[BetFlow] The Odds API fallback ${sportKey}: status ${res.status} ${res.statusText}`);
    if (!res.ok) {
        const errorBody = await res.text();
        console.warn(`[BetFlow] The Odds API fallback ${sportKey} failed: ${summarizeOddsApiError(errorBody)}`);
        return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data.flatMap((event: any): MatchWinnerMarket[] => {
        const bookmaker = event.bookmakers?.find((candidate: any) =>
            candidate.markets?.some((market: any) => market.key === 'h2h' && market.outcomes?.length)
        );
        const h2hMarket = bookmaker?.markets?.find((market: any) => market.key === 'h2h' && market.outcomes?.length);
        if (!bookmaker || !h2hMarket) return [];

        const outcomes = h2hMarket.outcomes
            .map((outcome: any) => ({
                outcome: String(outcome.name),
                odds: Number(outcome.price),
                apiValue: String(outcome.name)
            }))
            .filter((outcome: any) => !Number.isNaN(outcome.odds) && outcome.odds > 1);
        if (outcomes.length < 2) return [];

        return [{
            provider: 'the-odds-api',
            fixtureId: String(event.id),
            homeTeam: String(event.home_team),
            awayTeam: String(event.away_team),
            leagueId,
            leagueName: getApiFootballLeagueLabel(leagueId),
            matchDate: event.commence_time ? new Date(event.commence_time) : new Date(),
            bookmakerId: bookmaker.key || bookmaker.title || 'unknown',
            bookmaker: bookmaker.title || bookmaker.key || 'unknown',
            marketId: h2hMarket.key || 'h2h',
            marketName: 'Match Winner',
            updatedAt: h2hMarket.last_update ? new Date(h2hMarket.last_update) : undefined,
            outcomes
        }];
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('legacybet')
        .setDescription('Legacy coin-based betting flow.')
        .addStringOption(option =>
            option.setName('search')
                .setDescription('Search for a team or event name')
                .setRequired(false)
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.reply({ content: 'Check your DMs to place your bet!', ephemeral: true });
        const user = interaction.user;
        const dm = await user.createDM();
        const season = Number(process.env.API_FOOTBALL_SEASON) || getDefaultFootballSeason();
        const search = interaction.options.getString('search')?.toLowerCase() || '';

        console.log(`[BetFlow] /bet started by ${interaction.user.id}${search ? ` search="${search}"` : ''}; provider=API-Football; season=${season}`);
        if (!process.env.API_FOOTBALL_KEY && !process.env.API_SPORTS_KEY) {
            console.warn('[BetFlow] API_FOOTBALL_KEY is not set; /bet cannot fetch API-Football bookmaker odds.');
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_league')
            .setPlaceholder('Select one or more leagues/tournaments')
            .setMinValues(1)
            .setMaxValues(soccerLeagues.length)
            .addOptions(soccerLeagues.map((league) => ({
                label: league.label.slice(0, 100),
                value: String(league.apiFootballLeagueId)
            })));
        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
        const leaguePrompt = await dm.send({
            content: `Select the leagues/tournaments to search. Season: **${season}**.`,
            components: [selectRow]
        });

        const selectCollector = dm.createMessageComponentCollector({
            filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'select_league',
            componentType: ComponentType.StringSelect,
            time: 15 * 60 * 1000
        });

        selectCollector?.on('collect', async (selectInteraction: StringSelectMenuInteraction) => {
            try {
                await selectInteraction.deferUpdate();
                const selectedLeagues = selectInteraction.values.map(Number);
                let foundEvents: MatchWinnerMarket[] = [];
                const leagueMap: Record<string, string> = {};
                console.log(`[BetFlow] ${selectInteraction.user.id} selected API-Football leagues: ${selectedLeagues.map(getApiFootballLeagueLabel).join(', ')}`);

                for (const leagueId of selectedLeagues) {
                    const leagueLabel = getApiFootballLeagueLabel(leagueId);
                    const leagueConfig = getSoccerLeagueByApiFootballId(leagueId);
                    console.log(`[BetFlow] Fetching API-Football match-winner odds for ${leagueLabel} (${leagueId}), season=${season}`);

                    let leagueEvents: MatchWinnerMarket[] = [];
                    try {
                        leagueEvents = await fetchMatchWinnerOddsByLeague(leagueId, season);
                    } catch (err) {
                        console.error(`[BetFlow] ${leagueLabel}: API-Football odds fetch failed:`, err);
                    }

                    if (!leagueEvents.length && leagueConfig?.oddsApiKey) {
                        console.log(`[BetFlow] ${leagueLabel}: falling back to The Odds API sport key ${leagueConfig.oddsApiKey}`);
                        leagueEvents = await fetchTheOddsApiMatchWinnerOdds(leagueId, leagueConfig.oddsApiKey);
                    }

                    console.log(`[BetFlow] ${leagueLabel}: received ${leagueEvents.length} fixtures with match-winner odds before search filtering`);
                    if (search) {
                        leagueEvents = leagueEvents.filter((event) =>
                            event.homeTeam.toLowerCase().includes(search) ||
                            event.awayTeam.toLowerCase().includes(search)
                        );
                        console.log(`[BetFlow] ${leagueLabel}: ${leagueEvents.length} fixtures after search filter "${search}"`);
                    }

                    for (const event of leagueEvents) {
                        foundEvents.push(event);
                        leagueMap[String(event.fixtureId)] = event.leagueName || leagueLabel;
                    }
                }

                if (!foundEvents.length) {
                    console.log(`[BetFlow] No API-Football match-winner odds found for selected leagues${search ? ` and search "${search}"` : ''}.`);
                    await selectInteraction.message.edit({
                        content: `No upcoming events with bookmaker odds found${search ? ` for "${search}"` : ''}. Check bot logs for API-Football details.`,
                        components: []
                    });
                    return;
                }

                foundEvents = foundEvents
                    .sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime())
                    .slice(0, 25);
                console.log(`[BetFlow] Showing ${foundEvents.length} API-Football fixtures for event selection`);

                const eventOptions = foundEvents.map(event => ({
                    label: `${event.homeTeam} vs ${event.awayTeam}`.slice(0, 100),
                    description: `${formatMatchDate(event.matchDate)} | ${event.bookmaker}`.slice(0, 100),
                    value: String(event.fixtureId)
                }));
                const eventMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_event')
                    .setPlaceholder('Select an event')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(eventOptions);
                const eventRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventMenu);

                await selectInteraction.message.edit({
                    content: 'Select the event to view API-Football match-winner odds:',
                    components: [eventRow]
                });
                selectCollector?.stop('selected');

                const eventCollector = dm.createMessageComponentCollector({
                    filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'select_event',
                    componentType: ComponentType.StringSelect,
                    time: 15 * 60 * 1000
                });
                eventCollector?.on('collect', async (eventInteraction: StringSelectMenuInteraction) => {
                    try {
                        await eventInteraction.deferUpdate();
                        const eventId = eventInteraction.values[0];
                        const event = foundEvents.find(ev => String(ev.fixtureId) === eventId);
                        if (!event) {
                            await eventInteraction.message.edit({ content: 'Event not found.', components: [] });
                            return;
                        }

                        await connectMongo();
                        const userId = eventInteraction.user.id;
                        let dbUser = await User.findOne({ userId });
                        if (!dbUser) dbUser = await User.create({ userId });

                        const teams = `${event.homeTeam} vs ${event.awayTeam}`;
                        const displayOutcomes = orderMatchWinnerOutcomes(
                            event.outcomes,
                            event.homeTeam,
                            event.awayTeam
                        ).slice(0, 5);
                        const quickBetOptions: BetButtonOption[] = displayOutcomes.map((outcome) => ({
                            label: formatMatchWinnerButtonLabel(outcome),
                            marketCode: 'mw',
                            choiceCode: choiceCodeForMatchWinner(outcome.outcome, event.homeTeam, event.awayTeam)
                        }));
                        const leagueConfig = getSoccerLeagueByApiFootballId(event.leagueId);
                        const fixtureMarketPreview = event.provider === 'the-odds-api' && leagueConfig?.oddsApiKey
                            ? await fetchTheOddsApiFixtureMarkets(
                                leagueConfig.oddsApiKey,
                                String(event.fixtureId),
                                event.bookmaker
                            )
                            : [];
                        const buttonRows = buildFixtureBetRows(event, quickBetOptions, fixtureMarketPreview);
                        const exactScoreOdds = await fetchExactScoreOddsForBetScreen(event);
                        const exactScoreRow = buildExactScoreRow(event, exactScoreOdds);
                        const componentRows: BetComponentRow[] = [...buttonRows];
                        if (exactScoreRow) {
                            if (componentRows.length >= 5) {
                                componentRows[componentRows.length - 1] = exactScoreRow;
                            } else {
                                componentRows.push(exactScoreRow);
                            }
                        }

                        console.log(`[BetFlow] Preparing bet buttons for ${teams}; bookmaker=${event.bookmaker}; outcomes=${displayOutcomes.map((o) => `${o.outcome}:${o.odds}`).join(', ')}`);
                        await eventInteraction.message.edit({
                            content: `**${teams}** (League: ${leagueMap[String(event.fixtureId)]})\nMatch Date: ${formatMatchDate(event.matchDate)}\nBookmaker: **${event.bookmaker}**\nProvider: **${event.provider}**\n\nYou have **${dbUser.coins}** coins.\nClick an outcome below, then enter your bet amount:`,
                            components: componentRows
                        });
                        eventCollector?.stop('selected');

                        const buttonIdScope = `bet2|${event.provider === 'the-odds-api' ? 'o' : 'a'}|${encodeURIComponent(String(event.fixtureId))}|`;
                        const filter = (i: Interaction) => i.isButton() && i.user.id === user.id && i.customId.startsWith(buttonIdScope);
                        const collector = eventInteraction.channel?.createMessageComponentCollector({
                            filter,
                            componentType: ComponentType.Button,
                            time: 24 * 60 * 60 * 1000
                        });
                        collector?.on('collect', async (i) => {
                            const modal = new ModalBuilder()
                                .setCustomId(i.customId.replace('bet2|', 'betmodal2|'))
                                .setTitle('Place Your Bet');
                            const amountInput = new TextInputBuilder()
                                .setCustomId('bet_amount')
                                .setLabel('Enter amount to bet')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('e.g. 100')
                                .setRequired(true);
                            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput));
                            try {
                                await i.showModal(modal);
                            } catch (err) {
                                try {
                                    await i.reply({ content: 'This bet is no longer available or the interaction expired.', ephemeral: true });
                                } catch {}
                            }
                        });
                        if (exactScoreRow) {
                            const exactScoreCustomId = `exactscore|${encodeURIComponent(String(event.fixtureId)).slice(0, 80)}`;
                            const exactScoreCollector = eventInteraction.channel?.createMessageComponentCollector({
                                filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === exactScoreCustomId,
                                componentType: ComponentType.StringSelect,
                                time: 24 * 60 * 60 * 1000
                            });

                            exactScoreCollector?.on('collect', async (i: StringSelectMenuInteraction) => {
                                const selectedScore = i.values[0] || '';
                                const scoreMatch = selectedScore.match(/^(\d{1,2})-(\d{1,2})$/);
                                if (!scoreMatch) {
                                    await i.reply({ content: 'Could not read the selected score.', ephemeral: true });
                                    return;
                                }

                                const homeScore = Number(scoreMatch[1]);
                                const awayScore = Number(scoreMatch[2]);
                                const modal = new ModalBuilder()
                                    .setCustomId(`exactscoremodal|${Date.now()}`)
                                    .setTitle('Place Exact Score Bet');
                                const amountInput = new TextInputBuilder()
                                    .setCustomId('bet_amount')
                                    .setLabel(`Amount for ${homeScore}-${awayScore}`)
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g. 100')
                                    .setRequired(true);
                                modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput));

                                try {
                                    await i.showModal(modal);
                                    const modalInteraction = await i.awaitModalSubmit({
                                        filter: (submit) => submit.user.id === user.id && submit.customId === modal.data.custom_id,
                                        time: 5 * 60 * 1000
                                    });
                                    await modalInteraction.deferReply({ ephemeral: true });

                                    const amount = parseInt(modalInteraction.fields.getTextInputValue('bet_amount'), 10);
                                    if (Number.isNaN(amount) || amount <= 0) {
                                        await modalInteraction.editReply({ content: 'Invalid bet amount.' });
                                        return;
                                    }

                                    const latestOdd = await findLatestExactScoreOdd(event, homeScore, awayScore);
                                    if (!latestOdd) {
                                        await modalInteraction.editReply({
                                            content: `No current OddsChecker Correct Score odds found for **${homeScore}-${awayScore}**.`
                                        });
                                        return;
                                    }

                                    await connectMongo();
                                    let currentUser = await User.findOne({ userId });
                                    if (!currentUser) currentUser = await User.create({ userId });
                                    if (currentUser.coins < amount) {
                                        await modalInteraction.editReply({ content: `You do not have enough coins. You have **${currentUser.coins}**.` });
                                        return;
                                    }

                                    currentUser.coins -= amount;
                                    await currentUser.save();

                                    const eventName = `${event.homeTeam} vs ${event.awayTeam}`;
                                    const uniqueEventId = `${event.fixtureId}_${eventName.replace(/\s+/g, '_')}`;
                                    const { Bet } = require('../db/bet');
                                    await Bet.create({
                                        userId,
                                        eventId: uniqueEventId,
                                        eventName,
                                        league: leagueMap[String(event.fixtureId)] || event.leagueName,
                                        outcome: latestOdd.outcome,
                                        odds: latestOdd.odds,
                                        amount,
                                        market: 'exact_score',
                                        provider: 'oddschecker',
                                        providerFixtureId: String(event.fixtureId),
                                        providerMarketId: String(latestOdd.marketId),
                                        marketLabel: 'Correct Score',
                                        bookmaker: latestOdd.bookmaker,
                                        oddsLastUpdated: latestOdd.updatedAt,
                                        homeTeam: event.homeTeam,
                                        awayTeam: event.awayTeam,
                                        predictedHomeScore: homeScore,
                                        predictedAwayScore: awayScore,
                                        matchDate: event.matchDate
                                    });

                                    try {
                                        const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                                        if (channelId) {
                                            const notifChannel = await interaction.client.channels.fetch(channelId);
                                            if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                                                await (notifChannel as any).send({
                                                    content: `📝 <@${userId}> placed an exact-score bet: **${amount}** coins on **${event.homeTeam} ${homeScore}-${awayScore} ${event.awayTeam}** (${latestOdd.odds.toFixed(2)}) via **${latestOdd.bookmaker}**`
                                                });
                                            }
                                        }
                                    } catch (err) {
                                        console.error('Failed to send exact-score bet notification:', err);
                                    }

                                    const newContent = eventInteraction.message.content.replace(
                                        /You have \*\*[^*]+\*\* coins\./,
                                        `You have **${currentUser.coins}** coins.`
                                    );
                                    try {
                                        await eventInteraction.message.edit({ content: newContent, components: componentRows });
                                    } catch {}

                                    await modalInteraction.editReply({
                                        content: `Exact-score bet placed: **${amount}** coins on **${event.homeTeam} ${homeScore}-${awayScore} ${event.awayTeam}** at **${latestOdd.odds.toFixed(2)}** from **${latestOdd.bookmaker}**.`
                                    });
                                } catch (err) {
                                    try {
                                        if (!i.replied) {
                                            await i.reply({ content: 'This exact-score bet session expired. Run `/bet` again.', ephemeral: true });
                                        }
                                    } catch {}
                                }
                            });
                        }
                        collector?.on('end', async () => {
                            try {
                                const disabledRows = disableComponentRows(componentRows);
                                await eventInteraction.message.edit({ components: disabledRows });
                            } catch {}
                        });
                    } catch (error) {
                        console.error('[BetFlow] Error preparing API-Football bet:', error);
                        try {
                            await eventInteraction.message.edit({ content: 'An error occurred while preparing this bet.', components: [] });
                        } catch {}
                    }
                });
                eventCollector?.on('end', async (_collected, reason) => {
                    if (reason === 'selected') return;

                    try {
                        await selectInteraction.message.edit({
                            content: 'This betting session expired. Run `/bet` again to start a new one.',
                            components: []
                        });
                    } catch {}
                });
            } catch (error) {
                console.error('[BetFlow] Error fetching API-Football events:', error);
                try {
                    await selectInteraction.message.edit({ content: 'An error occurred while fetching events.', components: [] });
                } catch {}
            }
        });
        selectCollector?.on('end', async (_collected, reason) => {
            if (reason === 'selected') return;

            try {
                await leaguePrompt.edit({
                    content: 'This betting session expired. Run `/bet` again to start a new one.',
                    components: []
                });
            } catch {}
        });
    }
};
