import assert from 'assert';
import { formatFinalScoreInBetTeamOrder, isBetWinner, normalizeTeamName, settleBet } from './utils/betResolution';
import { formatMatchWinnerButtonLabel, orderMatchWinnerOutcomes } from './utils/matchWinnerOdds';
import { mapOddsCheckerCorrectScoreBet } from './features/oddsChecker';
import { scoreDeltaForSettlement } from './utils/scoreSettlement';

const result = {
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  homeScore: 2,
  awayScore: 1
};

assert.equal(
  isBetWinner(
    { market: 'match_winner', outcome: 'Arsenal' },
    result,
    'Arsenal',
    'Chelsea'
  ),
  true
);

assert.equal(
  isBetWinner(
    { market: 'exact_score', outcome: '2-1', predictedHomeScore: 2, predictedAwayScore: 1 },
    result,
    'Arsenal',
    'Chelsea'
  ),
  true
);

assert.equal(
  isBetWinner(
    { market: 'exact_score', outcome: '1-2', predictedHomeScore: 1, predictedAwayScore: 2 },
    result,
    'Arsenal',
    'Chelsea'
  ),
  false
);

assert.equal(
  formatFinalScoreInBetTeamOrder('Chelsea', result),
  '1-2'
);

assert.equal(
  settleBet({ market: 'draw_no_bet', outcome: 'Arsenal' }, result, 'Arsenal', 'Chelsea'),
  'won'
);

assert.equal(
  settleBet({ market: 'draw_no_bet', outcome: 'Arsenal' }, { ...result, homeScore: 1, awayScore: 1 }, 'Arsenal', 'Chelsea'),
  'void'
);

assert.equal(
  settleBet({ market: 'btts', outcome: 'Yes' }, result, 'Arsenal', 'Chelsea'),
  'won'
);

assert.equal(
  settleBet({ market: 'btts', outcome: 'No' }, { ...result, awayScore: 0 }, 'Arsenal', 'Chelsea'),
  'won'
);

assert.equal(
  settleBet({ market: 'total_goals', outcome: 'Over', marketLine: 2.5 }, result, 'Arsenal', 'Chelsea'),
  'won'
);

assert.equal(
  settleBet({ market: 'total_goals', outcome: 'Under', marketLine: 3 }, result, 'Arsenal', 'Chelsea'),
  'void'
);

assert.equal(
  settleBet(
    { market: 'exact_score', outcome: '2-1', predictedHomeScore: 2, predictedAwayScore: 1 },
    { homeTeam: 'Arsenal', awayTeam: 'Chelsea', homeScore: 2, awayScore: 1 },
    'Arsenal',
    'Chelsea'
  ),
  'won'
);

assert.equal(
  settleBet(
    { market: 'total_goals', outcome: 'Over', marketLine: 3 },
    { homeTeam: 'Arsenal', awayTeam: 'Chelsea', homeScore: 2, awayScore: 1 },
    'Arsenal',
    'Chelsea'
  ),
  'void'
);

const orderedOutcomes = orderMatchWinnerOutcomes(
  [
    { outcome: 'Bosnia & Herzegovina', odds: 6 },
    { outcome: 'Switzerland', odds: 1.55 },
    { outcome: 'Draw', odds: 4.2 }
  ],
  'Switzerland',
  'Bosnia & Herzegovina'
);

assert.deepEqual(
  orderedOutcomes.map((outcome) => outcome.outcome),
  ['Switzerland', 'Draw', 'Bosnia & Herzegovina']
);

assert.equal(
  formatMatchWinnerButtonLabel(orderedOutcomes[1]),
  'Draw (4.20)'
);

assert.deepEqual(
  mapOddsCheckerCorrectScoreBet(
    { betName: 'Ivory Coast', line: '1-0', bestOddsDecimal: 17, bestOddsBookmakerCodes: ['B3'] },
    'Germany',
    'Ivory Coast',
    123,
    'Correct Score'
  ),
  {
    homeScore: 0,
    awayScore: 1,
    outcome: '0-1',
    odds: 17,
    bookmaker: 'OddsChecker B3',
    bookmakerCode: 'B3',
    marketId: 123,
    marketName: 'Correct Score',
    updatedAt: undefined
  }
);

assert.equal(scoreDeltaForSettlement('won', 4.95), 3.95);
assert.equal(scoreDeltaForSettlement('lost', 4.95), -1);
assert.equal(scoreDeltaForSettlement('void', 4.95), 0);

assert.equal(normalizeTeamName('Cape Verde'), normalizeTeamName('Cabo Verde'));
assert.equal(normalizeTeamName('Türkiye'), normalizeTeamName('Turkey'));

console.log('bet resolution tests passed');
