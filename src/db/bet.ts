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
  resolved: { type: Boolean, default: false },
  won: { type: Boolean, default: null },
  createdAt: { type: Date, default: Date.now },
  matchDate: { type: Date, required: false }
});

export const Bet = mongoose.model<BetType>('Bet', betSchema);
