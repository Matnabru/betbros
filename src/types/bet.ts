export interface BetType {
  userId: string;
  eventId: string;
  eventName: string;
  league: string;
  outcome: string;
  odds: number;
  amount: number;
  resolved: boolean;
  won: boolean | null;
  createdAt: Date;
  matchDate?: Date;
}
