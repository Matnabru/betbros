import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import dotenv from 'dotenv';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import { Bet } from '../db/bet';
import { getDefaultFootballSeason, getApiFootballLeagueLabel, soccerLeagues } from '../config/leagues';
import {
  CorrectScoreOdd,
  fetchApiFootballFixtures,
  fetchCorrectScoreOdds,
  findBestCorrectScoreOdd,
  formatCorrectScorePreview
} from '../features/apiFootball';
import {
  fetchOddsCheckerWorldCupCorrectScoreOdds,
  fetchOddsCheckerWorldCupFixtures,
  OddsCheckerCorrectScoreOdd
} from '../features/oddsChecker';

dotenv.config();

const WORLD_CUP_LEAGUE_ID = 1;

interface ExactScoreOddsSource {
  provider: 'api-football' | 'oddschecker';
  label: string;
  odds: CorrectScoreOdd[];
}

interface ScoreBetFixture {
  fixtureId: string;
  apiFootballFixtureId?: number;
  homeTeam: string;
  awayTeam: string;
  leagueId: number;
  leagueName: string;
  matchDate: Date;
}

function parseExactScore(input: string): { homeScore: number; awayScore: number } | null {
  const match = input.trim().match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
  if (!match) return null;

  return {
    homeScore: Number(match[1]),
    awayScore: Number(match[2])
  };
}

function mapOddsCheckerOdd(
  fixture: ScoreBetFixture,
  odd: OddsCheckerCorrectScoreOdd
): CorrectScoreOdd {
  return {
    fixtureId: fixture.apiFootballFixtureId || 0,
    homeScore: odd.homeScore,
    awayScore: odd.awayScore,
    outcome: odd.outcome,
    odds: odd.odds,
    bookmakerId: 0,
    bookmaker: odd.bookmaker,
    marketId: odd.marketId,
    marketName: odd.marketName,
    updatedAt: odd.updatedAt
  };
}

async function fetchScoreBetFixtures(
  leagueId: number,
  season: number,
  next = 25
): Promise<ScoreBetFixture[]> {
  try {
    const apiFixtures = await fetchApiFootballFixtures(leagueId, season, next);
    return apiFixtures.map((fixture) => ({
      fixtureId: String(fixture.fixtureId),
      apiFootballFixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueId: fixture.leagueId,
      leagueName: fixture.leagueName,
      matchDate: fixture.matchDate
    }));
  } catch (err) {
    console.warn(`[ScoreBet] API-Football fixtures failed for league ${leagueId}, season ${season}:`, err);
    if (leagueId !== WORLD_CUP_LEAGUE_ID || !process.env.SCRAPE_DO_TOKEN) {
      throw err;
    }

    const oddsCheckerFixtures = await fetchOddsCheckerWorldCupFixtures(next);
    return oddsCheckerFixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueId: WORLD_CUP_LEAGUE_ID,
      leagueName: fixture.leagueName,
      matchDate: fixture.matchDate
    }));
  }
}

async function fetchExactScoreOddsForFixture(
  fixture: ScoreBetFixture,
  leagueId: number
): Promise<ExactScoreOddsSource> {
  if (fixture.apiFootballFixtureId) {
    try {
      const apiFootballOdds = await fetchCorrectScoreOdds(fixture.apiFootballFixtureId);
      if (apiFootballOdds.length) {
        return {
          provider: 'api-football',
          label: 'API-Football',
          odds: apiFootballOdds
        };
      }
    } catch (err) {
      console.warn(`[ScoreBet] API-Football Correct Score odds failed for fixture ${fixture.apiFootballFixtureId}:`, err);
    }
  }

  if (leagueId === WORLD_CUP_LEAGUE_ID && process.env.SCRAPE_DO_TOKEN) {
    try {
      const oddsCheckerMarket = await fetchOddsCheckerWorldCupCorrectScoreOdds(fixture.homeTeam, fixture.awayTeam);
      const odds = oddsCheckerMarket.odds.map((odd) => mapOddsCheckerOdd(fixture, odd));
      if (odds.length) {
        return {
          provider: 'oddschecker',
          label: 'OddsChecker',
          odds
        };
      }
    } catch (err) {
      console.warn(`[ScoreBet] OddsChecker Correct Score odds failed for ${fixture.homeTeam} vs ${fixture.awayTeam}:`, err);
    }
  }

  return {
    provider: 'api-football',
    label: 'external providers',
    odds: []
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('legacyscorebet')
    .setDescription('Legacy coin-based exact-score betting flow.')
    .addStringOption(option =>
      option.setName('search')
        .setDescription('Search for a team name')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('season')
        .setDescription('API-Football season year, e.g. 2025')
        .setRequired(false)
        .setMinValue(2000)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Check your DMs to place an exact-score bet!', ephemeral: true });

    const search = interaction.options.getString('search')?.toLowerCase() || '';
    const season = interaction.options.getInteger('season') || Number(process.env.API_FOOTBALL_SEASON) || getDefaultFootballSeason();
    const user = interaction.user;
    const dm = await user.createDM();

    const leagueMenu = new StringSelectMenuBuilder()
      .setCustomId('scorebet_select_league')
      .setPlaceholder('Select a league')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(soccerLeagues.map((league) => ({
        label: league.label.slice(0, 100),
        value: String(league.apiFootballLeagueId)
      })));

    const leaguePrompt = await dm.send({
      content: `Select a league for exact-score odds. Season: **${season}**.`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(leagueMenu)]
    });

    const leagueCollector = dm.createMessageComponentCollector({
      filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'scorebet_select_league',
      componentType: ComponentType.StringSelect,
      time: 15 * 60 * 1000
    });

    leagueCollector.once('collect', async (leagueInteraction: StringSelectMenuInteraction) => {
      try {
        await leagueInteraction.deferUpdate();
        const leagueId = Number(leagueInteraction.values[0]);
        const leagueLabel = getApiFootballLeagueLabel(leagueId);
        let fixtures = await fetchScoreBetFixtures(leagueId, season, 25);

        if (search) {
          fixtures = fixtures.filter((fixture) =>
            fixture.homeTeam.toLowerCase().includes(search)
            || fixture.awayTeam.toLowerCase().includes(search)
          );
        }

        if (!fixtures.length) {
          await leagueInteraction.message.edit({
            content: `No upcoming fixtures found for **${leagueLabel}** in season **${season}**${search ? ` matching "${search}"` : ''}.`,
            components: []
          });
          return;
        }

        const eventMenu = new StringSelectMenuBuilder()
          .setCustomId('scorebet_select_fixture')
          .setPlaceholder('Select a match')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(fixtures.slice(0, 25).map((fixture) => ({
            label: `${fixture.homeTeam} vs ${fixture.awayTeam}`.slice(0, 100),
            description: fixture.matchDate.toLocaleString('pl-PL', {
              timeZone: 'Europe/Warsaw',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit'
            }).slice(0, 100),
            value: String(fixture.fixtureId)
          })));

        await leagueInteraction.message.edit({
          content: `Select a match for **${leagueLabel}** exact-score odds:`,
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventMenu)]
        });
        leagueCollector.stop('selected');

        const eventCollector = dm.createMessageComponentCollector({
          filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'scorebet_select_fixture',
          componentType: ComponentType.StringSelect,
          time: 15 * 60 * 1000
        });

        eventCollector.once('collect', async (eventInteraction: StringSelectMenuInteraction) => {
          try {
            await eventInteraction.deferUpdate();
            const fixtureId = eventInteraction.values[0];
            const fixture = fixtures.find((item) => item.fixtureId === fixtureId);
            if (!fixture) {
              await eventInteraction.message.edit({ content: 'Fixture not found. Run `/legacyscorebet` again.', components: [] });
              return;
            }

            const oddsSource = await fetchExactScoreOddsForFixture(fixture, leagueId);
            if (!oddsSource.odds.length) {
              await eventInteraction.message.edit({
                content: `No external Correct Score odds are currently available for **${fixture.homeTeam} vs ${fixture.awayTeam}**.`,
                components: []
              });
              return;
            }

            const preview = formatCorrectScorePreview(oddsSource.odds);
            const placeButton = new ButtonBuilder()
              .setCustomId(`scorebet_place_${fixture.fixtureId}`)
              .setLabel('Enter score and amount')
              .setStyle(ButtonStyle.Primary);

            await eventInteraction.message.edit({
              content: `**${fixture.homeTeam} vs ${fixture.awayTeam}** (${fixture.leagueName})\nProvider: **${oddsSource.label}**\nEnter score as **home-away**. Examples with best available odds: ${preview || 'odds available'}`,
              components: [new ActionRowBuilder<ButtonBuilder>().addComponents(placeButton)]
            });
            eventCollector.stop('selected');

            const buttonCollector = dm.createMessageComponentCollector({
              filter: (i) => i.isButton() && i.user.id === user.id && i.customId === `scorebet_place_${fixture.fixtureId}`,
              componentType: ComponentType.Button,
              time: 15 * 60 * 1000
            });

            buttonCollector.on('collect', async (buttonInteraction) => {
              const modal = new ModalBuilder()
                .setCustomId(`scorebetmodal_${fixture.fixtureId}`)
                .setTitle('Place Exact-Score Bet');
              const scoreInput = new TextInputBuilder()
                .setCustomId('score_prediction')
                .setLabel('Exact score (home-away)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 2-1')
                .setRequired(true);
              const amountInput = new TextInputBuilder()
                .setCustomId('bet_amount')
                .setLabel('Amount to bet')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. 100')
                .setRequired(true);

              modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(scoreInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput)
              );

              try {
                await buttonInteraction.showModal(modal);
                const modalInteraction = await buttonInteraction.awaitModalSubmit({
                  filter: (i) => i.user.id === user.id && i.customId === `scorebetmodal_${fixture.fixtureId}`,
                  time: 5 * 60 * 1000
                });

                await modalInteraction.deferReply({ ephemeral: true });

                const score = parseExactScore(modalInteraction.fields.getTextInputValue('score_prediction'));
                const amount = parseInt(modalInteraction.fields.getTextInputValue('bet_amount'), 10);
                if (!score) {
                  await modalInteraction.editReply({ content: 'Invalid score. Use home-away format, for example `2-1`.' });
                  return;
                }
                if (Number.isNaN(amount) || amount <= 0) {
                  await modalInteraction.editReply({ content: 'Invalid bet amount.' });
                  return;
                }

                const latestOddsSource = await fetchExactScoreOddsForFixture(fixture, leagueId);
                const selectedOdd = findBestCorrectScoreOdd(latestOddsSource.odds, score.homeScore, score.awayScore);
                if (!selectedOdd) {
                  await modalInteraction.editReply({
                    content: `No external Correct Score odds are currently available for **${score.homeScore}-${score.awayScore}**. Try one of the scores shown in the DM.`
                  });
                  return;
                }

                await connectMongo();
                let dbUser = await User.findOne({ userId: user.id });
                if (!dbUser) dbUser = await User.create({ userId: user.id });
                if (dbUser.coins < amount) {
                  await modalInteraction.editReply({ content: `You do not have enough coins. You have **${dbUser.coins}**.` });
                  return;
                }

                dbUser.coins -= amount;
                await dbUser.save();

                const eventId = fixture.apiFootballFixtureId
                  ? `api-football_${fixture.apiFootballFixtureId}`
                  : `oddschecker_${fixture.fixtureId.replace(/[^a-z0-9]+/gi, '_')}`;

                await Bet.create({
                  userId: user.id,
                  eventId,
                  eventName: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
                  league: fixture.leagueName,
                  outcome: `${score.homeScore}-${score.awayScore}`,
                  odds: selectedOdd.odds,
                  amount,
                  market: 'exact_score',
                  provider: latestOddsSource.provider,
                  providerFixtureId: fixture.apiFootballFixtureId ? String(fixture.apiFootballFixtureId) : undefined,
                  providerMarketId: String(selectedOdd.marketId),
                  bookmaker: selectedOdd.bookmaker,
                  oddsLastUpdated: selectedOdd.updatedAt,
                  homeTeam: fixture.homeTeam,
                  awayTeam: fixture.awayTeam,
                  predictedHomeScore: score.homeScore,
                  predictedAwayScore: score.awayScore,
                  matchDate: fixture.matchDate
                });

                try {
                  const channelId = process.env.NOTIFICATION_CHANNEL_ID;
                  if (channelId) {
                    const notifChannel = await interaction.client.channels.fetch(channelId);
                    if (notifChannel && notifChannel.isTextBased() && 'send' in notifChannel) {
                      await (notifChannel as any).send({
                        content: `📝 <@${user.id}> placed an exact-score bet: **${amount}** coins on **${fixture.homeTeam} ${score.homeScore}-${score.awayScore} ${fixture.awayTeam}** (${selectedOdd.odds.toFixed(2)}) via **${selectedOdd.bookmaker}**`
                      });
                    }
                  }
                } catch (err) {
                  console.error('Failed to send exact-score bet notification:', err);
                }

                await modalInteraction.editReply({
                  content: `Exact-score bet placed: **${amount}** coins on **${fixture.homeTeam} ${score.homeScore}-${score.awayScore} ${fixture.awayTeam}** at **${selectedOdd.odds.toFixed(2)}** from **${selectedOdd.bookmaker}**.`
                });
              } catch (err) {
                try {
                  if (!buttonInteraction.replied) {
                    await buttonInteraction.reply({ content: 'This score bet session expired. Run `/legacyscorebet` again.', ephemeral: true });
                  }
                } catch {}
              }
            });
          } catch (err) {
            console.error('Scorebet fixture flow error:', err);
            await eventInteraction.message.edit({ content: 'Could not load exact-score odds for this match.', components: [] });
          }
        });

        eventCollector.on('end', async (_collected, reason) => {
          if (reason === 'selected') return;

          try {
            await leagueInteraction.message.edit({
              content: 'This score bet session expired. Run `/legacyscorebet` again to start a new one.',
              components: []
            });
          } catch {}
        });
      } catch (err) {
        console.error('Scorebet league flow error:', err);
        await leagueInteraction.message.edit({
          content: 'Could not load API-Football fixtures. Check API_FOOTBALL_KEY/API_FOOTBALL_HOST and try again.',
          components: []
        });
      }
    });

    leagueCollector.on('end', async (_collected, reason) => {
      if (reason === 'selected') return;

      try {
        await leaguePrompt.edit({
          content: 'This score bet session expired. Run `/legacyscorebet` again to start a new one.',
          components: []
        });
      } catch {}
    });
  }
};
