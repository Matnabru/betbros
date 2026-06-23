export type BetButtonProvider = 'api-football' | 'the-odds-api';
export type BetButtonMarketCode = 'mw' | 'dnb' | 'btts' | 'tot' | 'atot';
export type BetButtonChoiceCode = 'h' | 'd' | 'a' | 'y' | 'n' | 'o' | 'u';

export interface BetButtonIdData {
  provider: BetButtonProvider;
  eventId: string;
  index: number;
  timestamp: number;
  marketCode: BetButtonMarketCode;
  choiceCode: BetButtonChoiceCode;
  point?: number;
}

function providerToCode(provider: BetButtonProvider): string {
  return provider === 'the-odds-api' ? 'o' : 'a';
}

function providerFromCode(code: string): BetButtonProvider | null {
  if (code === 'o') return 'the-odds-api';
  if (code === 'a') return 'api-football';
  return null;
}

function pointToCode(point?: number): string {
  return typeof point === 'number' && !Number.isNaN(point) ? String(point) : '-';
}

function pointFromCode(code: string): number | undefined {
  if (!code || code === '-') return undefined;
  const point = Number(code);
  return Number.isNaN(point) ? undefined : point;
}

function encodeParts(prefix: 'bet2' | 'betmodal2', data: BetButtonIdData): string {
  return [
    prefix,
    providerToCode(data.provider),
    encodeURIComponent(data.eventId),
    String(data.index),
    String(data.timestamp),
    data.marketCode,
    data.choiceCode,
    pointToCode(data.point)
  ].join('|');
}

function decodeParts(customId: string, expectedPrefix: 'bet2' | 'betmodal2'): BetButtonIdData | null {
  const [prefix, providerCode, eventId, index, timestamp, marketCode, choiceCode, point] = customId.split('|');
  if (prefix !== expectedPrefix) return null;

  const provider = providerFromCode(providerCode);
  if (!provider) return null;

  return {
    provider,
    eventId: decodeURIComponent(eventId || ''),
    index: Number(index),
    timestamp: Number(timestamp),
    marketCode: marketCode as BetButtonMarketCode,
    choiceCode: choiceCode as BetButtonChoiceCode,
    point: pointFromCode(point)
  };
}

export function encodeBetButtonId(data: BetButtonIdData): string {
  return encodeParts('bet2', data);
}

export function encodeBetModalId(data: BetButtonIdData): string {
  return encodeParts('betmodal2', data);
}

export function decodeBetButtonId(customId: string): BetButtonIdData | null {
  return decodeParts(customId, 'bet2');
}

export function decodeBetModalId(customId: string): BetButtonIdData | null {
  return decodeParts(customId, 'betmodal2');
}
