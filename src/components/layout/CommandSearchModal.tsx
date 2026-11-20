import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../../services/api';
import { formatPercent, formatPrice } from '../../shared/format';
import type { MarketTicker, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

const QUICK_PAGES: { section: NavSection; label: string; hint: string }[] = [
  { section: 'overview', label: 'Overview Dashboard', hint: 'Market pulse, movers & watchlist' },
  { section: 'explorer', label: 'Asset Explorer', hint: '2D/3D charts & 10-indicator signal report' },
  { section: 'screener', label: 'Advanced Screener', hint: '20 executable presets & custom filters' },
  { section: 'signals', label: 'Live Signal Feed', hint: 'Confirmed technical events & transitions' },
  { section: 'studio3d', label: '3D Chart Studio', hint: 'Interactive WebGL candlesticks & surfaces' },
  { section: 'heatmaps', label: 'Market Heatmaps', hint: 'Performance, correlation & breadth' },
  { section: 'derivatives', label: 'Derivatives Analytics', hint: 'Bybit V5 funding, OI & basis' },
  { section: 'defi', label: 'DeFi Intelligence', hint: 'DefiLlama TVL, chains & protocols' },
  { section: 'compare', label: 'Compare Assets', hint: 'Overlay up to 5 assets & correlation' },
  { section: 'alerts', label: 'Smart Alerts', hint: 'Technical condition & webhook rules' },
  { section: 'ai', label: 'AI Research Assistant', hint: 'Optional BYOK explainability & NL scan' },
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
        className="w-full max-w-2xl rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E6EBF0] dark:border-[#27313C]">
          <Search className="w-4 h-4 text-[#677482] dark:text-[#8B97A5] shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pairs (BTC/USDT, ETH, SOL, Bybit, Kraken) or workspace..."
            className="w-full bg-transparent text-sm text-[#17212B] dark:text-[#F4F7FA] placeholder-[#677482] dark:placeholder-[#8B97A5] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close search"
            className="p-1 rounded-md text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
          {/* Markets section */}
          <div className="p-2">
            <div className="px-2 py-1 text-[11px] font-medium text-[#677482] dark:text-[#8B97A5]">
              Markets {loading ? '· Searching...' : `· ${results.length} matches`}
            </div>
            {results.length === 0 && !loading && (
              <div className="px-3 py-4 text-xs text-[#677482] dark:text-[#8B97A5]">
                No matching markets found across connected public exchanges.
              </div>
            )}
            <div className="space-y-0.5">
              {results.slice(0, 12).map((m) => (
                <button
                  key={m.canonicalId}
                  type="button"
                  onClick={() => selectMarket(m.exchange, m.marketType, m.displaySymbol, true)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-sm font-semibold text-[#17212B] dark:text-[#F4F7FA] font-mono">
                      {m.displaySymbol}
                    </span>
                    <span className="text-xs text-[#677482] dark:text-[#8B97A5]">
                      {m.exchange} · {m.marketType}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs tabular-nums shrink-0">
                    <span className="text-[#17212B] dark:text-[#F4F7FA]">
                      ${formatPrice(m.lastPrice)}
                    </span>
                    <span
                      className={
                        m.change24hPct >= 0
                          ? 'text-[#16A378] dark:text-[#35C89A]'
                          : 'text-[#DC4C54] dark:text-[#F16B72]'
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
              <div className="px-2 py-1 text-[11px] font-medium text-[#677482] dark:text-[#8B97A5]">
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
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D] transition-colors"
                  >
                    <span className="text-sm font-medium text-[#17212B] dark:text-[#F4F7FA]">
                      {p.label}
                    </span>
                    <span className="text-xs text-[#677482] dark:text-[#8B97A5]">{p.hint}</span>
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
