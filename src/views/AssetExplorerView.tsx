import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronUp,
  LineChart,
  RefreshCw,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { Chart2D } from '../components/charts/Chart2D';
import { SignalScoreBar, SkeletonBlock } from '../components/ui/SignalMeter';
import { StructuredSignalCard } from '../components/ui/StructuredSignalCard';
import { api, type AssetSignalBundle } from '../services/api';
import { EXCHANGE_LABELS, EXCHANGE_TIMEFRAMES } from '../shared/constants';
import {
  formatCompactUsd,
  formatPercent,
  formatPrice,
  formatTimestamp,
  signalBgClass,
  signalColorClass,
  signalLabel,
} from '../shared/format';
import type { MultiTimeframeSummary, OrderBookSnapshot, Timeframe } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

const Chart3DStudio = lazy(() =>
  import('../components/charts/Chart3DStudio').then((m) => ({ default: m.Chart3DStudio })),
);

export const AssetExplorerView: React.FC = () => {
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const preferences = useAppStore((s) => s.preferences);
  const watchlist = useAppStore((s) => s.watchlist);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const liveCandle = useAppStore((s) => s.liveCandle);
  const setTimeframe = useAppStore((s) => s.setTimeframe);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);

  const canonicalId = `${exchange}:${marketType}:${symbol}`;
  const isWatched = watchlist.includes(canonicalId);
  const supportedTimeframes = EXCHANGE_TIMEFRAMES[exchange];

  const [chartMode, setChartMode] = useState<'2d' | '3d'>(preferences.defaultChartMode);
  const [bundle, setBundle] = useState<AssetSignalBundle | null>(null);
  const [mtf, setMtf] = useState<MultiTimeframeSummary | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawMath, setShowRawMath] = useState(false);

  const loadAsset = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sigRes, mtfRes, obRes] = await Promise.allSettled([
        api.getAssetSignals(exchange, marketType, symbol, timeframe, 260),
        api.getMultiTimeframe(exchange, marketType, symbol),
        api.getOrderBook(exchange, marketType, symbol),
      ]);

      if (sigRes.status === 'fulfilled') {
        setBundle(sigRes.value);
      } else {
        throw new Error(
          sigRes.reason instanceof Error
            ? sigRes.reason.message
            : 'This market is not available from the selected exchange.',
        );
      }

      if (mtfRes.status === 'fulfilled') setMtf(mtfRes.value);
      else setMtf(null);

      if (obRes.status === 'fulfilled') setOrderBook(obRes.value);
      else setOrderBook(null);
    } catch (err) {
      setBundle(null);
      setError(err instanceof Error ? err.message : 'Unable to load asset analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAsset();
  }, [exchange, marketType, symbol, timeframe]);

  // Merge streaming forming candle cleanly into displayed chart array without repainting confirmed signal
  const mergedCandles = useMemo(() => {
    const base = bundle?.candles ?? [];
    if (
      !liveCandle ||
      liveCandle.canonicalId !== canonicalId ||
      liveCandle.timeframe !== timeframe ||
      base.length === 0
    ) {
      return base;
    }
    const copy = [...base];
    const last = copy[copy.length - 1];
    if (liveCandle.candle.openTime === last.openTime) {
      copy[copy.length - 1] = liveCandle.candle;
    } else if (liveCandle.candle.openTime > last.openTime) {
      copy.push(liveCandle.candle);
    }
    return copy;
  }, [bundle?.candles, canonicalId, liveCandle, timeframe]);

  const livePatch = liveTickers[canonicalId];
  const latestCandle = mergedCandles[mergedCandles.length - 1];
  const displayPrice = livePatch?.lastPrice ?? latestCandle?.close ?? null;
  const priceDirection =
    livePatch && livePatch.lastPrice !== livePatch.prevPrice
      ? livePatch.lastPrice > livePatch.prevPrice
        ? 'up'
        : 'down'
      : null;

  const confirmed = bundle?.confirmed ?? null;
  const provisional = bundle?.provisional ?? null;

  return (
    <div className="space-y-5">
      {/* Asset Header Bar */}
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold font-mono tracking-tight">{symbol}</h1>
              <span className="text-xs text-[#677482] dark:text-[#8B97A5]">
                {EXCHANGE_LABELS[exchange]} · {marketType === 'perpetual' ? 'Linear Perpetual' : 'Spot'} · {timeframe}
              </span>
              <button
                type="button"
                onClick={() => toggleWatchlist(canonicalId)}
                aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                className="p-1 rounded-md hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
              >
                <Star className={`w-4 h-4 ${isWatched ? 'fill-[#B6F36A] text-[#B6F36A]' : 'text-[#677482]'}`} />
              </button>
            </div>
            <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
              Source: {bundle?.source ?? `${EXCHANGE_LABELS[exchange]} Public API`} · Freshness:{' '}
              <span className="font-mono font-medium text-[#17212B] dark:text-[#F4F7FA]">
                {bundle?.freshness ?? 'LOADING'}
              </span>
              {confirmed?.metadata.calculatedAt && (
                <span> · Updated {formatTimestamp(confirmed.metadata.calculatedAt, preferences.timezone, false)}</span>
              )}
            </div>
          </div>

          <div
            className={`px-2 py-1 rounded-md font-mono text-2xl font-bold tabular-nums ${
              priceDirection === 'up'
                ? 'animate-flash-up'
                : priceDirection === 'down'
                  ? 'animate-flash-down'
                  : ''
            }`}
          >
            ${formatPrice(displayPrice, preferences.decimalPrecision)}
          </div>
        </div>

        {/* Key Market Telemetry */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono tabular-nums">
          {livePatch?.change24hPct !== undefined && (
            <div>
              <div className="text-[11px] font-sans text-[#677482] dark:text-[#8B97A5]">24h Change</div>
              <div
                className={
                  livePatch.change24hPct >= 0
                    ? 'text-[#16A378] dark:text-[#35C89A] font-semibold'
                    : 'text-[#DC4C54] dark:text-[#F16B72] font-semibold'
                }
              >
                {formatPercent(livePatch.change24hPct)}
              </div>
            </div>
          )}
          {orderBook?.spreadPct !== null && orderBook?.spreadPct !== undefined && (
            <div>
              <div className="text-[11px] font-sans text-[#677482] dark:text-[#8B97A5]">Book Spread</div>
              <div>{orderBook.spreadPct.toFixed(4)}%</div>
            </div>
          )}
          {livePatch?.quoteVolume24h !== undefined && (
            <div>
              <div className="text-[11px] font-sans text-[#677482] dark:text-[#8B97A5]">24h Volume</div>
              <div>{formatCompactUsd(livePatch.quoteVolume24h)}</div>
            </div>
          )}
          <button
            type="button"
            onClick={loadAsset}
            aria-label="Recalculate asset analytics"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] hover:border-[#94A3B8] font-sans font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-8 text-center">
          <AlertTriangle className="w-6 h-6 text-[#F16B72] mx-auto mb-2" />
          <h2 className="text-sm font-semibold">Market Data Unavailable</h2>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-1 max-w-md mx-auto">
            {error} This pair or timeframe may not be listed on {EXCHANGE_LABELS[exchange]} ({marketType}).
          </p>
        </div>
      ) : loading && !bundle ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <SkeletonBlock className="h-[520px] xl:col-span-8" />
          <SkeletonBlock className="h-[520px] xl:col-span-4" />
        </div>
      ) : (
        <>
          {/* Main Two-Column Analytical Workspace */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* LEFT: Interactive 2D / 3D Financial Chart */}
            <div className="xl:col-span-8 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              {/* Timeframe Bar + 2D/3D Switch */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-[#E6EBF0] dark:border-[#27313C]">
                <div className="flex flex-wrap items-center gap-1">
                  {supportedTimeframes.map((tf: Timeframe) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`px-2 py-1 rounded-md text-xs font-mono transition-colors ${
                        timeframe === tf
                          ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] font-semibold'
                          : 'text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F1F5F9] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C]">
                  <button
                    type="button"
                    onClick={() => setChartMode('2d')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      chartMode === '2d'
                        ? 'bg-[#FFFFFF] dark:bg-[#1B232D] text-[#17212B] dark:text-[#B6F36A]'
                        : 'text-[#677482] dark:text-[#8B97A5]'
                    }`}
                  >
                    <LineChart className="w-3.5 h-3.5" />
                    2D Chart
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('3d')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      chartMode === '3d'
                        ? 'bg-[#FFFFFF] dark:bg-[#1B232D] text-[#17212B] dark:text-[#B6F36A]'
                        : 'text-[#677482] dark:text-[#8B97A5]'
                    }`}
                  >
                    <Box className="w-3.5 h-3.5" />
                    3D Studio
                  </button>
                </div>
              </div>

              {chartMode === '2d' ? (
                <Chart2D
                  candles={mergedCandles}
                  series={bundle?.series ?? null}
                  supportResistance={bundle?.supportResistance ?? []}
                  signalSetup={(preferences.showLiveProvisional && provisional ? provisional : confirmed)?.signalSetup ?? null}
                  symbol={symbol}
                  timeframe={timeframe}
                  height={460}
                />
              ) : (
                <Suspense fallback={<SkeletonBlock className="h-[500px]" />}>
                  <Chart3DStudio
                    candles={mergedCandles}
                    series={bundle?.series ?? null}
                    supportResistance={bundle?.supportResistance ?? []}
                    orderBook={orderBook}
                    symbol={symbol}
                    timeframe={timeframe}
                    height={500}
                    onFallbackTo2D={() => setChartMode('2d')}
                  />
                </Suspense>
              )}
            </div>

            {/* RIGHT: Deterministic Explainable Signal Report */}
            {confirmed && (
              <div
                data-testid="signal-report-panel"
                className="xl:col-span-4 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-[#677482] dark:text-[#8B97A5] mb-2">
                    <span className="font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                      Confirmed Signal (Last Closed Candle)
                    </span>
                    <span className="font-mono">v{confirmed.metadata.engineVersion}</span>
                  </div>
                  <SignalScoreBar
                    score={confirmed.directionalScore}
                    classification={confirmed.classification}
                  />
                </div>

                {/* Structured Real-Time Signal Setup: Symbol / Direction / Entry / SL / TP1-TP3 */}
                <StructuredSignalCard
                  setup={(preferences.showLiveProvisional && provisional ? provisional : confirmed).signalSetup}
                  timeframe={timeframe}
                  livePrice={displayPrice}
                  statusTag={preferences.showLiveProvisional && provisional ? 'REAL-TIME' : 'CONFIRMED'}
                  compact
                />

                {/* Live Provisional Preview Distinction */}
                {preferences.showLiveProvisional && provisional && (
                  <div className="rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C] p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[#677482] dark:text-[#8B97A5]">
                        Live Preview (Forming Candle · Provisional)
                      </span>
                      <span className={`font-mono font-semibold ${signalColorClass(provisional.classification)}`}>
                        {provisional.label} ({provisional.directionalScore > 0 ? '+' : ''}
                        {provisional.directionalScore})
                      </span>
                    </div>
                    <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-1">
                      Unconfirmed until the active {timeframe} candle closes. Historical records only log confirmed bars.
                    </p>
                  </div>
                )}

                {/* Agreement & Quality Metrics Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C]">
                    <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Indicator Agreement</div>
                    <div className="font-mono font-semibold mt-0.5 tabular-nums">
                      {confirmed.agreement.agreementPct}% ({confirmed.agreement.bullishCount}B / {confirmed.agreement.bearishCount}S / {confirmed.agreement.neutralCount}N)
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C]">
                    <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Data Quality & Stability</div>
                    <div className="font-mono font-semibold mt-0.5">
                      {confirmed.dataQuality} · {confirmed.signalStability}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] col-span-2">
                    <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Market Regime</div>
                    <div className="font-mono font-medium mt-0.5 text-[#17212B] dark:text-[#F4F7FA]">
                      {confirmed.regime.combinedLabel}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] col-span-2">
                    <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                      Historical Out-of-Sample Reliability
                    </div>
                    <div className="font-mono font-medium mt-0.5">
                      {confirmed.historicalReliability}
                    </div>
                  </div>
                </div>

                {/* Why This Signal Appeared */}
                <div className="space-y-2 border-t border-[#E6EBF0] dark:border-[#27313C] pt-3">
                  <h3 className="text-xs font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                    Why This Signal Appeared
                  </h3>
                  {confirmed.supportingEvidence.length === 0 ? (
                    <p className="text-xs text-[#677482] dark:text-[#8B97A5]">
                      No dominant directional evidence above neutral thresholds.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-[#677482] dark:text-[#8B97A5]">
                      {confirmed.supportingEvidence.slice(0, 6).map((item, i) => (
                        <li key={i} className="leading-relaxed">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Contradictory Evidence */}
                <div className="space-y-1.5 border-t border-[#E6EBF0] dark:border-[#27313C] pt-3">
                  <h3 className="text-xs font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                    Contradictory Evidence
                  </h3>
                  {confirmed.contradictoryEvidence.length === 0 ? (
                    <p className="text-xs text-[#677482] dark:text-[#8B97A5]">
                      No direct counter-directional indicator readings detected.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-xs text-[#DC4C54] dark:text-[#F16B72]">
                      {confirmed.contradictoryEvidence.map((item, i) => (
                        <li key={i}>· {item}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Observable Invalidation Conditions */}
                <div className="space-y-1.5 border-t border-[#E6EBF0] dark:border-[#27313C] pt-3">
                  <h3 className="text-xs font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                    Analytical Invalidation Conditions
                  </h3>
                  <ul className="space-y-1 text-xs text-[#677482] dark:text-[#8B97A5]">
                    {confirmed.invalidationConditions.map((item, i) => (
                      <li key={i}>· {item}</li>
                    ))}
                  </ul>
                </div>

                {/* Safeguard Notices */}
                {confirmed.safeguardNotes.length > 0 && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5 text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" /> Safeguard Notes
                    </div>
                    {confirmed.safeguardNotes.map((n, i) => (
                      <div key={i}>· {n}</div>
                    ))}
                  </div>
                )}

                {/* Expandable Raw Calculations Audit */}
                <div className="border-t border-[#E6EBF0] dark:border-[#27313C] pt-3">
                  <button
                    type="button"
                    onClick={() => setShowRawMath((v) => !v)}
                    aria-expanded={showRawMath}
                    className="w-full flex items-center justify-between text-xs font-medium text-[#6B9F30] dark:text-[#B6F36A]"
                  >
                    <span>Show calculations (raw mathematical audit)</span>
                    {showRawMath ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showRawMath && (
                    <div className="mt-2.5 p-3 rounded-lg bg-[#F7F9FB] dark:bg-[#0B0F14] border border-[#E6EBF0] dark:border-[#27313C] font-mono text-[11px] space-y-1.5 overflow-x-auto">
                      <div>Raw Weighted Score: {confirmed.rawWeightedScore}</div>
                      <div>ATR Volatility Modifier: {confirmed.volatilityModifier.toFixed(2)}x</div>
                      <div>Coverage: {confirmed.agreement.coveragePct}% ({confirmed.metadata.candleCount} closed bars)</div>
                      <div>Last Completed Bar: {formatTimestamp(confirmed.metadata.lastCompletedCandleTime, preferences.timezone)}</div>
                      <div className="pt-1 border-t border-[#E6EBF0] dark:border-[#27313C]">
                        {confirmed.indicators.map((ind) => (
                          <div key={ind.id} className="flex justify-between gap-2">
                            <span>{ind.id} (w={ind.effectiveWeight})</span>
                            <span>ev={ind.evidence.toFixed(3)} · {ind.bias}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Multi-Timeframe Analysis Matrix */}
          {mtf && (
            <section className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Multi-Timeframe Analysis Matrix</h2>
                  <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
                    {mtf.alignmentSummary} · Consistency {mtf.consistencyScore}% · {mtf.higherTimeframeContext}
                  </p>
                </div>
                {mtf.conflictWarnings.length > 0 && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    {mtf.conflictWarnings[0]}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] text-[#677482] dark:text-[#8B97A5]">
                      <th className="py-2 text-left font-medium">Timeframe</th>
                      <th className="py-2 text-left font-medium">Confirmed Signal</th>
                      <th className="py-2 text-right font-medium">Score</th>
                      <th className="py-2 text-left pl-4 font-medium">Trend Strength</th>
                      <th className="py-2 text-right font-medium">Agreement</th>
                      <th className="py-2 text-right font-medium">RSI 14</th>
                      <th className="py-2 text-right font-medium">ADX 14</th>
                      <th className="py-2 text-left pl-4 font-medium">Regime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60 font-mono tabular-nums">
                    {mtf.rows.map((r) => (
                      <tr
                        key={r.timeframe}
                        onClick={() => r.available && setTimeframe(r.timeframe)}
                        className={`cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]/50 ${
                          r.timeframe === timeframe ? 'bg-[#F1F5F9]/60 dark:bg-[#1B232D]/40' : ''
                        }`}
                      >
                        <td className="py-2.5 font-semibold">{r.timeframe}</td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${signalBgClass(r.classification)}`}>
                            {r.label}
                          </span>
                        </td>
                        <td className={`py-2.5 text-right ${signalColorClass(r.classification)}`}>
                          {r.available ? (r.directionalScore > 0 ? `+${r.directionalScore}` : r.directionalScore) : '—'}
                        </td>
                        <td className="py-2.5 pl-4 font-sans text-[#677482] dark:text-[#8B97A5]">{r.trendStrength}</td>
                        <td className="py-2.5 text-right">
                          {r.available ? `${Math.max(r.bullishCount, r.bearishCount)}/${r.totalActive} (${r.agreementPct}%)` : '—'}
                        </td>
                        <td className="py-2.5 text-right">{r.rsi !== null ? r.rsi.toFixed(1) : '—'}</td>
                        <td className="py-2.5 text-right">{r.adx !== null ? r.adx.toFixed(1) : '—'}</td>
                        <td className="py-2.5 pl-4 font-sans text-[#677482] dark:text-[#8B97A5]">{r.regime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Full 10-Indicator Family Breakdown Table */}
          {confirmed && (
            <section className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-semibold mb-3">
                10-Indicator Technical Analysis Breakdown ({timeframe} Completed Bar)
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] text-[#677482] dark:text-[#8B97A5]">
                      <th className="py-2 text-left font-medium">Indicator Family</th>
                      <th className="py-2 text-left font-medium">Bias / Role</th>
                      <th className="py-2 text-right font-medium">Evidence</th>
                      <th className="py-2 text-right font-medium">Weight</th>
                      <th className="py-2 text-left pl-4 font-medium">Measured Interpretation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60">
                    {confirmed.indicators.map((ind) => (
                      <tr key={ind.id}>
                        <td className="py-2.5 font-medium text-[#17212B] dark:text-[#F4F7FA] whitespace-nowrap">
                          {ind.name}
                        </td>
                        <td className="py-2.5 font-mono text-[11px] whitespace-nowrap">
                          <span
                            className={
                              ind.role === 'volatility_modifier'
                                ? 'text-amber-600 dark:text-amber-400'
                                : ind.bias === 'BULLISH'
                                  ? 'text-[#16A378] dark:text-[#35C89A]'
                                  : ind.bias === 'BEARISH'
                                    ? 'text-[#DC4C54] dark:text-[#F16B72]'
                                    : 'text-[#677482] dark:text-[#8B97A5]'
                            }
                          >
                            {ind.role === 'volatility_modifier' ? 'VOL MODIFIER' : ind.bias}
                          </span>
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums">
                          {ind.available
                            ? ind.role === 'volatility_modifier'
                              ? `${ind.evidence.toFixed(2)}x`
                              : `${ind.evidence > 0 ? '+' : ''}${ind.evidence.toFixed(2)}`
                            : 'N/A'}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#677482] dark:text-[#8B97A5]">
                          {ind.role === 'volatility_modifier' ? 'Mod' : `${ind.effectiveWeight}%`}
                        </td>
                        <td className="py-2.5 pl-4 text-[#677482] dark:text-[#8B97A5]">
                          <div>{ind.summary}</div>
                          {ind.sufficiencyNote && (
                            <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                              {ind.sufficiencyNote}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Bottom Grid: Support & Resistance, Pattern Detection, Historical Validation */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Support & Resistance Zones */}
            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-semibold mb-1">Estimated Support & Resistance Zones</h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mb-3">
                Clustered from confirmed swing pivots. Zones are historical reaction areas, not guaranteed barriers.
              </p>
              {(bundle?.supportResistance ?? []).length === 0 ? (
                <p className="text-xs text-[#677482] dark:text-[#8B97A5]">
                  No repeated multi-touch pivot clusters identified in the current window.
                </p>
              ) : (
                <div className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60 text-xs font-mono tabular-nums">
                  {bundle?.supportResistance.map((z) => (
                    <div key={z.id} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <span
                          className={
                            z.type === 'SUPPORT'
                              ? 'text-[#16A378] dark:text-[#35C89A] font-semibold'
                              : 'text-[#DC4C54] dark:text-[#F16B72] font-semibold'
                          }
                        >
                          {z.type}
                        </span>
                        <span className="ml-2 text-[#17212B] dark:text-[#F4F7FA]">
                          ${formatPrice(z.price, preferences.decimalPrecision)}
                        </span>
                        <div className="text-[10px] font-sans text-[#677482] dark:text-[#8B97A5]">
                          {z.touches} touches · {z.ageBars} bars old · {z.status}
                        </div>
                      </div>
                      <span className="text-[#677482] dark:text-[#8B97A5]">
                        {formatPercent(z.distancePct)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pattern Detection */}
            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-semibold mb-1">Chart & Candlestick Patterns</h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mb-3">
                Rule-based structural and candlestick detections with explicit invalidation criteria.
              </p>
              {(bundle?.patterns ?? []).length === 0 ? (
                <p className="text-xs text-[#677482] dark:text-[#8B97A5]">
                  No validated structural or candlestick patterns triggered on recent completed bars.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {bundle?.patterns.slice(0, 6).map((p) => (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C] text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#17212B] dark:text-[#F4F7FA]">{p.name}</span>
                        <span
                          className={`font-mono text-[11px] ${
                            p.direction === 'BULLISH'
                              ? 'text-[#16A378] dark:text-[#35C89A]'
                              : p.direction === 'BEARISH'
                                ? 'text-[#DC4C54] dark:text-[#F16B72]'
                                : 'text-[#677482]'
                          }`}
                        >
                          {p.status} · Fit {p.qualityScore}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-1">
                        {p.detectionMethod}
                      </p>
                      <p className="text-[10px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
                        Invalidation: {p.invalidationCriteria}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Historical Signal Validation (Non-repainting) */}
            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-semibold mb-1">Historical Signal Validation</h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mb-3">
                Causal replay across completed candles (no future leakage). Not a trading profit simulation.
              </p>
              {bundle?.validation.insufficientHistoryWarning && (
                <div className="mb-2.5 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300">
                  {bundle.validation.insufficientHistoryWarning}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] text-[#677482] dark:text-[#8B97A5] font-sans">
                      <th className="py-1.5 text-left">Horizon</th>
                      <th className="py-1.5 text-right">Obs</th>
                      <th className="py-1.5 text-right">Dir Match</th>
                      <th className="py-1.5 text-right">Avg Ret</th>
                      <th className="py-1.5 text-right">MFE / MAE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60">
                    {(bundle?.validation.horizons ?? []).map((h) => (
                      <tr key={h.horizonBars}>
                        <td className="py-2">{h.horizonBars} bars</td>
                        <td className="py-2 text-right">{h.observations}</td>
                        <td className="py-2 text-right">
                          {h.directionalAccuracyPct !== null ? `${h.directionalAccuracyPct}%` : '—'}
                        </td>
                        <td
                          className={`py-2 text-right ${
                            (h.avgForwardReturnPct ?? 0) >= 0
                              ? 'text-[#16A378] dark:text-[#35C89A]'
                              : 'text-[#DC4C54] dark:text-[#F16B72]'
                          }`}
                        >
                          {h.avgForwardReturnPct !== null ? formatPercent(h.avgForwardReturnPct, 2) : '—'}
                        </td>
                        <td className="py-2 text-right text-[#677482] dark:text-[#8B97A5]">
                          {h.avgMaxFavorablePct !== null
                            ? `+${h.avgMaxFavorablePct.toFixed(2)}% / -${(h.avgMaxAdversePct ?? 0).toFixed(2)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
