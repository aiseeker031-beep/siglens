import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react';
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Cpu,
  Filter,
  Grid2x2,
  Home,
  Lock,
  Radio,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api } from '../services/api';
import { EXCHANGE_LABELS } from '../shared/constants';
import { formatCompactUsd, formatPercent, formatPrice } from '../shared/format';
import type {
  ArbitrageScanPayload,
  ExchangeId,
  MarketOverviewPayload,
  MarketTicker,
  MarketType,
  NavSection,
  PaperArenaSnapshot,
} from '../shared/types';
import { GoogleAuthButton } from '../components/ui/GoogleAuthButton';
import {
  KINETIC_EASE,
  KINETIC_SPRING,
  KineticMeterBar,
  KineticSegmentedControl,
  MiniSparkBars,
} from '../components/ui/Kinetic';

type ShowcaseClass = 'crypto' | 'stocks' | 'cfds';

const SHOWCASE_TABS: { value: ShowcaseClass; label: string }[] = [
  { value: 'crypto', label: 'Crypto Spot' },
  { value: 'stocks', label: 'US Stocks & ETFs' },
  { value: 'cfds', label: 'Global CFDs' },
];

const WORKSPACE_MODULES: {
  num: string;
  section: NavSection;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'dark' | 'sage' | 'light';
  span?: string;
  tag?: string;
}[] = [
  {
    num: '01',
    section: 'overview',
    title: 'Home Overview & Market Pulse',
    subtitle: 'Unified Multi-Asset Command Deck',
    description:
      'Live breadth gauge, Fear & Greed telemetry, 24h leader sparklines, interactive candlestick workspace, and instant regime readout.',
    icon: Home,
    tone: 'dark',
    span: 'lg:col-span-6',
    tag: 'CORE',
  },
  {
    num: '02',
    section: 'arbitrage',
    title: 'Real-Time Arbitrage Scanner',
    subtitle: 'Cross-Exchange Spot & Stat-Arb Z-Score',
    description:
      'Detects live ask-to-bid price spreads across Binance, Kraken & Coinbase alongside 1h cointegrated Z-score pair divergences.',
    icon: ArrowLeftRight,
    tone: 'sage',
    span: 'lg:col-span-6',
    tag: 'LIVE',
  },
  {
    num: '03',
    section: 'markets',
    title: 'Multi-Asset Markets',
    subtitle: 'Crypto · US Equities · Global CFDs',
    description:
      'Search and sort hundreds of live liquid spot pairs, perpetuals, top US stocks/ETFs, and global indices, metals & FX.',
    icon: BarChart3,
    tone: 'light',
    span: 'lg:col-span-4',
  },
  {
    num: '04',
    section: 'signals',
    title: '10-Indicator Signal Engine',
    subtitle: 'Deterministic Entry, SL & TP1–TP3',
    description:
      'Pure mathematical scoring across trend, momentum, volume, and ATR volatility with full supporting & invalidation rules.',
    icon: Radio,
    tone: 'light',
    span: 'lg:col-span-4',
  },
  {
    num: '05',
    section: 'demo',
    title: 'Pro Demo Trade Terminal',
    subtitle: 'Live Charts & Simulated Execution',
    description:
      'Trade Crypto, US Stocks, and Global CFDs on full-width live candlestick charts with up to 50x leverage, Limit/Market orders, and live TP/SL lines.',
    icon: Bot,
    tone: 'light',
    span: 'lg:col-span-4',
    tag: 'DEMO',
  },
  {
    num: '06',
    section: 'screener',
    title: '20-Preset Screener',
    subtitle: 'Breakouts, Squeezes & Divergences',
    description:
      'Run institutional preset filters or build custom multi-indicator screens with instant server-side scanning.',
    icon: Filter,
    tone: 'light',
    span: 'lg:col-span-4',
  },
  {
    num: '07',
    section: 'heatmaps',
    title: 'Heatmaps & Correlations',
    subtitle: 'Breadth, Normalized Returns & Pearson',
    description:
      'Spot capital rotation and cross-asset correlation clusters across timeframes with interactive visual matrices.',
    icon: Grid2x2,
    tone: 'light',
    span: 'lg:col-span-4',
  },
  {
    num: '08',
    section: 'ai',
    title: 'BYOK AI Research & Alerts',
    subtitle: 'Grounded Explainability + Webhooks',
    description:
      'Bring your own OpenAI, Anthropic, Gemini, Groq, or Ollama key encrypted locally in-browser to interrogate verified signal JSON.',
    icon: Sparkles,
    tone: 'light',
    span: 'lg:col-span-4',
  },
];

const INDICATOR_FACTORS = [
  { name: 'EMA Ribbon (9/20/50/100/200)', role: 'Trend Alignment', weight: 18 },
  { name: 'MACD (12, 26, 9)', role: 'Momentum Impulse', weight: 14 },
  { name: 'ADX + DI+/DI- (14)', role: 'Directional Strength', weight: 12 },
  { name: 'RSI (14) + Divergence', role: 'Overbought / Oversold', weight: 12 },
  { name: 'VWAP Institutional Anchor', role: 'Fair Value Positioning', weight: 12 },
  { name: 'OBV & RVOL (20)', role: 'Volume Confirmation', weight: 14 },
  { name: 'Bollinger Squeeze + StochRSI', role: 'Volatility & Timing', weight: 18 },
];

const BOT_PIPELINE = [
  {
    step: '01',
    title: 'Continuous Signal Scan',
    desc: 'Runs every 35 seconds in-memory plus a 5-minute cPanel cron tick to evaluate confirmed candle closes.',
  },
  {
    step: '02',
    title: 'Risk-Based Sizing',
    desc: 'Computes exact position size from stop-loss distance, max risk %, configurable leverage, fees & slippage.',
  },
  {
    step: '03',
    title: 'TP1 Breakeven & Trail',
    desc: 'Scales out partially at TP1, shifts stop-loss to breakeven automatically, and trails winners using ATR.',
  },
  {
    step: '04',
    title: 'Drawdown Kill-Switch',
    desc: 'Enforces daily drawdown ceiling with one-click Emergency Flatten to close all open risk instantaneously.',
  },
];

const LandingMark: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <motion.svg
    viewBox="0 0 40 40"
    fill="none"
    className={className}
    aria-hidden="true"
    whileHover={{ rotate: 30, scale: 1.06 }}
    transition={KINETIC_SPRING}
  >
    <defs>
      <linearGradient id="landingSiglensGrad" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4ADE80" />
        <stop offset="100%" stopColor="#16A34A" />
      </linearGradient>
    </defs>
    <path d="M18.6 4.2L7.2 10.8L18.6 17.4V4.2Z" fill="url(#landingSiglensGrad)" />
    <path d="M21.4 4.2V17.4L32.8 10.8L21.4 4.2Z" fill="url(#landingSiglensGrad)" opacity="0.92" />
    <path d="M34.2 13.2L22.8 19.8L34.2 26.4V13.2Z" fill="url(#landingSiglensGrad)" opacity="0.84" />
    <path d="M21.4 22.6V35.8L32.8 29.2L21.4 22.6Z" fill="url(#landingSiglensGrad)" />
    <path d="M18.6 35.8V22.6L7.2 29.2L18.6 35.8Z" fill="url(#landingSiglensGrad)" opacity="0.9" />
    <path d="M5.8 26.4L17.2 19.8L5.8 13.2V26.4Z" fill="url(#landingSiglensGrad)" opacity="0.82" />
  </motion.svg>
);

export const LandingPage: React.FC<{
  onLaunchApp: (section?: NavSection) => void;
  onInspectAsset: (exchange: ExchangeId, marketType: MarketType, symbol: string) => void;
  authNotice?: string | null;
  onDismissAuthNotice?: () => void;
}> = ({ onLaunchApp, onInspectAsset, authNotice, onDismissAuthNotice }) => {
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 28,
    restDelta: 0.001,
  });

  const [overview, setOverview] = useState<MarketOverviewPayload | null>(null);
  const [arb, setArb] = useState<ArbitrageScanPayload | null>(null);
  const [paper, setPaper] = useState<PaperArenaSnapshot | null>(null);

  const [showcaseClass, setShowcaseClass] = useState<ShowcaseClass>('crypto');
  const [marketsByClass, setMarketsByClass] = useState<Record<ShowcaseClass, MarketTicker[]>>({
    crypto: [],
    stocks: [],
    cfds: [],
  });
  const [loadingMarkets, setLoadingMarkets] = useState(false);

  // Fetch real live snapshots independently so Hero prices paint immediately without waiting for slower scans
  useEffect(() => {
    let active = true;
    api
      .getOverview('binance', 'spot')
      .then((ov) => {
        if (active) setOverview(ov);
      })
      .catch(() => {});
    api
      .getArbitrage(20)
      .then((arbRes) => {
        if (active) setArb(arbRes);
      })
      .catch(() => {});
    api
      .getPaperState(false)
      .then((paperRes) => {
        if (active) setPaper(paperRes);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Fetch live tickers for active Section 3 asset class
  useEffect(() => {
    if (marketsByClass[showcaseClass].length > 0) return;
    let active = true;
    setLoadingMarkets(true);
    const exchange: ExchangeId =
      showcaseClass === 'stocks' ? 'stocks' : showcaseClass === 'cfds' ? 'cfds' : 'binance';
    const marketType: MarketType =
      showcaseClass === 'stocks' ? 'equity' : showcaseClass === 'cfds' ? 'cfd' : 'spot';

    api
      .getMarkets(exchange, marketType)
      .then((res) => {
        if (!active) return;
        const sorted = [...res.markets]
          .filter((m) => m.lastPrice > 0)
          .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
          .slice(0, 8);
        setMarketsByClass((prev) => ({ ...prev, [showcaseClass]: sorted }));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingMarkets(false);
      });
    return () => {
      active = false;
    };
  }, [showcaseClass, marketsByClass]);

  const primaryLeader = overview?.leaders[0] ?? null;
  const topMomentum = overview?.strongestMomentum[0] ?? null;
  const topArb = arb?.opportunities[0] ?? null;
  const ribbonTickers = useMemo(() => {
    const list = overview?.highestVolume ?? marketsByClass.crypto;
    return list.slice(0, 12);
  }, [overview, marketsByClass.crypto]);

  const showcaseRows = marketsByClass[showcaseClass];

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[#F4F6F5] text-[#111814] selection:bg-[#22C55E]/25">
      {/* Kinetic Scroll Progress Hairline */}
      <motion.div
        style={{ scaleX: smoothProgress, transformOrigin: '0% 50%' }}
        className="fixed top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-[#16A34A] via-[#22C55E] to-[#4ADE80] z-[70]"
      />

      {/* Sticky Minimal Navigation Bar */}
      <header className="sticky top-0 z-50 bg-[#F4F6F5]/85 backdrop-blur-xl border-b border-[#E4EAE6]/80">
        <div className="max-w-[1280px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-4">
          <a href="#hero" className="flex items-center gap-2 shrink-0">
            <LandingMark className="w-7 h-7 sm:w-8 sm:h-8" />
            <div>
              <span className="text-sm sm:text-[15px] font-black tracking-[0.07em] text-[#111814] block leading-none">
                SIGLENS
              </span>
              <span className="hidden sm:block text-[10px] text-[#637369] mt-0.5">
                Multi-Asset Intelligence
              </span>
            </div>
          </a>

          <nav
            aria-label="Landing Sections"
            className="hidden lg:flex items-center gap-6 text-xs font-semibold text-[#55665C]"
          >
            <a href="#capabilities" className="hover:text-[#111814] transition-colors">
              Capabilities
            </a>
            <a href="#markets" className="hover:text-[#111814] transition-colors">
              Multi-Asset
            </a>
            <a href="#arbitrage" className="hover:text-[#111814] transition-colors">
              Arbitrage &amp; Math
            </a>
            <a href="#demo" className="hover:text-[#111814] transition-colors">
              Demo Trade
            </a>
            <a href="#architecture" className="hover:text-[#111814] transition-colors">
              Architecture
            </a>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <GoogleAuthButton
              compact
              label="Sign in"
              onContinueToApp={() => onLaunchApp('overview')}
            />
            <button
              type="button"
              onClick={() => onLaunchApp('overview')}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full sig-btn-primary text-xs font-semibold whitespace-nowrap"
            >
              <span>Launch App</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#4ADE80]" />
            </button>
          </div>
        </div>
      </header>

      {/* Optional Auth Error Banner (honest reporting if OAuth callback returned an error) */}
      <AnimatePresence>
        {authNotice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-3"
          >
            <div className="rounded-2xl bg-[#121814] text-white px-4 py-2.5 text-xs flex items-center justify-between gap-3 border border-[#22C55E]/30">
              <span>{authNotice}</span>
              {onDismissAuthNotice && (
                <button
                  type="button"
                  onClick={onDismissAuthNotice}
                  className="text-[#8FA899] hover:text-white font-semibold shrink-0"
                >
                  Dismiss
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* =================================================================
          SECTION 1: ASYMMETRIC KINETIC HERO & LIVE SIGNAL CANVAS
      ================================================================= */}
      <section id="hero" className="relative overflow-x-clip pt-12 sm:pt-16 pb-10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
            {/* Left Editorial Column */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: KINETIC_EASE }}
              className="lg:col-span-7 space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#DCE5DF] shadow-xs text-[11px] font-semibold text-[#111814]">
                <span className="relative flex h-2 w-2">
                  <span className="sig-sonar-ring absolute inline-flex h-full w-full rounded-full bg-[#22C55E]" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#16A34A]" />
                </span>
                <span>Live Crypto · US Equities · Global CFDs · Arbitrage</span>
              </div>

              <h1 className="text-4xl sm:text-6xl font-black tracking-[-0.03em] leading-[1.03] text-[#111814]">
                See Beyond the{' '}
                <span className="text-[#16A34A]">Market</span>
                <span className="block text-[#55665C] font-medium text-2xl sm:text-4xl mt-2 tracking-[-0.02em]">
                  Deterministic quant signals, real-time arbitrage &amp; autonomous paper bots.
                </span>
              </h1>

              <p className="text-sm sm:text-base text-[#55665C] max-w-xl leading-relaxed">
                SIGLENS unifies live exchange feeds, 10-indicator scoring, cross-venue arbitrage detection, and 24/7 autonomous paper-trading strategies inside one kinetic Swiss workspace — powered by real public market APIs.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <motion.button
                  type="button"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onLaunchApp('overview')}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full sig-btn-primary text-sm font-semibold"
                >
                  <span>Launch Dashboard</span>
                  <ArrowRight className="w-4 h-4 text-[#4ADE80]" />
                </motion.button>

                <GoogleAuthButton onContinueToApp={() => onLaunchApp('overview')} />

                <button
                  type="button"
                  onClick={() => onLaunchApp('arbitrage')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-[#111814] hover:bg-white/80 transition-colors"
                >
                  <span>Live Arbitrage</span>
                  <ArrowUpRight className="w-4 h-4 text-[#16A34A]" />
                </button>
              </div>

              {/* Minimal Real-Time Telemetry Strip */}
              <div className="grid grid-cols-3 gap-4 pt-5 border-t border-[#E2E8E4] max-w-lg">
                <div>
                  <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-[#111814]">
                    {overview ? overview.aggregateStats.trackedAssets : '—'}
                  </div>
                  <div className="text-[11px] text-[#637369] mt-0.5">Live Liquid Pairs</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-[#16A34A]">
                    {arb ? arb.opportunities.length : '—'}
                  </div>
                  <div className="text-[11px] text-[#637369] mt-0.5">Cross-Venue Spreads</div>
                </div>
                <div>
                  <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-[#111814]">
                    10
                  </div>
                  <div className="text-[11px] text-[#637369] mt-0.5">Quant Indicators</div>
                </div>
              </div>
            </motion.div>

            {/* Right Kinetic Layered Live Visual Stack */}
            <div className="lg:col-span-5 relative">
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.55, delay: 0.1, ease: KINETIC_EASE }}
                className="space-y-3.5"
              >
                {/* Primary Dark Obsidian Market Card */}
                <div className="sig-card-dark rounded-3xl p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7D9486]">
                        Live Primary Benchmark
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-2.5">
                        <span className="text-2xl sm:text-3xl font-black font-mono tabular-nums text-white">
                          {primaryLeader
                            ? `$${formatPrice(primaryLeader.ticker.lastPrice)}`
                            : 'Syncing live...'}
                        </span>
                        {primaryLeader && (
                          <span
                            className={`text-xs font-mono font-bold ${
                              primaryLeader.ticker.change24hPct >= 0
                                ? 'text-[#4ADE80]'
                                : 'text-[#FB7185]'
                            }`}
                          >
                            {formatPercent(primaryLeader.ticker.change24hPct)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#9DB2A5] mt-1">
                        {primaryLeader
                          ? `${primaryLeader.ticker.displaySymbol} · ${overview?.marketPulse.btcTrend ?? 'Live'}`
                          : 'Connected to Binance public stream'}
                      </div>
                    </div>
                    <MiniSparkBars
                      values={primaryLeader?.sparkline.slice(-5) ?? [40, 62, 54, 78, 70]}
                      variant="dark-emerald"
                    />
                  </div>

                  {overview && (
                    <div className="mt-5 pt-4 border-t border-white/[0.08] space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#8FA899]">Market Breadth Score</span>
                        <span className="font-mono font-bold text-[#4ADE80]">
                          {overview.aggregateStats.breadthScore >= 0 ? '+' : ''}
                          {overview.aggregateStats.breadthScore} · {overview.marketPulse.overallBias}
                        </span>
                      </div>
                      <KineticMeterBar
                        pct={Math.max(5, Math.min(100, (overview.aggregateStats.breadthScore + 100) / 2))}
                        barClassName="bg-[#22C55E]"
                        trackClassName="bg-white/10"
                      />
                    </div>
                  )}
                </div>

                {/* Overlapping Kinetic Row: Live Signal + Live Arbitrage */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <motion.button
                    type="button"
                    whileHover={{ y: -3 }}
                    transition={KINETIC_SPRING}
                    onClick={() => onLaunchApp('signals')}
                    className="sig-signal-buy p-4 text-left"
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-[#86EFAC]">
                      <span>Top Momentum Signal</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </div>
                    <div className="mt-2 font-mono text-base font-black text-white">
                      {topMomentum ? topMomentum.displaySymbol : 'Scanning...'}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-[#B7D5C0]">
                      <span>{topMomentum ? `$${formatPrice(topMomentum.price)}` : '10-indicator score'}</span>
                      {topMomentum && (
                        <span className="text-[#4ADE80] font-bold">
                          Score {topMomentum.directionalScore > 0 ? '+' : ''}
                          {topMomentum.directionalScore}
                        </span>
                      )}
                    </div>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileHover={{ y: -3 }}
                    transition={KINETIC_SPRING}
                    onClick={() => onLaunchApp('arbitrage')}
                    className="sig-card-sage rounded-2xl p-4 text-left"
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em] text-[#354E3E]">
                      <span>Live Arbitrage Edge</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </div>
                    <div className="mt-2 font-mono text-base font-black text-[#101A13]">
                      {topArb
                        ? `${topArb.baseAsset} +${topArb.grossSpreadPct.toFixed(2)}%`
                        : 'Scanning venues...'}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-[#354E3E] truncate">
                      {topArb
                        ? `${EXCHANGE_LABELS[topArb.buyExchange]} → ${EXCHANGE_LABELS[topArb.sellExchange]}`
                        : 'Binance · Kraken · Coinbase'}
                    </div>
                  </motion.button>
                </div>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Continuous Kinetic Live Market Ticker Ribbon */}
        {ribbonTickers.length >= 4 && (
          <div className="mt-12 border-y border-[#E2E8E4] bg-white/75 backdrop-blur-sm overflow-hidden">
            <div className="sig-marquee-track py-2.5">
              {[...ribbonTickers, ...ribbonTickers].map((t, idx) => {
                const pos = t.change24hPct >= 0;
                return (
                  <button
                    key={`${t.canonicalId}-${idx}`}
                    type="button"
                    onClick={() => onInspectAsset(t.exchange, t.marketType, t.displaySymbol)}
                    className="inline-flex items-center gap-2.5 px-5 border-r border-[#EDF1EE] hover:bg-[#F3F6F4] transition-colors font-mono text-xs tabular-nums whitespace-nowrap"
                  >
                    <span className="font-bold text-[#111814]">{t.displaySymbol}</span>
                    <span className="text-[#55665C]">${formatPrice(t.lastPrice)}</span>
                    <span className={`font-semibold ${pos ? 'text-[#16A34A]' : 'text-[#E11D48]'}`}>
                      {formatPercent(t.change24hPct)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* =================================================================
          SECTION 2: COMPLETE 8-WORKSPACE CAPABILITIES BENTO
      ================================================================= */}
      <section id="capabilities" className="py-16 sm:py-24">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 space-y-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, ease: KINETIC_EASE }}
            className="flex flex-col md:flex-row md:items-end justify-between gap-4"
          >
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#16A34A]">
                02 / Complete Workspace Architecture
              </div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.025em] text-[#111814] mt-2">
                Every quantitative tool, one cohesive terminal.
              </h2>
            </div>
            <p className="text-sm text-[#55665C] max-w-md">
              Click any capability module below to launch straight into that live workspace inside SIGLENS.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
            {WORKSPACE_MODULES.map((mod, idx) => {
              const Icon = mod.icon;
              const isDark = mod.tone === 'dark';
              const isSage = mod.tone === 'sage';
              return (
                <motion.button
                  key={mod.section}
                  type="button"
                  onClick={() => onLaunchApp(mod.section)}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.4, delay: idx * 0.04, ease: KINETIC_EASE }}
                  whileHover={{ y: -4 }}
                  className={`group text-left rounded-3xl p-6 flex flex-col justify-between gap-5 ${mod.span ?? 'lg:col-span-4'} ${
                    isDark
                      ? 'sig-card-dark'
                      : isSage
                        ? 'sig-card-sage'
                        : 'sig-glass sig-glass-interactive'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                          isDark
                            ? 'bg-[#22C55E] text-[#05140A]'
                            : isSage
                              ? 'bg-[#121814] text-[#4ADE80]'
                              : 'bg-[#EEF4F0] text-[#16A34A]'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-mono font-bold ${
                              isDark ? 'text-[#7D9486]' : isSage ? 'text-[#3E5245]' : 'text-[#7D8E84]'
                            }`}
                          >
                            {mod.num}
                          </span>
                          {mod.tag && (
                            <span
                              className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                                isDark
                                  ? 'bg-[#22C55E]/20 text-[#4ADE80]'
                                  : isSage
                                    ? 'bg-[#121814] text-[#4ADE80]'
                                    : 'bg-[#DCFCE7] text-[#15803D]'
                              }`}
                            >
                              {mod.tag}
                            </span>
                          )}
                        </div>
                        <h3
                          className={`text-base font-bold mt-0.5 ${
                            isDark ? 'text-white' : 'text-[#111814]'
                          }`}
                        >
                          {mod.title}
                        </h3>
                      </div>
                    </div>
                    <ArrowUpRight
                      className={`w-4 h-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${
                        isDark ? 'text-[#4ADE80]' : 'text-[#16A34A]'
                      }`}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div
                      className={`text-xs font-semibold ${
                        isDark ? 'text-[#B6C9BD]' : isSage ? 'text-[#283B2E]' : 'text-[#111814]'
                      }`}
                    >
                      {mod.subtitle}
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        isDark ? 'text-[#8FA899]' : isSage ? 'text-[#3E5245]' : 'text-[#637369]'
                      }`}
                    >
                      {mod.description}
                    </p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </section>

      {/* =================================================================
          SECTION 3: INTERACTIVE MULTI-ASSET ENGINE SHOWCASE
      ================================================================= */}
      <section id="markets" className="py-16 sm:py-24 bg-white border-y border-[#E5EAE7]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.45, ease: KINETIC_EASE }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#16A34A]">
                03 / Unified Multi-Asset Feeds
              </div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.025em] text-[#111814] mt-2">
                Switch asset classes with zero latency.
              </h2>
              <p className="text-sm text-[#55665C] mt-2 max-w-xl">
                Real live quotes pulled directly from Binance, Kraken, Coinbase, and Yahoo Finance. Click any instrument to open its live chart and indicator matrix.
              </p>
            </motion.div>

            <div className="max-w-full overflow-x-auto pb-1">
              <KineticSegmentedControl
                options={SHOWCASE_TABS}
                value={showcaseClass}
                onChange={setShowcaseClass}
                layoutId="landing-asset-showcase"
                variant="obsidian"
              />
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={showcaseClass}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: KINETIC_EASE }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
            >
              {loadingMarkets && showcaseRows.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl sig-skeleton" />
                ))
              ) : showcaseRows.length === 0 ? (
                <div className="col-span-full rounded-2xl bg-[#F4F6F5] border border-[#E5EAE7] p-8 text-center text-xs text-[#637369]">
                  Live market quotes are synchronizing from public exchange feeds.
                </div>
              ) : (
                showcaseRows.map((m) => {
                  const pos = m.change24hPct >= 0;
                  return (
                    <motion.button
                      key={m.canonicalId}
                      type="button"
                      whileHover={{ y: -3 }}
                      transition={KINETIC_SPRING}
                      onClick={() => onInspectAsset(m.exchange, m.marketType, m.displaySymbol)}
                      className="rounded-2xl border border-[#E5EAE7] bg-[#F8FAF9] hover:bg-white hover:border-[#C6D8C7] hover:shadow-md p-4 text-left transition-all flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-mono text-sm font-black text-[#111814]">
                            {m.displaySymbol}
                          </div>
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#7D8E84]">
                            {EXCHANGE_LABELS[m.exchange]} · {m.marketType}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold ${
                            pos
                              ? 'bg-[#DCFCE7] text-[#15803D]'
                              : 'bg-[#FFE4E6] text-[#BE123C]'
                          }`}
                        >
                          {formatPercent(m.change24hPct)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-lg font-bold tabular-nums text-[#111814]">
                          ${formatPrice(m.lastPrice)}
                        </span>
                        <span className="text-[10px] font-mono text-[#637369]">
                          Vol {formatCompactUsd(m.quoteVolume24h)}
                        </span>
                      </div>
                    </motion.button>
                  );
                })
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* =================================================================
          SECTION 4: ARBITRAGE ENGINE & 10-INDICATOR DETERMINISTIC MATH
      ================================================================= */}
      <section id="arbitrage" className="py-16 sm:py-24">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left: 10-Indicator Deterministic Math */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, ease: KINETIC_EASE }}
              className="lg:col-span-6 sig-glass rounded-3xl p-6 sm:p-7 space-y-6"
            >
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#16A34A]">
                  04 / Deterministic Signal Engine
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.025em] text-[#111814] mt-2">
                  Zero black-box guesses. Transparent weighted math.
                </h2>
                <p className="text-xs sm:text-sm text-[#55665C] mt-2 leading-relaxed">
                  Every signal score from -100 to +100 is computed strictly from closed OHLCV candles across 10 independent indicator families — automatically calculating Entry, Stop-Loss, and TP1–TP3 levels.
                </p>
              </div>

              <div className="space-y-3.5">
                {INDICATOR_FACTORS.map((item, i) => (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#111814]">{item.name}</span>
                      <span className="font-mono text-[11px] text-[#637369]">
                        {item.role} · {item.weight}%
                      </span>
                    </div>
                    <KineticMeterBar
                      pct={item.weight * 4.5}
                      delay={i * 0.05}
                      barClassName="bg-[#16A34A]"
                      trackClassName="bg-[#E8EEEA]"
                      heightClassName="h-1.5"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => onLaunchApp('signals')}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#16A34A] hover:underline"
              >
                Explore Live Signal Feed
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </motion.div>

            {/* Right: Live Real-Time Arbitrage Snapshot */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.45, delay: 0.08, ease: KINETIC_EASE }}
              className="lg:col-span-6 sig-card-dark rounded-3xl p-6 sm:p-7 space-y-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#4ADE80]">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    Real-Time Arbitrage Telemetry
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-black tracking-[-0.025em] text-white mt-2">
                    Live cross-venue spreads &amp; Z-score pairs.
                  </h3>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 text-[10px] font-mono font-bold text-[#4ADE80] shrink-0">
                  15S LIVE
                </span>
              </div>

              {/* Live Top 4 Cross-Exchange Spreads */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7D9486]">
                  Top Live Cross-Exchange Spot Discrepancies
                </div>
                {arb && arb.opportunities.length > 0 ? (
                  arb.opportunities.slice(0, 4).map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono font-black text-white">{o.baseAsset}</span>
                        <span className="text-[11px] text-[#9DB2A5] truncate">
                          {EXCHANGE_LABELS[o.buyExchange]} → {EXCHANGE_LABELS[o.sellExchange]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 font-mono shrink-0">
                        <span className="text-[#4ADE80] font-bold">
                          +{o.grossSpreadPct.toFixed(3)}%
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.08] text-[#D2E2D8]">
                          {o.status}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-5 rounded-2xl bg-white/[0.04] text-xs text-[#8FA899]">
                    Scanning Binance, Kraken &amp; Coinbase spot orderbooks...
                  </div>
                )}
              </div>

              {/* Live Stat-Arb Z-Score Preview */}
              {arb && arb.statArbPairs.length > 0 && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  {arb.statArbPairs.slice(0, 2).map((p) => (
                    <div
                      key={p.id}
                      className="px-3.5 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.07]"
                    >
                      <div className="text-[10px] text-[#7D9486] uppercase font-bold">
                        {p.category} · Stat-Arb
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="text-xs font-bold text-white">{p.label}</span>
                        <span
                          className={`font-mono text-xs font-black ${
                            Math.abs(p.zScore) >= 1.5 ? 'text-[#4ADE80]' : 'text-[#9DB2A5]'
                          }`}
                        >
                          {p.zScore >= 0 ? '+' : ''}
                          {p.zScore.toFixed(2)}σ
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => onLaunchApp('arbitrage')}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-[#22C55E] hover:bg-[#16A34A] text-[#05140A] font-bold text-xs sm:text-sm transition-colors"
              >
                <span>Open Real-Time Arbitrage Scanner</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* =================================================================
          SECTION 5: PRO DEMO TRADING TERMINAL
      ================================================================= */}
      <section id="demo" className="py-16 sm:py-24 px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease: KINETIC_EASE }}
          className="max-w-[1280px] mx-auto sig-card-dark rounded-[32px] p-7 sm:p-11 relative overflow-hidden"
        >
          <div className="relative z-10 space-y-10">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#4ADE80]">
                  <Bot className="w-4 h-4" />
                  05 / Pro Demo Trading Terminal
                </div>
                <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.025em] text-white mt-2">
                  Trade every live market on pro charts — zero real capital at risk.
                </h2>
                <p className="text-sm text-[#9DB2A5] mt-3 leading-relaxed">
                  Open Long and Short demo trades across Crypto, US Stocks, and Global CFDs with up to 50x leverage, Market &amp; Limit orders, live Entry/TP/SL chart lines, and persistent SQLite demo balance.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onLaunchApp('demo')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#22C55E] hover:bg-[#4ADE80] text-[#05140A] text-sm font-bold transition-colors shrink-0 self-start lg:self-auto"
              >
                <span>Open Demo Trade</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* 4-Stage Autonomous Pipeline */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {BOT_PIPELINE.map((stage, i) => (
                <motion.div
                  key={stage.step}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ duration: 0.4, delay: i * 0.06, ease: KINETIC_EASE }}
                  className="rounded-2xl bg-white/[0.05] border border-white/[0.08] p-5 space-y-2.5"
                >
                  <div className="text-xs font-mono font-black text-[#4ADE80]">{stage.step}</div>
                  <div className="text-sm font-bold text-white">{stage.title}</div>
                  <p className="text-xs text-[#9DB2A5] leading-relaxed">{stage.desc}</p>
                </motion.div>
              ))}
            </div>

            {/* Real Live Paper Arena Status Strip */}
            {paper && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-white/[0.08]">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7D9486]">
                    Live Arena Equity
                  </div>
                  <div className="mt-1 font-mono text-lg font-black text-white tabular-nums">
                    ${formatPrice(paper.metrics.totalEquityUsd, 2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7D9486]">
                    Active Bots
                  </div>
                  <div className="mt-1 font-mono text-lg font-black text-[#4ADE80] tabular-nums">
                    {paper.metrics.activeBotsCount} / {paper.bots.length}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7D9486]">
                    Open Positions
                  </div>
                  <div className="mt-1 font-mono text-lg font-black text-white tabular-nums">
                    {paper.metrics.openPositionsCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7D9486]">
                    Closed Trades
                  </div>
                  <div className="mt-1 font-mono text-lg font-black text-white tabular-nums">
                    {paper.metrics.closedTradesCount}
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </section>

      {/* =================================================================
          SECTION 6: ARCHITECTURE, SECURITY & FINAL LAUNCH CTA + FOOTER
      ================================================================= */}
      <section id="architecture" className="pt-14 pb-16 bg-white border-t border-[#E5EAE7]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 space-y-16">
          {/* 3 Architectural Pillars */}
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.45, ease: KINETIC_EASE }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#16A34A]">
                06 / Engineering &amp; Privacy
              </div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-[-0.025em] text-[#111814] mt-2">
                Built for speed, honesty, and zero vendor lock-in.
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="rounded-3xl bg-[#F6F8F7] border border-[#E5EAE7] p-6 space-y-3">
                <span className="w-10 h-10 rounded-2xl bg-white border border-[#E5EAE7] text-[#16A34A] flex items-center justify-center">
                  <Zap className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-[#111814]">100% Real Public Feeds</h3>
                <p className="text-xs text-[#55665C] leading-relaxed">
                  Zero mock data or simulated prices. Direct WebSocket &amp; REST feeds from Binance, Kraken, Coinbase, DefiLlama, Alternative.me, and Yahoo Finance.
                </p>
              </div>

              <div className="rounded-3xl bg-[#F6F8F7] border border-[#E5EAE7] p-6 space-y-3">
                <span className="w-10 h-10 rounded-2xl bg-white border border-[#E5EAE7] text-[#16A34A] flex items-center justify-center">
                  <Cpu className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-[#111814]">Node 24 + SQLite + Cron</h3>
                <p className="text-xs text-[#55665C] leading-relaxed">
                  Lightweight native `node:sqlite` persistence with automated candle caching, alert history, paper trade ledgers, and 5-minute background execution.
                </p>
              </div>

              <div className="rounded-3xl bg-[#F6F8F7] border border-[#E5EAE7] p-6 space-y-3">
                <span className="w-10 h-10 rounded-2xl bg-white border border-[#E5EAE7] text-[#16A34A] flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-[#111814]">Google OAuth &amp; Local BYOK</h3>
                <p className="text-xs text-[#55665C] leading-relaxed">
                  Sign in via standard Google OAuth 2.0 HTTP-only sessions while your optional LLM API keys stay encrypted client-side with WebCrypto AES-GCM.
                </p>
              </div>
            </div>
          </div>

          {/* Closing Conversion Banner */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, ease: KINETIC_EASE }}
            className="sig-card-sage rounded-[32px] p-8 sm:p-12 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6"
          >
            <div className="space-y-2 max-w-xl">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#15803D]">
                <ShieldCheck className="w-4 h-4" />
                Instant Access · No Credit Card Required
              </div>
              <h3 className="text-2xl sm:text-4xl font-black tracking-[-0.025em] text-[#101A13]">
                Ready to see beyond the market?
              </h3>
              <p className="text-xs sm:text-sm text-[#354E3E]">
                Launch the full SIGLENS terminal now or sign in with Google to personalize your workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onLaunchApp('overview')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full sig-btn-primary text-sm font-semibold"
              >
                <span>Launch SIGLENS</span>
                <ArrowRight className="w-4 h-4 text-[#4ADE80]" />
              </button>
              <GoogleAuthButton onContinueToApp={() => onLaunchApp('overview')} />
            </div>
          </motion.div>

          {/* Minimal Footer */}
          <footer className="pt-8 border-t border-[#E5EAE7] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#637369]">
            <div className="flex items-center gap-2.5">
              <LandingMark className="w-6 h-6" />
              <span className="font-bold text-[#111814] tracking-[0.06em]">SIGLENS</span>
              <span>· Quantitative Multi-Asset Analytics &amp; Paper-Trading Terminal</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onLaunchApp('arbitrage')}
                className="hover:text-[#111814] font-medium"
              >
                Arbitrage
              </button>
              <button
                type="button"
                onClick={() => onLaunchApp('demo')}
                className="hover:text-[#111814] font-medium"
              >
                Demo Trade
              </button>
              <button
                type="button"
                onClick={() => onLaunchApp('signals')}
                className="hover:text-[#111814] font-medium"
              >
                Live Signals
              </button>
              <span className="inline-flex items-center gap-1 text-[#7D8E84]">
                <Activity className="w-3 h-3 text-[#16A34A]" />
                Analytics only — not financial advice
              </span>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
};
