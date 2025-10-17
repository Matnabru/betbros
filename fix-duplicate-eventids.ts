import { connectMongo } from './src/db/mongo';
import { Bet } from './src/db/bet';
import * as crypto from 'crypto';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

/**
 * Script to manually fix all active bets with correct eventId and match dates
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

// Fetch match data from odds API
async function fetchMatchFromAPI(eventName: string, league: string): Promise<{ commence_time?: string } | null> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.log('⚠️  No ODDS_API_KEY found in .env file');
    return null;
  }

  // Map league names to API sport keys
  const leagueMap: { [key: string]: string } = {
    'La Liga (Spain)': 'soccer_spain_la_liga',
    'Premier League': 'soccer_epl',
    'Ekstraklasa (Poland)': 'soccer_poland_ekstraklasa',
    'FA Cup': 'soccer_fa_cup',
    'UEFA Champions League': 'soccer_uefa_champs_league',
    'UEFA Europa Conference League': 'soccer_uefa_europa_conference_league',
    'UEFA Europa League': 'soccer_uefa_europa_league'
  };

  const sportKey = leagueMap[league];
  if (!sportKey) {
    console.log(`⚠️  No API mapping found for league: ${league}`);
    return null;
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=eu&markets=h2h&oddsFormat=decimal`;
    const res = await fetch(url);
    
    if (!res.ok) {
      console.log(`⚠️  API request failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json() as any[];
    
    // Parse event name to get team names
    const match = eventName.match(/(.+) vs (.+)/i);
    if (!match) return null;
    
    const [, home, away] = match;
    
    // Find matching event
    const event = data.find((ev: any) => {
      const homeMatch = ev.home_team.toLowerCase().includes(home.toLowerCase()) || 
                       home.toLowerCase().includes(ev.home_team.toLowerCase());
      const awayMatch = ev.away_team.toLowerCase().includes(away.toLowerCase()) || 
                       away.toLowerCase().includes(ev.away_team.toLowerCase());
      return homeMatch && awayMatch;
    });

    if (event) {
      console.log(`✓ Found match in API: ${event.home_team} vs ${event.away_team}`);
      return event;
    }

    return null;
  } catch (err) {
    console.log(`⚠️  Error fetching from API: ${err}`);
    return null;
  }
}

async function fixActiveBets() {
  try {
    console.log('Connecting to MongoDB...');
    await connectMongo();
    
    console.log('\nFetching all active bets...');
    const activeBets = await Bet.find({ resolved: false });
    console.log(`Found ${activeBets.length} active bets\n`);
    
    if (activeBets.length === 0) {
      console.log('No active bets to fix!');
      rl.close();
      process.exit(0);
    }
    
    // Group bets by event name and league to show unique events
    const eventGroups = new Map<string, any[]>();
    activeBets.forEach(bet => {
      const key = `${bet.eventName}_${bet.league}`;
      if (!eventGroups.has(key)) {
        eventGroups.set(key, []);
      }
      eventGroups.get(key)!.push(bet);
    });
    
    console.log('='.repeat(70));
    console.log('ACTIVE EVENTS WITH BETS:');
    console.log('='.repeat(70));
    
    let eventNumber = 1;
    const eventsArray: Array<{ key: string, name: string, league: string, bets: any[] }> = [];
    
    eventGroups.forEach((bets, key) => {
      const eventName = bets[0].eventName;
      const league = bets[0].league;
      eventsArray.push({ key, name: eventName, league, bets });
      
      console.log(`\n${eventNumber}. ${eventName}`);
      console.log(`   League: ${league}`);
      console.log(`   Current eventId: ${bets[0].eventId}`);
      console.log(`   Current matchDate: ${bets[0].matchDate || 'None'}`);
      console.log(`   Number of bets: ${bets.length}`);
      bets.forEach(bet => {
        console.log(`     - ${bet.userId}: ${bet.amount} on ${bet.outcome} (${bet.odds})`);
      });
      eventNumber++;
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('\nYou will now fix each event one by one.');
    console.log('For each event, provide:');
    console.log('  1. Match date and time (format: YYYY-MM-DD HH:MM)');
    console.log('  2. Optionally correct the event name if needed');
    console.log('='.repeat(70) + '\n');
    
    for (let i = 0; i < eventsArray.length; i++) {
      const event = eventsArray[i];
      console.log(`\n[${i + 1}/${eventsArray.length}] Fixing: ${event.name} (${event.league})`);
      console.log('-'.repeat(70));
      
      // Try to fetch match data from API first
      console.log('Fetching match data from API...');
      const apiMatch = await fetchMatchFromAPI(event.name, event.league);
      
      let matchDate: Date | null = null;
      
      if (apiMatch && apiMatch.commence_time) {
        matchDate = new Date(apiMatch.commence_time);
        console.log(`✓ Match date from API: ${matchDate.toLocaleString('pl-PL', { 
          timeZone: 'Europe/Warsaw',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
          year: 'numeric'
        })}`);
        
        const useApiDate = await question('Use this date? (y/n): ');
        if (useApiDate.toLowerCase() !== 'y') {
          matchDate = null;
        }
      }
      
      // If no API date or user declined, ask for manual input
      if (!matchDate) {
        while (true) {
          const dateInput = await question('Enter match date and time (YYYY-MM-DD HH:MM) or "skip" to leave empty: ');
          
          if (dateInput.toLowerCase() === 'skip') {
            matchDate = null;
            break;
          }
          
          const dateMatch = dateInput.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
          if (dateMatch) {
            const [, year, month, day, hour, minute] = dateMatch;
            matchDate = new Date(
              parseInt(year),
              parseInt(month) - 1,
              parseInt(day),
              parseInt(hour),
              parseInt(minute),
              0,
              0
            );
            console.log(`✓ Match date set to: ${matchDate.toLocaleString('pl-PL', { 
              timeZone: 'Europe/Warsaw',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              year: 'numeric'
            })}`);
            break;
          } else {
            console.log('❌ Invalid format. Please use YYYY-MM-DD HH:MM (e.g., 2025-10-18 16:15)');
          }
        }
      }
      
      // Ask if event name needs correction
      const correctName = await question(`Keep event name "${event.name}"? (y/n): `);
      let eventName = event.name;
      if (correctName.toLowerCase() === 'n') {
        eventName = await question('Enter correct event name: ');
        console.log(`✓ Event name updated to: ${eventName}`);
      }
      
      // Generate new unique eventId based on corrected name and league
      const newEventId = crypto
        .createHash('md5')
        .update(`${eventName}_${event.league}`)
        .digest('hex')
        .substring(0, 24);
      
      console.log(`✓ Generated new eventId: ${newEventId}`);
      
      // Update all bets for this event
      for (const bet of event.bets) {
        bet.eventId = newEventId;
        bet.eventName = eventName;
        if (matchDate) {
          bet.matchDate = matchDate;
        }
        await bet.save();
      }
      
      console.log(`✅ Updated ${event.bets.length} bet(s) for this event`);
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL ACTIVE BETS HAVE BEEN FIXED!');
    console.log('='.repeat(70));
    
    // Show summary
    const updatedBets = await Bet.find({ resolved: false });
    const updatedGroups = new Map<string, any[]>();
    updatedBets.forEach(bet => {
      const key = `${bet.eventName}_${bet.league}`;
      if (!updatedGroups.has(key)) {
        updatedGroups.set(key, []);
      }
      updatedGroups.get(key)!.push(bet);
    });
    
    console.log('\nFINAL STATE:');
    updatedGroups.forEach((bets, key) => {
      console.log(`\n${bets[0].eventName} (${bets[0].league})`);
      console.log(`  EventId: ${bets[0].eventId}`);
      console.log(`  Match Date: ${bets[0].matchDate ? new Date(bets[0].matchDate).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'None'}`);
      console.log(`  Bets: ${bets.length}`);
    });
    
    rl.close();
    process.exit(0);
  } catch (error) {
    console.error('Error fixing bets:', error);
    rl.close();
    process.exit(1);
  }
}

// Run the script
fixActiveBets();
