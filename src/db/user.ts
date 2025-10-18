import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  coins: { type: Number, default: 1000 }, // Default starting coins
  inventory: { type: Array, default: [] },
  lastLootbox: { type: Date, default: null },
  bankruptcyCount: { type: Number, default: 0 }, // Track how many times user went broke
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model('User', userSchema);
