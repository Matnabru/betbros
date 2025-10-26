import mongoose from 'mongoose';

export interface CustomEventType extends mongoose.Document {
  customEventId: string;
  title: string;
  outcomes: string[];
  initialPool: { [outcome: string]: number };
  resolved: boolean;
  winningOutcome: string | null;
  createdAt: Date;
  createdBy: string;
}

const customEventSchema = new mongoose.Schema<CustomEventType>({
  customEventId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  outcomes: { type: [String], required: true },
  initialPool: { type: Map, of: Number, default: {} },
  resolved: { type: Boolean, default: false },
  winningOutcome: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, required: true }
});

export const CustomEvent = mongoose.model<CustomEventType>('CustomEvent', customEventSchema);
