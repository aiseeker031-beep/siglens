import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flame,
  LineChart,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { computeSignalSetup, formatSignalCopyText } from '../analytics/signalSetup';
import { StructuredSignalCard } from '../components/ui/StructuredSignalCard';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import {
  ALL_EXCHANGES,
  defaultMarketTypeFor,
  EXCHANGE_LABELS,
  EXCHANGE_MARKET_TYPES,
  EXCHANGE_TIMEFRAMES,
  QUICK_TIMEFRAMES,
} from '../shared/constants';
import { formatPercent, formatPrice, formatTimestamp } from '../shared/format';
import type {
  ExchangeId,
  MacroCalendarEvent,
  MarketIntelligenceSnapshot,
  MarketType,
  QuantSignalGrade,
  QuantSignalRow,
  SignalEventRecord,
  Timeframe,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type FeedTab = 'quant' | 'events';
type DirectionFilter = 'ALL' | 'BUY' | 'SELL' | 'WAIT';
type IntelSubTab = 'calendar' | 'news';

function formatCountdown(minutesFromNow: number, status: MacroCalendarEvent['status']): string {
  if (status === 'ONGOING') return 'LIVE NOW';
  const abs = Math.abs(minutesFromNow);
  if (abs < 60) return minutesFromNow >= 0 ? `in ${abs}m` : `${abs}m ago`;
  const hrs = Math.floor(abs / 60);
  const mins = abs % 60;
  if (hrs < 24) {
    const label = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    return minutesFromNow >= 0 ? `in ${label}` : `${label} ago`;
  }
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  const label = remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
  return minutesFromNow >= 0 ? `in ${label}` : `${label} ago`;
}

function timeAgoShort(ts: number): string {
  const diffMin = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const hrs = Math.floor(diffMin / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function gradeBadgeStyle(grade: QuantSignalGrade): string {
  switch (grade) {
    case 'A+':
      return 'bg-[#059669] text-white border-[#059669] shadow-sm shadow-emerald-500/20';
    case 'A':
      return 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]';
    case 'B':
      return 'bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]';
    case 'C':
      return 'bg-[#F8FAFC] text-[#475569] border-[#CBD5E1]';
    case 'BLOCKED':
    default:
      return 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]';
  }
}

export const LiveSignalsView: React.FC = () => {
  const globalExchange = useAppStore((s) => s.exchange);
  const globalMarketType = useAppStore((s) => s.marketType);
  const globalTimeframe = useAppStore((s) => s.timeframe);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const timezone = useAppStore((s) => s.preferences.timezone);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const wsFreshness = useAppStore((s) => s.wsFreshness);

  const [tab, setTab] = useState<FeedTab>('quant');
  const [intelTab, setIntelTab] = useState<IntelSubTab>('calendar');
  const [exchange, setExchange] = useState<ExchangeId>(globalExchange);
  const [marketType, setMarketType] = useState<MarketType>(globalMarketType);
  const [timeframe, setTimeframe] = useState<Timeframe>(
    QUICK_TIMEFRAMES.includes(globalTimeframe) ? globalTimeframe : '15m',
  );

  const [quantRows, setQuantRows] = useState<QuantSignalRow[]>([]);
  const [htfTimeframe, setHtfTimeframe] = useState<Timeframe | null>('4h');
  const [intel, setIntel] = useState<MarketIntelligenceSnapshot | null>(null);
  const [methodologyNote, setMethodologyNote] = useState<string>('');
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [events, setEvents] = useState<SignalEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [assetFilter, setAssetFilter] = useState('');
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('ALL');
  const [highConvictionOnly, setHighConvictionOnly] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const supportedMarketTypes = EXCHANGE_MARKET_TYPES[exchange] ?? ['spot'];
  const supportedTimeframes = useMemo(() => {
    const allowed = EXCHANGE_TIMEFRAMES[exchange] ?? QUICK_TIMEFRAMES;
    const quick = QUICK_TIMEFRAMES.filter((tf) => allowed.includes(tf));
    return quick.length > 0 ? quick : allowed.slice(0, 6);
  }, [exchange]);

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [quantRes, feedRes] = await Promise.all([
        api.getQuantSignals(exchange, marketType, timeframe, forceRefresh),
        api.getSignalFeed(120).catch(() => ({ events: [], count: 0 })),
      ]);
      setQuantRows(quantRes.signals);
      setHtfTimeframe(quantRes.htfTimeframe);
      setIntel(quantRes.intelligence);
      setMethodologyNote(quantRes.methodologyNote);
      setScannedAt(quantRes.scannedAt);
      setEvents(feedRes.events);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to run quant signal scan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExchange(globalExchange);
    setMarketType(globalMarketType);
  }, [globalExchange, globalMarketType]);

  useEffect(() => {
    if (!supportedMarketTypes.includes(marketType)) {
      setMarketType(defaultMarketTypeFor(exchange));
      return;
    }
    if (!supportedTimeframes.includes(timeframe)) {
      setTimeframe(supportedTimeframes.includes('15m') ? '15m' : supportedTimeframes[0]);
      return;
    }
    loadData(false);
    const t = window.setInterval(() => loadData(false), 45_000);
    return () => window.clearInterval(t);
  }, [exchange, marketType, timeframe]);

  const actionableRows = useMemo(
    () => quantRows.filter((r) => r.action !== 'WAIT'),
    [quantRows],
  );
  const blockedCount = quantRows.length - actionableRows.length;
  const buyCount = useMemo(
    () => quantRows.filter((r) => r.action === 'BUY').length,
    [quantRows],
  );
  const sellCount = useMemo(
    () => quantRows.filter((r) => r.action === 'SELL').length,
    [quantRows],
  );

  const filteredQuant = useMemo(() => {
    return quantRows.filter((row) => {
      if (highConvictionOnly && row.action === 'WAIT') return false;
      if (
        assetFilter &&
        !row.displaySymbol.includes(assetFilter.toUpperCase()) &&
        !row.baseAsset.includes(assetFilter.toUpperCase())
      ) {
        return false;
      }
      if (dirFilter === 'BUY' && row.action !== 'BUY') return false;
      if (dirFilter === 'SELL' && row.action !== 'SELL') return false;
      if (dirFilter === 'WAIT' && row.action !== 'WAIT') return false;
      return true;
    });
  }, [assetFilter, dirFilter, highConvictionOnly, quantRows]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const dir =
        ev.signalSetup?.direction ??
        (ev.classification.includes('BULLISH')
          ? 'BUY'
          : ev.classification.includes('BEARISH')
            ? 'SELL'
            : 'WAIT');
      if (assetFilter && !ev.displaySymbol.includes(assetFilter.toUpperCase())) return false;
      if (dirFilter !== 'ALL' && dir !== dirFilter) return false;
      return true;
    });
  }, [assetFilter, dirFilter, events]);

  const handleCopy = async (row: QuantSignalRow, livePrice: number) => {
    const header = `[SIGLENS Quant ${row.grade} · Alpha ${row.alphaScore}/100 · HTF ${row.htfBias}]`;
    const histLine =
      row.historicalEdge.sampleTrades >= 3 && row.historicalEdge.winRatePct !== null
        ? `• Historical Edge: ${row.historicalEdge.winRatePct}% win (${row.historicalEdge.expectancyR !== null && row.historicalEdge.expectancyR >= 0 ? '+' : ''}${row.historicalEdge.expectancyR}R across ${row.historicalEdge.sampleTrades} trades)`
        : '• Historical Edge: Fresh regime';
    const text = `${header}\n${formatSignalCopyText(row.setup, row.timeframe, livePrice)}\n${histLine}\n• Sentiment: ${row.assetSentiment.label} (${row.assetSentiment.score > 0 ? '+' : ''}${row.assetSentiment.score})`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(row.canonicalId);
      window.setTimeout(() => setCopiedId((cur) => (cur === row.canonicalId ? null : cur)), 1600);
    } catch {
      // clipboard blocked
    }
  };

  const handleTradeInDemo = (row: QuantSignalRow) => {
    selectMarket(row.exchange, row.marketType, row.displaySymbol, false);
    setActiveSection('demo');
  };

  const fngValue = intel?.fearAndGreed.value ?? null;
  const eventRiskBannerClass =
    intel?.eventRiskLevel === 'HIGH'
      ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#9F1239]'
      : intel?.eventRiskLevel === 'ELEVATED'
        ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
        : 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]';

  return (
    <div className="space-y-4">
      {/* Header Strip */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#0B120E] text-[#4ADE80] tracking-wide">
              <ShieldCheck className="w-3.5 h-3.5" />
              4-PILLAR QUANT ALPHA ENGINE
            </span>
            {htfTimeframe && (
              <span className="text-[11px] font-mono text-[#64748B]">
                HTF Filter: <strong className="text-[#0A0D14]">{htfTimeframe}</strong>
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B] max-w-3xl">
            Every setup must pass walk-forward historical chart expectancy, Higher-Timeframe trend alignment, ADX chop filtering, live macro event risk shielding, and social/news sentiment fusion before issuing a BUY or SELL.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-[11px] text-[#64748B]">
            Stream: <strong className="text-[#047857]">{wsFreshness}</strong>
            {scannedAt ? ` · ${formatTimestamp(scannedAt, timezone, false)}` : ''}
          </span>
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl sig-btn-primary font-semibold disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Scanning…' : 'Rescan Quant Alpha'}
          </button>
        </div>
      </div>

      {/* Live Market Intelligence Bento: Social/News Sentiment (5 cols) + Macro Events & Breaking Catalysts (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Dark Obsidian Sentiment & Social Pulse */}
        <div className="lg:col-span-5 rounded-2xl bg-[#0B120E] text-[#F1F5F2] border border-[#1E2E24] p-4 flex flex-col justify-between gap-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#86A792]">
                Social &amp; Crowd Sentiment Pulse
              </div>
              <div className="mt-1 flex items-baseline gap-2.5">
                <span className="text-2xl font-bold font-mono tabular-nums tracking-tight text-white">
                  {intel
                    ? `${intel.overallSentimentScore > 0 ? '+' : ''}${intel.overallSentimentScore}`
                    : '—'}
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    intel?.sentimentLabel.includes('BULLISH')
                      ? 'bg-[#16A34A]/20 text-[#4ADE80]'
                      : intel?.sentimentLabel.includes('BEARISH')
                        ? 'bg-[#E11D48]/20 text-[#FDA4AF]'
                        : 'bg-white/10 text-[#CBD5E1]'
                  }`}
                >
                  {intel ? intel.sentimentLabel.replace(/_/g, ' ') : 'LOADING'}
                </span>
              </div>
            </div>

            {/* Fear & Greed Pill */}
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase text-[#86A792]">
                Fear &amp; Greed (7d)
              </div>
              <div className="mt-0.5 flex items-center justify-end gap-1.5 font-mono tabular-nums">
                <span
                  className={`text-lg font-bold ${
                    fngValue === null
                      ? 'text-[#94A3B8]'
                      : fngValue <= 25
                        ? 'text-[#FB7185]'
                        : fngValue >= 75
                          ? 'text-[#4ADE80]'
                          : 'text-[#FDE047]'
                  }`}
                >
                  {fngValue !== null ? fngValue : '—'}
                </span>
                <span className="text-[11px] text-[#CBD5E1]">
                  {intel?.fearAndGreed.classification ?? '—'}
                </span>
                {intel?.fearAndGreed.delta7d !== null && intel?.fearAndGreed.delta7d !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      intel.fearAndGreed.delta7d >= 0
                        ? 'bg-[#16A34A]/20 text-[#4ADE80]'
                        : 'bg-[#E11D48]/20 text-[#FDA4AF]'
                    }`}
                  >
                    {intel.fearAndGreed.delta7d >= 0 ? '+' : ''}
                    {intel.fearAndGreed.delta7d}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 3-Metric Row: News NLP | Social Buzz | Funding Crowd */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#131F18] border border-[#1E2E24] px-2.5 py-2">
              <div className="text-[10px] text-[#86A792] uppercase font-mono">News NLP</div>
              <div
                className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                  (intel?.newsSentimentScore ?? 0) >= 12
                    ? 'text-[#4ADE80]'
                    : (intel?.newsSentimentScore ?? 0) <= -12
                      ? 'text-[#FDA4AF]'
                      : 'text-white'
                }`}
              >
                {intel ? `${intel.newsSentimentScore > 0 ? '+' : ''}${intel.newsSentimentScore}` : '—'}
              </div>
            </div>

            <div className="rounded-xl bg-[#131F18] border border-[#1E2E24] px-2.5 py-2">
              <div className="text-[10px] text-[#86A792] uppercase font-mono">Social Buzz</div>
              <div
                className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                  (intel?.socialBuzzScore ?? 0) >= 12
                    ? 'text-[#4ADE80]'
                    : (intel?.socialBuzzScore ?? 0) <= -12
                      ? 'text-[#FDA4AF]'
                      : 'text-white'
                }`}
              >
                {intel ? `${intel.socialBuzzScore > 0 ? '+' : ''}${intel.socialBuzzScore}` : '—'}
              </div>
            </div>

            <div className="rounded-xl bg-[#131F18] border border-[#1E2E24] px-2.5 py-2">
              <div className="text-[10px] text-[#86A792] uppercase font-mono">Perp Funding</div>
              <div className="mt-0.5 font-mono text-xs font-bold tabular-nums text-white truncate">
                {intel?.derivativesBias.avgFundingPct !== null &&
                intel?.derivativesBias.avgFundingPct !== undefined
                  ? `${intel.derivativesBias.avgFundingPct >= 0 ? '+' : ''}${intel.derivativesBias.avgFundingPct.toFixed(4)}%`
                  : 'N/A'}
              </div>
              <div className="text-[10px] text-[#86A792] truncate">
                {intel?.derivativesBias.crowdedSide.replace(/_/g, ' ') ?? '—'}
              </div>
            </div>
          </div>

          {/* Live Social Trending Strip */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#86A792] mb-1.5">
              <span className="inline-flex items-center gap-1">
                <Flame className="w-3 h-3 text-[#F59E0B]" />
                CoinGecko Live Social Trending
              </span>
              {intel?.fearAndGreed.contrarianBias !== 'NEUTRAL' && intel && (
                <span className="text-[#FDE047] normal-case">
                  {intel.fearAndGreed.contrarianBias === 'EXTREME_FEAR_LONG_BIAS'
                    ? 'Contrarian: Extreme Fear bounce zone'
                    : 'Contrarian: Extreme Greed caution'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(intel?.trendingCoins ?? []).slice(0, 7).map((coin) => (
                <button
                  key={coin.symbol}
                  type="button"
                  onClick={() => setAssetFilter(coin.symbol)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#131F18] hover:bg-[#1B2C22] border border-[#23372B] text-[11px] font-mono transition-colors"
                  title={`Filter signals by ${coin.name}`}
                >
                  <span className="text-[#86A792]">#{coin.rank}</span>
                  <span className="font-semibold text-white">{coin.symbol}</span>
                  {coin.priceChange24hPct !== null && (
                    <span
                      className={
                        coin.priceChange24hPct >= 0 ? 'text-[#4ADE80]' : 'text-[#FDA4AF]'
                      }
                    >
                      {coin.priceChange24hPct >= 0 ? '+' : ''}
                      {coin.priceChange24hPct.toFixed(1)}%
                    </span>
                  )}
                </button>
              ))}
              {(!intel || intel.trendingCoins.length === 0) && (
                <span className="text-[11px] text-[#86A792]">
                  {loading ? 'Loading live social velocity…' : 'Trending feed temporarily unavailable.'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Ongoing & Upcoming Events + Breaking News Catalysts */}
        <div className="lg:col-span-7 sig-glass rounded-2xl p-4 flex flex-col gap-3">
          {/* Event Risk Shield Bar */}
          <div
            className={`rounded-xl border px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${eventRiskBannerClass}`}
          >
            <div className="flex items-center gap-2 font-medium">
              {intel?.eventRiskLevel === 'HIGH' ? (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              ) : intel?.eventRiskLevel === 'ELEVATED' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldCheck className="w-4 h-4 shrink-0" />
              )}
              <span>{intel?.eventRiskSummary ?? 'Evaluating live macro calendar & breaking news risk…'}</span>
            </div>
            <span className="font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/70">
              RISK: {intel?.eventRiskLevel ?? '—'}
            </span>
          </div>

          {/* Sub-tabs: Macro Calendar vs Breaking News Catalysts */}
          <div className="flex items-center justify-between gap-2 border-b border-[#E6E8EE] pb-2">
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setIntelTab('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-colors ${
                  intelTab === 'calendar'
                    ? 'bg-[#0B120E] text-white'
                    : 'text-[#64748B] hover:bg-[#EAF0EC]'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Ongoing &amp; Upcoming Events ({intel?.upcomingEvents.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setIntelTab('news')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-colors ${
                  intelTab === 'news'
                    ? 'bg-[#0B120E] text-white'
                    : 'text-[#64748B] hover:bg-[#EAF0EC]'
                }`}
              >
                <Newspaper className="w-3.5 h-3.5" />
                Live News Catalysts ({intel?.newsCatalysts.length ?? 0})
              </button>
            </div>
            <span className="text-[10px] font-mono text-[#64748B] hidden sm:inline">
              {intel ? `${intel.activeSources.length} live feeds` : ''}
            </span>
          </div>

          {/* Scrollable Event / News List */}
          <div className="max-h-44 overflow-y-auto pr-1 space-y-1.5">
            {intelTab === 'calendar' ? (
              (intel?.upcomingEvents ?? []).length > 0 ? (
                intel!.upcomingEvents.slice(0, 12).map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/80 border border-[#E6E8EE] text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                          ev.impact === 'HIGH'
                            ? 'bg-[#FFF1F2] text-[#BE123C] border border-[#FECDD3]'
                            : ev.impact === 'MEDIUM'
                              ? 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]'
                              : 'bg-[#F1F5F9] text-[#475569]'
                        }`}
                      >
                        {ev.country} · {ev.impact}
                      </span>
                      <span className="font-medium text-[#0A0D14] truncate">{ev.title}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0 font-mono text-[11px] tabular-nums">
                      {(ev.forecast || ev.previous) && (
                        <span className="text-[#64748B] hidden md:inline">
                          {ev.forecast ? `F:${ev.forecast}` : ''}
                          {ev.forecast && ev.previous ? ' / ' : ''}
                          {ev.previous ? `P:${ev.previous}` : ''}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${
                          ev.status === 'ONGOING'
                            ? 'bg-[#E11D48] text-white animate-pulse'
                            : ev.status === 'UPCOMING'
                              ? 'bg-[#ECFDF5] text-[#047857]'
                              : 'bg-[#F1F5F9] text-[#64748B]'
                        }`}
                      >
                        {formatCountdown(ev.minutesFromNow, ev.status)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-xs text-[#64748B]">
                  {loading
                    ? 'Loading live economic calendar…'
                    : 'No major macro events currently returned by the weekly calendar feed.'}
                </div>
              )
            ) : (intel?.newsCatalysts ?? []).length > 0 ? (
              intel!.newsCatalysts.slice(0, 14).map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/80 border border-[#E6E8EE] text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                          item.sentiment === 'BULLISH'
                            ? 'bg-[#ECFDF5] text-[#047857]'
                            : item.sentiment === 'BEARISH'
                              ? 'bg-[#FFF1F2] text-[#BE123C]'
                              : 'bg-[#F1F5F9] text-[#475569]'
                        }`}
                      >
                        {item.sentiment}
                      </span>
                      {item.catalystType !== 'GENERAL' && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                            item.catalystType === 'SECURITY'
                              ? 'bg-[#E11D48] text-white'
                              : 'bg-[#0B120E] text-[#4ADE80]'
                          }`}
                        >
                          {item.catalystType}
                        </span>
                      )}
                      {item.assets.slice(0, 3).map((sym) => (
                        <span
                          key={sym}
                          className="px-1.5 py-0.5 rounded bg-[#EAF0EC] text-[#065F46] font-mono text-[10px] font-semibold"
                        >
                          {sym}
                        </span>
                      ))}
                      <span className="text-[10px] text-[#64748B] font-mono">
                        {item.source} · {timeAgoShort(item.publishedAt)}
                      </span>
                    </div>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#0A0D14] hover:text-[#047857] inline-flex items-center gap-1 line-clamp-1"
                      >
                        <span className="truncate">{item.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                      </a>
                    ) : (
                      <div className="font-medium text-[#0A0D14] line-clamp-1">{item.title}</div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-[#64748B]">
                {loading ? 'Loading live crypto & macro news feeds…' : 'No live news catalysts available.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mode Switch + Actionable vs Blocked Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EE] pb-2.5 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('quant')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'quant' ? 'sig-btn-primary' : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Quant Alpha Signals ({actionableRows.length} Active / {quantRows.length} Scanned)
          </button>
          <button
            type="button"
            onClick={() => setTab('events')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'events' ? 'sig-btn-primary' : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Confirmed Signal History ({events.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums sig-glass-subtle px-3.5 py-1.5 rounded-full">
          <span className="text-[#047857] font-semibold">BUY: {buyCount}</span>
          <span className="text-[#BE123C] font-semibold">SELL: {sellCount}</span>
          <span className="text-[#64748B]">BLOCKED/WAIT: {blockedCount}</span>
        </div>
      </div>

      {/* Filter Bar (All 14 Exchanges + High-Conviction Toggle) */}
      <div className="sig-glass rounded-2xl p-3 flex flex-wrap items-center gap-2.5 text-xs">
        <input
          type="text"
          value={assetFilter}
          onChange={(e) => setAssetFilter(e.target.value)}
          placeholder="Symbol e.g. BTC"
          aria-label="Filter signals by symbol"
          className="w-36 px-3 py-1.5 rounded-xl sig-glass-subtle font-mono text-[#0A0D14] placeholder-[#64748B]"
        />

        {tab === 'quant' && (
          <>
            <select
              aria-label="Signals exchange"
              value={exchange}
              onChange={(e) => {
                const ex = e.target.value as ExchangeId;
                setExchange(ex);
                const allowedTypes = EXCHANGE_MARKET_TYPES[ex];
                if (!allowedTypes.includes(marketType)) {
                  setMarketType(defaultMarketTypeFor(ex));
                }
              }}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14] font-medium"
            >
              {ALL_EXCHANGES.map((ex) => (
                <option key={ex} value={ex} className="bg-white">
                  {EXCHANGE_LABELS[ex]}
                </option>
              ))}
            </select>

            <select
              aria-label="Signals market type"
              value={marketType}
              onChange={(e) => setMarketType(e.target.value as MarketType)}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14]"
            >
              {supportedMarketTypes.map((mt) => (
                <option key={mt} value={mt} className="bg-white capitalize">
                  {mt === 'perpetual' ? 'Perpetual' : mt === 'cfd' ? 'CFD' : mt === 'equity' ? 'Equity' : 'Spot'}
                </option>
              ))}
            </select>

            <select
              aria-label="Signals timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle font-mono text-[#0A0D14]"
            >
              {supportedTimeframes.map((tf) => (
                <option key={tf} value={tf} className="bg-white">
                  {tf}
                </option>
              ))}
            </select>

            {/* Strict High-Conviction Filter Toggle */}
            <button
              type="button"
              onClick={() => setHighConvictionOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold border transition-all ${
                highConvictionOnly
                  ? 'bg-[#0B120E] text-[#4ADE80] border-[#0B120E]'
                  : 'bg-white text-[#475569] border-[#CBD5E1] hover:bg-[#F8FAFC]'
              }`}
              title="Toggle between verified A+/A/B setups only vs showing all blocked/choppy pairs with rejection reasons"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {highConvictionOnly
                ? `High-Conviction Only (${blockedCount} weak filtered)`
                : `Showing All (${blockedCount} blocked included)`}
            </button>
          </>
        )}

        <select
          aria-label="Filter by direction"
          value={dirFilter}
          onChange={(e) => setDirFilter(e.target.value as DirectionFilter)}
          className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14]"
        >
          <option value="ALL" className="bg-white">All Directions</option>
          <option value="BUY" className="bg-white">BUY (Long) Only</option>
          <option value="SELL" className="bg-white">SELL (Short) Only</option>
          <option value="WAIT" className="bg-white">Blocked / Wait</option>
        </select>

        {assetFilter && (
          <button
            type="button"
            onClick={() => setAssetFilter('')}
            className="px-2.5 py-1 rounded-lg bg-[#EAF0EC] text-[#047857] font-semibold"
          >
            Clear "{assetFilter}"
          </button>
        )}

        <span className="ml-auto font-mono text-[#64748B]">
          {tab === 'quant' ? `${filteredQuant.length} shown` : `${filteredEvents.length} events`}
        </span>
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-[#FFF1F2] border border-[#FECDD3] px-4 py-3 text-xs text-[#BE123C] flex items-center justify-between">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => loadData(true)}
            className="underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Content Grid */}
      {loading && quantRows.length === 0 && events.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <SkeletonBlock key={idx} className="h-72" />
          ))}
        </div>
      ) : tab === 'quant' ? (
        filteredQuant.length === 0 ? (
          <div className="sig-glass rounded-2xl p-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#EAF0EC] text-[#047857]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-[#0A0D14]">
              {highConvictionOnly && quantRows.length > 0
                ? `Capital Protected: All ${quantRows.length} scanned pairs on ${EXCHANGE_LABELS[exchange]} (${timeframe}) were filtered out.`
                : 'No quant signals match your current filters.'}
            </div>
            <p className="text-xs text-[#64748B] max-w-xl mx-auto">
              {highConvictionOnly && quantRows.length > 0
                ? 'Waiting in cash when markets are choppy (ADX < 18), counter-trend against HTF, negative historical expectancy, or facing high-impact macro news is how quant algorithms prevent avoidable losses. Try switching to 1h / 4h, another exchange, or inspect why pairs were blocked.'
                : 'Adjust your direction or symbol filter above.'}
            </p>
            {highConvictionOnly && quantRows.length > 0 && (
              <button
                type="button"
                onClick={() => setHighConvictionOnly(false)}
                className="px-4 py-1.5 rounded-xl bg-[#0B120E] text-[#4ADE80] text-xs font-semibold"
              >
                Inspect {quantRows.length} Blocked / Wait Pairs &amp; Rejection Reasons
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {filteredQuant.map((row) => {
              const live = liveTickers[row.canonicalId];
              const livePrice = live?.lastPrice ?? row.price;
              const isBuy = row.action === 'BUY';
              const isSell = row.action === 'SELL';
              const isWait = row.action === 'WAIT';
              const accentBorder = isBuy
                ? 'border-[#A7F3D0]'
                : isSell
                  ? 'border-[#FECDD3]'
                  : 'border-[#E6E8EE]';

              return (
                <article
                  key={row.canonicalId}
                  className={`rounded-2xl bg-white border ${accentBorder} p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-[#0A0D14] font-mono tracking-tight">
                          {row.displaySymbol}
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono font-bold ${gradeBadgeStyle(row.grade)}`}
                        >
                          {row.grade}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[11px] font-bold ${
                            isBuy
                              ? 'bg-[#059669] text-white'
                              : isSell
                                ? 'bg-[#E11D48] text-white'
                                : 'bg-[#F1F5F9] text-[#64748B]'
                          }`}
                        >
                          {isBuy && <ArrowUpRight className="w-3.5 h-3.5" />}
                          {isSell && <ArrowDownRight className="w-3.5 h-3.5" />}
                          {row.action}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#64748B] font-mono">
                        <span>{EXCHANGE_LABELS[row.exchange]}</span>
                        <span>·</span>
                        <span className="uppercase">{row.marketType}</span>
                        <span>·</span>
                        <span>{row.timeframe}</span>
                        {row.htfTimeframe && (
                          <>
                            <span>→</span>
                            <span>HTF {row.htfTimeframe}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-bold text-[#0A0D14] tabular-nums">
                        ${formatPrice(livePrice)}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 text-[11px] font-mono tabular-nums">
                        <span
                          className={
                            row.change24hPct >= 0 ? 'text-[#047857]' : 'text-[#BE123C]'
                          }
                        >
                          {formatPercent(row.change24hPct)}
                        </span>
                        <span className="text-[#94A3B8]">|</span>
                        <span className="font-bold text-[#0A0D14]">
                          Alpha {row.alphaScore}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 4-Pillar Quant Breakdown Strip */}
                  <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                    <div className="rounded-xl bg-[#F8FAFC] border border-[#E6E8EE] px-2 py-1.5">
                      <div className="text-[10px] text-[#64748B] font-mono">TECH</div>
                      <div className="font-mono font-bold text-[#0A0D14] tabular-nums">
                        {row.pillars.technicalScore}
                      </div>
                      <div className="text-[10px] text-[#64748B] font-mono truncate">
                        ADX {row.technicalSummary.adx14 ?? '—'}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAFC] border border-[#E6E8EE] px-2 py-1.5">
                      <div className="text-[10px] text-[#64748B] font-mono">
                        HTF {row.htfTimeframe ?? ''}
                      </div>
                      <div
                        className={`font-mono font-bold ${
                          row.htfBias === 'BULLISH'
                            ? 'text-[#047857]'
                            : row.htfBias === 'BEARISH'
                              ? 'text-[#BE123C]'
                              : 'text-[#64748B]'
                        }`}
                      >
                        {row.htfBias === 'BULLISH'
                          ? 'BULL'
                          : row.htfBias === 'BEARISH'
                            ? 'BEAR'
                            : 'NEUT'}
                      </div>
                      <div className="text-[10px] text-[#64748B] font-mono">
                        {row.htfAligned ? 'Aligned' : 'Diverged'}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAFC] border border-[#E6E8EE] px-2 py-1.5">
                      <div className="text-[10px] text-[#64748B] font-mono">HIST EDGE</div>
                      <div
                        className={`font-mono font-bold tabular-nums ${
                          row.historicalEdge.expectancyR !== null &&
                          row.historicalEdge.expectancyR > 0
                            ? 'text-[#047857]'
                            : row.historicalEdge.expectancyR !== null &&
                                row.historicalEdge.expectancyR < 0
                              ? 'text-[#BE123C]'
                              : 'text-[#0A0D14]'
                        }`}
                      >
                        {row.historicalEdge.winRatePct !== null
                          ? `${row.historicalEdge.winRatePct.toFixed(0)}%`
                          : 'Fresh'}
                      </div>
                      <div className="text-[10px] text-[#64748B] font-mono tabular-nums truncate">
                        {row.historicalEdge.expectancyR !== null
                          ? `${row.historicalEdge.expectancyR >= 0 ? '+' : ''}${row.historicalEdge.expectancyR}R (${row.historicalEdge.sampleTrades})`
                          : `${row.historicalEdge.sampleTrades} trd`}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F8FAFC] border border-[#E6E8EE] px-2 py-1.5">
                      <div className="text-[10px] text-[#64748B] font-mono">SENTIMENT</div>
                      <div
                        className={`font-mono font-bold tabular-nums ${
                          row.assetSentiment.label === 'BULLISH'
                            ? 'text-[#047857]'
                            : row.assetSentiment.label === 'BEARISH'
                              ? 'text-[#BE123C]'
                              : 'text-[#475569]'
                        }`}
                      >
                        {row.assetSentiment.score > 0 ? '+' : ''}
                        {row.assetSentiment.score}
                      </div>
                      <div className="text-[10px] text-[#64748B] font-mono truncate">
                        {row.assetSentiment.trendingRank
                          ? `Trend #${row.assetSentiment.trendingRank}`
                          : row.assetSentiment.fundingPct !== null
                            ? `F ${row.assetSentiment.fundingPct >= 0 ? '+' : ''}${row.assetSentiment.fundingPct.toFixed(3)}%`
                            : row.assetSentiment.label}
                      </div>
                    </div>
                  </div>

                  {/* Active Shock Catalyst Warning */}
                  {row.assetSentiment.shockWarning && (
                    <div className="rounded-xl bg-[#FFF1F2] border border-[#FECDD3] px-2.5 py-1.5 text-[11px] text-[#9F1239] flex items-start gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{row.assetSentiment.shockWarning}</span>
                    </div>
                  )}

                  {/* Trade Execution Plan OR Blocked Reason Panel */}
                  {!isWait ? (
                    <div className="rounded-xl bg-[#F4F6F5] border border-[#E2E8E5] p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-[#475569]">
                          {row.antiChase.entryMode === 'PULLBACK_ZONE'
                            ? 'Anti-Chase Pullback Limit Zone'
                            : 'Entry Execution (NOW)'}
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            row.antiChase.entryMode === 'PULLBACK_ZONE'
                              ? 'text-[#B45309]'
                              : 'text-[#0A0D14]'
                          }`}
                        >
                          {row.antiChase.entryMode === 'PULLBACK_ZONE'
                            ? `$${formatPrice(row.setup.entryZoneLow)} – $${formatPrice(row.setup.entryZoneHigh)}`
                            : `$${formatPrice(livePrice)}`}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E2E8E5]">
                        <span className="text-[11px] font-semibold text-[#BE123C]">
                          Anti-Wick Stop Loss (SL)
                        </span>
                        <span className="font-mono font-bold text-[#BE123C] tabular-nums">
                          ${formatPrice(row.setup.stopLoss)}{' '}
                          <span className="font-normal text-[11px]">
                            ({row.setup.stopLossPct !== null && row.setup.stopLossPct > 0 ? '+' : ''}
                            {row.setup.stopLossPct?.toFixed(2)}%)
                          </span>
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-[#E2E8E5]">
                        {row.setup.takeProfits.map((tp) => (
                          <div
                            key={tp.label}
                            className="rounded-lg bg-white border border-[#E2E8E5] px-2 py-1.5 text-center"
                          >
                            <div className="text-[10px] font-mono text-[#64748B]">
                              {tp.label} ({tp.rrRatio.toFixed(1)}R)
                            </div>
                            <div className="font-mono text-[11px] font-bold text-[#047857] tabular-nums">
                              ${formatPrice(tp.price)}
                            </div>
                            <div className="font-mono text-[10px] text-[#059669] tabular-nums">
                              {tp.pctFromEntry > 0 ? '+' : ''}
                              {tp.pctFromEntry.toFixed(2)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#FFF8F8] border border-[#FDE2E4] p-3 space-y-1.5 text-[11px]">
                      <div className="font-semibold text-[#9F1239] flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        Filtered to Prevent Low-Quality Loss
                      </div>
                      <ul className="space-y-1 text-[#64748B]">
                        {row.rejectionReasons.slice(0, 3).map((reason, idx) => (
                          <li key={idx} className="leading-snug">
                            • {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Gates Passed Pills */}
                  {row.gatesPassed.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {row.gatesPassed.slice(0, 4).map((gate, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#065F46] text-[10px] font-medium"
                        >
                          <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                          {gate}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Action Footer */}
                  <div className="mt-auto pt-2 border-t border-[#E6E8EE] flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleCopy(row, livePrice)}
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#F4F6F5] hover:bg-[#E6ECE9] text-[#0A0D14] font-medium transition-colors"
                    >
                      {copiedId === row.canonicalId ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#059669]" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        selectMarket(row.exchange, row.marketType, row.displaySymbol, true)
                      }
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#F4F6F5] hover:bg-[#E6ECE9] text-[#0A0D14] font-medium transition-colors"
                    >
                      <LineChart className="w-3.5 h-3.5" />
                      Chart
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTradeInDemo(row)}
                      className={`ml-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition-all ${
                        isBuy
                          ? 'bg-[#059669] hover:bg-[#047857] text-white'
                          : isSell
                            ? 'bg-[#E11D48] hover:bg-[#BE123C] text-white'
                            : 'bg-[#0B120E] hover:bg-[#1A2920] text-[#4ADE80]'
                      }`}
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      Trade in Demo
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : filteredEvents.length === 0 ? (
        <div className="sig-glass rounded-2xl p-8 text-center text-xs text-[#64748B]">
          No confirmed signal history events match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredEvents.map((ev) => {
            const setup =
              ev.signalSetup ??
              computeSignalSetup({
                displaySymbol: ev.displaySymbol,
                classification: ev.classification,
                closePrice: null,
                atr14: null,
                ema20: null,
                vwap: null,
              });
            return (
              <StructuredSignalCard
                key={ev.id}
                setup={setup}
                timeframe={ev.timeframe}
                exchangeLabel={EXCHANGE_LABELS[ev.exchange]}
                marketType={ev.marketType}
                score={ev.directionalScore}
                agreementPct={ev.agreementPct}
                statusTag={ev.eventType.replace(/_/g, ' ')}
                timestampLabel={formatTimestamp(ev.candleTimestamp, timezone, false)}
                onOpenPair={() => selectMarket(ev.exchange, ev.marketType, ev.displaySymbol, true)}
              />
            );
          })}
        </div>
      )}

      {/* Honest Methodology & Risk Footnote */}
      {methodologyNote && (
        <div className="rounded-xl bg-[#F4F6F5] border border-[#E2E8E5] px-3.5 py-2.5 flex items-start gap-2 text-[11px] text-[#64748B]">
          <Activity className="w-4 h-4 shrink-0 text-[#059669] mt-0.5" />
          <span>{methodologyNote}</span>
        </div>
      )}
    </div>
  );
};
