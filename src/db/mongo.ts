import * as dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

const uri = process.env.MONGO_URI || '';

export async function connectMongo() {
  if (!uri) throw new Error('MONGO_URI not set in environment variables');
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri, {
    dbName: 'betbros'
  });
  console.log('Connected to MongoDB');
}