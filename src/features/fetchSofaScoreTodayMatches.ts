
import fetch from 'node-fetch';

export interface SofaScoreMatch {
  league: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  startTime: string;
}

export async function fetchSofaScoreTodayMatches(): Promise<SofaScoreMatch[]> {
  // Use SofaScore's public API for scheduled events by date
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const url = `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${dateStr}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BetBrosBot/1.0)'
    }
  });
  if (!res.ok) throw new Error(`SofaScore API fetch error: ${res.statusText}`);
  const json = await res.json();
  const matches: SofaScoreMatch[] = [];
  console.log(matches)
  if (!json.events) return matches;
  for (const event of json.events) {
    const league = event.tournament?.name || '';
    const home = event.homeTeam?.name || '';
    const away = event.awayTeam?.name || '';
    const homeScore = event.homeScore?.current ?? null;
    const awayScore = event.awayScore?.current ?? null;
    const status = event.status?.type || '';
    const startTime = event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : '';
    if (home && away) {
      matches.push({ league, home, away, homeScore, awayScore, status, startTime });
    }
  }
  return matches;
}
