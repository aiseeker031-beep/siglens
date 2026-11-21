import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { api } from '../../services/api';
import { formatPercent, formatPrice } from '../../shared/format';
import type { MarketTicker, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';
import { KINETIC_EASE } from '../ui/Kinetic';

const QUICK_PAGES: { section: NavSection; label: string; hint: string }[] = [
  { section: 'overview', label: 'Home Dashboard', hint: 'Market pulse, live chart & watchlist' },
  { section: 'markets', label: 'Markets', hint: 'Real-time multi-exchange spot & perp pairs' },
  { section: 'signals', label: 'Live Signal Feed', hint: 'Real-time Entry, SL & TP1-TP3 setups' },
  { section: 'screener', label: 'Advanced Screener', hint: '20 executable presets & custom filters' },
  { section: 'heatmaps', label: 'Market Heatmaps', hint: 'Performance, correlation & breadth' },
  { section: 'arbitrage', label: 'Real-Time Arbitrage Scanner', hint: 'Cross-exchange spot spreads & Stat-Arb Z-scores' },
  { section: 'arena', label: 'Autonomous Bot Arena', hint: 'Live paper-trading bots, equity curve & risk engine' },
  { section: 'ai', label: 'AI Insights', hint: 'Optional BYOK explainability & NL scan' },
  { section: 'settings', label: 'Settings & Diagnostics', hint: 'Weights, providers, alerts & BYOK' },
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
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  const matchedPages = query.trim()
    ? QUICK_PAGES.filter(
        (p) =>
          p.label.toLowerCase().includes(query.toLowerCase()) ||
          p.hint.toLowerCase().includes(query.toLowerCase()),
      )
    : QUICK_PAGES.slice(0, 5);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Global Pair and Navigation Search"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-[#0A0D14]/35 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: KINETIC_EASE }}
            className="w-full max-w-2xl rounded-2xl bg-white border border-[#DCE0E8] shadow-[0_24px_64px_-16px_rgba(10,13,20,0.22)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#ECEFF4]">
              <Search className="w-4 h-4 text-[#7C8798] shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search crypto, stocks (AAPL, NVDA), CFDs (US500, XAU, EUR/USD)..."
                className="w-full bg-transparent text-sm text-[#0A0D14] placeholder-[#8A94A6] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close search"
                className="p-1.5 rounded-lg text-[#7C8798] hover:text-[#0A0D14] hover:bg-[#F2F4F7] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto divide-y divide-[#ECEFF4]">
              {/* Markets section */}
              <div className="p-2">
                <div className="px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-[#7C8798]">
                  Markets {loading ? '· Searching...' : `· ${results.length} matches`}
                </div>
                {results.length === 0 && !loading && (
                  <div className="px-3 py-4 text-xs text-[#64748B]">
                    No matching markets found across connected public exchanges.
                  </div>
                )}
                <div className="space-y-0.5">
                  {results.slice(0, 12).map((m) => (
                    <button
                      key={m.canonicalId}
                      type="button"
                      onClick={() => selectMarket(m.exchange, m.marketType, m.displaySymbol, true)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-[#F2F4F7] transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-sm font-semibold text-[#0A0D14] font-mono">
                          {m.displaySymbol}
                        </span>
                        <span className="text-xs text-[#7C8798]">
                          {m.exchange} · {m.marketType}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-xs tabular-nums shrink-0">
                        <span className="text-[#0A0D14] font-medium">
                          ${formatPrice(m.lastPrice)}
                        </span>
                        <span
                          className={
                            m.change24hPct >= 0
                              ? 'text-[#059669] font-semibold'
                              : 'text-[#E11D48] font-semibold'
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
                  <div className="px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-[#7C8798]">
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
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left hover:bg-[#F2F4F7] transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#0A0D14]">{p.label}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-[#7C8798] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-xs text-[#7C8798]">{p.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
