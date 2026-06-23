import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

interface SofaScoreFetchOptions {
  referer?: string;
}

type SofaScoreProxyProvider = 'scrape-do' | 'scraping-ant';

function isProxyEnabled(): boolean {
  return ['true', '1', 'yes'].includes((process.env.USE_PROXY || '').trim().toLowerCase());
}

function isEnabled(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;

  return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}

function getProxyProvider(): SofaScoreProxyProvider {
  const configuredProvider = (process.env.SOFASCORE_PROXY_PROVIDER || '').trim().toLowerCase();
  if (['scrape-do', 'scrapedo', 'scrape_do'].includes(configuredProvider)) {
    return 'scrape-do';
  }
  if (['scraping-ant', 'scrapingant', 'scraping_ant'].includes(configuredProvider)) {
    return 'scraping-ant';
  }

  return process.env.SCRAPE_DO_TOKEN ? 'scrape-do' : 'scraping-ant';
}

function getSofaScoreHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.8',
    'cache-control': 'max-age=0',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'x-requested-with': 'b08eca'
  };

  if (referer) {
    headers.referer = referer;
  }

  return headers;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractJsonText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  const preMatch = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (preMatch?.[1]) {
    return decodeBasicHtmlEntities(preMatch[1].trim());
  }

  throw new Error('ScrapingAnt response did not contain SofaScore JSON');
}

function parseScrapingAntPayload<T>(payload: unknown): T {
  if (
    payload
    && typeof payload === 'object'
    && 'content' in payload
  ) {
    const content = (payload as { content?: unknown }).content;
    if (typeof content !== 'string') {
      throw new Error('ScrapingAnt response is missing string content');
    }

    return JSON.parse(extractJsonText(content)) as T;
  }

  return payload as T;
}

function buildScrapingAntUrl(targetUrl: string, apiKey: string): string {
  const scrapingAntUrl = new URL('https://api.scrapingant.com/v1/general');
  scrapingAntUrl.searchParams.set('url', targetUrl);
  scrapingAntUrl.searchParams.set('x-api-key', apiKey);
  scrapingAntUrl.searchParams.set('browser', process.env.SCRAPING_ANT_BROWSER || 'false');

  if (process.env.SCRAPING_ANT_PROXY_TYPE) {
    scrapingAntUrl.searchParams.set('proxy_type', process.env.SCRAPING_ANT_PROXY_TYPE);
  }

  if (process.env.SCRAPING_ANT_PROXY_COUNTRY) {
    scrapingAntUrl.searchParams.set('proxy_country', process.env.SCRAPING_ANT_PROXY_COUNTRY);
  }

  return scrapingAntUrl.toString();
}

function buildScrapeDoUrl(targetUrl: string, token: string): string {
  const scrapeDoUrl = new URL('https://api.scrape.do/');
  scrapeDoUrl.searchParams.set('token', token);
  scrapeDoUrl.searchParams.set('url', targetUrl);

  if (isEnabled(process.env.SCRAPE_DO_SUPER, true)) {
    scrapeDoUrl.searchParams.set('super', 'true');
  }

  if (process.env.SCRAPE_DO_GEO_CODE) {
    scrapeDoUrl.searchParams.set('geoCode', process.env.SCRAPE_DO_GEO_CODE);
  }

  if (process.env.SCRAPE_DO_DEVICE) {
    scrapeDoUrl.searchParams.set('device', process.env.SCRAPE_DO_DEVICE);
  }

  if (isEnabled(process.env.SCRAPE_DO_RENDER)) {
    scrapeDoUrl.searchParams.set('render', 'true');
  }

  if (isEnabled(process.env.SCRAPE_DO_CUSTOM_HEADERS)) {
    scrapeDoUrl.searchParams.set('customHeaders', 'true');
  }

  return scrapeDoUrl.toString();
}

export function buildSofaScoreUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) {
    return pathOrUrl;
  }

  return `https://www.sofascore.com/api/v1/${pathOrUrl.replace(/^\/+/, '')}`;
}

export async function fetchSofaScoreJson<T>(
  pathOrUrl: string,
  options: SofaScoreFetchOptions = {}
): Promise<T> {
  const targetUrl = buildSofaScoreUrl(pathOrUrl);
  const useProxy = isProxyEnabled();
  const proxyProvider = getProxyProvider();
  let fetchUrl = targetUrl;

  if (useProxy && proxyProvider === 'scrape-do') {
    const scrapeDoToken = process.env.SCRAPE_DO_TOKEN || '';
    if (!scrapeDoToken) {
      throw new Error('USE_PROXY is enabled with Scrape.do but SCRAPE_DO_TOKEN is not set');
    }
    fetchUrl = buildScrapeDoUrl(targetUrl, scrapeDoToken);
  } else if (useProxy) {
    const scrapingAntKey = process.env.SCRAPING_ANT_API_KEY || '';
    if (!scrapingAntKey) {
      throw new Error('USE_PROXY is enabled with ScrapingAnt but SCRAPING_ANT_API_KEY is not set');
    }
    fetchUrl = buildScrapingAntUrl(targetUrl, scrapingAntKey);
  }

  const response = await fetch(fetchUrl, {
    headers: !useProxy || proxyProvider === 'scraping-ant' || isEnabled(process.env.SCRAPE_DO_CUSTOM_HEADERS)
      ? getSofaScoreHeaders(options.referer)
      : {}
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`SofaScore API fetch error: ${response.status} ${response.statusText}: ${responseText.slice(0, 200)}`);
  }

  if (useProxy && proxyProvider === 'scraping-ant') {
    return parseScrapingAntPayload<T>(JSON.parse(responseText) as unknown);
  }

  return JSON.parse(responseText) as T;
}

export async function fetchSofaScoreEventOdds(
  eventId: number | string,
  bookmakerId: number | string = process.env.SOFASCORE_BOOKMAKER_ID || '1137',
  slug: string = ''
): Promise<unknown> {
  return fetchSofaScoreJson(
    `event/${eventId}/odds/${bookmakerId}/all`,
    {
      referer: slug
        ? `https://www.sofascore.com/football/match/${slug}`
        : 'https://www.sofascore.com/football'
    }
  );
}
