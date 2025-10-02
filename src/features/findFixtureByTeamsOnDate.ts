import fetch from 'node-fetch';

export async function findFixtureByTeamsOnDate(
  apiToken: string,
  date: string, // format: YYYY-MM-DD
  teamA: string,
  teamB: string
) {
  const url = `https://api.sportmonks.com/v3/football/fixtures/date/${date}?api_token=${apiToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SportMonks API error: ${res.statusText}`);
  const data = await res.json();

  // Normalize team names for comparison
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const teamAKey = normalize(teamA);
  const teamBKey = normalize(teamB);

  const match = data.data.find((fixture: any) => {
    const name = normalize(fixture.name);
    return name.includes(teamAKey) && name.includes(teamBKey);
  });

  return match || null;
}
