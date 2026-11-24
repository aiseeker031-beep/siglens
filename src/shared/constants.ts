import type {
  ExchangeId,
  IndicatorWeights,
  MarketType,
  ScreenerPreset,
  Timeframe,
  UserPreferences,
} from './types';

export const ENGINE_VERSION = '1.0.0';
export const CONFIG_VERSION = '2026.1';

export const TIMEFRAMES: Timeframe[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1d',
  '1w',
];

export const QUICK_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

export const MTF_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export const EXCHANGE_TIMEFRAMES: Record<ExchangeId, Timeframe[]> = {
  binance: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'],
  bybit: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'],
  okx: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'],
  kucoin: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'],
  gateio: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
  mexc: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
  bitget: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w'],
  htx: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
  cryptocom: ['1m', '5m', '15m', '30m', '1h', '4h', '6h', '12h', '1d', '1w'],
  hyperliquid: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1d', '1w'],
  kraken: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
  coinbase: ['1m', '5m', '15m', '1h', '6h', '1d'],
  stocks: ['5m', '15m', '30m', '1h', '4h', '1d', '1w'],
  cfds: ['5m', '15m', '30m', '1h', '4h', '1d', '1w'],
};

export const EXCHANGE_MARKET_TYPES: Record<ExchangeId, MarketType[]> = {
  binance: ['spot'],
  bybit: ['spot', 'perpetual'],
  okx: ['spot', 'perpetual'],
  kucoin: ['spot'],
  gateio: ['spot', 'perpetual'],
  mexc: ['spot'],
  bitget: ['spot', 'perpetual'],
  htx: ['spot'],
  cryptocom: ['spot'],
  hyperliquid: ['perpetual'],
  kraken: ['spot'],
  coinbase: ['spot'],
  stocks: ['equity'],
  cfds: ['cfd'],
};

export const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  kucoin: 'KuCoin',
  gateio: 'Gate.io',
  mexc: 'MEXC',
  bitget: 'Bitget',
  htx: 'HTX',
  cryptocom: 'Crypto.com',
  hyperliquid: 'Hyperliquid',
  kraken: 'Kraken',
  coinbase: 'Coinbase',
  stocks: 'US Stocks',
  cfds: 'Global CFDs',
};

export const CRYPTO_EXCHANGES: ExchangeId[] = [
  'binance',
  'bybit',
  'okx',
  'kucoin',
  'gateio',
  'mexc',
  'bitget',
  'htx',
  'cryptocom',
  'hyperliquid',
  'kraken',
  'coinbase',
];

export const ALL_EXCHANGES: ExchangeId[] = [...CRYPTO_EXCHANGES, 'stocks', 'cfds'];

export function defaultMarketTypeFor(exchange: ExchangeId): MarketType {
  return EXCHANGE_MARKET_TYPES[exchange][0];
}

export interface TraditionalInstrument {
  base: string;
  quote: string;
  displaySymbol: string;
  nativeSymbol: string;
  name: string;
  category: 'Equity' | 'ETF' | 'Index CFD' | 'Commodity CFD' | 'FX CFD';
}

export const STOCK_UNIVERSE: TraditionalInstrument[] = [
  { base: 'AAPL', quote: 'USD', displaySymbol: 'AAPL/USD', nativeSymbol: 'AAPL', name: 'Apple Inc.', category: 'Equity' },
  { base: 'MSFT', quote: 'USD', displaySymbol: 'MSFT/USD', nativeSymbol: 'MSFT', name: 'Microsoft', category: 'Equity' },
  { base: 'NVDA', quote: 'USD', displaySymbol: 'NVDA/USD', nativeSymbol: 'NVDA', name: 'NVIDIA', category: 'Equity' },
  { base: 'AMZN', quote: 'USD', displaySymbol: 'AMZN/USD', nativeSymbol: 'AMZN', name: 'Amazon', category: 'Equity' },
  { base: 'GOOGL', quote: 'USD', displaySymbol: 'GOOGL/USD', nativeSymbol: 'GOOGL', name: 'Alphabet', category: 'Equity' },
  { base: 'META', quote: 'USD', displaySymbol: 'META/USD', nativeSymbol: 'META', name: 'Meta Platforms', category: 'Equity' },
  { base: 'TSLA', quote: 'USD', displaySymbol: 'TSLA/USD', nativeSymbol: 'TSLA', name: 'Tesla', category: 'Equity' },
  { base: 'AVGO', quote: 'USD', displaySymbol: 'AVGO/USD', nativeSymbol: 'AVGO', name: 'Broadcom', category: 'Equity' },
  { base: 'AMD', quote: 'USD', displaySymbol: 'AMD/USD', nativeSymbol: 'AMD', name: 'AMD', category: 'Equity' },
  { base: 'NFLX', quote: 'USD', displaySymbol: 'NFLX/USD', nativeSymbol: 'NFLX', name: 'Netflix', category: 'Equity' },
  { base: 'PLTR', quote: 'USD', displaySymbol: 'PLTR/USD', nativeSymbol: 'PLTR', name: 'Palantir', category: 'Equity' },
  { base: 'ORCL', quote: 'USD', displaySymbol: 'ORCL/USD', nativeSymbol: 'ORCL', name: 'Oracle', category: 'Equity' },
  { base: 'JPM', quote: 'USD', displaySymbol: 'JPM/USD', nativeSymbol: 'JPM', name: 'JPMorgan Chase', category: 'Equity' },
  { base: 'V', quote: 'USD', displaySymbol: 'V/USD', nativeSymbol: 'V', name: 'Visa', category: 'Equity' },
  { base: 'COIN', quote: 'USD', displaySymbol: 'COIN/USD', nativeSymbol: 'COIN', name: 'Coinbase', category: 'Equity' },
  { base: 'MSTR', quote: 'USD', displaySymbol: 'MSTR/USD', nativeSymbol: 'MSTR', name: 'Strategy', category: 'Equity' },
  { base: 'SPY', quote: 'USD', displaySymbol: 'SPY/USD', nativeSymbol: 'SPY', name: 'S&P 500 ETF', category: 'ETF' },
  { base: 'QQQ', quote: 'USD', displaySymbol: 'QQQ/USD', nativeSymbol: 'QQQ', name: 'Nasdaq 100 ETF', category: 'ETF' },
  { base: 'UBER', quote: 'USD', displaySymbol: 'UBER/USD', nativeSymbol: 'UBER', name: 'Uber', category: 'Equity' },
  { base: 'DIS', quote: 'USD', displaySymbol: 'DIS/USD', nativeSymbol: 'DIS', name: 'Walt Disney', category: 'Equity' },
];

export const CFD_UNIVERSE: TraditionalInstrument[] = [
  { base: 'US500', quote: 'USD', displaySymbol: 'US500/USD', nativeSymbol: '^GSPC', name: 'S&P 500 Index CFD', category: 'Index CFD' },
  { base: 'NAS100', quote: 'USD', displaySymbol: 'NAS100/USD', nativeSymbol: '^NDX', name: 'Nasdaq 100 CFD', category: 'Index CFD' },
  { base: 'US30', quote: 'USD', displaySymbol: 'US30/USD', nativeSymbol: '^DJI', name: 'Dow Jones 30 CFD', category: 'Index CFD' },
  { base: 'GER40', quote: 'EUR', displaySymbol: 'GER40/EUR', nativeSymbol: '^GDAXI', name: 'DAX 40 CFD', category: 'Index CFD' },
  { base: 'UK100', quote: 'GBP', displaySymbol: 'UK100/GBP', nativeSymbol: '^FTSE', name: 'FTSE 100 CFD', category: 'Index CFD' },
  { base: 'JPN225', quote: 'JPY', displaySymbol: 'JPN225/JPY', nativeSymbol: '^N225', name: 'Nikkei 225 CFD', category: 'Index CFD' },
  { base: 'XAU', quote: 'USD', displaySymbol: 'XAU/USD', nativeSymbol: 'GC=F', name: 'Gold CFD', category: 'Commodity CFD' },
  { base: 'XAG', quote: 'USD', displaySymbol: 'XAG/USD', nativeSymbol: 'SI=F', name: 'Silver CFD', category: 'Commodity CFD' },
  { base: 'WTI', quote: 'USD', displaySymbol: 'WTI/USD', nativeSymbol: 'CL=F', name: 'WTI Crude Oil CFD', category: 'Commodity CFD' },
  { base: 'BRENT', quote: 'USD', displaySymbol: 'BRENT/USD', nativeSymbol: 'BZ=F', name: 'Brent Crude CFD', category: 'Commodity CFD' },
  { base: 'NATGAS', quote: 'USD', displaySymbol: 'NATGAS/USD', nativeSymbol: 'NG=F', name: 'Natural Gas CFD', category: 'Commodity CFD' },
  { base: 'COPPER', quote: 'USD', displaySymbol: 'COPPER/USD', nativeSymbol: 'HG=F', name: 'Copper CFD', category: 'Commodity CFD' },
  { base: 'XPT', quote: 'USD', displaySymbol: 'XPT/USD', nativeSymbol: 'PL=F', name: 'Platinum CFD', category: 'Commodity CFD' },
  { base: 'XPD', quote: 'USD', displaySymbol: 'XPD/USD', nativeSymbol: 'PA=F', name: 'Palladium CFD', category: 'Commodity CFD' },
  { base: 'EUR', quote: 'USD', displaySymbol: 'EUR/USD', nativeSymbol: 'EURUSD=X', name: 'EUR/USD FX CFD', category: 'FX CFD' },
  { base: 'GBP', quote: 'USD', displaySymbol: 'GBP/USD', nativeSymbol: 'GBPUSD=X', name: 'GBP/USD FX CFD', category: 'FX CFD' },
  { base: 'USD', quote: 'JPY', displaySymbol: 'USD/JPY', nativeSymbol: 'USDJPY=X', name: 'USD/JPY FX CFD', category: 'FX CFD' },
  { base: 'AUD', quote: 'USD', displaySymbol: 'AUD/USD', nativeSymbol: 'AUDUSD=X', name: 'AUD/USD FX CFD', category: 'FX CFD' },
  { base: 'USD', quote: 'CAD', displaySymbol: 'USD/CAD', nativeSymbol: 'USDCAD=X', name: 'USD/CAD FX CFD', category: 'FX CFD' },
  { base: 'USD', quote: 'CHF', displaySymbol: 'USD/CHF', nativeSymbol: 'USDCHF=X', name: 'USD/CHF FX CFD', category: 'FX CFD' },
];

export const DEFAULT_WEIGHTS: IndicatorWeights = {
  ema: 20,
  macd: 15,
  rsi: 10,
  adx: 15,
  bollinger: 10,
  stochRsi: 10,
  obv: 8,
  vwap: 7,
  rvol: 5,
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  timezone: 'UTC',
  decimalPrecision: 'auto',
  defaultExchange: 'binance',
  defaultMarketType: 'spot',
  defaultPair: 'BTC/USDT',
  defaultTimeframe: '15m',
  denseMode: false,
  sidebarCollapsed: false,
  defaultChartMode: '2d',
  showLiveProvisional: true,
  reducedMotion: false,
  weights: { ...DEFAULT_WEIGHTS },
  thresholds: {
    strongBullish: 60,
    bullish: 25,
    bearish: -25,
    strongBearish: -60,
  },
  minCoveragePct: 65,
  minAgreementForStrongPct: 60,
};

export const CORE_UNIVERSE_BASES = [
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'BNB',
  'DOGE',
  'ADA',
  'AVAX',
  'LINK',
  'DOT',
  'SUI',
  'UNI',
  'NEAR',
  'LTC',
  'APT',
  'ARB',
  'OP',
  'ATOM',
  'FIL',
  'INJ',
  'AAVE',
  'TRX',
  'BCH',
  'ETC',
  'XLM',
  'ALGO',
  'HBAR',
  'VET',
  'RENDER',
  'TAO',
];

export const BUILT_IN_SCREENER_PRESETS: ScreenerPreset[] = [
  {
    id: 'strong-uptrend',
    name: 'Strong Uptrend',
    description: 'Price above EMA 20/50/200 with ADX >= 22 and bullish directional bias.',
    category: 'Trend',
    filters: { aboveEma20: true, aboveEma50: true, aboveEma200: true, minAdx: 22, classifications: ['STRONG_BULLISH', 'BULLISH'] },
    isBuiltIn: true,
  },
  {
    id: 'strong-downtrend',
    name: 'Strong Downtrend',
    description: 'Price below EMA 20/50/200 with ADX >= 22 and bearish directional bias.',
    category: 'Trend',
    filters: { aboveEma20: false, aboveEma50: false, aboveEma200: false, minAdx: 22, classifications: ['STRONG_BEARISH', 'BEARISH'] },
    isBuiltIn: true,
  },
  {
    id: 'emerging-bullish-momentum',
    name: 'Emerging Bullish Momentum',
    description: 'Positive MACD histogram with RSI between 50 and 70 and price reclaiming EMA 20.',
    category: 'Momentum',
    filters: { aboveEma20: true, minRsi: 50, maxRsi: 70, macdHistDirection: 'POSITIVE' },
    isBuiltIn: true,
  },
  {
    id: 'emerging-bearish-momentum',
    name: 'Emerging Bearish Momentum',
    description: 'Negative MACD histogram with RSI between 30 and 50 and price below EMA 20.',
    category: 'Momentum',
    filters: { aboveEma20: false, minRsi: 30, maxRsi: 50, macdHistDirection: 'NEGATIVE' },
    isBuiltIn: true,
  },
  {
    id: 'fresh-macd-crossovers',
    name: 'Fresh MACD Crossovers',
    description: 'Assets exhibiting a recent bullish MACD line crossover above signal line.',
    category: 'Momentum',
    filters: { macdCross: 'BULLISH' },
    isBuiltIn: true,
  },
  {
    id: 'ema-golden-cross',
    name: 'EMA Golden Cross',
    description: 'EMA 50 crossing above EMA 200 or bullish EMA 20/50 alignment.',
    category: 'Trend',
    filters: { emaCross: 'GOLDEN' },
    isBuiltIn: true,
  },
  {
    id: 'ema-death-cross',
    name: 'EMA Death Cross',
    description: 'EMA 50 crossing below EMA 200 indicating structural trend reversal.',
    category: 'Trend',
    filters: { emaCross: 'DEATH' },
    isBuiltIn: true,
  },
  {
    id: 'oversold-assets',
    name: 'Oversold Assets',
    description: 'RSI 14 below 35 highlighting potential short-term exhaustion.',
    category: 'Momentum',
    filters: { maxRsi: 35 },
    isBuiltIn: true,
  },
  {
    id: 'overbought-assets',
    name: 'Overbought Assets',
    description: 'RSI 14 above 68 indicating stretched upside momentum.',
    category: 'Momentum',
    filters: { minRsi: 68 },
    isBuiltIn: true,
  },
  {
    id: 'high-volume-breakouts',
    name: 'High Volume Breakouts',
    description: 'Relative volume >= 1.5x 20-bar baseline with positive 24h momentum.',
    category: 'Volume',
    filters: { minRvol: 1.5, minChange24h: 1.5 },
    isBuiltIn: true,
  },
  {
    id: 'low-volatility-squeeze',
    name: 'Low Volatility Squeeze',
    description: 'Bollinger bandwidth compressed into lower historical quartile.',
    category: 'Volatility',
    filters: { bbSqueeze: true },
    isBuiltIn: true,
  },
  {
    id: 'approaching-support',
    name: 'Approaching Support',
    description: 'Price trading within 2.5% of a detected historical support zone.',
    category: 'Structure',
    filters: { nearSupport: true },
    isBuiltIn: true,
  },
  {
    id: 'approaching-resistance',
    name: 'Approaching Resistance',
    description: 'Price trading within 2.5% of a detected historical resistance zone.',
    category: 'Structure',
    filters: { nearResistance: true },
    isBuiltIn: true,
  },
  {
    id: 'bullish-divergence',
    name: 'Bullish Divergence',
    description: 'Bullish RSI divergence detected against recent swing lows.',
    category: 'Momentum',
    filters: { rsiDivergence: 'BULLISH' },
    isBuiltIn: true,
  },
  {
    id: 'bearish-divergence',
    name: 'Bearish Divergence',
    description: 'Bearish RSI divergence detected against recent swing highs.',
    category: 'Momentum',
    filters: { rsiDivergence: 'BEARISH' },
    isBuiltIn: true,
  },
  {
    id: 'momentum-acceleration',
    name: 'Momentum Acceleration',
    description: 'Expanding Bollinger bands with positive MACD and elevated RVOL >= 1.2.',
    category: 'Momentum',
    filters: { bbExpanding: true, macdHistDirection: 'POSITIVE', minRvol: 1.2 },
    isBuiltIn: true,
  },
  {
    id: 'trend-exhaustion',
    name: 'Trend Exhaustion',
    description: 'Strong prior trend showing extreme RSI (> 72 or < 28) with high ATR.',
    category: 'Volatility',
    filters: { minAtrPct: 2.0, minAdx: 30 },
    isBuiltIn: true,
  },
  {
    id: 'mtf-bullish-alignment',
    name: 'High-Agreement Bullish',
    description: 'Bullish or Strong Bullish signals with >= 65% indicator agreement.',
    category: 'Signals',
    filters: { classifications: ['STRONG_BULLISH', 'BULLISH'], minAgreementPct: 65 },
    isBuiltIn: true,
  },
  {
    id: 'mtf-bearish-alignment',
    name: 'High-Agreement Bearish',
    description: 'Bearish or Strong Bearish signals with >= 65% indicator agreement.',
    category: 'Signals',
    filters: { classifications: ['STRONG_BEARISH', 'BEARISH'], minAgreementPct: 65 },
    isBuiltIn: true,
  },
  {
    id: 'unusual-market-activity',
    name: 'Unusual Market Activity',
    description: 'Abnormal volume participation (RVOL >= 1.8) across tracked pairs.',
    category: 'Volume',
    filters: { minRvol: 1.8 },
    isBuiltIn: true,
  },
];

export const DEFAULT_WATCHLIST_MARKETS = [
  'binance:spot:BTC/USDT',
  'binance:spot:ETH/USDT',
  'binance:spot:SOL/USDT',
  'binance:spot:XRP/USDT',
  'binance:spot:BNB/USDT',
  'binance:spot:LINK/USDT',
  'binance:spot:AVAX/USDT',
  'binance:spot:SUI/USDT',
];
