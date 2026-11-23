import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  Filter,
  Globe,
  Grid2x2,
  Home,
  Menu,
  Radio,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { CRYPTO_EXCHANGES, EXCHANGE_LABELS, EXCHANGE_MARKET_TYPES } from '../../shared/constants';
import { formatPercent, formatPrice, formatTimestamp } from '../../shared/format';
import type { ExchangeId, MarketType, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';
import { GoogleAuthButton } from '../ui/GoogleAuthButton';
import { KINETIC_EASE, KINETIC_SPRING, KineticSegmentedControl } from '../ui/Kinetic';

type AssetClass = 'crypto' | 'stocks' | 'cfds';
const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: 'crypto', label: 'Crypto' },
  { value: 'stocks', label: 'Stocks' },
  { value: 'cfds', label: 'CFDs' },
];

const PRIMARY_NAV: {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'markets', label: 'Markets', icon: BarChart3 },
  { id: 'signals', label: 'Signals', icon: Radio },
  { id: 'screener', label: 'Screener', icon: Filter },
  { id: 'heatmaps', label: 'Heatmaps', icon: Grid2x2 },
  { id: 'arbitrage', label: 'Arbitrage', icon: ArrowLeftRight, badge: 'LIVE' },
  { id: 'demo', label: 'Demo Trade', icon: CandlestickChart, badge: 'DEMO' },
  { id: 'ai', label: 'AI Insights', icon: Sparkles },
];

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Dashboard Overview',
  markets: 'Markets Explorer',
  signals: 'Live Signal Feed',
  screener: 'Advanced Screener',
  heatmaps: 'Market Heatmaps',
  arbitrage: 'Real-Time Arbitrage Scanner',
  demo: 'Demo Trading Terminal',
  ai: 'AI Research Insights',
  settings: 'Settings & Diagnostics',
};

/** Signature Emerald Hexagonal Aperture Emblem for SIGLENS */
const SiglensMark: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <motion.svg
    viewBox="0 0 40 40"
    fill="none"
    className={className}
    aria-hidden="true"
    whileHover={{ rotate: 30, scale: 1.05 }}
    transition={KINETIC_SPRING}
  >
    <defs>
      <linearGradient id="siglensEmeraldGrad" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4ADE80" />
        <stop offset="100%" stopColor="#16A34A" />
      </linearGradient>
    </defs>
    <path d="M18.6 4.2L7.2 10.8L18.6 17.4V4.2Z" fill="url(#siglensEmeraldGrad)" />
    <path d="M21.4 4.2V17.4L32.8 10.8L21.4 4.2Z" fill="url(#siglensEmeraldGrad)" opacity="0.92" />
    <path d="M34.2 13.2L22.8 19.8L34.2 26.4V13.2Z" fill="url(#siglensEmeraldGrad)" opacity="0.84" />
    <path d="M21.4 22.6V35.8L32.8 29.2L21.4 22.6Z" fill="url(#siglensEmeraldGrad)" />
    <path d="M18.6 35.8V22.6L7.2 29.2L18.6 35.8Z" fill="url(#siglensEmeraldGrad)" opacity="0.9" />
    <path d="M5.8 26.4L17.2 19.8L5.8 13.2V26.4Z" fill="url(#siglensEmeraldGrad)" opacity="0.82" />
  </motion.svg>
);

function formatHeaderClock(date: Date, timezone: 'UTC' | 'local'): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timezone === 'UTC' ? { timeZone: 'UTC' } : {}),
    };
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('hour')}:${get('minute')} ${timezone === 'UTC' ? 'UTC' : 'Local'}`;
  } catch {
    return `${date.toISOString().slice(11, 16)} UTC`;
  }
}

export const AppShell: React.FC<{
  children: React.ReactNode;
  onNavigateLanding?: () => void;
}> = ({ children, onNavigateLanding }) => {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const preferences = useAppStore((s) => s.preferences);
  const wsFreshness = useAppStore((s) => s.wsFreshness);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const notifications = useAppStore((s) => s.notifications);
  const clearNotifications = useAppStore((s) => s.clearNotifications);
  const setExchange = useAppStore((s) => s.setExchange);
  const setMarketType = useAppStore((s) => s.setMarketType);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setCommandSearchOpen = useAppStore((s) => s.setCommandSearchOpen);
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [notifOpen, setNotifOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const collapsed = preferences.sidebarCollapsed;
  const supportedMarketTypes = EXCHANGE_MARKET_TYPES[exchange];
  const activeAssetClass: AssetClass =
    exchange === 'stocks' ? 'stocks' : exchange === 'cfds' ? 'cfds' : 'crypto';

  const handleAssetClassChange = (cls: AssetClass) => {
    if (cls === 'stocks') {
      setExchange('stocks');
    } else if (cls === 'cfds') {
      setExchange('cfds');
    } else if (exchange === 'stocks' || exchange === 'cfds') {
      setExchange('binance');
    }
  };

  const ribbonItems = useMemo(() => {
    const entries = Object.values(liveTickers)
      .filter((t) => t.lastPrice > 0 && t.canonicalId.startsWith('binance:spot:'))
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
      .slice(0, 12);
    return entries.map((t) => {
      const parts = t.canonicalId.split(':');
      const ex = (parts[0] || 'binance') as ExchangeId;
      const mt = (parts[1] || 'spot') as MarketType;
      const sym = parts[2] || t.canonicalId;
      return { ...t, exchange: ex, marketType: mt, displaySymbol: sym };
    });
  }, [liveTickers]);

  const freshnessDot =
    wsFreshness === 'LIVE'
      ? 'bg-[#22C55E] shadow-[0_0_8px_#22C55E]'
      : wsFreshness === 'DELAYED' || wsFreshness === 'RECONNECTING'
        ? 'bg-amber-400'
        : 'bg-[#FB7185]';

  const SidebarInner = ({ isMobile = false, onSelect }: { isMobile?: boolean; onSelect?: () => void }) => {
    const isCompact = !isMobile && collapsed;
    return (
      <div className="flex flex-col h-full text-white">
        {/* Top Brand + Collapse */}
        <div className="h-16 flex items-center justify-between px-4 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveSection('overview');
              onSelect?.();
            }}
            aria-label="SIGLENS Home"
            className="flex items-center gap-2.5 min-w-0"
          >
            <SiglensMark className="w-8 h-8 shrink-0 drop-shadow-[0_0_12px_rgba(34,197,94,0.35)]" />
            {!isCompact && (
              <div className="text-left min-w-0">
                <div className="text-[15px] font-black tracking-[0.06em] text-white leading-none">
                  SIGLENS
                </div>
                <div className="text-[10px] text-[#7D9486] mt-0.5 truncate">
                  See Beyond the Market
                </div>
              </div>
            )}
          </button>
          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
              className="p-1.5 rounded-lg text-[#9BB0A3] hover:text-white hover:bg-white/[0.08]"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updatePreferences({ sidebarCollapsed: !collapsed })}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1.5 rounded-lg text-[#7D9486] hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Sidebar Search Pill */}
        {!isCompact && (
          <div className="px-3 pb-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCommandSearchOpen(true);
                onSelect?.();
              }}
              aria-label="Search pairs"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-xs text-[#9BB0A3] transition-colors"
            >
              <Search className="w-3.5 h-3.5 shrink-0 text-[#7D9486]" />
              <span className="truncate">Search pairs...</span>
              <span className="ml-auto px-1.5 py-0.5 rounded-md bg-white/[0.08] font-mono text-[10px] text-[#B7C9BE]">
                ⌘K
              </span>
            </button>
          </div>
        )}

        {/* Mobile Asset Class Switcher */}
        {isMobile && (
          <div className="px-3 pb-2">
            <KineticSegmentedControl
              options={ASSET_CLASSES}
              value={activeAssetClass}
              onChange={handleAssetClassChange}
              layoutId="shell-mobile-asset-class"
              size="xs"
              variant="obsidian"
              className="w-full justify-between"
            />
          </div>
        )}

        {/* Primary Navigation */}
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
          {!isCompact && (
            <div className="px-2 pt-2 pb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase text-[#5E7366]">
              Navigation
            </div>
          )}
          <nav aria-label="Primary Workspace Navigation" className="space-y-1">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(item.id);
                    onSelect?.();
                  }}
                  aria-current={active ? 'page' : undefined}
                  title={isCompact ? item.label : undefined}
                  className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] transition-all whitespace-nowrap ${
                    active
                      ? 'text-white font-semibold'
                      : 'text-[#8FA497] hover:bg-white/[0.05] hover:text-white font-medium'
                  } ${isCompact ? 'justify-center px-0' : ''}`}
                >
                  {active && (
                    <motion.span
                      layoutId={isMobile ? 'sig-nav-mobile' : 'sig-nav-desktop'}
                      transition={KINETIC_SPRING}
                      className="absolute inset-0 rounded-xl bg-white/[0.11] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                    />
                  )}
                  <span
                    className={`relative z-10 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      active ? 'bg-[#22C55E] text-[#05140A]' : 'bg-white/[0.06] text-[#9BB0A3]'
                    }`}
                  >
                    <Icon className="w-[15px] h-[15px]" />
                  </span>
                  {!isCompact && <span className="relative z-10 truncate flex-1 text-left">{item.label}</span>}
                  {!isCompact && item.id === 'signals' && (
                    <span
                      className="relative z-10 w-5 h-5 rounded-full bg-[#22C55E] text-[#05140A] text-[10px] font-mono font-bold flex items-center justify-center shrink-0"
                      title="Live signals active"
                    >
                      •
                    </span>
                  )}
                  {!isCompact && item.badge && (
                    <span className="relative z-10 px-1.5 py-0.5 rounded-md bg-[#22C55E]/20 text-[#4ADE80] border border-[#22C55E]/30 text-[9px] font-bold shrink-0">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Pinned Landing + Settings + Market Feed Status */}
        <div className="p-3 border-t border-white/[0.08] space-y-1.5 shrink-0">
          {onNavigateLanding && (
            <button
              type="button"
              onClick={() => {
                onSelect?.();
                onNavigateLanding();
              }}
              title={isCompact ? 'Landing Page' : undefined}
              className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] transition-all whitespace-nowrap text-[#8FA497] hover:bg-white/[0.05] hover:text-white font-medium ${
                isCompact ? 'justify-center px-0' : ''
              }`}
            >
              <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-white/[0.06] text-[#9BB0A3]">
                <Globe className="w-[15px] h-[15px]" />
              </span>
              {!isCompact && <span>Landing Page</span>}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setActiveSection('settings');
              onSelect?.();
            }}
            aria-current={activeSection === 'settings' ? 'page' : undefined}
            title={isCompact ? 'Settings' : undefined}
            className={`relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] transition-all whitespace-nowrap ${
              activeSection === 'settings'
                ? 'bg-white/[0.11] text-white font-semibold'
                : 'text-[#8FA497] hover:bg-white/[0.05] hover:text-white font-medium'
            } ${isCompact ? 'justify-center px-0' : ''}`}
          >
            <span
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                activeSection === 'settings'
                  ? 'bg-[#22C55E] text-[#05140A]'
                  : 'bg-white/[0.06] text-[#9BB0A3]'
              }`}
            >
              <Settings className="w-[15px] h-[15px]" />
            </span>
            {!isCompact && <span>Settings</span>}
          </button>

          {!isCompact && (
            <div className="px-2 pt-1 space-y-1">
              <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-[#5E7366]">
                Market Feed
              </div>
              <div className="flex items-center justify-between gap-2 py-1">
                <span
                  data-testid="global-freshness"
                  className="inline-flex items-center gap-2 text-xs font-medium text-[#D5E2DA]"
                  title="Real-time WebSocket market feed status"
                >
                  <span className="relative flex h-2 w-2">
                    {wsFreshness === 'LIVE' && (
                      <span className="sig-sonar-ring absolute inline-flex h-full w-full rounded-full bg-[#22C55E]" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${freshnessDot}`} />
                  </span>
                  {wsFreshness === 'LIVE' ? 'Live Market' : wsFreshness}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updatePreferences({
                      timezone: preferences.timezone === 'UTC' ? 'local' : 'UTC',
                    })
                  }
                  title="Toggle UTC / Local clock"
                  aria-label="Toggle timezone"
                  className="font-mono text-[11px] text-[#7D9486] hover:text-white transition-colors"
                >
                  {formatHeaderClock(now, preferences.timezone)}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex bg-[#0B120E] text-[#111814]">
      {/* Desktop Obsidian-Emerald Left Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen transition-[width] duration-200 z-20 relative overflow-hidden ${
          collapsed ? 'w-[72px]' : 'w-[244px]'
        }`}
        style={{
          background:
            'radial-gradient(circle at 0% 0%, rgba(22, 163, 74, 0.24) 0%, rgba(11, 18, 14, 0.96) 44%, #09100C 100%)',
        }}
      >
        <SidebarInner />
      </aside>

      {/* Mobile Drawer Navigation */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 lg:hidden flex bg-black/65 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          >
            <motion.div
              initial={{ x: -264 }}
              animate={{ x: 0 }}
              exit={{ x: -264 }}
              transition={{ duration: 0.24, ease: KINETIC_EASE }}
              className="w-[260px] max-w-[84vw] h-full border-r border-white/[0.08] flex flex-col"
              style={{
                background:
                  'radial-gradient(circle at 0% 0%, rgba(22, 163, 74, 0.24) 0%, #0B120E 48%, #080E0A 100%)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <SidebarInner isMobile onSelect={() => setMobileNavOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Rounded Alabaster Workspace Canvas */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#F4F6F5] lg:rounded-[26px] lg:my-2.5 lg:mr-2.5 overflow-x-clip shadow-[0_0_48px_rgba(0,0,0,0.45)] min-h-screen lg:min-h-[calc(100vh-20px)]">
        {/* Crisp Alabaster Top Bar */}
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 flex items-center justify-between gap-3 bg-[#F4F6F5]/90 backdrop-blur-md border-b border-[#E5EAE7]/80">
          {/* Left Zone: Mobile Menu + Active Section Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-xl bg-white border border-[#E5EAE7] text-[#111814]"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <div className="text-[15px] font-bold tracking-tight text-[#111814] truncate">
                {SECTION_TITLES[activeSection]}
              </div>
              <div className="hidden sm:block text-[11px] text-[#637369] truncate">
                {EXCHANGE_LABELS[exchange]} · Real-Time Multi-Asset Intelligence
              </div>
            </div>
          </div>

          {/* Right Zone: Obsidian-Emerald Asset Class Switcher + Venue + Alerts */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className="hidden sm:flex items-center gap-2">
              <KineticSegmentedControl
                options={ASSET_CLASSES}
                value={activeAssetClass}
                onChange={handleAssetClassChange}
                layoutId="shell-asset-class"
                size="xs"
                variant="obsidian"
              />

              {activeAssetClass === 'crypto' && (
                <select
                  aria-label="Select exchange"
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value as ExchangeId)}
                  className="px-3 py-1.5 rounded-full border border-[#E5EAE7] bg-white hover:border-[#C6D8C7] text-[11px] font-semibold text-[#111814] transition-colors focus:outline-none focus:border-[#16A34A]"
                >
                  {CRYPTO_EXCHANGES.map((ex) => (
                    <option key={ex} value={ex}>
                      {EXCHANGE_LABELS[ex]}
                    </option>
                  ))}
                </select>
              )}

              {supportedMarketTypes.includes('spot') && supportedMarketTypes.includes('perpetual') && (
                <select
                  aria-label="Select market type"
                  value={marketType}
                  onChange={(e) => setMarketType(e.target.value as MarketType)}
                  className="px-3 py-1.5 rounded-full border border-[#E5EAE7] bg-white hover:border-[#C6D8C7] text-[11px] font-semibold text-[#111814] transition-colors focus:outline-none"
                >
                  <option value="spot">Spot</option>
                  <option value="perpetual">Perp</option>
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCommandSearchOpen(true)}
              aria-label="Quick search"
              className="lg:hidden p-2 rounded-full border border-[#E5EAE7] bg-white text-[#637369] hover:text-[#111814]"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Google OAuth Sign In / Profile */}
            <GoogleAuthButton compact />

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Alert notifications"
                className="relative p-2 rounded-full border border-[#E5EAE7] bg-white hover:border-[#C6D8C7] text-[#637369] hover:text-[#111814] transition-colors"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#16A34A]" />
                )}
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: KINETIC_EASE }}
                    className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl bg-white border border-[#E5EAE7] shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5EAE7]">
                      <span className="text-xs font-bold text-[#111814]">Alert Notifications</span>
                      {notifications.length > 0 && (
                        <button
                          type="button"
                          onClick={clearNotifications}
                          className="text-[11px] font-medium text-[#637369] hover:text-[#111814]"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#EDF1EE]">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-[#637369]">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div key={n.id} className="px-4 py-3 text-xs">
                            <div className="font-mono font-semibold text-[#111814]">
                              {n.displaySymbol} · {n.timeframe}
                            </div>
                            <div className="text-[#637369] mt-0.5">{n.message}</div>
                            <div className="text-[10px] font-mono text-[#7D8E84] mt-1">
                              {formatTimestamp(n.triggeredAt, preferences.timezone)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Live Kinetic Ticker Strip */}
        {ribbonItems.length >= 4 && (
          <div className="border-b border-[#E5EAE7]/80 bg-white/75 backdrop-blur-sm overflow-hidden">
            <div className="sig-marquee-track py-1.5">
              {[...ribbonItems, ...ribbonItems].map((item, idx) => {
                const pos = (item.change24hPct ?? 0) >= 0;
                return (
                  <button
                    key={`${item.canonicalId}-${idx}`}
                    type="button"
                    onClick={() => selectMarket(item.exchange, item.marketType, item.displaySymbol, true)}
                    className="inline-flex items-center gap-2 px-4 border-r border-[#EDF1EE] hover:bg-[#F3F6F4] transition-colors font-mono text-[11px] tabular-nums whitespace-nowrap"
                  >
                    <span className="font-bold text-[#111814]">{item.displaySymbol.split('/')[0]}</span>
                    <span className="text-[#637369]">${formatPrice(item.lastPrice, preferences.decimalPrecision)}</span>
                    {typeof item.change24hPct === 'number' && (
                      <span className={`font-semibold ${pos ? 'text-[#16A34A]' : 'text-[#E11D48]'}`}>
                        {formatPercent(item.change24hPct)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Scrollable Workspace */}
        <main className="flex-1 w-full max-w-[1520px] mx-auto px-4 sm:px-6 py-5 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};
