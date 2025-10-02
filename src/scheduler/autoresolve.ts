import { connectMongo } from '../db/mongo';
import { Bet } from '../db/bet';
import { User } from '../db/user';
import { fetchSofaScoreTodayMatches } from '../features/fetchSofaScoreTodayMatches';
import { Client, ChannelType } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Automatically resolve finished bets using SofaScore data
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

    // Group bets by unique event
    const eventMap = new Map();
    unresolvedBets.forEach((bet: any) => {
      if (!eventMap.has(bet.eventId)) {
        eventMap.set(bet.eventId, []);
      }
      eventMap.get(bet.eventId).push(bet);
    });

    console.log(`[AutoResolve] Found ${eventMap.size} unique events with unresolved bets`);

    // Fetch today's matches from SofaScore
    let matches;
    try {
      matches = await fetchSofaScoreTodayMatches();
      console.log(`[AutoResolve] Fetched ${matches.length} matches from SofaScore`);
    } catch (err) {
      console.error('[AutoResolve] Failed to fetch SofaScore matches:', err);
      return;
    }

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

        // Normalize team names for fuzzy matching
        const normalize = (name: string) => name
          .toLowerCase()
          .replace(/[-\s.]/g, '') // Remove hyphens, spaces, dots
          .replace(/saint/g, 'st') // Saint -> St
          .replace(/psg/g, 'parissaintgermain'); // Handle PSG abbreviation

        const homeNorm = normalize(home);
        const awayNorm = normalize(away);

        // Find match using fuzzy matching
        const fixture = matches.find((m: any) => {
          const sofaHomeNorm = normalize(m.home);
          const sofaAwayNorm = normalize(m.away);
          return (sofaHomeNorm === homeNorm && sofaAwayNorm === awayNorm) ||
                 (sofaHomeNorm === awayNorm && sofaAwayNorm === homeNorm); // Try reverse order too
        });

        if (!fixture) {
          console.log(`[AutoResolve] No SofaScore match found for: ${home} vs ${away}`);
          console.log(`[AutoResolve] Normalized: ${homeNorm} vs ${awayNorm}`);
          // Log available matches for debugging
          const availableMatches = matches.slice(0, 3).map((m: any) => `${m.home} vs ${m.away}`);
          console.log(`[AutoResolve] Available matches sample:`, availableMatches);
          continue;
        }

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
          const sofaHomeNorm = normalize(fixture.home);
          const homeNorm = normalize(home);
          if (sofaHomeNorm === homeNorm) {
            result = home; // Same order - home team won
          } else {
            result = away; // Reversed order - away team won
          }
        } else if (awayScore > homeScore) {
          // Check if teams are in same order or reversed
          const sofaHomeNorm = normalize(fixture.home);
          const homeNorm = normalize(home);
          if (sofaHomeNorm === homeNorm) {
            result = away; // Same order - away team won
          } else {
            result = home; // Reversed order - home team won
          }
        } else {
          result = 'DRAW';
        }

        console.log(`[AutoResolve] Resolving ${home} vs ${away}: ${result} (${homeScore}-${awayScore})`);

        // Resolve all bets for this event
        let eventResolvedBets = 0;
        for (const bet of eventBets) {
          try {
            if (bet.outcome === result || (result === 'DRAW' && bet.outcome === 'Draw')) {
              // Winner - pay out
              const betUser = await User.findOne({ userId: bet.userId });
              if (betUser) {
                const payout = Math.round(bet.amount * bet.odds);
                betUser.coins += payout;
                await betUser.save();
                console.log(`[AutoResolve] Paid ${payout} coins to user ${bet.userId}`);
              }
              bet.won = true;
            } else {
              bet.won = false;
            }
            bet.resolved = true;
            await bet.save();
            eventResolvedBets++;
            resolvedBets++;
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
              const winners = eventBets.filter((bet: any) => bet.won);
              const winnersText = winners.length > 0 
                ? `\n🎉 **Zwycięzcy:** ${winners.length} graczy wygrało swoje zakłady!`
                : '\n😢 **Brak zwycięzców** w tym meczu.';
              
              const message = `⚽ **Mecz rozstrzygnięty!**
**${home} ${homeScore}-${awayScore} ${away}**
${result === 'DRAW' ? '🤝 **Wynik:** Remis' : `🏆 **Zwycięzca:** ${result}`}
📊 **Zakładów:** ${eventResolvedBets}${winnersText}`;

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