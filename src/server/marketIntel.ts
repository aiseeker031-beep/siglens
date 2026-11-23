import type {
  CatalystCategory,
  MacroCalendarEvent,
  MacroEventImpact,
  MacroEventStatus,
  MarketIntelligenceSnapshot,
  MarketNewsItem,
  TrendingSocialCoin,
} from '../shared/types';
import { fetchDerivativesOverview } from './providers';

const INTEL_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 6_500;
const USER_AGENT = 'SIGLENS-QuantIntel/1.0 (+https://siglens.cc.cd)';

let cachedIntel: { snapshot: MarketIntelligenceSnapshot; expiresAt: number } | null = null;
let inFlightIntel: Promise<MarketIntelligenceSnapshot> | null = null;

// =========================================================================
// 1. PURE XML RSS PARSER & FINANCIAL SENTIMENT LEXICON (ZERO MOCK DATA)
// =========================================================================

const RSS_FEEDS: { name: string; url: string }[] = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  {
    name: 'Yahoo Finance',
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD,ETH-USD,SOL-USD,SPY,NVDA&region=US&lang=en-US',
  },
];

// Asset name/ticker aliases for deterministic headline attribution
const ASSET_ALIASES: { symbol: string; patterns: RegExp[] }[] = [
  { symbol: 'BTC', patterns: [/\bbitcoin\b/i, /\bbtc\b/i] },
  { symbol: 'ETH', patterns: [/\bethereum\b/i, /\bether\b/i, /\beth\b/i] },
  { symbol: 'SOL', patterns: [/\bsolana\b/i, /\bsol\b/i] },
  { symbol: 'XRP', patterns: [/\bripple\b/i, /\bxrp\b/i] },
  { symbol: 'BNB', patterns: [/\bbinance coin\b/i, /\bbnb\b/i] },
  { symbol: 'DOGE', patterns: [/\bdogecoin\b/i, /\bdoge\b/i] },
  { symbol: 'ADA', patterns: [/\bcardano\b/i, /\bada\b/i] },
  { symbol: 'AVAX', patterns: [/\bavalanche\b/i, /\bavax\b/i] },
  { symbol: 'LINK', patterns: [/\bchainlink\b/i, /\blink\b/i] },
  { symbol: 'SUI', patterns: [/\bsui\b/i] },
  { symbol: 'TON', patterns: [/\btoncoin\b/i, /\bton\b/i] },
  { symbol: 'DOT', patterns: [/\bpolkadot\b/i, /\bdot\b/i] },
  { symbol: 'LTC', patterns: [/\blitecoin\b/i, /\bltc\b/i] },
  { symbol: 'BCH', patterns: [/\bbitcoin cash\b/i, /\bbch\b/i] },
  { symbol: 'UNI', patterns: [/\buniswap\b/i, /\buni\b/i] },
  { symbol: 'AAVE', patterns: [/\baave\b/i] },
  { symbol: 'ARB', patterns: [/\barbitrum\b/i, /\barb\b/i] },
  { symbol: 'OP', patterns: [/\boptimism\b/i] },
  { symbol: 'NEAR', patterns: [/\bnear protocol\b/i] },
  { symbol: 'APT', patterns: [/\baptos\b/i, /\bapt\b/i] },
  { symbol: 'PEPE', patterns: [/\bpepe\b/i] },
  { symbol: 'SHIB', patterns: [/\bshiba inu\b/i, /\bshib\b/i] },
  { symbol: 'HYPE', patterns: [/\bhyperliquid\b/i, /\bhype\b/i] },
  { symbol: 'TRX', patterns: [/\btron\b/i, /\btrx\b/i] },
  { symbol: 'XLM', patterns: [/\bstellar\b/i, /\bxlm\b/i] },
  { symbol: 'HBAR', patterns: [/\bhedera\b/i, /\bhbar\b/i] },
  { symbol: 'TAO', patterns: [/\bbittensor\b/i, /\btao\b/i] },
  { symbol: 'NVDA', patterns: [/\bnvidia\b/i, /\bnvda\b/i] },
  { symbol: 'AAPL', patterns: [/\bapple\b/i, /\baapl\b/i] },
  { symbol: 'TSLA', patterns: [/\btesla\b/i, /\btsla\b/i] },
  { symbol: 'MSFT', patterns: [/\bmicrosoft\b/i, /\bmsft\b/i] },
  { symbol: 'COIN', patterns: [/\bcoinbase\b/i] },
  { symbol: 'MSTR', patterns: [/\bmicrostrategy\b/i, /\bstrategy\b/i, /\bmstr\b/i] },
  { symbol: 'XAU', patterns: [/\bgold\b/i, /\bxau\b/i] },
];

const BULLISH_TERMS: { re: RegExp; weight: number }[] = [
  { re: /\b(etf approv|spot etf|record inflow|net inflows?|institutional buying|treasury buys?)\b/i, weight: 32 },
  { re: /\b(surge[sd]?|soar[sed]*|rall(?:y|ies|ied)|breakout|all-time high|ath|skyrocket)\b/i, weight: 24 },
  { re: /\b(rate cut|dovish|cooling inflation|cpi cools?|stimulus|liquidity boost)\b/i, weight: 24 },
  { re: /\b(bullish|accumulat(?:ion|ing)|adoption|partnership|mainnet launch|upgrade|listing|approved)\b/i, weight: 18 },
  { re: /\b(rebound[sed]*|recover[syed]*|gains?|jumps?|climbs?|outperform|beats? estimates?)\b/i, weight: 14 },
  { re: /\b(whale[s]? buy|short squeeze|support holds?|greenlight|cleared)\b/i, weight: 16 },
];

const BEARISH_TERMS: { re: RegExp; weight: number }[] = [
  { re: /\b(hack(?:ed|s)?|exploit(?:ed|s)?|breach|drained|stolen|rug ?pull|insolven(?:t|cy)|bankrupt(?:cy)?)\b/i, weight: 42 },
  { re: /\b(delist(?:ed|ing)?|sec sues?|lawsuit|indict(?:ed|ment)|ban(?:ned|s)?|crackdown|sanction(?:ed|s)?|fraud)\b/i, weight: 34 },
  { re: /\b(crash(?:ed|es)?|plunge[sd]?|plummet[sed]*|capitulat(?:ion|es)|liquidat(?:ed|ions)|sell-?off|dump(?:ed|ing)?)\b/i, weight: 26 },
  { re: /\b(rate hike|hawkish|hot inflation|cpi hot|recession|tariff|outflows?|etf outflows?)\b/i, weight: 22 },
  { re: /\b(bearish|slump[sed]?|drops?|falls?|tumbles?|slides?|sinks?|warning|downgrade|misses? estimates?)\b/i, weight: 15 },
  { re: /\b(fear|panic|risk-off|pressure|resistance rejects?|downtrend|vulnerabilit(?:y|ies))\b/i, weight: 14 },
];

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? decodeXmlEntities(m[1]) : '';
}

function extractAtomLink(block: string): string {
  const hrefMatch = /<link[^>]+href=["']([^"']+)["']/i.exec(block);
  if (hrefMatch) return decodeXmlEntities(hrefMatch[1]);
  return extractTag(block, 'link');
}

export function scoreHeadlineSentiment(text: string): {
  score: number;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  catalystType: CatalystCategory;
  assets: string[];
} {
  let raw = 0;
  for (const { re, weight } of BULLISH_TERMS) {
    if (re.test(text)) raw += weight;
  }
  for (const { re, weight } of BEARISH_TERMS) {
    if (re.test(text)) raw -= weight;
  }
  const score = Math.max(-100, Math.min(100, Math.round(raw)));
  const sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    score >= 12 ? 'BULLISH' : score <= -12 ? 'BEARISH' : 'NEUTRAL';

  let catalystType: CatalystCategory = 'GENERAL';
  if (/\b(hack|exploit|breach|drained|stolen|rug ?pull|vulnerabilit|phishing|insolven|bankrupt)\b/i.test(text)) {
    catalystType = 'SECURITY';
  } else if (/\b(etf|blackrock|grayscale|fidelity|inflow|outflow)\b/i.test(text)) {
    catalystType = 'ETF';
  } else if (/\b(sec|cftc|lawsuit|regulat|ban|senate|congress|bill|sanction|indict|court|doj)\b/i.test(text)) {
    catalystType = 'REGULATORY';
  } else if (/\b(fed|fomc|powell|cpi|inflation|gdp|payroll|nfp|interest rate|treasury|tariff|macro)\b/i.test(text)) {
    catalystType = 'MACRO';
  } else if (/\b(delist|listing|listed on|launch(?:es|ed)? trading)\b/i.test(text)) {
    catalystType = 'LISTING';
  } else if (/\b(upgrade|hard fork|mainnet|v2|v3|halving|burn|staking|airdrop)\b/i.test(text)) {
    catalystType = 'UPGRADE';
  }

  const assets: string[] = [];
  for (const entry of ASSET_ALIASES) {
    if (entry.patterns.some((p) => p.test(text))) {
      assets.push(entry.symbol);
    }
  }

  return { score, sentiment, catalystType, assets };
}

function parseRssXml(xml: string, sourceName: string): MarketNewsItem[] {
  const items: MarketNewsItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];

  for (const block of blocks.slice(0, 18)) {
    const title = extractTag(block, 'title');
    if (!title || title.length < 10) continue;

    const url = extractAtomLink(block);
    const pubRaw =
      extractTag(block, 'pubDate') ||
      extractTag(block, 'published') ||
      extractTag(block, 'updated') ||
      extractTag(block, 'dc:date');
    const parsedTs = pubRaw ? Date.parse(pubRaw) : NaN;
    const publishedAt = Number.isFinite(parsedTs) ? parsedTs : Date.now();

    const desc = extractTag(block, 'description') || extractTag(block, 'summary');
    const combinedText = `${title} ${desc.slice(0, 180)}`;
    const analyzed = scoreHeadlineSentiment(combinedText);

    items.push({
      id: `${sourceName.toLowerCase().replace(/\s+/g, '')}-${publishedAt}-${title.slice(0, 28).replace(/[^a-zA-Z0-9]/g, '')}`,
      title,
      source: sourceName,
      url: url.startsWith('http') ? url : '',
      publishedAt,
      sentiment: analyzed.sentiment,
      sentimentScore: analyzed.score,
      assets: analyzed.assets,
      catalystType: analyzed.catalystType,
    });
  }

  return items;
}

// =========================================================================
// 2. LIVE UPSTREAM FETCHERS (ALL REAL PUBLIC FEEDS, ZERO FABRICATION)
// =========================================================================

async function fetchMacroCalendar(nowMs: number): Promise<{
  events: MacroCalendarEvent[];
  ok: boolean;
}> {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return { events: [], ok: false };
    const rows = (await res.json()) as {
      title?: string;
      country?: string;
      date?: string;
      impact?: string;
      forecast?: string;
      previous?: string;
    }[];
    if (!Array.isArray(rows)) return { events: [], ok: false };

    const MAJOR_COUNTRIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'ALL']);
    const events: MacroCalendarEvent[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const title = String(r.title ?? '').trim();
      const country = String(r.country ?? '').trim().toUpperCase();
      const rawImpact = String(r.impact ?? '').trim().toUpperCase();
      if (!title || !r.date) continue;

      const ts = Date.parse(r.date);
      if (!Number.isFinite(ts)) continue;

      const impact: MacroEventImpact =
        rawImpact === 'HIGH' ? 'HIGH' : rawImpact === 'MEDIUM' ? 'MEDIUM' : 'LOW';

      // Keep High/Medium impact major-economy events + any USD event
      if (impact === 'LOW' && country !== 'USD') continue;
      if (!MAJOR_COUNTRIES.has(country) && impact !== 'HIGH') continue;

      const minutesFromNow = Math.round((ts - nowMs) / 60_000);
      // Window: from 24 hours ago through +7 days
      if (minutesFromNow < -24 * 60 || minutesFromNow > 7 * 24 * 60) continue;

      const status: MacroEventStatus =
        minutesFromNow >= -60 && minutesFromNow <= 30
          ? 'ONGOING'
          : minutesFromNow > 30
            ? 'UPCOMING'
            : 'RECENT';

      events.push({
        id: `macro-${country}-${ts}-${i}`,
        title,
        country,
        impact,
        timestamp: ts,
        status,
        forecast: r.forecast && String(r.forecast).trim() ? String(r.forecast).trim() : null,
        previous: r.previous && String(r.previous).trim() ? String(r.previous).trim() : null,
        minutesFromNow,
      });
    }

    // Sort: ONGOING first, then UPCOMING soonest first, then RECENT newest first
    events.sort((a, b) => {
      const rank = (s: MacroEventStatus) => (s === 'ONGOING' ? 0 : s === 'UPCOMING' ? 1 : 2);
      const rd = rank(a.status) - rank(b.status);
      if (rd !== 0) return rd;
      if (a.status === 'RECENT') return b.timestamp - a.timestamp;
      return a.timestamp - b.timestamp;
    });

    return { events: events.slice(0, 24), ok: true };
  } catch {
    return { events: [], ok: false };
  }
}

async function fetchFearAndGreed7d(): Promise<{
  value: number | null;
  classification: string;
  delta7d: number | null;
  ok: boolean;
}> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=7', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { value: null, classification: 'Unavailable', delta7d: null, ok: false };
    const json = (await res.json()) as {
      data?: { value?: string; value_classification?: string }[];
    };
    const rows = json.data ?? [];
    if (rows.length === 0) {
      return { value: null, classification: 'Unavailable', delta7d: null, ok: false };
    }
    const latest = Number(rows[0].value);
    const oldest = Number(rows[rows.length - 1].value);
    const value = Number.isFinite(latest) ? latest : null;
    const delta7d =
      value !== null && Number.isFinite(oldest) ? Number((value - oldest).toFixed(1)) : null;
    return {
      value,
      classification: rows[0].value_classification || 'Neutral',
      delta7d,
      ok: value !== null,
    };
  } catch {
    return { value: null, classification: 'Unavailable', delta7d: null, ok: false };
  }
}

async function fetchCoinGeckoTrending(): Promise<{
  coins: TrendingSocialCoin[];
  ok: boolean;
}> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return { coins: [], ok: false };
    const json = (await res.json()) as {
      coins?: {
        item?: {
          symbol?: string;
          name?: string;
          score?: number;
          data?: { price_change_percentage_24h?: { usd?: number } };
        };
      }[];
    };
    const coins: TrendingSocialCoin[] = (json.coins ?? [])
      .map((entry, idx): TrendingSocialCoin | null => {
        const item = entry.item;
        if (!item?.symbol) return null;
        const chg = item.data?.price_change_percentage_24h?.usd;
        return {
          symbol: item.symbol.toUpperCase(),
          name: item.name || item.symbol.toUpperCase(),
          rank: idx + 1,
          priceChange24hPct:
            typeof chg === 'number' && Number.isFinite(chg) ? Number(chg.toFixed(2)) : null,
        };
      })
      .filter((c): c is TrendingSocialCoin => c !== null)
      .slice(0, 15);
    return { coins, ok: coins.length > 0 };
  } catch {
    return { coins: [], ok: false };
  }
}

async function fetchAllNewsCatalysts(): Promise<{
  items: MarketNewsItem[];
  activeFeeds: string[];
  failedFeeds: string[];
}> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
      });
      if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
      const xml = await res.text();
      return { name: feed.name, items: parseRssXml(xml, feed.name) };
    }),
  );

  const activeFeeds: string[] = [];
  const failedFeeds: string[] = [];
  const merged: MarketNewsItem[] = [];
  const seenTitles = new Set<string>();

  results.forEach((r, idx) => {
    const feed = RSS_FEEDS[idx];
    if (r.status === 'fulfilled' && r.value.items.length > 0) {
      activeFeeds.push(feed.name);
      for (const item of r.value.items) {
        const norm = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 48);
        if (seenTitles.has(norm)) continue;
        seenTitles.add(norm);
        merged.push(item);
      }
    } else {
      failedFeeds.push(feed.name);
    }
  });

  merged.sort((a, b) => b.publishedAt - a.publishedAt);
  return { items: merged.slice(0, 36), activeFeeds, failedFeeds };
}

// =========================================================================
// 3. AGGREGATE LIVE INTELLIGENCE SNAPSHOT
// =========================================================================

async function buildMarketIntelligence(): Promise<MarketIntelligenceSnapshot> {
  const nowMs = Date.now();
  const [macroRes, fngRes, trendingRes, newsRes, derivRes] = await Promise.all([
    fetchMacroCalendar(nowMs),
    fetchFearAndGreed7d(),
    fetchCoinGeckoTrending(),
    fetchAllNewsCatalysts(),
    fetchDerivativesOverview().catch(() => null),
  ]);

  const activeSources: string[] = [];
  const unavailableSources: string[] = [];

  if (macroRes.ok) activeSources.push('ForexFactory Macro Calendar');
  else unavailableSources.push('Macro Calendar');

  if (fngRes.ok) activeSources.push('Alternative.me Fear & Greed (7d)');
  else unavailableSources.push('Fear & Greed Index');

  if (trendingRes.ok) activeSources.push('CoinGecko Social Trending');
  else unavailableSources.push('CoinGecko Trending');

  for (const name of newsRes.activeFeeds) activeSources.push(`${name} RSS`);
  for (const name of newsRes.failedFeeds) unavailableSources.push(`${name} RSS`);

  // Derivatives crowd positioning
  const perAssetFundingPct: Record<string, number> = {};
  let avgFundingPct: number | null = null;
  let crowdedSide: MarketIntelligenceSnapshot['derivativesBias']['crowdedSide'] = 'UNAVAILABLE';

  if (derivRes && derivRes.markets.length > 0) {
    activeSources.push(derivRes.source);
    let sumFunding = 0;
    let countFunding = 0;
    for (const m of derivRes.markets) {
      const base = m.displaySymbol.split('/')[0]?.toUpperCase();
      if (base && Number.isFinite(m.fundingRatePct)) {
        perAssetFundingPct[base] = Number(m.fundingRatePct.toFixed(4));
        sumFunding += m.fundingRatePct;
        countFunding += 1;
      }
    }
    if (countFunding > 0) {
      avgFundingPct = Number((sumFunding / countFunding).toFixed(4));
      if (avgFundingPct >= 0.015) crowdedSide = 'CROWDED_LONGS';
      else if (avgFundingPct <= -0.008) crowdedSide = 'CROWDED_SHORTS';
      else crowdedSide = 'BALANCED';
    }
  } else {
    unavailableSources.push('Perpetual Funding Positioning');
  }

  // Compute aggregate News NLP Sentiment (-100 .. +100), recency-weighted over last 48h
  const recentNews = newsRes.items.filter((n) => nowMs - n.publishedAt <= 72 * 3_600_000);
  let weightedNewsSum = 0;
  let weightedNewsDenom = 0;
  for (const item of recentNews) {
    const ageHours = Math.max(0, (nowMs - item.publishedAt) / 3_600_000);
    const recencyWeight = Math.exp(-ageHours / 18); // half-life ~12.5h
    weightedNewsSum += item.sentimentScore * recencyWeight;
    weightedNewsDenom += recencyWeight;
  }
  const newsSentimentScore =
    weightedNewsDenom > 0 ? Math.round(weightedNewsSum / weightedNewsDenom) : 0;

  // Social buzz score from CoinGecko trending 24h momentum + Fear & Greed level
  const trendingChanges = trendingRes.coins
    .map((c) => c.priceChange24hPct)
    .filter((v): v is number => v !== null);
  const avgTrendingChg =
    trendingChanges.length > 0
      ? trendingChanges.reduce((a, b) => a + b, 0) / trendingChanges.length
      : 0;
  const fngNorm = fngRes.value !== null ? (fngRes.value - 50) * 1.4 : 0; // -70 .. +70
  const socialBuzzScore = Math.max(
    -100,
    Math.min(100, Math.round(fngNorm * 0.55 + Math.max(-45, Math.min(45, avgTrendingChg * 3.5)) * 0.45)),
  );

  const contrarianBias: MarketIntelligenceSnapshot['fearAndGreed']['contrarianBias'] =
    fngRes.value !== null && fngRes.value <= 20
      ? 'EXTREME_FEAR_LONG_BIAS'
      : fngRes.value !== null && fngRes.value >= 80
        ? 'EXTREME_GREED_SHORT_BIAS'
        : 'NEUTRAL';

  // Overall blended sentiment (-100 .. +100)
  const overallSentimentScore = Math.max(
    -100,
    Math.min(100, Math.round(newsSentimentScore * 0.55 + socialBuzzScore * 0.45)),
  );
  const sentimentLabel: MarketIntelligenceSnapshot['sentimentLabel'] =
    overallSentimentScore >= 35
      ? 'STRONGLY_BULLISH'
      : overallSentimentScore >= 12
        ? 'BULLISH'
        : overallSentimentScore <= -35
          ? 'STRONGLY_BEARISH'
          : overallSentimentScore <= -12
            ? 'BEARISH'
            : 'NEUTRAL';

  // Compute Macro Event Risk Level from ONGOING & UPCOMING High/Medium USD/Global events
  const imminentHigh = macroRes.events.filter(
    (e) => e.impact === 'HIGH' && e.minutesFromNow >= -60 && e.minutesFromNow <= 360,
  );
  const nearTermHigh = macroRes.events.filter(
    (e) => e.impact === 'HIGH' && e.minutesFromNow > 360 && e.minutesFromNow <= 24 * 60,
  );
  const imminentMedUsd = macroRes.events.filter(
    (e) =>
      e.impact === 'MEDIUM' &&
      e.country === 'USD' &&
      e.minutesFromNow >= -45 &&
      e.minutesFromNow <= 240,
  );

  let eventRiskLevel: MarketIntelligenceSnapshot['eventRiskLevel'] = 'LOW';
  let eventRiskSummary = 'No high-impact macro catalyst scheduled within the next 24h.';

  if (imminentHigh.length > 0) {
    eventRiskLevel = 'HIGH';
    const first = imminentHigh[0];
    const timing =
      first.status === 'ONGOING'
        ? 'ONGOING NOW'
        : first.minutesFromNow < 60
          ? `in ${first.minutesFromNow}m`
          : `in ${(first.minutesFromNow / 60).toFixed(1)}h`;
    eventRiskSummary = `HIGH VOLATILITY RISK: ${first.country} ${first.title} (${timing}). Tight stops widened & weak setups blocked.`;
  } else if (nearTermHigh.length > 0 || imminentMedUsd.length > 0) {
    eventRiskLevel = 'ELEVATED';
    const first = nearTermHigh[0] ?? imminentMedUsd[0];
    const hrs = Math.max(0.5, first.minutesFromNow / 60).toFixed(1);
    eventRiskSummary = `Elevated macro watch: ${first.country} ${first.title} in ${hrs}h (${first.impact} impact).`;
  }

  return {
    updatedAt: nowMs,
    fearAndGreed: {
      value: fngRes.value,
      classification: fngRes.classification,
      delta7d: fngRes.delta7d,
      contrarianBias,
    },
    newsSentimentScore,
    socialBuzzScore,
    overallSentimentScore,
    sentimentLabel,
    eventRiskLevel,
    eventRiskSummary,
    upcomingEvents: macroRes.events,
    newsCatalysts: newsRes.items,
    trendingCoins: trendingRes.coins,
    derivativesBias: {
      avgFundingPct,
      crowdedSide,
    },
    perAssetFundingPct,
    activeSources,
    unavailableSources,
  };
}

export async function getMarketIntelligence(
  forceRefresh = false,
): Promise<MarketIntelligenceSnapshot> {
  const now = Date.now();
  if (!forceRefresh && cachedIntel && cachedIntel.expiresAt > now) {
    return cachedIntel.snapshot;
  }
  if (!forceRefresh && inFlightIntel) {
    return inFlightIntel;
  }
  inFlightIntel = buildMarketIntelligence()
    .then((snapshot) => {
      cachedIntel = { snapshot, expiresAt: Date.now() + INTEL_TTL_MS };
      inFlightIntel = null;
      return snapshot;
    })
    .catch((err) => {
      inFlightIntel = null;
      throw err;
    });
  return inFlightIntel;
}

// =========================================================================
// 4. PER-ASSET SENTIMENT & CATALYST CONTEXT RESOLVER
// =========================================================================

export interface AssetSentimentContext {
  score: number; // -100 .. +100
  label: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trendingRank: number | null;
  fundingPct: number | null;
  headlinesCount: number;
  shockWarning: string | null;
  blocksLong: boolean;
  blocksShort: boolean;
}

export function getAssetSentimentContext(
  baseAsset: string,
  intel: MarketIntelligenceSnapshot,
): AssetSentimentContext {
  const base = baseAsset.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nowMs = Date.now();

  // Direct news headlines mentioning this asset within last 48h
  const assetNews = intel.newsCatalysts.filter(
    (n) => n.assets.includes(base) && nowMs - n.publishedAt <= 48 * 3_600_000,
  );

  // Check for active shock catalysts (security exploit/hack or bearish regulatory/delisting shock)
  let shockWarning: string | null = null;
  let blocksLong = false;
  let blocksShort = false;

  const recentShock = assetNews.find(
    (n) =>
      nowMs - n.publishedAt <= 24 * 3_600_000 &&
      ((n.catalystType === 'SECURITY' && n.sentimentScore <= -20) ||
        (n.catalystType === 'REGULATORY' && n.sentimentScore <= -30) ||
        (n.catalystType === 'LISTING' && /delist/i.test(n.title))),
  );
  if (recentShock) {
    shockWarning = `${recentShock.catalystType} shock (${recentShock.source}): "${recentShock.title.slice(0, 88)}"`;
    blocksLong = true;
  }

  const bullishCatalystShock = assetNews.find(
    (n) =>
      nowMs - n.publishedAt <= 18 * 3_600_000 &&
      n.catalystType === 'ETF' &&
      n.sentimentScore >= 30,
  );
  if (bullishCatalystShock && !shockWarning) {
    // Do not blindly short right into an ETF approval / massive inflow headline
    blocksShort = true;
  }

  // Asset-specific news average, falling back to macro market news sentiment
  const assetNewsScore =
    assetNews.length > 0
      ? assetNews.reduce((sum, n) => sum + n.sentimentScore, 0) / assetNews.length
      : intel.newsSentimentScore * 0.6;

  // CoinGecko social trending boost/context
  const trendHit = intel.trendingCoins.find((c) => c.symbol === base);
  const trendingRank = trendHit ? trendHit.rank : null;
  let socialTrendAdj = 0;
  if (trendHit) {
    const chg = trendHit.priceChange24hPct ?? 0;
    // Positive trending momentum boosts bullish sentiment; dumping trending coin warns of panic
    socialTrendAdj = chg >= 0 ? Math.min(18, 6 + chg * 0.8) : Math.max(-18, -6 + chg * 0.8);
  }

  // Contrarian Fear & Greed adjustment (avoid shorting panic bottoms or buying euphoric tops)
  let fngAdj = 0;
  if (intel.fearAndGreed.contrarianBias === 'EXTREME_FEAR_LONG_BIAS') {
    fngAdj = 10; // Contrarian edge slightly favors oversold bounces over chasing shorts
  } else if (intel.fearAndGreed.contrarianBias === 'EXTREME_GREED_SHORT_BIAS') {
    fngAdj = -10;
  }

  // Perpetual funding rate crowd contrarian adjustment
  const fundingPct = intel.perAssetFundingPct[base] ?? null;
  let fundingAdj = 0;
  if (fundingPct !== null) {
    // Extremely crowded longs (>= +0.04% per interval) = squeeze risk downward
    if (fundingPct >= 0.04) fundingAdj = -14;
    else if (fundingPct <= -0.025) fundingAdj = 14; // Crowded shorts = short squeeze fuel
  }

  const blended = Math.max(
    -100,
    Math.min(
      100,
      Math.round(
        assetNewsScore * 0.5 +
          intel.overallSentimentScore * 0.25 +
          socialTrendAdj +
          fngAdj +
          fundingAdj,
      ),
    ),
  );

  const label: AssetSentimentContext['label'] =
    blended >= 12 ? 'BULLISH' : blended <= -12 ? 'BEARISH' : 'NEUTRAL';

  return {
    score: blended,
    label,
    trendingRank,
    fundingPct,
    headlinesCount: assetNews.length,
    shockWarning,
    blocksLong,
    blocksShort,
  };
}
