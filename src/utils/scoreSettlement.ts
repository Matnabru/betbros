import { BetSettlement } from './betResolution';

export function scoreDeltaForSettlement(settlement: BetSettlement, odds: number): number {
  if (settlement === 'won') {
    return Number((odds - 1).toFixed(2));
  }

  if (settlement === 'lost') {
    return -1;
  }

  return 0;
}

export function formatScore(value: number): string {
  return Number(value.toFixed(2)).toString();
}
