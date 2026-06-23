import { BetType } from '../types/bet';

export function formatBetOutcome(bet: Pick<BetType, 'market' | 'outcome' | 'homeTeam' | 'awayTeam' | 'predictedHomeScore' | 'predictedAwayScore' | 'marketLine' | 'marketLabel'>): string {
  if (bet.market === 'exact_score') {
    const score = bet.predictedHomeScore !== undefined && bet.predictedAwayScore !== undefined
      ? `${bet.predictedHomeScore}-${bet.predictedAwayScore}`
      : bet.outcome;
    const teams = bet.homeTeam && bet.awayTeam ? ` ${bet.homeTeam} vs ${bet.awayTeam}` : '';

    return `Exact score ${score}${teams}`;
  }

  if (bet.market === 'draw_no_bet') {
    return `Draw no bet: ${bet.outcome}`;
  }

  if (bet.market === 'btts') {
    return `Both teams to score: ${bet.outcome}`;
  }

  if (bet.market === 'total_goals') {
    const line = typeof bet.marketLine === 'number' ? ` ${bet.marketLine}` : '';
    return `${bet.marketLabel || 'Match goals'}: ${bet.outcome}${line}`;
  }

  return bet.outcome;
}
