import mongoose, { Schema, Document } from 'mongoose';

export interface IErrorLog extends Document {
  message: string;
  stack: string;
  location: string;
  createdAt: Date;
}

const ErrorLogSchema = new Schema<IErrorLog>({
  message: { type: String, required: true },
  stack: { type: String, required: true },
  location: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const ErrorLog = mongoose.models.ErrorLog || mongoose.model<IErrorLog>('ErrorLog', ErrorLogSchema);
