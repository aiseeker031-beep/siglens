import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Search, Star } from 'lucide-react';
import { api } from '../services/api';
import { EXCHANGE_LABELS } from '../shared/constants';
import { formatCompactUsd, formatPercent, formatPrice } from '../shared/format';
import type { ExchangeId, MarketTicker, MarketType } from '../shared/types';
import { useAppStore } from '../store/useAppStore';
import { SkeletonBlock } from '../components/ui/SignalMeter';

type SortKey = 'quoteVolume24h' | 'lastPrice' | 'change24hPct' | 'displaySymbol' | 'spreadPct';

export const MarketsView: React.FC = () => {
  const selectMarket = useAppStore((s) => s.selectMarket);
  const watchlist = useAppStore((s) => s.watchlist);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [exchangeFilter, setExchangeFilter] = useState<ExchangeId | 'all'>('all');
  const [marketTypeFilter, setMarketTypeFilter] = useState<MarketType | 'all'>('all');
  const [quoteFilter, setQuoteFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('quoteVolume24h');
  const [sortAsc, setSortAsc] = useState(false);
  const [markets, setMarkets] = useState<MarketTicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getMarkets(exchangeFilter, marketTypeFilter)
      .then((res) => {
        if (active) setMarkets(res.markets);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load exchange markets');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [exchangeFilter, marketTypeFilter]);

  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const filtered = markets.filter((m) => {
      if (quoteFilter !== 'ALL' && m.quoteAsset !== quoteFilter) return false;
      if (q && !m.displaySymbol.includes(q) && !m.baseAsset.includes(q) && !m.exchange.toUpperCase().includes(q)) {
        return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      const av = sortKey === 'displaySymbol' ? a.displaySymbol : (a[sortKey] ?? -Infinity);
      const bv = sortKey === 'displaySymbol' ? b.displaySymbol : (b[sortKey] ?? -Infinity);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
  }, [markets, quoteFilter, search, sortAsc, sortKey]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Markets Explorer</h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Normalized spot and perpetual markets across Binance, Bybit V5, Kraken, and Coinbase public feeds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => updatePreferences({ denseMode: !preferences.denseMode })}
          className="px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] text-xs font-medium"
        >
          {preferences.denseMode ? 'Comfortable Density' : 'Dense Table Mode'}
        </button>
      </div>

      {/* Filters Bar */}
      <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-[#677482] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by symbol or exchange..."
            aria-label="Filter markets"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-xs"
          />
        </div>

        <select
          aria-label="Filter by exchange"
          value={exchangeFilter}
          onChange={(e) => setExchangeFilter(e.target.value as ExchangeId | 'all')}
          className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-xs"
        >
          <option value="all">All Exchanges</option>
          {(['binance', 'bybit', 'kraken', 'coinbase'] as ExchangeId[]).map((ex) => (
            <option key={ex} value={ex}>
              {EXCHANGE_LABELS[ex]}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by market type"
          value={marketTypeFilter}
          onChange={(e) => setMarketTypeFilter(e.target.value as MarketType | 'all')}
          className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-xs"
        >
          <option value="all">Spot & Perpetual</option>
          <option value="spot">Spot Only</option>
          <option value="perpetual">Perpetual Only</option>
        </select>

        <select
          aria-label="Filter by quote currency"
          value={quoteFilter}
          onChange={(e) => setQuoteFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-xs"
        >
          <option value="ALL">All Quotes</option>
          <option value="USDT">USDT</option>
          <option value="USD">USD</option>
          <option value="USDC">USDC</option>
          <option value="BTC">BTC</option>
        </select>

        <span className="text-xs font-mono text-[#677482] dark:text-[#8B97A5] ml-auto">
          {rows.length} markets
        </span>
      </div>

      {loading ? (
        <SkeletonBlock className="h-96" />
      ) : error ? (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-6 text-xs text-[#DC4C54] dark:text-[#F16B72]">
          {error}
        </div>
      ) : (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-[#677482] dark:text-[#8B97A5]">
                  <th className="w-10 py-2.5 px-3 text-left">Fav</th>
                  <th className="py-2.5 px-3 text-left">
                    <button type="button" onClick={() => toggleSort('displaySymbol')} className="inline-flex items-center gap-1 font-medium">
                      Pair <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-left font-medium">Exchange / Type</th>
                  <th className="py-2.5 px-3 text-right">
                    <button type="button" onClick={() => toggleSort('lastPrice')} className="inline-flex items-center gap-1 font-medium">
                      Last Price <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button type="button" onClick={() => toggleSort('change24hPct')} className="inline-flex items-center gap-1 font-medium">
                      24h Change <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right font-medium">24h High / Low</th>
                  <th className="py-2.5 px-3 text-right">
                    <button type="button" onClick={() => toggleSort('spreadPct')} className="inline-flex items-center gap-1 font-medium">
                      Spread <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button type="button" onClick={() => toggleSort('quoteVolume24h')} className="inline-flex items-center gap-1 font-medium">
                      24h Volume <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6EBF0]/60 dark:divide-[#27313C]/60 font-mono tabular-nums">
                {rows.slice(0, 120).map((m) => {
                  const live = liveTickers[m.canonicalId];
                  const price = live?.lastPrice ?? m.lastPrice;
                  const pct = live?.change24hPct ?? m.change24hPct;
                  const isFav = watchlist.includes(m.canonicalId);
                  const py = preferences.denseMode ? 'py-1.5' : 'py-2.5';
                  return (
                    <tr
                      key={m.canonicalId}
                      onClick={() => selectMarket(m.exchange, m.marketType, m.displaySymbol, true)}
                      className="cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]/60 transition-colors"
                    >
                      <td className={`${py} px-3`} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => toggleWatchlist(m.canonicalId)}
                          aria-label={isFav ? `Remove ${m.displaySymbol} from watchlist` : `Add ${m.displaySymbol} to watchlist`}
                          className="text-[#677482] hover:text-[#B6F36A]"
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-[#B6F36A] text-[#B6F36A]' : ''}`} />
                        </button>
                      </td>
                      <td className={`${py} px-3 font-semibold text-[#17212B] dark:text-[#F4F7FA]`}>
                        {m.displaySymbol}
                      </td>
                      <td className={`${py} px-3 font-sans text-[#677482] dark:text-[#8B97A5]`}>
                        {EXCHANGE_LABELS[m.exchange]} · {m.marketType}
                      </td>
                      <td className={`${py} px-3 text-right font-semibold`}>
                        ${formatPrice(price, preferences.decimalPrecision)}
                      </td>
                      <td
                        className={`${py} px-3 text-right ${
                          pct >= 0
                            ? 'text-[#16A378] dark:text-[#35C89A]'
                            : 'text-[#DC4C54] dark:text-[#F16B72]'
                        }`}
                      >
                        {formatPercent(pct)}
                      </td>
                      <td className={`${py} px-3 text-right text-[#677482] dark:text-[#8B97A5]`}>
                        ${formatPrice(m.high24h)} / ${formatPrice(m.low24h)}
                      </td>
                      <td className={`${py} px-3 text-right text-[#677482] dark:text-[#8B97A5]`}>
                        {m.spreadPct !== null ? `${m.spreadPct.toFixed(3)}%` : '—'}
                      </td>
                      <td className={`${py} px-3 text-right`}>
                        {formatCompactUsd(m.quoteVolume24h)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
