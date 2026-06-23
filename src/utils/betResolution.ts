import { BetType } from '../types/bet';

export interface MatchResult {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export type BetSettlement = 'won' | 'lost' | 'void';

export function normalizeTeamName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/saint/g, 'st')
    .replace(/psg/g, 'parissaintgermain')
    .replace(/&/g, 'and')
    .replace(/\s+(f\.?c\.?|c\.?f\.?|s\.?c\.?|a\.?f\.?c\.?|s\.?f\.?c\.?|c\.?f\.?c\.?|a\.?c\.?|b\.?c\.?|fc|cf|sc|afc|sfc|cfc|ac|bc|united|city|club|team)$/gi, '')
    .replace(/[-.]/g, '')
    .replace(/\s+/g, '');

  const aliases: Record<string, string> = {
    bosniaherzegovina: 'bosniaandherzegovina',
    capeverde: 'caboverde',
    cotedivoire: 'ivorycoast',
    czechia: 'czechrepublic',
    democraticrepublicofcongo: 'drcongo',
    iriran: 'iran',
    korearepublic: 'southkorea',
    turkiye: 'turkey',
    unitedstates: 'usa',
    unitedstatesofamerica: 'usa'
  };

  return aliases[normalized] || normalized;
}

export function scoresInBetTeamOrder(betHomeTeam: string, result: MatchResult) {
  const betHomeNorm = normalizeTeamName(betHomeTeam);
  const resultHomeNorm = normalizeTeamName(result.homeTeam);

  if (betHomeNorm === resultHomeNorm) {
    return {
      homeScore: result.homeScore,
      awayScore: result.awayScore
    };
  }

  return {
    homeScore: result.awayScore,
    awayScore: result.homeScore
  };
}

export function getMatchWinnerInBetTeamOrder(betHomeTeam: string, betAwayTeam: string, result: MatchResult): string {
  const orderedScores = scoresInBetTeamOrder(betHomeTeam, result);

  if (orderedScores.homeScore > orderedScores.awayScore) return betHomeTeam;
  if (orderedScores.awayScore > orderedScores.homeScore) return betAwayTeam;
  return 'DRAW';
}

function parseTotalLine(bet: Pick<BetType, 'outcome' | 'marketLine'>): number | null {
  if (typeof bet.marketLine === 'number' && !Number.isNaN(bet.marketLine)) {
    return bet.marketLine;
  }

  const match = bet.outcome.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function settleBet(
  bet: Pick<BetType, 'market' | 'outcome' | 'predictedHomeScore' | 'predictedAwayScore' | 'marketLine'>,
  result: MatchResult,
  betHomeTeam: string,
  betAwayTeam: string
): BetSettlement {
  if (bet.market === 'exact_score') {
    const orderedScores = scoresInBetTeamOrder(betHomeTeam, result);
    const scoreMatches = bet.predictedHomeScore === orderedScores.homeScore
      && bet.predictedAwayScore === orderedScores.awayScore;
    return scoreMatches ? 'won' : 'lost';
  }

  const winner = getMatchWinnerInBetTeamOrder(betHomeTeam, betAwayTeam, result);
  if (bet.market === 'draw_no_bet') {
    if (winner === 'DRAW') return 'void';
    return bet.outcome === winner ? 'won' : 'lost';
  }

  if (bet.market === 'btts') {
    const bothTeamsScored = result.homeScore > 0 && result.awayScore > 0;
    const pickedYes = bet.outcome.trim().toLowerCase() === 'yes';
    return pickedYes === bothTeamsScored ? 'won' : 'lost';
  }

  if (bet.market === 'total_goals') {
    const line = parseTotalLine(bet);
    if (line === null || Number.isNaN(line)) return 'lost';

    const totalGoals = result.homeScore + result.awayScore;
    if (totalGoals === line) return 'void';

    const pickedOver = bet.outcome.trim().toLowerCase().startsWith('over');
    return (pickedOver && totalGoals > line) || (!pickedOver && totalGoals < line)
      ? 'won'
      : 'lost';
  }

  return bet.outcome === winner || (winner === 'DRAW' && bet.outcome === 'Draw')
    ? 'won'
    : 'lost';
}

export function isBetWinner(
  bet: Pick<BetType, 'market' | 'outcome' | 'predictedHomeScore' | 'predictedAwayScore' | 'marketLine'>,
  result: MatchResult,
  betHomeTeam: string,
  betAwayTeam: string
): boolean {
  return settleBet(bet, result, betHomeTeam, betAwayTeam) === 'won';
}

export function formatFinalScoreInBetTeamOrder(betHomeTeam: string, result: MatchResult): string {
  const orderedScores = scoresInBetTeamOrder(betHomeTeam, result);
  return `${orderedScores.homeScore}-${orderedScores.awayScore}`;
}
