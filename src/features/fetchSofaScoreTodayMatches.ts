import { fetchSofaScoreJson } from './sofaScoreClient';

export interface SofaScoreMatch {
  league: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  startTime: string;
}

interface SofaScoreEvent {
  tournament?: {
    name?: string;
  };
  homeTeam?: {
    name?: string;
  };
  awayTeam?: {
    name?: string;
  };
  homeScore?: {
    current?: number | null;
  };
  awayScore?: {
    current?: number | null;
  };
  status?: {
    type?: string;
  };
  startTimestamp?: number;
}

interface SofaScoreScheduledTournament {
  tournament?: {
    name?: string;
  };
  events?: SofaScoreEvent[];
}

interface SofaScoreScheduleResponse {
  events?: SofaScoreEvent[];
  scheduledTournaments?: SofaScoreScheduledTournament[];
}

function formatSofaScoreDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapSofaScoreEvent(event: SofaScoreEvent, fallbackLeague: string = ''): SofaScoreMatch | null {
  const league = event.tournament?.name || fallbackLeague;
  const home = event.homeTeam?.name || '';
  const away = event.awayTeam?.name || '';

  if (!home || !away) return null;

  return {
    league,
    home,
    away,
    homeScore: event.homeScore?.current ?? null,
    awayScore: event.awayScore?.current ?? null,
    status: event.status?.type || '',
    startTime: event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : ''
  };
}

function mapSofaScoreMatches(json: SofaScoreScheduleResponse): SofaScoreMatch[] {
  const matches: SofaScoreMatch[] = [];

  for (const event of json.events || []) {
    const match = mapSofaScoreEvent(event);
    if (match) matches.push(match);
  }

  for (const scheduledTournament of json.scheduledTournaments || []) {
    const fallbackLeague = scheduledTournament.tournament?.name || '';
    for (const event of scheduledTournament.events || []) {
      const match = mapSofaScoreEvent(event, fallbackLeague);
      if (match) matches.push(match);
    }
  }

  return matches;
}

export async function fetchSofaScoreMatchesByDate(date: Date = new Date()): Promise<SofaScoreMatch[]> {
  const dateStr = formatSofaScoreDate(date);
  const referer = `https://www.sofascore.com/football/${dateStr}`;
  let scheduledTournamentsError: unknown;

  try {
    const json = await fetchSofaScoreJson<SofaScoreScheduleResponse>(
      `sport/football/scheduled-tournaments/${dateStr}/page/1`,
      { referer }
    );
    const matches = mapSofaScoreMatches(json);
    if (matches.length) {
      return matches;
    }
    scheduledTournamentsError = new Error('scheduled-tournaments returned no event rows');
  } catch (err) {
    scheduledTournamentsError = err;
  }

  try {
    const json = await fetchSofaScoreJson<SofaScoreScheduleResponse>(
      `sport/football/scheduled-events/${dateStr}`,
      { referer }
    );
    return mapSofaScoreMatches(json);
  } catch (scheduledEventsError) {
    throw new Error(
      `SofaScore schedule fetch failed. scheduled-tournaments: ${errorMessage(scheduledTournamentsError)}; scheduled-events: ${errorMessage(scheduledEventsError)}`
    );
  }
}

export async function fetchSofaScoreTodayMatches(): Promise<SofaScoreMatch[]> {
  return fetchSofaScoreMatchesByDate();
}
