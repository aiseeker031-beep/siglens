import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  Flame,
  Gem,
  Landmark,
  Layers,
  LineChart,
  Lock,
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
  CRYPTO_EXCHANGES,
  defaultMarketTypeFor,
  EXCHANGE_LABELS,
  EXCHANGE_MARKET_TYPES,
  EXCHANGE_TIMEFRAMES,
  QUICK_TIMEFRAMES,
} from '../shared/constants';
import { formatPercent, formatPrice, formatTimestamp } from '../shared/format';
import type {
  ExchangeId,
  LockedSignalStatus,
  MacroCalendarEvent,
  MarketIntelligenceSnapshot,
  MarketType,
  QuantAssetCategory,
  QuantSignalGrade,
  QuantSignalRow,
  SignalAssetClass,
  SignalEventRecord,
  Timeframe,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type FeedTab = 'quant' | 'resolved' | 'events';
type DirectionFilter = 'ALL' | 'BUY' | 'SELL' | 'WAIT';
type IntelSubTab = 'calendar' | 'news';

const ASSET_CLASS_TABS: {
  id: SignalAssetClass;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'all', label: 'All Markets', sub: 'Crypto + Stocks + Commodities', icon: Layers },
  { id: 'crypto', label: 'Crypto', sub: '12 Exchanges', icon: Coins },
  { id: 'stocks', label: 'US Stocks', sub: 'Equities & ETFs', icon: Landmark },
  { id: 'commodities', label: 'Commodities', sub: 'Gold · Oil · Silver · Gas', icon: Gem },
];

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

function assetClassBadge(assetClass: QuantAssetCategory): { label: string; cls: string } {
  if (assetClass === 'commodities') {
    return { label: 'COMMODITY', cls: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]' };
  }
  if (assetClass === 'stocks') {
    return { label: 'US STOCK', cls: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]' };
  }
  return { label: 'CRYPTO', cls: 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]' };
}

function lockStatusBadge(status: LockedSignalStatus): { label: string; cls: string } {
  switch (status) {
    case 'TP3_HIT':
      return { label: 'TP3 WIN', cls: 'bg-[#059669] text-white' };
    case 'TP2_HIT':
      return { label: 'TP2 HIT · ACTIVE', cls: 'bg-[#10B981] text-white' };
    case 'TP1_HIT':
      return { label: 'TP1 HIT · BE STOP', cls: 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' };
    case 'TP1_SECURED':
      return { label: 'TP1 SECURED (WIN)', cls: 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' };
    case 'SL_HIT':
      return { label: 'STOPPED (SL)', cls: 'bg-[#FFF1F2] text-[#BE123C] border border-[#FECDD3]' };
    case 'EXPIRED':
      return { label: 'EXPIRED', cls: 'bg-[#F1F5F9] text-[#64748B]' };
    case 'ACTIVE':
    default:
      return { label: 'LOCKED STATIC', cls: 'bg-[#0B120E] text-[#4ADE80]' };
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
  const [assetClass, setAssetClass] = useState<SignalAssetClass>('all');
  const [cryptoExchange, setCryptoExchange] = useState<ExchangeId>(
    CRYPTO_EXCHANGES.includes(globalExchange) ? globalExchange : 'binance',
  );
  const [marketType, setMarketType] = useState<MarketType>(
    CRYPTO_EXCHANGES.includes(globalExchange) ? globalMarketType : 'spot',
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(
    QUICK_TIMEFRAMES.includes(globalTimeframe) ? globalTimeframe : '1h',
  );

  const [quantRows, setQuantRows] = useState<QuantSignalRow[]>([]);
  const [resolvedRows, setResolvedRows] = useState<QuantSignalRow[]>([]);
  const [trackRecord, setTrackRecord] = useState<{
    activeLockedCount: number;
    resolvedCount: number;
    winsCount: number;
    lossesCount: number;
    winRatePct: number | null;
  }>({ activeLockedCount: 0, resolvedCount: 0, winsCount: 0, lossesCount: 0, winRatePct: null });
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

  const supportedMarketTypes = EXCHANGE_MARKET_TYPES[cryptoExchange] ?? ['spot'];
  const supportedTimeframes = useMemo(() => {
    const allowed =
      assetClass === 'stocks' || assetClass === 'commodities'
        ? EXCHANGE_TIMEFRAMES.stocks
        : EXCHANGE_TIMEFRAMES[cryptoExchange] ?? QUICK_TIMEFRAMES;
    const quick = QUICK_TIMEFRAMES.filter((tf) => allowed.includes(tf));
    return quick.length > 0 ? quick : allowed.slice(0, 6);
  }, [assetClass, cryptoExchange]);

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const reqExchange: ExchangeId =
        assetClass === 'stocks'
          ? 'stocks'
          : assetClass === 'commodities'
            ? 'cfds'
            : cryptoExchange;
      const reqMarketType: MarketType =
        assetClass === 'stocks'
          ? 'equity'
          : assetClass === 'commodities'
            ? 'cfd'
            : marketType;

      const [quantRes, feedRes] = await Promise.all([
        api.getQuantSignals(reqExchange, reqMarketType, timeframe, forceRefresh, assetClass),
        api.getSignalFeed(120).catch(() => ({ events: [], count: 0 })),
      ]);
      setQuantRows(quantRes.signals);
      setResolvedRows(quantRes.resolvedSignals ?? []);
      setTrackRecord(
        quantRes.trackRecord ?? {
          activeLockedCount: quantRes.actionableCount,
          resolvedCount: 0,
          winsCount: 0,
          lossesCount: 0,
          winRatePct: null,
        },
      );
      setHtfTimeframe(quantRes.htfTimeframe);
      setIntel(quantRes.intelligence);
      setMethodologyNote(quantRes.methodologyNote);
      setScannedAt(quantRes.scannedAt);
      setEvents(feedRes.events);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to run static quant signal scan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supportedMarketTypes.includes(marketType)) {
      setMarketType(defaultMarketTypeFor(cryptoExchange));
      return;
    }
    if (!supportedTimeframes.includes(timeframe)) {
      setTimeframe(supportedTimeframes.includes('1h') ? '1h' : supportedTimeframes[0]);
      return;
    }
    loadData(false);
    const t = window.setInterval(() => loadData(false), 60_000);
    return () => window.clearInterval(t);
  }, [assetClass, cryptoExchange, marketType, timeframe]);

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

  const classCounts = useMemo(
    () => ({
      crypto: actionableRows.filter((r) => r.assetClass === 'crypto').length,
      stocks: actionableRows.filter((r) => r.assetClass === 'stocks').length,
      commodities: actionableRows.filter((r) => r.assetClass === 'commodities').length,
    }),
    [actionableRows],
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

  const filteredResolved = useMemo(() => {
    return resolvedRows.filter((row) => {
      if (
        assetFilter &&
        !row.displaySymbol.includes(assetFilter.toUpperCase()) &&
        !row.baseAsset.includes(assetFilter.toUpperCase())
      ) {
        return false;
      }
      if (dirFilter === 'BUY' && row.action !== 'BUY') return false;
      if (dirFilter === 'SELL' && row.action !== 'SELL') return false;
      return true;
    });
  }, [assetFilter, dirFilter, resolvedRows]);

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

  const handleCopy = async (row: QuantSignalRow) => {
    const lockedEntry = row.lockState?.lockedEntryPrice ?? row.setup.entryPrice;
    const header = `[SIGLENS STATIC LOCKED ${row.grade} · ${row.assetClass.toUpperCase()} · Alpha ${row.alphaScore}/100 · HTF ${row.htfBias}]`;
    const histLine =
      row.historicalEdge.sampleTrades >= 3 && row.historicalEdge.winRatePct !== null
        ? `• Historical Edge: ${row.historicalEdge.winRatePct}% win (${row.historicalEdge.expectancyR !== null && row.historicalEdge.expectancyR >= 0 ? '+' : ''}${row.historicalEdge.expectancyR}R across ${row.historicalEdge.sampleTrades} trades)`
        : '• Historical Edge: Fresh regime';
    const text = `${header}\n${formatSignalCopyText(row.setup, row.timeframe, lockedEntry)}\n• Lock Status: ${row.lockState?.status ?? 'STATIC'} (Non-repainting closed-candle levels)\n${histLine}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(row.lockState?.lockId ?? row.canonicalId);
      window.setTimeout(() => setCopiedId(null), 1600);
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

  const renderSignalCard = (row: QuantSignalRow, isResolvedCard = false) => {
    const live = liveTickers[row.canonicalId];
    const livePrice = isResolvedCard
      ? row.lockState?.closedPrice ?? row.price
      : live?.lastPrice ?? row.price;
    const lockedEntry = row.lockState?.lockedEntryPrice ?? row.setup.entryPrice;
    const isBuy = row.action === 'BUY';
    const isSell = row.action === 'SELL';
    const isWait = row.action === 'WAIT';

    // Compute live P&L strictly vs STATIC locked entry (never repainting entry!)
    const livePnlPct =
      isResolvedCard
        ? row.lockState?.realizedPct ?? null
        : lockedEntry && lockedEntry > 0 && !isWait
          ? Number(
              (
                ((isBuy ? livePrice - lockedEntry : lockedEntry - livePrice) / lockedEntry) *
                100
              ).toFixed(2),
            )
          : row.lockState?.livePnlPct ?? null;

    const acBadge = assetClassBadge(row.assetClass);
    const stBadge = row.lockState ? lockStatusBadge(row.lockState.status) : null;

    const accentBorder = isBuy
      ? 'border-[#A7F3D0]'
      : isSell
        ? 'border-[#FECDD3]'
        : 'border-[#E6E8EE]';

    return (
      <article
        key={row.lockState?.lockId ?? row.canonicalId}
        className={`rounded-2xl bg-white border ${accentBorder} p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow`}
      >
        {/* Top Lock + Asset Class Strip */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold ${acBadge.cls}`}
            >
              {acBadge.label}
            </span>
            {stBadge && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${stBadge.cls}`}
              >
                <Lock className="w-2.5 h-2.5" />
                {stBadge.label}
              </span>
            )}
          </div>
          {row.lockState && (
            <span className="text-[10px] font-mono text-[#64748B]">
              Locked {formatTimestamp(row.lockState.lockedAt, timezone, false)}
            </span>
          )}
        </div>

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
              <span>{row.timeframe}</span>
              {row.htfTimeframe && (
                <>
                  <span>→</span>
                  <span>HTF {row.htfTimeframe}</span>
                </>
              )}
              <span>·</span>
              <span className="font-semibold text-[#0A0D14]">Alpha {row.alphaScore}</span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[10px] font-mono text-[#64748B]">
              {isResolvedCard ? 'Closed At' : 'Live Market'}
            </div>
            <div className="font-mono text-sm font-bold text-[#0A0D14] tabular-nums">
              ${formatPrice(livePrice)}
            </div>
            {livePnlPct !== null ? (
              <div
                className={`text-[11px] font-mono font-bold tabular-nums ${
                  livePnlPct >= 0 ? 'text-[#047857]' : 'text-[#BE123C]'
                }`}
              >
                {livePnlPct >= 0 ? '+' : ''}
                {livePnlPct.toFixed(2)}% vs Entry
              </div>
            ) : (
              <div
                className={`text-[11px] font-mono tabular-nums ${
                  row.change24hPct >= 0 ? 'text-[#047857]' : 'text-[#BE123C]'
                }`}
              >
                {formatPercent(row.change24hPct)}
              </div>
            )}
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
            <div className="text-[10px] text-[#64748B] font-mono">HTF {row.htfTimeframe ?? ''}</div>
            <div
              className={`font-mono font-bold ${
                row.htfBias === 'BULLISH'
                  ? 'text-[#047857]'
                  : row.htfBias === 'BEARISH'
                    ? 'text-[#BE123C]'
                    : 'text-[#64748B]'
              }`}
            >
              {row.htfBias === 'BULLISH' ? 'BULL' : row.htfBias === 'BEARISH' ? 'BEAR' : 'NEUT'}
            </div>
            <div className="text-[10px] text-[#64748B] font-mono">
              {row.htfAligned ? 'Aligned' : 'Diverged'}
            </div>
          </div>

          <div className="rounded-xl bg-[#F8FAFC] border border-[#E6E8EE] px-2 py-1.5">
            <div className="text-[10px] text-[#64748B] font-mono">HIST EDGE</div>
            <div
              className={`font-mono font-bold tabular-nums ${
                row.historicalEdge.expectancyR !== null && row.historicalEdge.expectancyR > 0
                  ? 'text-[#047857]'
                  : row.historicalEdge.expectancyR !== null && row.historicalEdge.expectancyR < 0
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
                : row.assetSentiment.headlinesCount > 0
                  ? `${row.assetSentiment.headlinesCount} news`
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

        {/* STATIC Frozen Trade Execution Plan OR Blocked Reason Panel */}
        {!isWait ? (
          <div className="rounded-xl bg-[#F4F6F5] border border-[#E2E8E5] p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0A0D14]">
                <Lock className="w-3 h-3 text-[#059669]" />
                {row.antiChase.entryMode === 'PULLBACK_ZONE'
                  ? 'Static Pullback Zone'
                  : 'Static Locked Entry'}
              </span>
              <span className="font-mono font-bold tabular-nums text-[#0A0D14]">
                {row.antiChase.entryMode === 'PULLBACK_ZONE' &&
                row.setup.entryZoneLow &&
                row.setup.entryZoneHigh
                  ? `$${formatPrice(row.setup.entryZoneLow)} – $${formatPrice(row.setup.entryZoneHigh)}`
                  : `$${formatPrice(lockedEntry)}`}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#E2E8E5]">
              <span className="text-[11px] font-semibold text-[#BE123C]">
                {row.lockState?.tp1HitAt
                  ? 'Protected Stop (Moved to BE)'
                  : 'Static Stop Loss (SL)'}
              </span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  row.lockState?.tp1HitAt ? 'text-[#047857]' : 'text-[#BE123C]'
                }`}
              >
                $
                {formatPrice(
                  row.lockState?.tp1HitAt ? lockedEntry : row.setup.stopLoss,
                )}{' '}
                {!row.lockState?.tp1HitAt && row.setup.stopLossPct !== null && (
                  <span className="font-normal text-[11px]">
                    ({row.setup.stopLossPct > 0 ? '+' : ''}
                    {row.setup.stopLossPct.toFixed(2)}%)
                  </span>
                )}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-[#E2E8E5]">
              {row.setup.takeProfits.map((tp, idx) => {
                const hit =
                  (idx === 0 && Boolean(row.lockState?.tp1HitAt)) ||
                  (idx === 1 && Boolean(row.lockState?.tp2HitAt)) ||
                  (idx === 2 && Boolean(row.lockState?.tp3HitAt));
                return (
                  <div
                    key={tp.label}
                    className={`rounded-lg border px-2 py-1.5 text-center transition-colors ${
                      hit
                        ? 'bg-[#059669] border-[#059669] text-white'
                        : 'bg-white border-[#E2E8E5]'
                    }`}
                  >
                    <div
                      className={`text-[10px] font-mono flex items-center justify-center gap-0.5 ${
                        hit ? 'text-emerald-100' : 'text-[#64748B]'
                      }`}
                    >
                      {hit && <Check className="w-2.5 h-2.5" />}
                      {tp.label} ({tp.rrRatio.toFixed(1)}R)
                    </div>
                    <div
                      className={`font-mono text-[11px] font-bold tabular-nums ${
                        hit ? 'text-white' : 'text-[#047857]'
                      }`}
                    >
                      ${formatPrice(tp.price)}
                    </div>
                    <div
                      className={`font-mono text-[10px] tabular-nums ${
                        hit ? 'text-emerald-100' : 'text-[#059669]'
                      }`}
                    >
                      {tp.pctFromEntry > 0 ? '+' : ''}
                      {tp.pctFromEntry.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>

            {row.lockState && !isResolvedCard && (
              <div className="text-[10px] font-mono text-[#64748B] flex items-center justify-between pt-1">
                <span>Non-repainting closed-candle levels</span>
                <span>Valid til {formatTimestamp(row.lockState.expiresAt, timezone, false)}</span>
              </div>
            )}
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
            onClick={() => handleCopy(row)}
            className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#F4F6F5] hover:bg-[#E6ECE9] text-[#0A0D14] font-medium transition-colors"
          >
            {copiedId === (row.lockState?.lockId ?? row.canonicalId) ? (
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
            onClick={() => selectMarket(row.exchange, row.marketType, row.displaySymbol, true)}
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
  };

  return (
    <div className="space-y-4">
      {/* Header Strip */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#0B120E] text-[#4ADE80] tracking-wide">
              <Lock className="w-3 h-3" />
              STATIC LOCKED QUANT SIGNALS · ZERO REPAINT
            </span>
            {htfTimeframe && (
              <span className="text-[11px] font-mono text-[#64748B]">
                HTF Filter: <strong className="text-[#0A0D14]">{htfTimeframe}</strong>
              </span>
            )}
            {trackRecord.resolvedCount > 0 && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#047857] font-semibold">
                Locked Track Record: {trackRecord.winsCount}W / {trackRecord.lossesCount}L
                {trackRecord.winRatePct !== null ? ` (${trackRecord.winRatePct}%)` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B] max-w-3xl">
            Signals are locked to closed candles across <strong>Crypto</strong>, <strong>US Stocks</strong>, and <strong>Commodities</strong>. Entry, Stop Loss, and TP1/TP2/TP3 stay 100% static — they never shift or flip mid-trade until TP3, Stop Loss, Breakeven after TP1, or Expiry.
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
            {loading ? 'Scanning…' : 'Check Closed Candles'}
          </button>
        </div>
      </div>

      {/* Prominent Multi-Asset Class Selector: All Markets | Crypto | US Stocks | Commodities */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {ASSET_CLASS_TABS.map((item) => {
          const Icon = item.icon;
          const active = assetClass === item.id;
          const badgeCount =
            item.id === 'all'
              ? actionableRows.length
              : assetClass === 'all'
                ? classCounts[item.id]
                : active
                  ? actionableRows.length
                  : null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setAssetClass(item.id)}
              className={`rounded-2xl border p-3 text-left transition-all flex items-center justify-between gap-2 ${
                active
                  ? 'bg-[#0B120E] text-white border-[#0B120E] shadow-sm'
                  : 'bg-white text-[#0A0D14] border-[#E6E8EE] hover:border-[#A7F3D0] hover:bg-[#F8FAF9]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    active ? 'bg-[#16A34A]/20 text-[#4ADE80]' : 'bg-[#F4F6F5] text-[#059669]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{item.label}</div>
                  <div
                    className={`text-[10px] truncate ${
                      active ? 'text-[#86A792]' : 'text-[#64748B]'
                    }`}
                  >
                    {item.sub}
                  </div>
                </div>
              </div>
              {badgeCount !== null && (
                <span
                  className={`font-mono text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    active ? 'bg-[#4ADE80]/20 text-[#4ADE80]' : 'bg-[#ECFDF5] text-[#047857]'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Live Market Intelligence Bento */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 rounded-2xl bg-[#0B120E] text-[#F1F5F2] border border-[#1E2E24] p-4 flex flex-col justify-between gap-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-[#86A792]">
                Social &amp; Cross-Market Sentiment
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
              </div>
            </div>
          </div>

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
                {intel
                  ? `${intel.newsSentimentScore > 0 ? '+' : ''}${intel.newsSentimentScore}`
                  : '—'}
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

          <div>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#86A792] mb-1.5">
              <span className="inline-flex items-center gap-1">
                <Flame className="w-3 h-3 text-[#F59E0B]" />
                Trending Buzz
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
                >
                  <span className="text-[#86A792]">#{coin.rank}</span>
                  <span className="font-semibold text-white">{coin.symbol}</span>
                  {coin.priceChange24hPct !== null && (
                    <span
                      className={coin.priceChange24hPct >= 0 ? 'text-[#4ADE80]' : 'text-[#FDA4AF]'}
                    >
                      {coin.priceChange24hPct >= 0 ? '+' : ''}
                      {coin.priceChange24hPct.toFixed(1)}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 sig-glass rounded-2xl p-4 flex flex-col gap-3">
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
              <span>
                {intel?.eventRiskSummary ?? 'Evaluating live macro calendar & breaking news risk…'}
              </span>
            </div>
            <span className="font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/70">
              RISK: {intel?.eventRiskLevel ?? '—'}
            </span>
          </div>

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
                {loading ? 'Loading live news feeds…' : 'No live news catalysts available.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mode Switch Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EE] pb-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('quant')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'quant' ? 'sig-btn-primary' : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Static Locked Signals ({actionableRows.length} Active / {quantRows.length} Scanned)
          </button>
          <button
            type="button"
            onClick={() => setTab('resolved')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'resolved' ? 'sig-btn-primary' : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Resolved Locked History ({resolvedRows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('events')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'events' ? 'sig-btn-primary' : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Scanner Event Log ({events.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums sig-glass-subtle px-3.5 py-1.5 rounded-full">
          <span className="text-[#047857] font-semibold">LOCKED BUY: {buyCount}</span>
          <span className="text-[#BE123C] font-semibold">LOCKED SELL: {sellCount}</span>
          <span className="text-[#64748B]">FILTERED: {blockedCount}</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="sig-glass rounded-2xl p-3 flex flex-wrap items-center gap-2.5 text-xs">
        <input
          type="text"
          value={assetFilter}
          onChange={(e) => setAssetFilter(e.target.value)}
          placeholder="Symbol e.g. XAU, NVDA, BTC"
          aria-label="Filter signals by symbol"
          className="w-44 px-3 py-1.5 rounded-xl sig-glass-subtle font-mono text-[#0A0D14] placeholder-[#64748B]"
        />

        {(tab === 'quant' || tab === 'resolved') && (
          <>
            {(assetClass === 'all' || assetClass === 'crypto') && (
              <>
                <select
                  aria-label="Crypto exchange"
                  value={cryptoExchange}
                  onChange={(e) => {
                    const ex = e.target.value as ExchangeId;
                    setCryptoExchange(ex);
                    const allowedTypes = EXCHANGE_MARKET_TYPES[ex];
                    if (!allowedTypes.includes(marketType)) {
                      setMarketType(defaultMarketTypeFor(ex));
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14] font-medium"
                >
                  {CRYPTO_EXCHANGES.map((ex) => (
                    <option key={ex} value={ex} className="bg-white">
                      Crypto: {EXCHANGE_LABELS[ex]}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Crypto market type"
                  value={marketType}
                  onChange={(e) => setMarketType(e.target.value as MarketType)}
                  className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14]"
                >
                  {supportedMarketTypes.map((mt) => (
                    <option key={mt} value={mt} className="bg-white capitalize">
                      {mt === 'perpetual' ? 'Perpetual' : 'Spot'}
                    </option>
                  ))}
                </select>
              </>
            )}

            <select
              aria-label="Signals timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle font-mono text-[#0A0D14]"
            >
              {supportedTimeframes.map((tf) => (
                <option key={tf} value={tf} className="bg-white">
                  TF: {tf}
                </option>
              ))}
            </select>

            {tab === 'quant' && (
              <button
                type="button"
                onClick={() => setHighConvictionOnly((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold border transition-all ${
                  highConvictionOnly
                    ? 'bg-[#0B120E] text-[#4ADE80] border-[#0B120E]'
                    : 'bg-white text-[#475569] border-[#CBD5E1] hover:bg-[#F8FAFC]'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {highConvictionOnly
                  ? `Locked Active Only (${blockedCount} filtered)`
                  : `Showing All (${blockedCount} blocked included)`}
              </button>
            )}
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
          {tab === 'quant'
            ? `${filteredQuant.length} shown`
            : tab === 'resolved'
              ? `${filteredResolved.length} resolved`
              : `${filteredEvents.length} events`}
        </span>
      </div>

      {errorMsg && (
        <div className="rounded-xl bg-[#FFF1F2] border border-[#FECDD3] px-4 py-3 text-xs text-[#BE123C] flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => loadData(true)} className="underline font-semibold">
            Retry
          </button>
        </div>
      )}

      {/* Main Content Grid */}
      {loading && quantRows.length === 0 && resolvedRows.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <SkeletonBlock key={idx} className="h-72" />
          ))}
        </div>
      ) : tab === 'quant' ? (
        filteredQuant.length === 0 ? (
          <div className="sig-glass rounded-2xl p-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#EAF0EC] text-[#047857]">
              <Lock className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-[#0A0D14]">
              {highConvictionOnly && quantRows.length > 0
                ? `No Active Locked Signals on ${timeframe} (${quantRows.length} scanned pairs filtered).`
                : 'No static signals match your current filters.'}
            </div>
            <p className="text-xs text-[#64748B] max-w-xl mx-auto">
              {highConvictionOnly && quantRows.length > 0
                ? 'Static signals only lock on closed candles that pass HTF trend alignment, positive historical expectancy, ADX trend strength, and macro event filters. Try switching timeframe (e.g., 1h or 4h), selecting All Markets, or inspecting blocked pairs.'
                : 'Adjust your direction, asset class, or symbol filter above.'}
            </p>
            {highConvictionOnly && quantRows.length > 0 && (
              <button
                type="button"
                onClick={() => setHighConvictionOnly(false)}
                className="px-4 py-1.5 rounded-xl bg-[#0B120E] text-[#4ADE80] text-xs font-semibold"
              >
                Inspect {quantRows.length} Filtered Pairs &amp; Rejection Reasons
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {filteredQuant.map((row) => renderSignalCard(row, false))}
          </div>
        )
      ) : tab === 'resolved' ? (
        filteredResolved.length === 0 ? (
          <div className="sig-glass rounded-2xl p-8 text-center text-xs text-[#64748B]">
            No locked static signals have resolved in the last 72 hours for this timeframe yet. Once an active locked signal hits TP3, Breakeven after TP1, Stop Loss, or expires, its final outcome appears here permanently.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {filteredResolved.map((row) => renderSignalCard(row, true))}
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

      {methodologyNote && (
        <div className="rounded-xl bg-[#F4F6F5] border border-[#E2E8E5] px-3.5 py-2.5 flex items-start gap-2 text-[11px] text-[#64748B]">
          <Activity className="w-4 h-4 shrink-0 text-[#059669] mt-0.5" />
          <span>{methodologyNote}</span>
        </div>
      )}
    </div>
  );
};
