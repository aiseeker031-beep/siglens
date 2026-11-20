import React, { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Download, Plus, RefreshCw, X } from 'lucide-react';
import { EChartBox } from '../components/charts/EChartBox';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import { CORE_UNIVERSE_BASES, EXCHANGE_LABELS, QUICK_TIMEFRAMES } from '../shared/constants';
import {
  exportToCsv,
  formatPercent,
  formatPrice,
  signalBgClass,
  signalLabel,
} from '../shared/format';
import type { ExchangeId, MarketType, Timeframe } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

const LINE_COLORS = ['#4EA1FF', '#35C89A', '#E6A832', '#F16B72', '#A78BFA'];

export const CompareView: React.FC = () => {
  const globalExchange = useAppStore((s) => s.exchange);
  const globalMarketType = useAppStore((s) => s.marketType);
  const globalSymbol = useAppStore((s) => s.symbol);
  const theme = useAppStore((s) => s.preferences.theme);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const selectMarket = useAppStore((s) => s.selectMarket);

  const [exchange, setExchange] = useState<ExchangeId>(globalExchange);
  const [marketType, setMarketType] = useState<MarketType>(globalMarketType);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');

  const quote = exchange === 'kraken' || exchange === 'coinbase' ? 'USD' : 'USDT';
  const [selectedBases, setSelectedBases] = useState<string[]>(() => {
    const activeBase = globalSymbol.split('/')[0] || 'BTC';
    const baseSet = Array.from(new Set([activeBase, 'BTC', 'ETH', 'SOL'])).slice(0, 3);
    return baseSet;
  });
  const [addBase, setAddBase] = useState('LINK');

  const [data, setData] = useState<Awaited<ReturnType<typeof api.compareAssets>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const textColor = isDark ? '#F4F7FA' : '#17212B';
  const mutedColor = isDark ? '#8B97A5' : '#677482';
  const borderColor = isDark ? '#27313C' : '#E6EBF0';

  const symbols = useMemo(() => selectedBases.map((b) => `${b}/${quote}`), [selectedBases, quote]);

  const loadComparison = async () => {
    if (symbols.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.compareAssets(symbols, exchange, marketType, timeframe);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to compare selected assets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComparison();
  }, [symbols.join(','), exchange, marketType, timeframe]);

  const handleAddAsset = () => {
    if (selectedBases.length >= 5 || selectedBases.includes(addBase)) return;
    setSelectedBases((prev) => [...prev, addBase]);
  };

  const handleRemoveAsset = (base: string) => {
    if (selectedBases.length <= 2) return;
    setSelectedBases((prev) => prev.filter((b) => b !== base));
  };

  const normalizedOption = useMemo<EChartsOption>(() => {
    if (!data?.normalized.timestamps.length) return {};
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      legend: {
        data: Object.keys(data.normalized.series),
        textStyle: { color: textColor, fontSize: 11 },
        top: 0,
      },
      grid: { left: 56, right: 20, top: 34, bottom: 32 },
      xAxis: {
        type: 'category',
        data: data.normalized.timestamps.map((t) =>
          new Date(t).toISOString().slice(5, 16).replace('T', ' '),
        ),
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: mutedColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
      },
      series: Object.entries(data.normalized.series).map(([sym, vals], idx) => ({
        name: sym,
        type: 'line',
        smooth: false,
        showSymbol: false,
        lineStyle: { width: 2, color: LINE_COLORS[idx % LINE_COLORS.length] },
        itemStyle: { color: LINE_COLORS[idx % LINE_COLORS.length] },
        data: vals.map((v) => Number(v.toFixed(2))),
      })),
    };
  }, [data, isDark, borderColor, textColor, mutedColor]);

  const radarOption = useMemo<EChartsOption>(() => {
    if (!data?.assets.length) return {};
    const indicators = [
      { name: 'EMA Trend', max: 100 },
      { name: 'MACD', max: 100 },
      { name: 'RSI', max: 100 },
      { name: 'ADX/DMI', max: 100 },
      { name: 'Volume (OBV/RVOL)', max: 100 },
      { name: 'Agreement', max: 100 },
    ];

    const normEvidence = (ev: number | undefined) => Math.round(((ev ?? 0) + 1) * 50);

    return {
      tooltip: {
        backgroundColor: isDark ? '#151B23' : '#FFFFFF',
        borderColor,
        textStyle: { color: textColor, fontSize: 12 },
      },
      legend: {
        data: data.assets.map((a) => a.symbol),
        bottom: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      radar: {
        indicator: indicators,
        radius: '62%',
        axisName: { color: mutedColor, fontSize: 10 },
        splitArea: { areaStyle: { color: ['transparent'] } },
        splitLine: { lineStyle: { color: borderColor } },
        axisLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          type: 'radar',
          data: data.assets.map((a, idx) => {
            const byId = new Map(a.confirmed.indicators.map((i) => [i.id, i]));
            const obvEv = byId.get('obv')?.evidence ?? 0;
            const rvolEv = byId.get('rvol')?.evidence ?? 0;
            return {
              name: a.symbol,
              value: [
                normEvidence(byId.get('ema')?.evidence),
                normEvidence(byId.get('macd')?.evidence),
                normEvidence(byId.get('rsi')?.evidence),
                normEvidence(byId.get('adx')?.evidence),
                normEvidence((obvEv + rvolEv) / 2),
                a.confirmed.agreement.agreementPct,
              ],
              lineStyle: { width: 2, color: LINE_COLORS[idx % LINE_COLORS.length] },
              itemStyle: { color: LINE_COLORS[idx % LINE_COLORS.length] },
              areaStyle: { color: LINE_COLORS[idx % LINE_COLORS.length], opacity: 0.08 },
            };
          }),
        },
      ],
    };
  }, [data, isDark, borderColor, textColor, mutedColor]);

  const handleExport = () => {
    if (!data) return;
    exportToCsv(
      `cryptolens-compare-${exchange}-${timeframe}.csv`,
      ['Symbol', 'Close', 'Period Return %', 'Signal', 'Directional Score', 'Agreement %', 'Regime'],
      data.assets.map((a) => [
        a.symbol,
        a.close ?? '',
        a.periodReturnPct?.toFixed(2) ?? '',
        a.confirmed.classification,
        a.confirmed.directionalScore.toFixed(1),
        a.confirmed.agreement.agreementPct,
        a.confirmed.regime.combinedLabel,
      ]),
    );
  };

  const availableToAdd = CORE_UNIVERSE_BASES.filter((b) => !selectedBases.includes(b));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Compare Assets</h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Side-by-side normalized return overlay, multi-factor radar strength, indicator breakdown, and pairwise Pearson correlation (up to 5 pairs).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Compare exchange"
            value={exchange}
            onChange={(e) => {
              const ex = e.target.value as ExchangeId;
              setExchange(ex);
              if (ex !== 'bybit' && marketType === 'perpetual') setMarketType('spot');
            }}
            className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23]"
          >
            <option value="binance">Binance</option>
            <option value="bybit">Bybit</option>
            <option value="kraken">Kraken</option>
            <option value="coinbase">Coinbase</option>
          </select>

          <select
            aria-label="Compare timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23]"
          >
            {QUICK_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleExport}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>

          <button
            type="button"
            onClick={loadComparison}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Asset Selector Bar */}
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {selectedBases.map((base, idx) => (
            <div
              key={base}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: LINE_COLORS[idx % LINE_COLORS.length] }}
              />
              <span className="font-semibold">
                {base}/{quote}
              </span>
              {selectedBases.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove ${base}`}
                  onClick={() => handleRemoveAsset(base)}
                  className="text-[#677482] hover:text-[#DC4C54]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        {selectedBases.length < 5 && availableToAdd.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Add asset to compare"
              value={availableToAdd.includes(addBase) ? addBase : availableToAdd[0]}
              onChange={(e) => setAddBase(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              {availableToAdd.map((b) => (
                <option key={b} value={b}>
                  {b}/{quote}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const pick = availableToAdd.includes(addBase) ? addBase : availableToAdd[0];
                if (pick && !selectedBases.includes(pick) && selectedBases.length < 5) {
                  setSelectedBases((prev) => [...prev, pick]);
                }
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Asset
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-[#F16B72]/40 bg-[#F16B72]/10 p-4 text-xs text-[#DC4C54] dark:text-[#F16B72]">
          {error}
        </div>
      )}

      {loading && !data ? (
        <SkeletonBlock className="h-[420px]" />
      ) : data ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-bold mb-1">
                Normalized Cumulative Return (%) — {EXCHANGE_LABELS[exchange]} ({timeframe})
              </h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mb-2">
                Rebased to 0% at the earliest aligned completed candle across selected assets.
              </p>
              <EChartBox option={normalizedOption} height={320} />
            </div>

            <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
              <h2 className="text-sm font-bold mb-1">Technical Factor Radar</h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mb-2">
                Normalized bullishness (0–100) across core indicator families.
              </p>
              <EChartBox option={radarOption} height={320} />
            </div>
          </div>

          {/* Side-by-side Indicator Matrix */}
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#E6EBF0] dark:border-[#27313C] text-xs font-semibold">
              Side-by-Side Deterministic Indicator Matrix
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-[11px] text-[#677482] dark:text-[#8B97A5]">
                    <th className="text-left px-3 py-2 font-medium">Metric</th>
                    {data.assets.map((a) => (
                      <th key={a.symbol} className="text-right px-3 py-2 font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                        <button
                          type="button"
                          onClick={() => selectMarket(exchange, marketType, a.symbol, true)}
                          className="hover:text-[#2563EB] dark:hover:text-[#4EA1FF]"
                        >
                          {a.symbol}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                  <tr>
                    <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">Last Completed Close</td>
                    {data.assets.map((a) => (
                      <td key={a.symbol} className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        ${formatPrice(a.close, precision)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">Window Return</td>
                    {data.assets.map((a) => (
                      <td
                        key={a.symbol}
                        className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${
                          (a.periodReturnPct ?? 0) >= 0
                            ? 'text-[#16A378] dark:text-[#35C89A]'
                            : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {formatPercent(a.periodReturnPct)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">Confirmed Signal</td>
                    {data.assets.map((a) => (
                      <td key={a.symbol} className="px-3 py-2 text-right">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${signalBgClass(a.confirmed.classification)}`}>
                          {signalLabel(a.confirmed.classification)}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">Directional Score</td>
                    {data.assets.map((a) => (
                      <td key={a.symbol} className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                        {a.confirmed.directionalScore > 0
                          ? `+${a.confirmed.directionalScore.toFixed(1)}`
                          : a.confirmed.directionalScore.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">Agreement / Coverage</td>
                    {data.assets.map((a) => (
                      <td key={a.symbol} className="px-3 py-2 text-right font-mono tabular-nums">
                        {a.confirmed.agreement.agreementPct}% / {a.confirmed.agreement.coveragePct}%
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5]">Market Regime</td>
                    {data.assets.map((a) => (
                      <td key={a.symbol} className="px-3 py-2 text-right text-[11px]">
                        {a.confirmed.regime.combinedLabel}
                      </td>
                    ))}
                  </tr>
                  {(['ema', 'rsi', 'macd', 'adx', 'bollinger', 'stochRsi', 'obv', 'vwap', 'rvol', 'atr'] as const).map(
                    (indId) => (
                      <tr key={indId}>
                        <td className="px-3 py-2 text-[#677482] dark:text-[#8B97A5] uppercase text-[11px]">
                          {indId}
                        </td>
                        {data.assets.map((a) => {
                          const ind = a.confirmed.indicators.find((i) => i.id === indId);
                          return (
                            <td key={a.symbol} className="px-3 py-2 text-right font-mono tabular-nums">
                              {ind ? (
                                <span
                                  className={
                                    ind.bias === 'BULLISH'
                                      ? 'text-[#16A378] dark:text-[#35C89A]'
                                      : ind.bias === 'BEARISH'
                                        ? 'text-[#DC4C54] dark:text-[#F16B72]'
                                        : 'text-[#677482] dark:text-[#8B97A5]'
                                  }
                                >
                                  {ind.role === 'volatility_modifier'
                                    ? `×${ind.evidence.toFixed(2)}`
                                    : `${ind.evidence > 0 ? '+' : ''}${ind.evidence.toFixed(2)}`}{' '}
                                  ({ind.bias})
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pairwise Correlation Table */}
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4">
            <h2 className="text-sm font-bold mb-2">Pairwise Return Correlation Matrix</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E6EBF0] dark:border-[#27313C]">
                    <th className="text-left py-2 px-2 text-[#677482] dark:text-[#8B97A5]">Pair</th>
                    {data.correlation.symbols.map((s) => (
                      <th key={s} className="text-right py-2 px-2 font-mono">
                        {s.split('/')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                  {data.correlation.symbols.map((sym, i) => (
                    <tr key={sym}>
                      <td className="py-2 px-2 font-semibold">{sym}</td>
                      {data.correlation.matrix[i].map((val, j) => (
                        <td
                          key={`${sym}-${j}`}
                          className={`py-2 px-2 text-right font-mono tabular-nums ${
                            i === j
                              ? 'text-[#677482] dark:text-[#8B97A5]'
                              : (val ?? 0) >= 0.65
                                ? 'text-[#16A378] dark:text-[#35C89A] font-semibold'
                                : (val ?? 0) <= -0.35
                                  ? 'text-[#DC4C54] dark:text-[#F16B72] font-semibold'
                                  : ''
                          }`}
                        >
                          {val === null ? '—' : val.toFixed(3)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};
