import fetch from 'node-fetch';

interface ApiFootballEnvelope<T> {
  response: T[];
  results?: number;
  paging?: {
    current: number;
    total: number;
  };
  errors?: unknown;
}

interface ApiFootballBetType {
  id: number;
  name: string;
}

interface ApiFootballFixtureResponse {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status?: {
      long: string;
      short: string;
      elapsed: number | null;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals?: {
    home: number | null;
    away: number | null;
  };
}

interface ApiFootballOddsResponse {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
  };
  league: {
    id: number;
    name: string;
    country: string;
  };
  teams?: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  update?: string;
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string;
      values: Array<{
        value: string;
        odd: string;
      }>;
    }>;
  }>;
}

export interface ApiFootballFixture {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  leagueId: number;
  leagueName: string;
  matchDate: Date;
}

export interface ApiFootballMatchResult {
  fixtureId: number;
  league: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  startTime: string;
}

export interface CorrectScoreOdd {
  fixtureId: number;
  homeScore: number;
  awayScore: number;
  outcome: string;
  odds: number;
  bookmakerId: number;
  bookmaker: string;
  marketId: number;
  marketName: string;
  updatedAt?: Date;
}

export interface MatchWinnerOutcome {
  outcome: string;
  odds: number;
  apiValue: string;
}

export interface MatchWinnerMarket {
  provider: 'api-football' | 'the-odds-api';
  fixtureId: number | string;
  homeTeam: string;
  awayTeam: string;
  leagueId: number;
  leagueName: string;
  matchDate: Date;
  bookmakerId: number | string;
  bookmaker: string;
  marketId: number | string;
  marketName: string;
  updatedAt?: Date;
  outcomes: MatchWinnerOutcome[];
}

let cachedCorrectScoreBetId: number | null = null;
let cachedMatchWinnerBetId: number | null = null;

function getApiFootballConfig() {
  const apiKey = process.env.API_FOOTBALL_KEY || process.env.API_SPORTS_KEY || '';
  const host = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
  const baseUrl = host.startsWith('http') ? host : `https://${host}`;

  if (!apiKey) {
    throw new Error('API_FOOTBALL_KEY is not set');
  }

  return { apiKey, baseUrl };
}

function hasApiFootballErrors(errors: unknown): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === 'object') return Object.keys(errors as Record<string, unknown>).length > 0;
  return true;
}

async function apiFootballGetPage<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  page?: number
): Promise<ApiFootballEnvelope<T>> {
  const { apiKey, baseUrl } = getApiFootballConfig();
  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  if (page && page > 1) {
    url.searchParams.set('page', String(page));
  }

  const response = await fetch(url.toString(), {
    headers: {
      'x-apisports-key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`API-Football request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as ApiFootballEnvelope<T>;
  if (hasApiFootballErrors(body.errors)) {
    throw new Error(`API-Football returned errors: ${JSON.stringify(body.errors)}`);
  }

  return body;
}

async function apiFootballGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T[]> {
  const firstPage = await apiFootballGetPage<T>(path, params);
  const results = [...(firstPage.response || [])];
  const totalPages = firstPage.paging?.total || 1;

  for (let page = 2; page <= totalPages; page++) {
    const nextPage = await apiFootballGetPage<T>(path, params, page);
    results.push(...(nextPage.response || []));
  }

  return results;
}

export async function getCorrectScoreBetId(): Promise<number> {
  const configuredId = process.env.API_FOOTBALL_CORRECT_SCORE_BET_ID;
  if (configuredId && !Number.isNaN(Number(configuredId))) {
    return Number(configuredId);
  }

  if (cachedCorrectScoreBetId) return cachedCorrectScoreBetId;

  const betTypes = await apiFootballGet<ApiFootballBetType>('odds/bets', { search: 'Correct Score' });
  const correctScore = betTypes.find((bet) => bet.name.toLowerCase() === 'correct score')
    || betTypes.find((bet) => bet.name.toLowerCase().includes('correct score'));

  if (!correctScore) {
    throw new Error('Correct Score bet type was not found in API-Football');
  }

  cachedCorrectScoreBetId = correctScore.id;
  return correctScore.id;
}

export async function getMatchWinnerBetId(): Promise<number> {
  const configuredId = process.env.API_FOOTBALL_MATCH_WINNER_BET_ID;
  if (configuredId && !Number.isNaN(Number(configuredId))) {
    return Number(configuredId);
  }

  if (cachedMatchWinnerBetId) return cachedMatchWinnerBetId;

  const betTypes = await apiFootballGet<ApiFootballBetType>('odds/bets', { search: 'Match Winner' });
  const matchWinner = betTypes.find((bet) => bet.name.toLowerCase() === 'match winner')
    || betTypes.find((bet) => bet.name.toLowerCase().includes('match winner'));

  if (!matchWinner) {
    throw new Error('Match Winner bet type was not found in API-Football');
  }

  cachedMatchWinnerBetId = matchWinner.id;
  return matchWinner.id;
}

export async function fetchApiFootballFixtures(
  leagueId: number,
  season: number,
  next: number = 25
): Promise<ApiFootballFixture[]> {
  const fixtures = await apiFootballGet<ApiFootballFixtureResponse>('fixtures', {
    league: leagueId,
    season,
    next,
    timezone: 'Europe/Warsaw'
  });

  return fixtures.map((item) => ({
    fixtureId: item.fixture.id,
    homeTeam: item.teams.home.name,
    awayTeam: item.teams.away.name,
    leagueId: item.league.id,
    leagueName: item.league.name,
    matchDate: new Date(item.fixture.date)
  }));
}

function mapApiFootballMatchResult(item: ApiFootballFixtureResponse): ApiFootballMatchResult {
  const statusShort = item.fixture.status?.short || '';
  const statusLong = item.fixture.status?.long || '';
  const status = ['FT', 'AET', 'PEN'].includes(statusShort) || statusLong.toLowerCase().includes('finished')
    ? 'finished'
    : statusShort || statusLong;

  return {
    fixtureId: item.fixture.id,
    league: item.league.name,
    home: item.teams.home.name,
    away: item.teams.away.name,
    homeScore: item.goals?.home ?? null,
    awayScore: item.goals?.away ?? null,
    status,
    startTime: item.fixture.date
  };
}

export async function fetchApiFootballMatchResultByFixtureId(fixtureId: number): Promise<ApiFootballMatchResult | null> {
  const fixtures = await apiFootballGet<ApiFootballFixtureResponse>('fixtures', {
    id: fixtureId,
    timezone: 'Europe/Warsaw'
  });

  return fixtures[0] ? mapApiFootballMatchResult(fixtures[0]) : null;
}

export async function fetchApiFootballMatchResultsByDate(date: string): Promise<ApiFootballMatchResult[]> {
  const fixtures = await apiFootballGet<ApiFootballFixtureResponse>('fixtures', {
    date,
    timezone: 'Europe/Warsaw'
  });

  return fixtures.map(mapApiFootballMatchResult);
}

function mapMatchWinnerValue(value: string, homeTeam: string, awayTeam: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'home') return homeTeam;
  if (normalized === 'away') return awayTeam;
  if (normalized === 'draw') return 'Draw';

  return value;
}

function mapMatchWinnerOutcomes(
  values: Array<{ value: string; odd: string }>,
  homeTeam: string,
  awayTeam: string
): MatchWinnerOutcome[] {
  return values
    .map((value) => ({
      outcome: mapMatchWinnerValue(value.value, homeTeam, awayTeam),
      odds: Number(value.odd),
      apiValue: value.value
    }))
    .filter((outcome) => !Number.isNaN(outcome.odds) && outcome.odds > 1);
}

export async function fetchMatchWinnerOddsByLeague(
  leagueId: number,
  season: number
): Promise<MatchWinnerMarket[]> {
  const matchWinnerBetId = await getMatchWinnerBetId();
  const oddsFixtures = await apiFootballGet<ApiFootballOddsResponse>('odds', {
    league: leagueId,
    season,
    bet: matchWinnerBetId
  });

  const markets: MatchWinnerMarket[] = [];
  for (const oddsFixture of oddsFixtures) {
    const homeTeam = oddsFixture.teams?.home?.name || '';
    const awayTeam = oddsFixture.teams?.away?.name || '';
    if (!homeTeam || !awayTeam) continue;

    const bookmaker = (oddsFixture.bookmakers || []).find((candidate) =>
      candidate.bets?.some((bet) =>
        (bet.id === matchWinnerBetId || bet.name.toLowerCase().includes('match winner'))
        && mapMatchWinnerOutcomes(bet.values || [], homeTeam, awayTeam).length >= 2
      )
    );
    if (!bookmaker) continue;

    const market = bookmaker.bets.find((bet) =>
      (bet.id === matchWinnerBetId || bet.name.toLowerCase().includes('match winner'))
      && mapMatchWinnerOutcomes(bet.values || [], homeTeam, awayTeam).length >= 2
    );
    if (!market) continue;

    markets.push({
      provider: 'api-football',
      fixtureId: oddsFixture.fixture.id,
      homeTeam,
      awayTeam,
      leagueId: oddsFixture.league.id,
      leagueName: oddsFixture.league.name,
      matchDate: new Date(oddsFixture.fixture.date),
      bookmakerId: bookmaker.id,
      bookmaker: bookmaker.name,
      marketId: market.id,
      marketName: market.name,
      updatedAt: oddsFixture.update ? new Date(oddsFixture.update) : undefined,
      outcomes: mapMatchWinnerOutcomes(market.values || [], homeTeam, awayTeam)
    });
  }

  return markets;
}

function parseScoreValue(value: string): { homeScore: number; awayScore: number } | null {
  const match = value.match(/(\d+)\s*[:-]\s*(\d+)/);
  if (!match) return null;

  return {
    homeScore: Number(match[1]),
    awayScore: Number(match[2])
  };
}

export async function fetchCorrectScoreOdds(fixtureId: number): Promise<CorrectScoreOdd[]> {
  const correctScoreBetId = await getCorrectScoreBetId();
  const oddsFixtures = await apiFootballGet<ApiFootballOddsResponse>('odds', {
    fixture: fixtureId,
    bet: correctScoreBetId
  });

  const odds: CorrectScoreOdd[] = [];
  for (const oddsFixture of oddsFixtures) {
    for (const bookmaker of oddsFixture.bookmakers || []) {
      for (const bet of bookmaker.bets || []) {
        const isCorrectScoreMarket = bet.id === correctScoreBetId
          || bet.name.toLowerCase().includes('correct score');
        if (!isCorrectScoreMarket) continue;

        for (const value of bet.values || []) {
          const parsedScore = parseScoreValue(value.value);
          const parsedOdds = Number(value.odd);
          if (!parsedScore || Number.isNaN(parsedOdds) || parsedOdds <= 1) continue;

          odds.push({
            fixtureId: oddsFixture.fixture.id,
            homeScore: parsedScore.homeScore,
            awayScore: parsedScore.awayScore,
            outcome: `${parsedScore.homeScore}-${parsedScore.awayScore}`,
            odds: parsedOdds,
            bookmakerId: bookmaker.id,
            bookmaker: bookmaker.name,
            marketId: bet.id,
            marketName: bet.name,
            updatedAt: oddsFixture.update ? new Date(oddsFixture.update) : undefined
          });
        }
      }
    }
  }

  return odds;
}

export function findBestCorrectScoreOdd(
  odds: CorrectScoreOdd[],
  homeScore: number,
  awayScore: number
): CorrectScoreOdd | null {
  const matchingOdds = odds.filter((odd) => odd.homeScore === homeScore && odd.awayScore === awayScore);
  if (!matchingOdds.length) return null;

  return matchingOdds.reduce((best, current) => current.odds > best.odds ? current : best);
}

export function formatCorrectScorePreview(odds: CorrectScoreOdd[], limit: number = 12): string {
  const bestByScore = new Map<string, CorrectScoreOdd>();

  for (const odd of odds) {
    const existing = bestByScore.get(odd.outcome);
    if (!existing || odd.odds > existing.odds) {
      bestByScore.set(odd.outcome, odd);
    }
  }

  return Array.from(bestByScore.values())
    .sort((a, b) => (a.homeScore + a.awayScore) - (b.homeScore + b.awayScore)
      || a.homeScore - b.homeScore
      || a.awayScore - b.awayScore)
    .slice(0, limit)
    .map((odd) => `${odd.outcome} (${odd.odds.toFixed(2)})`)
    .join(', ');
}
