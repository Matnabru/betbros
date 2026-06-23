export interface SoccerLeagueConfig {
  label: string;
  oddsApiKey: string;
  apiFootballLeagueId: number;
}

export const soccerLeagues: SoccerLeagueConfig[] = [
  { label: 'La Liga (Spain)', oddsApiKey: 'soccer_spain_la_liga', apiFootballLeagueId: 140 },
  { label: 'Premier League', oddsApiKey: 'soccer_epl', apiFootballLeagueId: 39 },
  { label: 'Ekstraklasa (Poland)', oddsApiKey: 'soccer_poland_ekstraklasa', apiFootballLeagueId: 106 },
  { label: 'FA Cup', oddsApiKey: 'soccer_fa_cup', apiFootballLeagueId: 45 },
  { label: 'FIFA World Cup Qualifiers - Europe', oddsApiKey: 'soccer_fifa_world_cup_qualifiers_europe', apiFootballLeagueId: 32 },
  { label: 'FIFA World Cup', oddsApiKey: 'soccer_fifa_world_cup', apiFootballLeagueId: 1 },
  { label: 'UEFA Champions League', oddsApiKey: 'soccer_uefa_champs_league', apiFootballLeagueId: 2 },
  { label: 'UEFA Europa Conference League', oddsApiKey: 'soccer_uefa_europa_conference_league', apiFootballLeagueId: 848 },
  { label: 'UEFA Europa League', oddsApiKey: 'soccer_uefa_europa_league', apiFootballLeagueId: 3 }
];

export function getApiFootballLeagueLabel(leagueId: number): string {
  return soccerLeagues.find((league) => league.apiFootballLeagueId === leagueId)?.label || `League ${leagueId}`;
}

export function getSoccerLeagueByApiFootballId(leagueId: number): SoccerLeagueConfig | undefined {
  return soccerLeagues.find((league) => league.apiFootballLeagueId === leagueId);
}

export function getDefaultFootballSeason(now = new Date()): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  return month >= 7 ? year : year - 1;
}
