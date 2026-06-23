import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export interface OddsCheckerCorrectScoreOdd {
  homeScore: number;
  awayScore: number;
  outcome: string;
  odds: number;
  bookmaker: string;
  bookmakerCode?: string;
  marketId: number;
  marketName: string;
  updatedAt?: Date;
}

export interface OddsCheckerCorrectScoreMarket {
  homeTeam: string;
  awayTeam: string;
  marketId: number;
  marketName: string;
  pageUrl: string;
  odds: OddsCheckerCorrectScoreOdd[];
}

export interface OddsCheckerWorldCupFixture {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  matchDate: Date;
  pageUrl: string;
}

interface OddsCheckerMarketEntity {
  ocMarketId?: number;
  marketName?: string;
  marketTypeName?: string;
}

interface OddsCheckerBookmakerEntity {
  bookmakerCode?: string;
  bookmakerName?: string;
  name?: string;
}

interface OddsCheckerHypernovaData {
  bookmakers?: {
    entities?: Record<string, OddsCheckerBookmakerEntity>;
  };
  markets?: {
    entities?: Record<string, OddsCheckerMarketEntity>;
  };
  subeventConfig?: {
    homeTeamName?: string;
    awayTeamName?: string;
  };
  subeventMeta?: {
    url?: string;
  };
}

interface OddsCheckerAllOddsMarket {
  marketId: number;
  marketName: string;
  marketTypeName?: string;
  odds?: Array<{
    betId?: number;
    bookmakerCode?: string;
    oddsDecimal?: number;
    betFeedTimestamp?: string;
  }>;
  bets?: OddsCheckerBet[];
}

interface OddsCheckerBet {
  betId?: number;
  betName?: string;
  line?: string;
  bestOddsDecimal?: number;
  bestOddsBookmakerCodes?: string[];
}

const ODDSCHECKER_BASE_URL = 'https://www.oddschecker.com';
const WORLD_CUP_PATH = 'football/world-cup';
const LONDON_TIME_ZONE = 'Europe/London';
const MONTH_INDEX: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;

  return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}

function stripHtmlComment(value: string): string {
  return value
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .trim();
}

function removeDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function canonicalTeamName(value: string): string {
  const normalized = removeDiacritics(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');

  const aliases: Record<string, string> = {
    bosniaherzegovina: 'bosniaandherzegovina',
    congodr: 'drcongo',
    democraticrepublicofcongo: 'drcongo',
    czechia: 'czechrepublic',
    cotedivoire: 'ivorycoast',
    unitedstates: 'usa',
    unitedstatesofamerica: 'usa'
  };

  return aliases[normalized] || normalized;
}

function slugifyTeamName(value: string): string {
  const slugAliases: Record<string, string> = {
    czechia: 'czech-republic',
    'bosnia-herzegovina': 'bosnia-and-herzegovina',
    'congo-dr': 'dr-congo',
    'democratic-republic-of-congo': 'dr-congo',
    'cote-d-ivoire': 'ivory-coast',
    'united-states': 'usa',
    'united-states-of-america': 'usa'
  };

  const slug = removeDiacritics(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slugAliases[slug] || slug;
}

function buildScrapeDoUrl(targetUrl: string): string {
  const token = process.env.SCRAPE_DO_TOKEN || '';
  if (!token) return targetUrl;

  const url = new URL('https://api.scrape.do/');
  url.searchParams.set('token', token);
  url.searchParams.set('url', targetUrl);

  if (isEnabled(process.env.ODDSCHECKER_SCRAPE_DO_SUPER, true)) {
    url.searchParams.set('super', 'true');
  }

  url.searchParams.set('geoCode', process.env.ODDSCHECKER_SCRAPE_DO_GEO_CODE || 'gb');

  if (process.env.ODDSCHECKER_SCRAPE_DO_DEVICE) {
    url.searchParams.set('device', process.env.ODDSCHECKER_SCRAPE_DO_DEVICE);
  }

  if (isEnabled(process.env.ODDSCHECKER_SCRAPE_DO_RENDER)) {
    url.searchParams.set('render', 'true');
  }

  return url.toString();
}

function absoluteOddsCheckerUrl(href: string): string {
  return href.startsWith('http')
    ? href
    : `${ODDSCHECKER_BASE_URL}/${href.replace(/^\/+/, '')}`;
}

async function fetchOddsCheckerText(targetUrl: string): Promise<string> {
  const proxiedUrl = buildScrapeDoUrl(targetUrl);
  const response = await fetch(proxiedUrl, {
    headers: proxiedUrl === targetUrl
      ? {
          accept: 'text/html,application/json',
          'accept-language': 'en-GB,en;q=0.8',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
        }
      : {}
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`OddsChecker fetch failed: ${response.status} ${response.statusText}: ${body.slice(0, 200)}`);
  }

  return body;
}

export function buildOddsCheckerWorldCupMatchUrl(homeTeam: string, awayTeam: string): string {
  const slug = `${slugifyTeamName(homeTeam)}-v-${slugifyTeamName(awayTeam)}`;
  return `${ODDSCHECKER_BASE_URL}/${WORLD_CUP_PATH}/${slug}/winner`;
}

function parseHypernovaJson(raw: string): OddsCheckerHypernovaData | null {
  try {
    const parsed = JSON.parse(stripHtmlComment(raw)) as OddsCheckerHypernovaData & {
      bestOdds?: OddsCheckerHypernovaData;
    };
    const data = parsed.bestOdds || parsed;

    if (data.bookmakers || data.markets || data.subeventConfig || data.subeventMeta) {
      return data;
    }
  } catch {}

  return null;
}

function parseHypernovaData(html: string): OddsCheckerHypernovaData {
  const $ = cheerio.load(html);
  const preferredScript = $('script[data-hypernova-key="subeventmarkets"]').first().html();
  if (preferredScript) {
    const data = parseHypernovaJson(preferredScript);
    if (data) return data;
  }

  for (const element of $('script[type="application/json"][data-hypernova-key]').toArray()) {
    const raw = $(element).html();
    if (!raw) continue;

    const data = parseHypernovaJson(raw);
    if (data?.bookmakers || data?.markets || data?.subeventConfig) {
      return data;
    }
  }

  return {};
}

function findCorrectScoreMarketId(data: OddsCheckerHypernovaData, html: string): number {
  const markets = data.markets?.entities || {};
  const correctScore = Object.values(markets).find((market) =>
    market.marketTypeName?.toLowerCase() === 'correct score'
  );

  const marketId = correctScore?.ocMarketId;
  if (!marketId) {
    const $ = cheerio.load(html);
    for (const element of $('section[id^="market_"]').toArray()) {
      const heading = $(element).find('h2').first().text().trim().toLowerCase();
      const id = $(element).attr('id') || '';
      const sectionMarketId = Number(id.replace(/^market_/, ''));

      if (heading === 'correct score' && !Number.isNaN(sectionMarketId)) {
        return sectionMarketId;
      }
    }

    throw new Error('OddsChecker Correct Score market was not found on the match page');
  }

  return marketId;
}

function buildBookmakerNameMap(data: OddsCheckerHypernovaData): Map<string, string> {
  const result = new Map<string, string>();
  for (const [code, bookmaker] of Object.entries(data.bookmakers?.entities || {})) {
    result.set(code, bookmaker.bookmakerName || bookmaker.name || code);
    if (bookmaker.bookmakerCode) {
      result.set(bookmaker.bookmakerCode, bookmaker.bookmakerName || bookmaker.name || bookmaker.bookmakerCode);
    }
  }

  return result;
}

function findWorldCupMatchLink(indexHtml: string, homeTeam: string, awayTeam: string): string | null {
  const homeNorm = canonicalTeamName(homeTeam);
  const awayNorm = canonicalTeamName(awayTeam);
  const $ = cheerio.load(indexHtml);

  for (const element of $('a[href*="/football/world-cup/"], a[href^="football/world-cup/"]').toArray()) {
    const href = $(element).attr('href') || '';
    const textNorm = canonicalTeamName($(element).text());
    const hrefNorm = canonicalTeamName(href.replace(/\/winner.*$/, '').replace(/^.*world-cup\//, '').replace(/-v-/g, ' '));
    const hasTeams = (textNorm.includes(homeNorm) && textNorm.includes(awayNorm))
      || (hrefNorm.includes(homeNorm) && hrefNorm.includes(awayNorm));

    if (hasTeams) {
      return absoluteOddsCheckerUrl(href);
    }
  }

  return null;
}

function extractWorldCupYear($: cheerio.CheerioAPI): number {
  const pageText = $('body').text();
  const yearMatch = pageText.match(/World Cup\s+(\d{4})/i);
  if (yearMatch) return Number(yearMatch[1]);

  return new Date().getFullYear();
}

function datePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day)
  };
}

function timeZoneOffsetMillis(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second)
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
  dateParts: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const utcGuess = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute));
  const offset = timeZoneOffsetMillis(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offset);
}

function parseFixtureDateLabel(
  label: string,
  worldCupYear: number,
  now = new Date()
): { year: number; month: number; day: number } | null {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (/^today/i.test(normalized)) {
    return datePartsInTimeZone(now, LONDON_TIME_ZONE);
  }

  const match = normalized.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
  if (!match) return null;

  const month = MONTH_INDEX[match[2].toLowerCase()];
  if (!month) return null;

  return {
    year: worldCupYear,
    month,
    day: Number(match[1])
  };
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

async function fetchWorldCupMatchPage(homeTeam: string, awayTeam: string): Promise<{ html: string; pageUrl: string }> {
  const directUrl = buildOddsCheckerWorldCupMatchUrl(homeTeam, awayTeam);

  try {
    return {
      html: await fetchOddsCheckerText(directUrl),
      pageUrl: directUrl
    };
  } catch (directError) {
    const indexUrl = `${ODDSCHECKER_BASE_URL}/${WORLD_CUP_PATH}`;
    const indexHtml = await fetchOddsCheckerText(indexUrl);
    const pageUrl = findWorldCupMatchLink(indexHtml, homeTeam, awayTeam);
    if (!pageUrl) {
      throw directError;
    }

    return {
      html: await fetchOddsCheckerText(pageUrl),
      pageUrl
    };
  }
}

function parseScoreLine(line: string): { left: number; right: number } | null {
  const match = line.trim().match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
  if (!match) return null;

  return {
    left: Number(match[1]),
    right: Number(match[2])
  };
}

export function mapOddsCheckerCorrectScoreBet(
  bet: OddsCheckerBet,
  homeTeam: string,
  awayTeam: string,
  marketId: number,
  marketName: string,
  bookmakerNames = new Map<string, string>(),
  latestUpdateByBetId = new Map<number, Date>()
): OddsCheckerCorrectScoreOdd | null {
  const score = bet.line ? parseScoreLine(bet.line) : null;
  const odds = Number(bet.bestOddsDecimal);
  if (!score || Number.isNaN(odds) || odds <= 1) return null;

  const betName = bet.betName || '';
  const betNameNorm = canonicalTeamName(betName);
  const homeNorm = canonicalTeamName(homeTeam);
  const awayNorm = canonicalTeamName(awayTeam);
  let homeScore: number;
  let awayScore: number;

  if (betNameNorm === homeNorm) {
    homeScore = score.left;
    awayScore = score.right;
  } else if (betNameNorm === awayNorm) {
    homeScore = score.right;
    awayScore = score.left;
  } else if (betNameNorm === 'draw' && score.left === score.right) {
    homeScore = score.left;
    awayScore = score.right;
  } else {
    return null;
  }

  const bookmakerCode = bet.bestOddsBookmakerCodes?.[0];
  const bookmaker = bookmakerCode
    ? bookmakerNames.get(bookmakerCode) || `OddsChecker ${bookmakerCode}`
    : 'OddsChecker best price';

  return {
    homeScore,
    awayScore,
    outcome: `${homeScore}-${awayScore}`,
    odds,
    bookmaker,
    bookmakerCode,
    marketId,
    marketName,
    updatedAt: bet.betId ? latestUpdateByBetId.get(bet.betId) : undefined
  };
}

function latestUpdateByBetId(market: OddsCheckerAllOddsMarket): Map<number, Date> {
  const result = new Map<number, Date>();

  for (const odd of market.odds || []) {
    if (!odd.betId || !odd.betFeedTimestamp) continue;
    const update = new Date(odd.betFeedTimestamp);
    if (Number.isNaN(update.getTime())) continue;

    const existing = result.get(odd.betId);
    if (!existing || update > existing) {
      result.set(odd.betId, update);
    }
  }

  return result;
}

export async function fetchOddsCheckerWorldCupCorrectScoreOdds(
  homeTeam: string,
  awayTeam: string
): Promise<OddsCheckerCorrectScoreMarket> {
  const page = await fetchWorldCupMatchPage(homeTeam, awayTeam);
  const pageData = parseHypernovaData(page.html);
  const marketId = findCorrectScoreMarketId(pageData, page.html);
  const bookmakerNames = buildBookmakerNameMap(pageData);
  const marketUrl = `${ODDSCHECKER_BASE_URL}/api/markets/v2/all-odds?market-ids=${marketId}&repub=OC`;
  const marketBody = await fetchOddsCheckerText(marketUrl);
  const markets = JSON.parse(marketBody) as OddsCheckerAllOddsMarket[];
  const market = markets.find((candidate) => candidate.marketId === marketId) || markets[0];
  if (!market) {
    throw new Error('OddsChecker Correct Score odds response was empty');
  }

  const updateMap = latestUpdateByBetId(market);
  const resolvedHomeTeam = pageData.subeventConfig?.homeTeamName || homeTeam;
  const resolvedAwayTeam = pageData.subeventConfig?.awayTeamName || awayTeam;
  const odds = (market.bets || [])
    .map((bet) => mapOddsCheckerCorrectScoreBet(
      bet,
      resolvedHomeTeam,
      resolvedAwayTeam,
      market.marketId,
      market.marketTypeName || market.marketName || 'Correct Score',
      bookmakerNames,
      updateMap
    ))
    .filter((odd): odd is OddsCheckerCorrectScoreOdd => Boolean(odd));

  return {
    homeTeam: resolvedHomeTeam,
    awayTeam: resolvedAwayTeam,
    marketId: market.marketId,
    marketName: market.marketTypeName || market.marketName || 'Correct Score',
    pageUrl: page.pageUrl,
    odds
  };
}

export async function fetchOddsCheckerWorldCupFixtures(limit = 50): Promise<OddsCheckerWorldCupFixture[]> {
  const pageUrl = `${ODDSCHECKER_BASE_URL}/${WORLD_CUP_PATH}`;
  const html = await fetchOddsCheckerText(pageUrl);
  const $ = cheerio.load(html);
  const year = extractWorldCupYear($);
  const fixtures: OddsCheckerWorldCupFixture[] = [];
  let currentDateParts: { year: number; month: number; day: number } | null = null;

  $('div[class*="TitleWrapper"], div[class*="RowWrapper"]').each((_index, element) => {
    const item = $(element);
    const className = item.attr('class') || '';

    if (className.includes('TitleWrapper')) {
      currentDateParts = parseFixtureDateLabel(item.text(), year) || currentDateParts;
      return;
    }

    const link = item.find('a[title*=" v "][href*="football/world-cup/"]').first();
    const title = link.attr('title') || '';
    const href = link.attr('href') || '';
    const time = parseTime(item.find('a[class*="StartTimeText"]').first().text());
    const teams = title.split(/\s+v\s+/i);
    if (!currentDateParts || !href || !time || teams.length !== 2) return;

    const fullUrl = absoluteOddsCheckerUrl(href);
    fixtures.push({
      fixtureId: href.replace(/^\/+/, ''),
      homeTeam: teams[0].trim(),
      awayTeam: teams[1].trim(),
      leagueName: 'FIFA World Cup',
      matchDate: zonedDateTimeToUtc(currentDateParts, time.hour, time.minute, LONDON_TIME_ZONE),
      pageUrl: fullUrl
    });
  });

  return fixtures
    .sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime())
    .slice(0, limit);
}
