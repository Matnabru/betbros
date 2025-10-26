import mongoose from 'mongoose';

export interface CustomBetType extends mongoose.Document {
  userId: string;
  customEventId: string;
  customEventTitle: string;
  outcome: string;
  odds: number;
  amount: number;
  resolved: boolean;
  won: boolean | null;
  createdAt: Date;
}

const customBetSchema = new mongoose.Schema<CustomBetType>({
  userId: { type: String, required: true },
  customEventId: { type: String, required: true },
  customEventTitle: { type: String, required: true },
  outcome: { type: String, required: true },
  odds: { type: Number, required: true },
  amount: { type: Number, required: true },
  resolved: { type: Boolean, default: false },
  won: { type: Boolean, default: null },
  createdAt: { type: Date, default: Date.now }
});

export const CustomBet = mongoose.model<CustomBetType>('CustomBet', customBetSchema);
