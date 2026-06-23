import { normalizeTeamName } from './betResolution';

export interface MatchWinnerOutcomeLike {
  outcome: string;
  odds: number;
}

function isDrawOutcome(outcome: string): boolean {
  const normalized = outcome.trim().toLowerCase();
  return normalized === 'draw' || normalized === 'x' || normalized === 'tie';
}

function oddsText(odds: number): string {
  return odds.toFixed(2);
}

export function orderMatchWinnerOutcomes<T extends MatchWinnerOutcomeLike>(
  outcomes: T[],
  homeTeam: string,
  awayTeam: string
): T[] {
  const homeNorm = normalizeTeamName(homeTeam);
  const awayNorm = normalizeTeamName(awayTeam);
  const used = new Set<T>();

  const pick = (predicate: (outcome: T) => boolean): T | undefined => {
    const match = outcomes.find((outcome) => !used.has(outcome) && predicate(outcome));
    if (match) used.add(match);
    return match;
  };

  const ordered = [
    pick((outcome) => normalizeTeamName(outcome.outcome) === homeNorm),
    pick((outcome) => isDrawOutcome(outcome.outcome)),
    pick((outcome) => normalizeTeamName(outcome.outcome) === awayNorm)
  ].filter((outcome): outcome is T => Boolean(outcome));

  for (const outcome of outcomes) {
    if (!used.has(outcome)) ordered.push(outcome);
  }

  return ordered;
}

export function formatMatchWinnerOption(outcome: MatchWinnerOutcomeLike): string {
  return `${outcome.outcome}: ${oddsText(outcome.odds)}`;
}

export function formatMatchWinnerButtonLabel(outcome: MatchWinnerOutcomeLike): string {
  return `${outcome.outcome} (${oddsText(outcome.odds)})`;
}
