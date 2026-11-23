import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Layers,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
import { api } from '../services/api';
import { EXCHANGE_LABELS } from '../shared/constants';
import { formatCompactUsd, formatPrice, formatTimestamp } from '../shared/format';
import type { ArbitrageOpportunity, ArbitrageScanPayload, StatArbPair } from '../shared/types';
import { useAppStore } from '../store/useAppStore';
import {
  KINETIC_EASE,
  KineticCard,
  KineticSegmentedControl,
  MiniSparkBars,
} from '../components/ui/Kinetic';
import { SkeletonBlock } from '../components/ui/SignalMeter';

type ArbTab = 'spot' | 'statarb';
type StatCategory = 'ALL' | 'Crypto' | 'US Equities' | 'Global CFDs';

const TAB_OPTIONS: { value: ArbTab; label: string }[] = [
  { value: 'spot', label: 'Cross-Exchange Spot' },
  { value: 'statarb', label: 'Multi-Asset Stat-Arb Z-Score' },
];

const STAT_CATEGORIES: { value: StatCategory; label: string }[] = [
  { value: 'ALL', label: 'All Classes' },
  { value: 'Crypto', label: 'Crypto' },
  { value: 'US Equities', label: 'US Equities' },
  { value: 'Global CFDs', label: 'Global CFDs' },
];

export const ArbitrageView: React.FC = () => {
  const preferences = useAppStore((s) => s.preferences);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [tab, setTab] = useState<ArbTab>('spot');
  const [statCategory, setStatCategory] = useState<StatCategory>('ALL');
  const [feeBps, setFeeBps] = useState<number>(20);
  const [tradeCapitalUsd, setTradeCapitalUsd] = useState<number>(10000);
  const [minSpreadPct, setMinSpreadPct] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [data, setData] = useState<ArbitrageScanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScan = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const res = await api.getArbitrage(feeBps);
        setData(res);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to scan live exchange spreads');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [feeBps],
  );

  useEffect(() => {
    fetchScan(false);
    const id = window.setInterval(() => fetchScan(true), 15_000);
    return () => window.clearInterval(id);
  }, [fetchScan]);

  const filteredOpps = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toUpperCase();
    return data.opportunities.filter((o) => {
      if (o.grossSpreadPct < minSpreadPct) return false;
      if (
        q &&
        !o.baseAsset.includes(q) &&
        !o.buyExchange.toUpperCase().includes(q) &&
        !o.sellExchange.toUpperCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [data, minSpreadPct, search]);

  const filteredStatArb = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toUpperCase();
    return data.statArbPairs.filter((p) => {
      if (statCategory !== 'ALL' && p.category !== statCategory) return false;
      if (q && !p.label.toUpperCase().includes(q) && !p.category.toUpperCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [data, statCategory, search]);

  const bestOpp: ArbitrageOpportunity | null = data?.opportunities[0] ?? null;
  const executableCount = data?.opportunities.filter((o) => o.status === 'EXECUTABLE').length ?? 0;
  const watchCount = data?.opportunities.filter((o) => o.status === 'WATCH').length ?? 0;
  const activeStatSignals =
    data?.statArbPairs.filter((p) => p.signal !== 'NEUTRAL').length ?? 0;

  const bestEstProfitUsd =
    bestOpp && tradeCapitalUsd > 0 ? (tradeCapitalUsd * bestOpp.netSpreadPct) / 100 : 0;

  const spreadBars = useMemo(() => {
    const top = (data?.opportunities ?? []).slice(0, 5).map((o) => Math.max(10, o.grossSpreadPct * 100));
    return top.length >= 5 ? top : [22, 48, 35, 64, 52];
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Top 3 Kinetic Bento KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI 1: Featured Dark Obsidian Best Live Spread */}
        <KineticCard surface="dark" className="rounded-3xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8FA899]">
                <span className="relative flex h-2 w-2">
                  <span className="sig-sonar-ring absolute inline-flex h-full w-full rounded-full bg-[#22C55E]" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22C55E]" />
                </span>
                Best Live Cross-Venue Spread
              </div>
              {loading && !bestOpp ? (
                <div className="mt-3 h-8 w-32 rounded-xl bg-white/10 animate-pulse" />
              ) : bestOpp ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2.5">
                    <span className="text-3xl font-black tracking-tight font-mono tabular-nums text-white">
                      {bestOpp.netSpreadPct >= 0 ? '+' : ''}
                      {bestOpp.netSpreadPct.toFixed(3)}%
                    </span>
                    <span className="text-xs font-mono text-[#4ADE80]">
                      net ({bestOpp.grossSpreadPct.toFixed(3)}% gross)
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-[#B6C9BD] flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-white">{bestOpp.baseAsset}</span>
                    <span>· Buy {EXCHANGE_LABELS[bestOpp.buyExchange]}</span>
                    <ArrowRight className="w-3 h-3 text-[#4ADE80]" />
                    <span>Sell {EXCHANGE_LABELS[bestOpp.sellExchange]}</span>
                  </div>
                </>
              ) : (
                <div className="mt-2 text-sm text-[#8FA899]">Waiting for multi-venue ticks...</div>
              )}
            </div>
            <MiniSparkBars values={spreadBars} variant="dark-emerald" />
          </div>

          <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between text-xs">
            <span className="text-[#8FA899]">
              Est. net on {formatCompactUsd(tradeCapitalUsd)}
            </span>
            <span
              className={`font-mono font-bold tabular-nums ${
                bestEstProfitUsd > 0 ? 'text-[#4ADE80]' : 'text-[#9BB0A3]'
              }`}
            >
              {bestEstProfitUsd >= 0 ? '+' : '-'}${Math.abs(bestEstProfitUsd).toFixed(2)}
            </span>
          </div>
        </KineticCard>

        {/* KPI 2: Actionable Spreads & Stat-Arb Alerts */}
        <KineticCard surface="glass" delay={0.05} className="rounded-3xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#637369]">
                Executable Opportunities
              </div>
              <div className="mt-2 flex items-baseline gap-2.5">
                <span className="text-3xl font-black tracking-tight font-mono tabular-nums text-[#111814]">
                  {executableCount}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#DCFCE7] text-[#15803D]">
                  Net &gt; 0%
                </span>
              </div>
              <div className="mt-1.5 text-xs text-[#637369]">
                {watchCount} on watch · {activeStatSignals} Stat-Arb Z-score divergences
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-[#EEF5F0] text-[#16A34A] flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          <div className="pt-3 border-t border-[#EDF1EE] flex items-center justify-between text-xs">
            <span className="text-[#637369]">Fee model applied</span>
            <span className="font-mono font-semibold text-[#111814]">
              {feeBps} bps round-trip ({(feeBps / 100).toFixed(2)}%)
            </span>
          </div>
        </KineticCard>

        {/* KPI 3: Soft Sage Multi-Venue Coverage */}
        <KineticCard surface="sage" delay={0.1} className="rounded-3xl p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#3E5245]">
                Connected Live Venues
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black tracking-tight font-mono tabular-nums text-[#101A13]">
                  {data?.venuesScanned.length ?? 0}
                </span>
                <span className="text-xs font-semibold text-[#3E5245]">
                  spot exchanges + Yahoo Finance
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(data?.venuesScanned ?? []).map((v) => (
                  <span
                    key={v}
                    className="px-2 py-0.5 rounded-full bg-white/75 border border-[#C6D8C7] text-[10px] font-bold uppercase tracking-wider text-[#101A13]"
                  >
                    {EXCHANGE_LABELS[v]}
                  </span>
                ))}
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-[#121814] text-[#4ADE80] flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
          </div>

          <div className="pt-3 border-t border-[#C4D6C5] flex items-center justify-between text-xs text-[#3E5245]">
            <span>{data?.opportunities.length ?? 0} shared pairs scanned</span>
            <span className="font-mono font-semibold">
              {data?.updatedAt ? formatTimestamp(data.updatedAt, preferences.timezone) : 'Syncing...'}
            </span>
          </div>
        </KineticCard>
      </div>

      {/* Controls & Mode Switcher Bar */}
      <KineticCard surface="glass" delay={0.12} className="rounded-3xl p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <KineticSegmentedControl
              options={TAB_OPTIONS}
              value={tab}
              onChange={setTab}
              layoutId="arb-main-tabs"
              variant="obsidian"
            />
            {tab === 'statarb' && (
              <KineticSegmentedControl
                options={STAT_CATEGORIES}
                value={statCategory}
                onChange={setStatCategory}
                layoutId="arb-stat-cats"
                size="xs"
                variant="light"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#7D8E84] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter asset or venue..."
                className="pl-8 pr-3 py-1.5 w-44 rounded-full border border-[#E5EAE7] bg-[#F8FAF9] text-xs text-[#111814] placeholder-[#7D8E84] focus:outline-none focus:border-[#16A34A]"
              />
            </div>

            {tab === 'spot' && (
              <>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E5EAE7] bg-white text-xs text-[#55665C]">
                  <SlidersHorizontal className="w-3 h-3 text-[#16A34A]" />
                  <span>Capital $</span>
                  <input
                    type="number"
                    min={100}
                    step={500}
                    value={tradeCapitalUsd}
                    onChange={(e) => setTradeCapitalUsd(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20 font-mono font-bold text-[#111814] bg-transparent focus:outline-none text-right"
                  />
                </label>

                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E5EAE7] bg-white text-xs text-[#55665C]">
                  <span>Fees</span>
                  <input
                    type="number"
                    min={0}
                    max={150}
                    step={5}
                    value={feeBps}
                    onChange={(e) => setFeeBps(Math.max(0, Math.min(150, Number(e.target.value) || 0)))}
                    className="w-12 font-mono font-bold text-[#111814] bg-transparent focus:outline-none text-right"
                  />
                  <span>bps</span>
                </label>

                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#E5EAE7] bg-white text-xs text-[#55665C]">
                  <span>Min</span>
                  <input
                    type="number"
                    min={-1}
                    max={5}
                    step={0.05}
                    value={minSpreadPct}
                    onChange={(e) => setMinSpreadPct(Number(e.target.value) || 0)}
                    className="w-12 font-mono font-bold text-[#111814] bg-transparent focus:outline-none text-right"
                  />
                  <span>%</span>
                </label>
              </>
            )}

            <button
              type="button"
              onClick={() => fetchScan(false)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full sig-btn-primary text-xs font-semibold disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Scan Now
            </button>
          </div>
        </div>
      </KineticCard>

      {error && (
        <div className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] px-4 py-3 text-xs text-[#BE123C] font-medium">
          {error}
        </div>
      )}

      {/* Main Content Area */}
      {loading && !data ? (
        <div className="space-y-3">
          <SkeletonBlock className="h-14" />
          <SkeletonBlock className="h-72" />
        </div>
      ) : tab === 'spot' ? (
        <KineticCard surface="glass" className="rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#EDF1EE] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#111814]">
                Live Cross-Exchange Spot Arbitrage Matrix
              </h2>
              <p className="text-xs text-[#637369] mt-0.5">
                Real-time ask-to-bid price discrepancies across 11 global spot exchanges — Binance, Bybit, OKX, KuCoin, Gate.io, MEXC, Bitget, HTX, Crypto.com, Kraken &amp; Coinbase (auto-refreshes every 15s).
              </p>
            </div>
            <span className="text-[11px] font-mono font-semibold text-[#637369]">
              Showing {filteredOpps.length} pairs
            </span>
          </div>

          {filteredOpps.length === 0 ? (
            <div className="p-10 text-center space-y-1.5">
              <div className="text-sm font-bold text-[#111814]">
                No matching cross-exchange spreads
              </div>
              <p className="text-xs text-[#637369] max-w-md mx-auto">
                Lower your minimum spread threshold or clear the search filter to view all live multi-venue quotes.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EDF1EE] bg-[#F8FAF9] text-[10px] font-bold uppercase tracking-[0.08em] text-[#637369]">
                    <th className="py-3 pl-5 pr-3">Asset</th>
                    <th className="py-3 px-3">Buy Leg (Low)</th>
                    <th className="py-3 px-3">Sell Leg (High)</th>
                    <th className="py-3 px-3 text-right">Gross Spread</th>
                    <th className="py-3 px-3 text-right">Net Spread</th>
                    <th className="py-3 px-3 text-right">Est. Net P&amp;L</th>
                    <th className="py-3 px-3 text-right">Min 24h Liq</th>
                    <th className="py-3 pl-3 pr-5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDF1EE] text-xs">
                  {filteredOpps.slice(0, 60).map((opp) => {
                    const estPnl = (tradeCapitalUsd * opp.netSpreadPct) / 100;
                    const expanded = expandedId === opp.id;
                    return (
                      <React.Fragment key={opp.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : opp.id)}
                          className="hover:bg-[#F6F9F7] transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 pl-5 pr-3">
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-xl bg-[#121814] text-[#4ADE80] font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                                {opp.baseAsset.slice(0, 4)}
                              </span>
                              <div>
                                <div className="font-bold text-[#111814] font-mono">
                                  {opp.baseAsset}
                                </div>
                                <div className="text-[10px] text-[#7D8E84]">
                                  {opp.venueCount} live venues
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-3 font-mono tabular-nums">
                            <div className="font-semibold text-[#111814]">
                              ${formatPrice(opp.buyPrice, preferences.decimalPrecision)}
                            </div>
                            <div className="text-[10px] text-[#16A34A] font-semibold uppercase">
                              {EXCHANGE_LABELS[opp.buyExchange]} · {opp.buySymbol}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 font-mono tabular-nums">
                            <div className="font-semibold text-[#111814]">
                              ${formatPrice(opp.sellPrice, preferences.decimalPrecision)}
                            </div>
                            <div className="text-[10px] text-[#E11D48] font-semibold uppercase">
                              {EXCHANGE_LABELS[opp.sellExchange]} · {opp.sellSymbol}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono tabular-nums font-semibold text-[#111814]">
                            +{opp.grossSpreadPct.toFixed(3)}%
                          </td>
                          <td
                            className={`py-3.5 px-3 text-right font-mono tabular-nums font-bold ${
                              opp.netSpreadPct > 0
                                ? 'text-[#16A34A]'
                                : opp.netSpreadPct > -0.1
                                  ? 'text-[#B45309]'
                                  : 'text-[#637369]'
                            }`}
                          >
                            {opp.netSpreadPct >= 0 ? '+' : ''}
                            {opp.netSpreadPct.toFixed(3)}%
                          </td>
                          <td
                            className={`py-3.5 px-3 text-right font-mono tabular-nums font-bold ${
                              estPnl > 0 ? 'text-[#16A34A]' : 'text-[#637369]'
                            }`}
                          >
                            {estPnl >= 0 ? '+' : '-'}${Math.abs(estPnl).toFixed(2)}
                          </td>
                          <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[#55665C]">
                            {formatCompactUsd(opp.minVolume24hUsd)}
                          </td>
                          <td className="py-3.5 pl-3 pr-5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <span
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${
                                  opp.status === 'EXECUTABLE'
                                    ? 'bg-[#DCFCE7] text-[#15803D]'
                                    : opp.status === 'WATCH'
                                      ? 'bg-[#FEF3C7] text-[#B45309]'
                                      : 'bg-[#EEF2EF] text-[#55665C]'
                                }`}
                              >
                                {opp.status}
                              </span>
                              {expanded ? (
                                <ChevronUp className="w-3.5 h-3.5 text-[#7D8E84]" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 text-[#7D8E84]" />
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Multi-Venue Quote Ladder */}
                        <AnimatePresence>
                          {expanded && (
                            <tr>
                              <td colSpan={8} className="bg-[#F8FAF9] px-5 py-4 border-b border-[#E5EAE7]">
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.18, ease: KINETIC_EASE }}
                                  className="flex flex-col md:flex-row md:items-center justify-between gap-4"
                                >
                                  <div className="flex flex-wrap gap-2.5">
                                    {opp.venues.map((v) => (
                                      <div
                                        key={`${opp.id}-${v.exchange}`}
                                        className="px-3.5 py-2.5 rounded-2xl bg-white border border-[#E5EAE7] min-w-[165px]"
                                      >
                                        <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase text-[#637369]">
                                          <span>{EXCHANGE_LABELS[v.exchange]}</span>
                                          <span className="font-mono">{v.displaySymbol}</span>
                                        </div>
                                        <div className="mt-1 font-mono text-sm font-bold text-[#111814]">
                                          ${formatPrice(v.price, preferences.decimalPrecision)}
                                        </div>
                                        <div className="mt-0.5 text-[10px] font-mono text-[#7D8E84]">
                                          24h Vol: {formatCompactUsd(v.volume24hUsd)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        selectMarket(opp.buyExchange, 'spot', opp.buySymbol, true)
                                      }
                                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#DCE3DF] bg-white hover:border-[#16A34A] text-xs font-semibold text-[#111814]"
                                    >
                                      Inspect {EXCHANGE_LABELS[opp.buyExchange]}
                                      <ArrowUpRight className="w-3.5 h-3.5 text-[#16A34A]" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setActiveSection('demo')}
                                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full sig-btn-primary text-xs font-semibold"
                                    >
                                      <Bot className="w-3.5 h-3.5 text-[#4ADE80]" />
                                      Open Demo Trade
                                    </button>
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </KineticCard>
      ) : (
        /* Multi-Asset Statistical Arbitrage Z-Score Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredStatArb.length === 0 ? (
            <div className="col-span-full sig-glass rounded-3xl p-10 text-center space-y-1.5">
              <div className="text-sm font-bold text-[#111814]">
                No statistical arbitrage pairs available
              </div>
              <p className="text-xs text-[#637369]">
                Live 1h candle pairs are still synchronizing or filtered out.
              </p>
            </div>
          ) : (
            filteredStatArb.map((pair: StatArbPair, idx: number) => {
              const clampedZ = Math.max(-3, Math.min(3, pair.zScore));
              const markerPct = ((clampedZ + 3) / 6) * 100;
              const isActionable = pair.signal !== 'NEUTRAL';
              const isLongA = pair.signal === 'LONG_A_SHORT_B';

              return (
                <KineticCard
                  key={pair.id}
                  surface={isActionable ? 'dark' : 'glass'}
                  delay={idx * 0.04}
                  interactive
                  className="rounded-3xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div
                        className={`text-[10px] font-bold uppercase tracking-[0.1em] ${
                          isActionable ? 'text-[#8FA899]' : 'text-[#637369]'
                        }`}
                      >
                        {pair.category} · {pair.sampleBars}× 1H BARS
                      </div>
                      <h3
                        className={`text-base font-bold mt-1 ${
                          isActionable ? 'text-white' : 'text-[#111814]'
                        }`}
                      >
                        {pair.label}
                      </h3>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        pair.signal === 'LONG_A_SHORT_B'
                          ? 'bg-[#22C55E] text-[#05140A]'
                          : pair.signal === 'SHORT_A_LONG_B'
                            ? 'bg-[#FB7185] text-[#1A050A]'
                            : 'bg-[#EEF2EF] text-[#55665C]'
                      }`}
                    >
                      {pair.signal === 'LONG_A_SHORT_B'
                        ? 'Long A / Short B'
                        : pair.signal === 'SHORT_A_LONG_B'
                          ? 'Short A / Long B'
                          : 'Mean Reverted'}
                    </span>
                  </div>

                  {/* Z-Score Readout & Visual Needle Gauge */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`text-2xl font-black font-mono tabular-nums ${
                            isActionable
                              ? isLongA
                                ? 'text-[#4ADE80]'
                                : 'text-[#FB7185]'
                              : 'text-[#111814]'
                          }`}
                        >
                          {pair.zScore >= 0 ? '+' : ''}
                          {pair.zScore.toFixed(2)}σ
                        </span>
                        <span
                          className={`text-[11px] ${
                            isActionable ? 'text-[#8FA899]' : 'text-[#637369]'
                          }`}
                        >
                          Z-Score
                        </span>
                      </div>
                      <span
                        className={`text-xs font-mono font-semibold ${
                          isActionable ? 'text-[#C8D9CE]' : 'text-[#55665C]'
                        }`}
                      >
                        r = {pair.correlation.toFixed(2)}
                      </span>
                    </div>

                    <div className="relative h-2 rounded-full bg-gradient-to-r from-[#22C55E]/40 via-[#94A3B8]/30 to-[#F43F5E]/40 overflow-visible">
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/40" />
                      <motion.div
                        initial={{ left: '50%' }}
                        animate={{ left: `${markerPct}%` }}
                        transition={{ duration: 0.55, ease: KINETIC_EASE }}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-[#111814] shadow-md"
                      />
                    </div>
                    <div
                      className={`flex justify-between text-[10px] font-mono ${
                        isActionable ? 'text-[#7D9486]' : 'text-[#7D8E84]'
                      }`}
                    >
                      <span>-3σ (Long A)</span>
                      <span>Mean {pair.meanRatio.toFixed(4)}</span>
                      <span>+3σ (Short A)</span>
                    </div>
                  </div>

                  {/* Leg Prices + Quick Open */}
                  <div
                    className={`grid grid-cols-2 gap-2 pt-3 border-t ${
                      isActionable ? 'border-white/[0.08]' : 'border-[#EDF1EE]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        selectMarket(pair.legA.exchange, pair.legA.marketType, pair.legA.symbol, true)
                      }
                      className={`text-left px-3 py-2 rounded-xl transition-colors ${
                        isActionable
                          ? 'bg-white/[0.06] hover:bg-white/[0.12]'
                          : 'bg-[#F4F7F5] hover:bg-[#EAF0EC]'
                      }`}
                    >
                      <div className="text-[10px] font-mono opacity-75">LEG A · {pair.legA.symbol}</div>
                      <div className="text-xs font-bold font-mono mt-0.5">
                        ${formatPrice(pair.legA.price, preferences.decimalPrecision)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        selectMarket(pair.legB.exchange, pair.legB.marketType, pair.legB.symbol, true)
                      }
                      className={`text-left px-3 py-2 rounded-xl transition-colors ${
                        isActionable
                          ? 'bg-white/[0.06] hover:bg-white/[0.12]'
                          : 'bg-[#F4F7F5] hover:bg-[#EAF0EC]'
                      }`}
                    >
                      <div className="text-[10px] font-mono opacity-75">LEG B · {pair.legB.symbol}</div>
                      <div className="text-xs font-bold font-mono mt-0.5">
                        ${formatPrice(pair.legB.price, preferences.decimalPrecision)}
                      </div>
                    </button>
                  </div>
                </KineticCard>
              );
            })
          )}
        </div>
      )}

      {/* Subtle Methodology Footnote */}
      <div className="flex items-center gap-2 text-[11px] text-[#637369] px-1">
        <Activity className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
        <span>
          Arbitrage scanner evaluates live public exchange quotes and 1-hour cointegrated log-ratio Z-scores across Binance, Bybit, OKX, KuCoin, Gate.io, MEXC, Bitget, HTX, Crypto.com, Kraken, Coinbase, and Yahoo Finance. Transfer latency &amp; withdrawal fees are excluded from spot fee estimates.
        </span>
      </div>
    </div>
  );
};
