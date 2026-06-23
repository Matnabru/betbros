export interface BetType {
  userId: string;
  eventId: string;
  eventName: string;
  league: string;
  outcome: string;
  odds: number;
  amount: number;
  market?: 'match_winner' | 'exact_score' | 'draw_no_bet' | 'btts' | 'total_goals';
  provider?: string;
  providerFixtureId?: string;
  providerMarketId?: string;
  marketLabel?: string;
  marketLine?: number;
  scoringMode?: 'score' | 'coins';
  scoreDelta?: number;
  bookmaker?: string;
  oddsLastUpdated?: Date;
  homeTeam?: string;
  awayTeam?: string;
  predictedHomeScore?: number;
  predictedAwayScore?: number;
  settlementLockedAt?: Date;
  resolved: boolean;
  won: boolean | null;
  createdAt: Date;
  matchDate?: Date;
}
