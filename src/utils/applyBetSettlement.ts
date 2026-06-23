import { Bet } from '../db/bet';
import { User } from '../db/user';
import { BetSettlement } from './betResolution';
import { formatBetOutcome } from './formatBet';
import { scoreDeltaForSettlement } from './scoreSettlement';

export interface SettlementBuckets {
  scoreChanges: Array<{ userId: string; delta: number; outcome: string }>;
  winners: Array<{ userId: string; amount: number; outcome: string }>;
  losers: Array<{ userId: string; amount: number; outcome: string }>;
  refunded: Array<{ userId: string; amount: number; outcome: string }>;
}

export function createSettlementBuckets(): SettlementBuckets {
  return {
    scoreChanges: [],
    winners: [],
    losers: [],
    refunded: []
  };
}

const SETTLEMENT_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

async function claimBetForSettlement(bet: any) {
  const staleLockBefore = new Date(Date.now() - SETTLEMENT_LOCK_TIMEOUT_MS);

  return Bet.findOneAndUpdate(
    {
      _id: bet._id,
      resolved: false,
      $or: [
        { settlementLockedAt: { $exists: false } },
        { settlementLockedAt: null },
        { settlementLockedAt: { $lt: staleLockBefore } }
      ]
    },
    {
      $set: { settlementLockedAt: new Date() }
    },
    { new: true }
  );
}

async function releaseBetSettlementClaim(betId: unknown) {
  await Bet.updateOne(
    { _id: betId, resolved: false },
    { $unset: { settlementLockedAt: '' } }
  );
}

async function applyUserDeltaOnce(
  userId: string,
  betId: string,
  delta: { coins?: number; score?: number }
): Promise<boolean> {
  await User.updateOne(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const update: Record<string, unknown> = {
    $addToSet: { settledBetIds: betId }
  };
  const inc: Record<string, number> = {};

  if (typeof delta.coins === 'number' && delta.coins !== 0) {
    inc.coins = delta.coins;
  }
  if (typeof delta.score === 'number' && delta.score !== 0) {
    inc.score = delta.score;
  }
  if (Object.keys(inc).length > 0) {
    update.$inc = inc;
  }

  const result = await User.updateOne(
    {
      userId,
      settledBetIds: { $ne: betId }
    },
    update
  );

  return result.modifiedCount > 0;
}

export async function applyBetSettlementOnce(
  bet: any,
  settlement: BetSettlement,
  buckets: SettlementBuckets
): Promise<boolean> {
  const claimedBet = await claimBetForSettlement(bet);
  if (!claimedBet) return false;

  try {
    const betId = String(claimedBet._id);
    if (claimedBet.scoringMode === 'score') {
      const scoreDelta = scoreDeltaForSettlement(settlement, claimedBet.odds);
      const applied = await applyUserDeltaOnce(claimedBet.userId, betId, { score: scoreDelta });
      claimedBet.scoreDelta = scoreDelta;
      claimedBet.won = settlement === 'won' ? true : settlement === 'lost' ? false : null;
      if (applied) {
        buckets.scoreChanges.push({
          userId: claimedBet.userId,
          delta: scoreDelta,
          outcome: formatBetOutcome(claimedBet)
        });
      }
    } else if (settlement === 'won') {
      const payout = Math.round(claimedBet.amount * claimedBet.odds);
      const applied = await applyUserDeltaOnce(claimedBet.userId, betId, { coins: payout });
      claimedBet.won = true;
      if (applied) {
        buckets.winners.push({
          userId: claimedBet.userId,
          amount: payout - claimedBet.amount,
          outcome: formatBetOutcome(claimedBet)
        });
      }
    } else if (settlement === 'void') {
      const applied = await applyUserDeltaOnce(claimedBet.userId, betId, { coins: claimedBet.amount });
      claimedBet.won = null;
      if (applied) {
        buckets.refunded.push({
          userId: claimedBet.userId,
          amount: claimedBet.amount,
          outcome: formatBetOutcome(claimedBet)
        });
      }
    } else {
      claimedBet.won = false;
      buckets.losers.push({
        userId: claimedBet.userId,
        amount: claimedBet.amount,
        outcome: formatBetOutcome(claimedBet)
      });
    }

    claimedBet.resolved = true;
    claimedBet.settlementLockedAt = undefined;
    await claimedBet.save();
    return true;
  } catch (err) {
    await releaseBetSettlementClaim(claimedBet._id);
    throw err;
  }
}
