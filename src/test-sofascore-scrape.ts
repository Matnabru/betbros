import { fetchSofaScoreTodayMatches } from './features/fetchSofaScoreTodayMatches';

async function main() {
  try {
    const matches = await fetchSofaScoreTodayMatches();
    console.log('SofaScore Today Matches:');
    for (const match of matches) {
      console.log(`${match.league} | ${match.home} vs ${match.away} | ${match.homeScore}-${match.awayScore} | ${match.status} | ${match.startTime}`);
    }
    if (matches.length === 0) {
      console.log('No matches found. The page structure may have changed.');
    }
  } catch (err) {
    console.error('Error fetching SofaScore matches:', err);
  }
}

main();
