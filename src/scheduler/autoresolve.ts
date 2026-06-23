import { connectMongo } from '../db/mongo';
import { Bet } from '../db/bet';
import { fetchSofaScoreMatchesByDate } from '../features/fetchSofaScoreTodayMatches';
import {
  ApiFootballMatchResult,
  fetchApiFootballMatchResultByFixtureId,
  fetchApiFootballMatchResultsByDate
} from '../features/apiFootball';
import { Client, ChannelType } from 'discord.js';
import dotenv from 'dotenv';
import { normalizeTeamName, settleBet } from '../utils/betResolution';
import { applyBetSettlementOnce, createSettlementBuckets } from '../utils/applyBetSettlement';
import { formatScore } from '../utils/scoreSettlement';

dotenv.config();

type ResolvableMatch = ApiFootballMatchResult & { source: string };

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

function teamsMatch(fixture: Pick<ResolvableMatch, 'home' | 'away'>, homeNorm: string, awayNorm: string): boolean {
  const fixtureHomeNorm = normalizeTeamName(fixture.home);
  const fixtureAwayNorm = normalizeTeamName(fixture.away);

  return (fixtureHomeNorm === homeNorm && fixtureAwayNorm === awayNorm)
    || (fixtureHomeNorm === awayNorm && fixtureAwayNorm === homeNorm);
}

function hasApiFootballKey(): boolean {
  return Boolean(process.env.API_FOOTBALL_KEY || process.env.API_SPORTS_KEY);
}

function getNumericProviderFixtureId(eventBets: any[]): string | undefined {
  return eventBets.find((bet: any) => bet.providerFixtureId && /^\d+$/.test(String(bet.providerFixtureId)))?.providerFixtureId;
}

/**
 * Automatically resolve finished bets using API-Football, with SofaScore as a fallback.
 * This function replicates the logic from resolveapibet command
 */
export async function autoResolveBets(client?: Client) {
  try {
    console.log('[AutoResolve] Starting automatic bet resolution...');
    await connectMongo();

    // Get all unresolved bets
    const unresolvedBets = await Bet.find({ resolved: false });
    if (unresolvedBets.length === 0) {
      console.log('[AutoResolve] No unresolved bets found.');
      return;
    }

    // Group by event id plus match identity/date so rematches and older duplicate provider ids stay separate.
    const eventMap = new Map();
    unresolvedBets.forEach((bet: any) => {
      const dateKey = bet.matchDate ? new Date(bet.matchDate).toISOString() : '';
      const key = `${bet.eventId}|${bet.eventName}|${dateKey}`;
      if (!eventMap.has(key)) {
        eventMap.set(key, []);
      }
      eventMap.get(key).push(bet);
    });

    console.log(`[AutoResolve] Found ${eventMap.size} unique events with unresolved bets`);
    
    // Check for duplicate eventIds with different event names (diagnostic logging)
    const eventIdMap = new Map();
    unresolvedBets.forEach((bet: any) => {
      if (!eventIdMap.has(bet.eventId)) {
        eventIdMap.set(bet.eventId, new Set());
      }
      eventIdMap.get(bet.eventId).add(bet.eventName);
    });
    for (const [eventId, eventNames] of eventIdMap) {
      if (eventNames.size > 1) {
        console.warn(`[AutoResolve] WARNING: EventId ${eventId} has multiple event names:`, Array.from(eventNames));
      }
    }

    const apiFootballDateCache = new Map<string, Promise<ResolvableMatch[]>>();
    const sofaScoreDateCache = new Map<string, Promise<ResolvableMatch[]>>();

    const fetchApiFootballMatchesForDate = (date: Date) => {
      const dateKey = toDateKey(date);
      if (!apiFootballDateCache.has(dateKey)) {
        apiFootballDateCache.set(dateKey, fetchApiFootballMatchResultsByDate(dateKey)
          .then((matches) => matches.map((match) => ({ ...match, source: 'API-Football' }))));
      }

      return apiFootballDateCache.get(dateKey)!;
    };

    const fetchSofaScoreMatchesForDate = (date: Date) => {
      const dateKey = toDateKey(date);
      if (!sofaScoreDateCache.has(dateKey)) {
        sofaScoreDateCache.set(dateKey, fetchSofaScoreMatchesByDate(date)
          .then((matches) => matches.map((match: any) => ({ ...match, source: 'SofaScore' })))
          .catch((err) => {
            console.error(`[AutoResolve] Failed to fetch SofaScore matches for ${dateKey}:`, err);
            return [];
          }));
      }

      return sofaScoreDateCache.get(dateKey)!;
    };

    let resolvedEvents = 0;
    let resolvedBets = 0;

    // Process each event
    for (const [eventId, eventBets] of eventMap) {
      try {
        const eventName = eventBets[0].eventName;
        
        // Extract home and away teams from event name
        const match = eventName.match(/(.+) vs (.+)/i);
        if (!match) {
          console.log(`[AutoResolve] Could not parse event name: ${eventName}`);
          continue;
        }

        const home = match[1].trim();
        const away = match[2].trim();

        const homeNorm = normalizeTeamName(home);
        const awayNorm = normalizeTeamName(away);
        const eventDate = getEventDate(eventBets);
        let fixture: ResolvableMatch | null = null;

        const providerFixtureId = getNumericProviderFixtureId(eventBets);
        if (hasApiFootballKey() && providerFixtureId) {
          try {
            const apiFixture = await fetchApiFootballMatchResultByFixtureId(Number(providerFixtureId));
            if (apiFixture) {
              fixture = { ...apiFixture, source: 'API-Football' };
            }
          } catch (err) {
            console.error(`[AutoResolve] API-Football fixture lookup failed for ${providerFixtureId}:`, err);
          }
        }

        if (!fixture && hasApiFootballKey()) {
          for (const lookupDate of resultLookupDates(eventDate)) {
            try {
              const apiMatches = await fetchApiFootballMatchesForDate(lookupDate);
              fixture = apiMatches.find((apiMatch) => teamsMatch(apiMatch, homeNorm, awayNorm)) || null;
              if (fixture) break;
            } catch (err) {
              console.error(`[AutoResolve] API-Football date lookup failed for ${eventName} on ${toDateKey(lookupDate)}:`, err);
            }
          }
        }

        if (!fixture) {
          for (const lookupDate of resultLookupDates(eventDate)) {
            const sofaMatches = await fetchSofaScoreMatchesForDate(lookupDate);
            fixture = sofaMatches.find((sofaMatch) => teamsMatch(sofaMatch, homeNorm, awayNorm)) || null;
            if (fixture) break;
          }
        }

        if (!fixture) {
          console.log(`[AutoResolve] No score source match found for: ${home} vs ${away}`);
          console.log(`[AutoResolve] Normalized: ${homeNorm} vs ${awayNorm}`);
          console.log(`[AutoResolve] League: ${eventBets[0].league}, Match Date: ${eventBets[0].matchDate || 'unknown'}, searched dates: ${resultLookupDates(eventDate).map(toDateKey).join(', ')}`);
          continue;
        }

        console.log(`[AutoResolve] Matched fixture via ${fixture.source}: ${fixture.home} vs ${fixture.away} (${fixture.league}, ${fixture.startTime})`);

        // Only resolve if match is finished
        if (fixture.status !== 'finished') {
          console.log(`[AutoResolve] Match not finished: ${home} vs ${away} (status: ${fixture.status})`);
          continue;
        }

        // Check if scores are available
        const homeScore = fixture.homeScore;
        const awayScore = fixture.awayScore;
        if (homeScore == null || awayScore == null) {
          console.log(`[AutoResolve] Scores not available for: ${home} vs ${away}`);
          continue;
        }

        // Determine result using original bet team names
        let result = '';
        if (homeScore > awayScore) {
          // Check if teams are in same order or reversed
          const fixtureHomeNorm = normalizeTeamName(fixture.home);
          if (fixtureHomeNorm === homeNorm) {
            result = home; // Same order - home team won
          } else {
            result = away; // Reversed order - away team won
          }
        } else if (awayScore > homeScore) {
          // Check if teams are in same order or reversed
          const fixtureHomeNorm = normalizeTeamName(fixture.home);
          if (fixtureHomeNorm === homeNorm) {
            result = away; // Same order - away team won
          } else {
            result = home; // Reversed order - home team won
          }
        } else {
          result = 'DRAW';
        }

        console.log(`[AutoResolve] Resolving ${home} vs ${away}: ${result} (${homeScore}-${awayScore})`);
        const matchResult = {
          homeTeam: fixture.home,
          awayTeam: fixture.away,
          homeScore,
          awayScore
        };

        // Resolve all bets for this event
        let eventResolvedBets = 0;
        const buckets = createSettlementBuckets();
        for (const bet of eventBets) {
          try {
            const settlement = settleBet(bet, matchResult, home, away);
            if (await applyBetSettlementOnce(bet, settlement, buckets)) {
              eventResolvedBets++;
              resolvedBets++;
            }
          } catch (err) {
            console.error(`[AutoResolve] Error resolving bet ${bet._id}:`, err);
          }
        }

        console.log(`[AutoResolve] Resolved ${eventResolvedBets} bets for event: ${eventName}`);
        
        // Send Discord notification about resolved match
        if (client && eventResolvedBets > 0) {
          try {
            const channelId = process.env.NOTIFICATION_CHANNEL_ID;
            if (!channelId) {
              console.error('[AutoResolve] NOTIFICATION_CHANNEL_ID not set in environment variables');
              continue;
            }
            const channel = await client.channels.fetch(channelId);
            if (channel && channel.type === ChannelType.GuildText) {
              // Prepare list of results
              let resultsList = '';
              const addResultLine = async (userId: string, resultText: string) => {
                let userTag = userId;
                try {
                  const member = await channel.guild.members.fetch(userId);
                  userTag = member ? member.displayName : userId;
                } catch {}
                resultsList += `\n**${userTag}**: ${resultText}`;
              };

              for (const change of buckets.scoreChanges) {
                const sign = change.delta > 0 ? '+' : '';
                await addResultLine(change.userId, `${sign}${formatScore(change.delta)} pts (${change.outcome})`);
              }

              for (const winner of buckets.winners) {
                await addResultLine(winner.userId, `+${winner.amount} coins (${winner.outcome})`);
              }

              for (const loser of buckets.losers) {
                await addResultLine(loser.userId, `-${loser.amount} coins (${loser.outcome})`);
              }

              for (const refund of buckets.refunded) {
                await addResultLine(refund.userId, `+0 coins (${refund.outcome} - refund ${refund.amount})`);
              }

              const scoreWinners = buckets.scoreChanges.filter((change) => change.delta > 0).length;
              const scoreLosers = buckets.scoreChanges.filter((change) => change.delta < 0).length;
              const scoreVoids = buckets.scoreChanges.filter((change) => change.delta === 0).length;
              const winnerCount = buckets.winners.length + scoreWinners;
              const loserCount = buckets.losers.length + scoreLosers;
              const voidedCount = buckets.refunded.length + scoreVoids;
              const winnersText = winnerCount > 0
                ? `\n🎉 **Zwycięzcy:** ${winnerCount} graczy wygrało swoje zakłady!`
                : '\n😢 **Brak zwycięzców** w tym meczu.';
              const losersText = loserCount > 0
                ? `\n😢 **Przegrani:** ${loserCount} graczy straciło swoje zakłady.`
                : '';
              const voidedText = voidedCount > 0
                ? `\n↩️ **Zwroty:** ${voidedCount} zakładów zostało zwróconych.`
                : '';

              const message = `⚽ **Mecz rozstrzygnięty!**
**${home} ${homeScore}-${awayScore} ${away}**
${result === 'DRAW' ? '🤝 **Wynik:** Remis' : `🏆 **Zwycięzca:** ${result}`}
📊 **Zakładów:** ${eventResolvedBets}${winnersText}${losersText}
${voidedText}
${resultsList}`;

              await (channel as any).send(message);
            }
          } catch (err) {
            console.error('[AutoResolve] Error sending Discord notification:', err);
          }
        }
        
        resolvedEvents++;

      } catch (err) {
        console.error(`[AutoResolve] Error processing event ${eventId}:`, err);
      }
    }

    console.log(`[AutoResolve] Completed: ${resolvedEvents} events, ${resolvedBets} bets resolved`);

  } catch (err) {
    console.error('[AutoResolve] Fatal error in autoResolveBets:', err);
  }
}
