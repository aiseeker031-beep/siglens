import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../../services/api';
import { formatPercent, formatPrice } from '../../shared/format';
import type { MarketTicker, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

const QUICK_PAGES: { section: NavSection; label: string; hint: string }[] = [
  { section: 'overview', label: 'Home Dashboard', hint: 'Market pulse, live chart & watchlist' },
  { section: 'markets', label: 'Markets', hint: 'Real-time multi-exchange spot & perp pairs' },
  { section: 'signals', label: 'Live Signal Feed', hint: 'Real-time Entry, SL & TP1-TP3 setups' },
  { section: 'screener', label: 'Advanced Screener', hint: '20 executable presets & custom filters' },
  { section: 'heatmaps', label: 'Market Heatmaps', hint: 'Performance, correlation & breadth' },
  { section: 'ai', label: 'AI Insights', hint: 'Optional BYOK explainability & NL scan' },
  { section: 'settings', label: 'Settings & Diagnostics', hint: 'Theme, weights, providers & BYOK' },
];

export const CommandSearchModal: React.FC = () => {
  const open = useAppStore((s) => s.commandSearchOpen);
  const setOpen = useAppStore((s) => s.setCommandSearchOpen);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketTicker[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchMarkets(query)
        .then((res) => {
          if (active) setResults(res.results);
        })
        .catch(() => {
          if (active) setResults([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 140);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  if (!open) return null;

  const matchedPages = query.trim()
    ? QUICK_PAGES.filter(
        (p) =>
          p.label.toLowerCase().includes(query.toLowerCase()) ||
          p.hint.toLowerCase().includes(query.toLowerCase()),
      )
    : QUICK_PAGES.slice(0, 5);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global Pair and Navigation Search"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl sig-glass shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#E8DDD1] dark:border-[#FFA95C]/14">
          <Search className="w-4 h-4 text-[#756253] dark:text-[#B9A392] shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pairs (BTC/USDT, ETH, SOL, Bybit, Kraken) or workspace..."
            className="w-full bg-transparent text-sm text-[#1D150F] dark:text-[#FFF8F0] placeholder-[#756253] dark:placeholder-[#B9A392] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close search"
            className="p-1 rounded-lg text-[#756253] dark:text-[#B9A392] hover:bg-[#EFE4D7] dark:hover:bg-[#2F1E13]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto divide-y divide-[#E8DDD1]/70 dark:divide-[#FFA95C]/12">
          {/* Markets section */}
          <div className="p-2">
            <div className="px-2 py-1 text-[11px] font-medium text-[#756253] dark:text-[#B9A392]">
              Markets {loading ? '· Searching...' : `· ${results.length} matches`}
            </div>
            {results.length === 0 && !loading && (
              <div className="px-3 py-4 text-xs text-[#756253] dark:text-[#B9A392]">
                No matching markets found across connected public exchanges.
              </div>
            )}
            <div className="space-y-0.5">
              {results.slice(0, 12).map((m) => (
                <button
                  key={m.canonicalId}
                  type="button"
                  onClick={() => selectMarket(m.exchange, m.marketType, m.displaySymbol, true)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-[#EFE4D7]/70 dark:hover:bg-[#2F1E13]/70 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-sm font-semibold text-[#1D150F] dark:text-[#FFF8F0] font-mono">
                      {m.displaySymbol}
                    </span>
                    <span className="text-xs text-[#756253] dark:text-[#B9A392]">
                      {m.exchange} · {m.marketType}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs tabular-nums shrink-0">
                    <span className="text-[#1D150F] dark:text-[#FFF8F0]">
                      ${formatPrice(m.lastPrice)}
                    </span>
                    <span
                      className={
                        m.change24hPct >= 0
                          ? 'text-[#12A875] dark:text-[#22E59B]'
                          : 'text-[#DC4C54] dark:text-[#FF747B]'
                      }
                    >
                      {formatPercent(m.change24hPct)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Navigation shortcuts */}
          {matchedPages.length > 0 && (
            <div className="p-2">
              <div className="px-2 py-1 text-[11px] font-medium text-[#756253] dark:text-[#B9A392]">
                Workspaces
              </div>
              <div className="space-y-0.5">
                {matchedPages.map((p) => (
                  <button
                    key={p.section}
                    type="button"
                    onClick={() => {
                      setActiveSection(p.section);
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-[#EFE4D7]/70 dark:hover:bg-[#2F1E13]/70 transition-colors"
                  >
                    <span className="text-sm font-medium text-[#1D150F] dark:text-[#FFF8F0]">
                      {p.label}
                    </span>
                    <span className="text-xs text-[#756253] dark:text-[#B9A392]">{p.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
