import { fetchSofaScoreTodayMatches } from './features/fetchSofaScoreTodayMatches';

(async () => {
  try {
    const matches = await fetchSofaScoreTodayMatches();
    console.log('Fetched matches:', matches);
  } catch (err) {
    console.error('Error:', err);
  }
})();
