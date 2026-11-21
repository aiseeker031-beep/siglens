export type ExchangeId = 'binance' | 'bybit' | 'kraken' | 'coinbase' | 'stocks' | 'cfds';
export type MarketType = 'spot' | 'perpetual' | 'equity' | 'cfd';

export type Timeframe =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'
  | '1w';

export type DataFreshness = 'LIVE' | 'DELAYED' | 'RECONNECTING' | 'STALE' | 'UNAVAILABLE';

export type NavSection =
  | 'overview'
  | 'markets'
  | 'signals'
  | 'screener'
  | 'heatmaps'
  | 'arena'
  | 'ai'
  | 'settings';

export interface CanonicalMarket {
  canonicalId: string; // e.g., binance:spot:BTC/USDT
  exchange: ExchangeId;
  marketType: MarketType;
  baseAsset: string;
  quoteAsset: string;
  displaySymbol: string; // BTC/USDT
  nativeSymbol: string; // BTCUSDT, BTC-USD, XBTUSD
}

export interface MarketTicker extends CanonicalMarket {
  lastPrice: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  change24h: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  baseVolume24h: number;
  quoteVolume24h: number;
  timestamp: number;
  freshness: DataFreshness;
  source: string;
}

export interface Candle {
  openTime: number; // ms UTC
  closeTime: number; // ms UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume?: number;
  isClosed: boolean;
}

export interface CandleValidationResult {
  validCandles: Candle[];
  completedCandles: Candle[];
  formingCandle: Candle | null;
  issues: string[];
  hasGaps: boolean;
  duplicateCount: number;
  rejectedCount: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface OrderBookSnapshot {
  canonicalId: string;
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spreadPct: number | null;
  timestamp: number;
  source: string;
}

export type SignalClassification =
  | 'STRONG_BULLISH'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONG_BEARISH'
  | 'INSUFFICIENT_DATA';

export type DirectionalBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';

export type IndicatorFamilyId =
  | 'ema'
  | 'rsi'
  | 'macd'
  | 'adx'
  | 'bollinger'
  | 'stochRsi'
  | 'obv'
  | 'vwap'
  | 'rvol'
  | 'atr';

export interface IndicatorWeights {
  ema: number;
  macd: number;
  rsi: number;
  adx: number;
  bollinger: number;
  stochRsi: number;
  obv: number;
  vwap: number;
  rvol: number;
}

export interface IndicatorFamilyResult {
  id: IndicatorFamilyId;
  name: string;
  role: 'directional' | 'volatility_modifier';
  evidence: number; // [-1, +1] for directional, [0, 1] quality modifier for ATR
  weight: number;
  effectiveWeight: number;
  bias: DirectionalBias;
  available: boolean;
  sufficiencyNote: string | null;
  summary: string;
  rules: string[];
  rawValues: Record<string, number | string | boolean | null>;
  candleTimestamp: number;
}

export interface IndicatorSeriesPack {
  ema9: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema100: (number | null)[];
  ema200: (number | null)[];
  rsi14: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  adx14: (number | null)[];
  plusDi14: (number | null)[];
  minusDi14: (number | null)[];
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
  bbBandwidth: (number | null)[];
  stochRsiK: (number | null)[];
  stochRsiD: (number | null)[];
  obv: number[];
  vwap: (number | null)[];
  rvol20: (number | null)[];
  atr14: (number | null)[];
  atrPct: (number | null)[];
}

export type TrendRegime =
  | 'Strong Uptrend'
  | 'Moderate Uptrend'
  | 'Sideways / Range'
  | 'Moderate Downtrend'
  | 'Strong Downtrend'
  | 'Transition / Uncertain';

export type VolatilityRegime = 'High Volatility' | 'Normal Volatility' | 'Low Volatility';

export interface MarketRegimeReport {
  trendRegime: TrendRegime;
  volatilityRegime: VolatilityRegime;
  combinedLabel: string;
  triggers: string[];
  metrics: {
    adx: number | null;
    emaAlignment: string;
    priceSlopePct: number | null;
    atrPct: number | null;
    realizedVolPct: number | null;
    bbBandwidthPct: number | null;
    rvol: number | null;
  };
}

export interface SignalAgreement {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  unavailableCount: number;
  totalDirectional: number;
  agreementPct: number;
  coveragePct: number;
}

export interface SignalTakeProfitTarget {
  label: 'TP1' | 'TP2' | 'TP3';
  price: number;
  pctFromEntry: number;
  rrRatio: number;
}

export interface SignalSetupPlan {
  symbol: string; // Compact ticker e.g. BTCUSDT
  direction: 'BUY' | 'SELL' | 'WAIT';
  directionLabel: 'BUY (LONG)' | 'SELL (SHORT)' | 'NEUTRAL (WAIT)';
  entryMode: 'NOW' | 'ZONE';
  entryPrice: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stopLoss: number | null;
  stopLossPct: number | null;
  takeProfits: SignalTakeProfitTarget[];
  riskRewardTp2: number | null;
  atr14: number | null;
  methodology: string;
}

export interface SignalReport {
  canonicalId: string;
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  timeframe: Timeframe;
  status: 'CONFIRMED' | 'PROVISIONAL';
  classification: SignalClassification;
  label: string;
  directionalScore: number; // -100 to +100
  rawWeightedScore: number;
  volatilityModifier: number; // 0.5 to 1.0
  agreement: SignalAgreement;
  dataQuality: 'HIGH' | 'MODERATE' | 'LOW' | 'INSUFFICIENT';
  signalStability: 'STABLE' | 'TRANSITIONING' | 'VOLATILE';
  historicalReliability: string; // "Not calibrated" unless out-of-sample validated
  regime: MarketRegimeReport;
  indicators: IndicatorFamilyResult[];
  marketCondition: {
    dominantDirection: string;
    momentumState: string;
    volumeConfirmation: string;
    volatilityCondition: string;
    trendStrength: string;
    structureStatus: string;
  };
  supportingEvidence: string[];
  contradictoryEvidence: string[];
  invalidationConditions: string[];
  safeguardNotes: string[];
  signalSetup: SignalSetupPlan;
  metadata: {
    candleClosePrice: number | null;
    lastCompletedCandleTime: number | null;
    calculatedAt: number;
    candleCount: number;
    freshness: DataFreshness;
    engineVersion: string;
    configVersion: string;
  };
}

export interface DualSignalResponse {
  confirmed: SignalReport;
  provisional: SignalReport | null;
  series: IndicatorSeriesPack;
  patterns: PatternDetection[];
  supportResistance: SupportResistanceZone[];
  validation: HistoricalValidationSummary;
}

export interface MultiTimeframeRow {
  timeframe: Timeframe;
  classification: SignalClassification;
  label: string;
  directionalScore: number;
  trendStrength: string;
  bullishCount: number;
  bearishCount: number;
  totalActive: number;
  agreementPct: number;
  rsi: number | null;
  adx: number | null;
  regime: string;
  available: boolean;
  error?: string;
}

export interface MultiTimeframeSummary {
  rows: MultiTimeframeRow[];
  alignmentSummary: string;
  conflictWarnings: string[];
  consistencyScore: number;
  higherTimeframeContext: string;
}

export interface PatternDetection {
  id: string;
  name: string;
  category: 'candlestick' | 'structural';
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  timeframe: Timeframe;
  startTimestamp: number;
  confirmationTimestamp: number | null;
  status: 'CONFIRMED' | 'FORMING';
  priceBoundaries: {
    upper: number;
    lower: number;
    breakoutLevel?: number;
  };
  detectionMethod: string;
  invalidationCriteria: string;
  qualityScore: number; // 0-100 structural fit score
  qualityMeaning: string;
}

export interface SupportResistanceZone {
  id: string;
  type: 'SUPPORT' | 'RESISTANCE';
  price: number;
  zoneLow: number;
  zoneHigh: number;
  distancePct: number;
  touches: number;
  firstTouchTime: number;
  lastTouchTime: number;
  ageBars: number;
  status: 'ACTIVE' | 'TESTING' | 'BROKEN';
}

export interface SignalEventRecord {
  id: string;
  canonicalId: string;
  displaySymbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  eventType: string;
  classification: SignalClassification;
  directionalScore: number;
  agreementPct: number;
  candleTimestamp: number;
  triggeredAt: number;
  summary: string;
  indicatorChanges: string[];
  signalSetup?: SignalSetupPlan | null;
}

export interface HistoricalHorizonMetric {
  horizonBars: number;
  observations: number;
  directionalAccuracyPct: number | null;
  avgForwardReturnPct: number | null;
  medianForwardReturnPct: number | null;
  avgMaxFavorablePct: number | null;
  avgMaxAdversePct: number | null;
  sufficientSample: boolean;
}

export interface HistoricalValidationSummary {
  canonicalId: string;
  timeframe: Timeframe;
  totalConfirmedSignals: number;
  classDistribution: Record<SignalClassification, number>;
  horizons: HistoricalHorizonMetric[];
  regimeBreakdown: {
    regime: string;
    observations: number;
    directionalAccuracyPct: number | null;
    avgForwardReturn5Pct: number | null;
  }[];
  methodologyNote: string;
  insufficientHistoryWarning: string | null;
}

export interface DerivativesMarket {
  canonicalId: string;
  exchange: ExchangeId;
  displaySymbol: string;
  nativeSymbol: string;
  lastPrice: number;
  markPrice: number;
  indexPrice: number;
  premiumPct: number;
  fundingRate: number;
  fundingRatePct: number;
  nextFundingTime: number;
  openInterest: number;
  openInterestValueUsd: number;
  volume24hUsd: number;
  change24hPct: number;
  longShortRatio: number | null;
  buyRatio: number | null;
  sellRatio: number | null;
  observation: string;
  timestamp: number;
  source: string;
}

export interface DefiChainSummary {
  name: string;
  tokenSymbol: string | null;
  tvl: number;
  sharePct: number;
}

export interface DefiProtocolSummary {
  name: string;
  symbol: string;
  category: string;
  chains: string[];
  tvl: number;
  change1d: number | null;
  change7d: number | null;
  url: string;
}

export interface DefiOverview {
  totalTvl: number;
  tvlChange24hPct: number | null;
  chains: DefiChainSummary[];
  protocols: DefiProtocolSummary[];
  historicalTvl: { date: number; tvl: number }[];
  stablecoinTotalUsd: number | null;
  dexVolume24hUsd: number | null;
  source: string;
  updatedAt: number;
  unavailableMetrics: string[];
}

export interface ScreenerRow {
  canonicalId: string;
  displaySymbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  price: number;
  change24hPct: number;
  volume24hUsd: number;
  spreadPct: number | null;
  classification: SignalClassification;
  directionalScore: number;
  agreementPct: number;
  rsi14: number | null;
  macdHist: number | null;
  macdCross: 'BULLISH' | 'BEARISH' | 'NONE';
  adx14: number | null;
  rvol20: number | null;
  atrPct: number | null;
  bbSqueeze: boolean;
  bbExpanding: boolean;
  aboveEma20: boolean | null;
  aboveEma50: boolean | null;
  aboveEma200: boolean | null;
  emaCross: 'GOLDEN' | 'DEATH' | 'BULLISH_20_50' | 'BEARISH_20_50' | 'NONE';
  rsiDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  obvDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  nearSupport: boolean;
  nearResistance: boolean;
  regime: string;
  signalSetup?: SignalSetupPlan | null;
  updatedAt: number;
}

export interface ScreenerFilters {
  exchange?: ExchangeId | 'all';
  marketType?: MarketType | 'all';
  quoteAsset?: string;
  timeframe?: Timeframe;
  minPrice?: number;
  maxPrice?: number;
  minChange24h?: number;
  maxChange24h?: number;
  minVolume24h?: number;
  minRsi?: number;
  maxRsi?: number;
  minAdx?: number;
  minRvol?: number;
  minAtrPct?: number;
  maxAtrPct?: number;
  aboveEma20?: boolean;
  aboveEma50?: boolean;
  aboveEma200?: boolean;
  emaCross?: string;
  macdCross?: string;
  macdHistDirection?: 'POSITIVE' | 'NEGATIVE';
  bbSqueeze?: boolean;
  bbExpanding?: boolean;
  rsiDivergence?: 'BULLISH' | 'BEARISH';
  obvDivergence?: 'BULLISH' | 'BEARISH';
  nearSupport?: boolean;
  nearResistance?: boolean;
  classifications?: SignalClassification[];
  minAgreementPct?: number;
  presetId?: string;
}

export interface ScreenerPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  filters: ScreenerFilters;
  isBuiltIn: boolean;
}

export type AlertConditionType =
  | 'PRICE_ABOVE'
  | 'PRICE_BELOW'
  | 'PCT_CHANGE_ABOVE'
  | 'PCT_CHANGE_BELOW'
  | 'RVOL_ABOVE'
  | 'RSI_BELOW'
  | 'RSI_ABOVE'
  | 'MACD_BULLISH_CROSS'
  | 'MACD_BEARISH_CROSS'
  | 'EMA_BULLISH_CROSS'
  | 'EMA_BEARISH_CROSS'
  | 'SIGNAL_STRONG_BULLISH'
  | 'SIGNAL_STRONG_BEARISH'
  | 'SIGNAL_CHANGED'
  | 'ADX_ABOVE'
  | 'PRICE_ABOVE_VWAP'
  | 'PRICE_BELOW_VWAP'
  | 'FUNDING_ABOVE'
  | 'FUNDING_BELOW';

export interface AlertRule {
  id: string;
  canonicalId: string;
  displaySymbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  condition: AlertConditionType;
  threshold: number | null;
  enabled: boolean;
  cooldownMinutes: number;
  recurring: boolean;
  webhookUrl: string | null;
  lastTriggeredAt: number | null;
  createdAt: number;
}

export interface AlertEventRecord {
  id: string;
  ruleId: string;
  canonicalId: string;
  displaySymbol: string;
  timeframe: Timeframe;
  condition: AlertConditionType;
  message: string;
  triggeredValue: number | null;
  triggeredAt: number;
  acknowledged: boolean;
}

export type AIProviderType =
  | 'openai'
  | 'openai_compatible'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'ollama';

export interface AIProviderProfile {
  id: string;
  name: string;
  providerType: AIProviderType;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  enabled: boolean;
  storageMode: 'session' | 'encrypted_local';
  hasKeyStored?: boolean;
}

export interface ProviderStatus {
  id: ExchangeId | 'defillama' | 'alternative_me';
  name: string;
  status: DataFreshness;
  wsConnected: boolean;
  lastRestSuccessAt: number | null;
  lastWsMessageAt: number | null;
  latencyMs: number | null;
  requestCount: number;
  errorCount: number;
  lastError: string | null;
  supportedMarkets: MarketType[];
}

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system';
  timezone: 'UTC' | 'local';
  decimalPrecision: 'auto' | 2 | 4 | 6;
  defaultExchange: ExchangeId;
  defaultMarketType: MarketType;
  defaultPair: string;
  defaultTimeframe: Timeframe;
  denseMode: boolean;
  sidebarCollapsed: boolean;
  defaultChartMode: '2d' | '3d';
  showLiveProvisional: boolean;
  reducedMotion: boolean;
  weights: IndicatorWeights;
  thresholds: {
    strongBullish: number;
    bullish: number;
    bearish: number;
    strongBearish: number;
  };
  minCoveragePct: number;
  minAgreementForStrongPct: number;
}

export interface MarketOverviewPayload {
  fearAndGreed: {
    value: number;
    classification: string;
    timestamp: number;
    source: string;
  } | null;
  exchangeCoverageNote: string;
  aggregateStats: {
    trackedAssets: number;
    analyzedAssets: number;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    breadthScore: number; // -100 to +100
    exchangeVolume24hUsd: number;
    btcDominanceProxy: number | null;
    ethDominanceProxy: number | null;
    aboveEma50Pct: number;
    aboveEma200Pct: number;
  };
  marketPulse: {
    overallBias: string;
    btcTrend: string;
    ethTrend: string;
    volumeCondition: string;
    volatilityRegime: string;
    sentiment: string;
    freshness: DataFreshness;
  };
  topGainers: MarketTicker[];
  topLosers: MarketTicker[];
  highestVolume: MarketTicker[];
  unusualVolume: ScreenerRow[];
  strongestMomentum: ScreenerRow[];
  strongestDowntrend: ScreenerRow[];
  leaders: {
    ticker: MarketTicker;
    sparkline: number[];
    signal: SignalClassification;
    score: number;
  }[];
  recentSignals: SignalEventRecord[];
  updatedAt: number;
}

// =========================================================================
// AUTONOMOUS PAPER-TRADING BOT & STRATEGY ARENA
// =========================================================================

export type PaperBotDirectionMode = 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY';
export type PaperSide = 'LONG' | 'SHORT';
export type PaperPositionStatus = 'OPEN' | 'CLOSED';

export interface PaperAccountConfig {
  startingBalanceUsd: number;
  cashBalanceUsd: number;
  maxRiskPerTradePct: number;
  maxOpenPositions: number;
  maxDailyDrawdownPct: number;
  defaultLeverage: number;
  feeBps: number;
  slippageBps: number;
  killSwitchTriggered: boolean;
  killSwitchReason: string | null;
  dailyStartEquityUsd: number;
  dailyResetDay: string;
  updatedAt: number;
}

export interface PaperStrategyBot {
  id: string;
  name: string;
  description: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  enabled: boolean;
  directionMode: PaperBotDirectionMode;
  minScore: number;
  minAgreementPct: number;
  riskPerTradePct: number;
  leverage: number;
  trailingStopAtrMult: number | null;
  partialTp1Pct: number;
  cooldownMinutes: number;
  lastRunAt: number | null;
  lastActionNote: string | null;
  createdAt: number;
}

export interface PaperPosition {
  id: string;
  botId: string | null;
  botName: string;
  canonicalId: string;
  exchange: ExchangeId;
  marketType: MarketType;
  displaySymbol: string;
  timeframe: Timeframe;
  side: PaperSide;
  status: PaperPositionStatus;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  remainingQuantity: number;
  notionalUsd: number;
  marginUsd: number;
  leverage: number;
  stopLoss: number | null;
  initialStopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp1Hit: boolean;
  trailingAtr: number | null;
  feesPaidUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  entryReason: string;
  exitReason: string | null;
  openedAt: number;
  closedAt: number | null;
}

export interface PaperEquityPoint {
  id: number;
  timestamp: number;
  equityUsd: number;
  cashUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  openCount: number;
}

export interface PaperBotLogRecord {
  id: string;
  botId: string | null;
  botName: string;
  level: 'INFO' | 'TRADE' | 'WARN';
  message: string;
  timestamp: number;
}

export interface PaperBotLeaderboardRow {
  botId: string;
  botName: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  enabled: boolean;
  openCount: number;
  closedCount: number;
  wins: number;
  winRatePct: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
}

export interface PaperArenaSnapshot {
  account: PaperAccountConfig;
  metrics: {
    totalEquityUsd: number;
    marginUsedUsd: number;
    unrealizedPnlUsd: number;
    realizedPnlUsd: number;
    totalPnlUsd: number;
    totalPnlPct: number;
    dailyDrawdownPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    profitFactor: number | null;
    avgRMultiple: number | null;
    openPositionsCount: number;
    closedTradesCount: number;
    totalFeesUsd: number;
    activeBotsCount: number;
  };
  bots: PaperStrategyBot[];
  openPositions: PaperPosition[];
  closedTrades: PaperPosition[];
  equityCurve: PaperEquityPoint[];
  botLeaderboard: PaperBotLeaderboardRow[];
  recentLogs: PaperBotLogRecord[];
  lastCycleAt: number | null;
  timestamp: number;
}
