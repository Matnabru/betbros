import mongoose from 'mongoose';
import { BetType } from '../types/bet';

const betSchema = new mongoose.Schema<BetType>({
  userId: { type: String, required: true },
  eventId: { type: String, required: true },
  eventName: { type: String, required: true },
  league: { type: String, required: true },
  outcome: { type: String, required: true },
  odds: { type: Number, required: true },
  amount: { type: Number, required: true },
  market: { type: String, enum: ['match_winner', 'exact_score', 'draw_no_bet', 'btts', 'total_goals'], default: 'match_winner' },
  provider: { type: String, required: false },
  providerFixtureId: { type: String, required: false },
  providerMarketId: { type: String, required: false },
  marketLabel: { type: String, required: false },
  marketLine: { type: Number, required: false },
  scoringMode: { type: String, enum: ['score', 'coins'], default: 'coins' },
  scoreDelta: { type: Number, required: false },
  bookmaker: { type: String, required: false },
  oddsLastUpdated: { type: Date, required: false },
  homeTeam: { type: String, required: false },
  awayTeam: { type: String, required: false },
  predictedHomeScore: { type: Number, required: false },
  predictedAwayScore: { type: Number, required: false },
  settlementLockedAt: { type: Date, required: false },
  resolved: { type: Boolean, default: false },
  won: { type: Boolean, default: null },
  createdAt: { type: Date, default: Date.now },
  matchDate: { type: Date, required: false }
});

betSchema.index(
  {
    userId: 1,
    eventId: 1,
    scoringMode: 1,
    market: 1,
    outcome: 1,
    marketLine: 1,
    predictedHomeScore: 1,
    predictedAwayScore: 1
  },
  {
    unique: true,
    partialFilterExpression: {
      resolved: false,
      scoringMode: 'score'
    }
  }
);

export const Bet = mongoose.model<BetType>('Bet', betSchema);
