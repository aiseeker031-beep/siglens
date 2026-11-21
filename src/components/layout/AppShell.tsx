import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid2x2,
  Home,
  Menu,
  Radio,
  Search,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { EXCHANGE_LABELS, EXCHANGE_MARKET_TYPES } from '../../shared/constants';
import { formatPercent, formatPrice, formatTimestamp } from '../../shared/format';
import type { ExchangeId, MarketType, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';
import { KINETIC_EASE, KINETIC_SPRING, KineticSegmentedControl } from '../ui/Kinetic';

type AssetClass = 'crypto' | 'stocks' | 'cfds';
const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: 'crypto', label: 'Crypto' },
  { value: 'stocks', label: 'Stocks' },
  { value: 'cfds', label: 'CFDs' },
];

const PRIMARY_NAV: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'markets', label: 'Markets', icon: BarChart3 },
  { id: 'signals', label: 'Signals', icon: Radio },
  { id: 'screener', label: 'Screener', icon: Filter },
  { id: 'heatmaps', label: 'Heatmaps', icon: Grid2x2 },
  { id: 'arena', label: 'Bot Arena', icon: Bot },
  { id: 'ai', label: 'AI Insights', icon: Sparkles },
];

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Overview',
  markets: 'Markets',
  signals: 'Live Signals',
  screener: 'Screener',
  heatmaps: 'Heatmaps',
  arena: 'Bot Arena',
  ai: 'AI Insights',
  settings: 'Settings',
};

/** Precision kinetic geometric aperture mark for SIGLENS */
const SiglensMark: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <motion.svg
    viewBox="0 0 40 40"
    fill="none"
    className={className}
    aria-hidden="true"
    whileHover={{ rotate: 30, scale: 1.04 }}
    transition={KINETIC_SPRING}
  >
    <defs>
      <linearGradient id="siglensKineticGrad" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0A0D14" />
        <stop offset="100%" stopColor="#2563EB" />
      </linearGradient>
    </defs>
    <path d="M18.6 4.2L7.2 10.8L18.6 17.4V4.2Z" fill="url(#siglensKineticGrad)" />
    <path d="M21.4 4.2V17.4L32.8 10.8L21.4 4.2Z" fill="#0A0D14" opacity="0.9" />
    <path d="M34.2 13.2L22.8 19.8L34.2 26.4V13.2Z" fill="#2563EB" opacity="0.88" />
    <path d="M21.4 22.6V35.8L32.8 29.2L21.4 22.6Z" fill="#0A0D14" />
    <path d="M18.6 35.8V22.6L7.2 29.2L18.6 35.8Z" fill="url(#siglensKineticGrad)" opacity="0.85" />
    <path d="M5.8 26.4L17.2 19.8L5.8 13.2V26.4Z" fill="#059669" opacity="0.86" />
  </motion.svg>
);

function formatHeaderClock(date: Date, timezone: 'UTC' | 'local'): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timezone === 'UTC' ? { timeZone: 'UTC' } : {}),
    };
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('month')} ${get('day')} · ${get('hour')}:${get('minute')} ${timezone === 'UTC' ? 'UTC' : 'Local'}`;
  } catch {
    return `${date.toISOString().slice(11, 16)} UTC`;
  }
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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

  const freshnessColor =
    wsFreshness === 'LIVE'
      ? 'text-[#059669]'
      : wsFreshness === 'DELAYED' || wsFreshness === 'RECONNECTING'
        ? 'text-[#D97706]'
        : 'text-[#E11D48]';

  const SidebarNavList = ({ onSelect, mobile = false }: { onSelect?: () => void; mobile?: boolean }) => (
    <nav aria-label="Primary Workspace Navigation" className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1">
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
            title={!mobile && collapsed ? item.label : undefined}
            className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors whitespace-nowrap ${
              active
                ? 'text-white font-semibold'
                : 'text-[#4B5565] hover:text-[#0A0D14] hover:bg-[#F2F4F7]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={mobile ? 'sig-nav-mobile-pill' : 'sig-nav-desktop-pill'}
                transition={KINETIC_SPRING}
                className="absolute inset-0 rounded-xl bg-[#0A0D14] shadow-[0_6px_16px_-6px_rgba(10,13,20,0.38)]"
              />
            )}
            <span className="relative z-10 shrink-0">
              <Icon className="w-[17px] h-[17px]" />
            </span>
            {(mobile || !collapsed) && <span className="relative z-10 truncate">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="relative min-h-screen flex text-[#0A0D14] sig-kinetic-canvas">
      {/* Desktop Left Navigation Rail */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-[#E6E8EE] bg-white/90 backdrop-blur-xl sticky top-0 h-screen transition-[width] duration-200 z-20 ${
          collapsed ? 'w-[72px]' : 'w-[200px]'
        }`}
      >
        {/* Brand Emblem + Collapse Toggle */}
        <div className="h-16 flex items-center justify-between px-3.5 border-b border-[#ECEFF4]">
          <button
            type="button"
            onClick={() => setActiveSection('overview')}
            aria-label="SIGLENS Home"
            className="flex items-center gap-2.5 min-w-0"
          >
            <SiglensMark className="w-8 h-8 shrink-0" />
            {!collapsed && (
              <div className="text-left min-w-0">
                <div className="text-[14px] font-extrabold tracking-[0.06em] text-[#0A0D14] leading-none">
                  SIGLENS
                </div>
                <div className="text-[10px] font-mono text-[#7C8798] mt-0.5 tracking-tight">
                  QUANT STUDIO
                </div>
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={() => updatePreferences({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-[#7C8798] hover:text-[#0A0D14] hover:bg-[#F2F4F7] transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <SidebarNavList />

        {/* Bottom Pinned Settings */}
        <div className="p-2.5 border-t border-[#ECEFF4]">
          <button
            type="button"
            onClick={() => setActiveSection('settings')}
            aria-current={activeSection === 'settings' ? 'page' : undefined}
            title={collapsed ? 'Settings' : undefined}
            className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors whitespace-nowrap ${
              activeSection === 'settings'
                ? 'text-white font-semibold'
                : 'text-[#4B5565] hover:text-[#0A0D14] hover:bg-[#F2F4F7]'
            }`}
          >
            {activeSection === 'settings' && (
              <motion.span
                layoutId="sig-nav-desktop-pill"
                transition={KINETIC_SPRING}
                className="absolute inset-0 rounded-xl bg-[#0A0D14] shadow-[0_6px_16px_-6px_rgba(10,13,20,0.38)]"
              />
            )}
            <Settings className="relative z-10 w-[17px] h-[17px] shrink-0" />
            {!collapsed && <span className="relative z-10">Settings</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 lg:hidden flex bg-[#0A0D14]/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          >
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ duration: 0.24, ease: KINETIC_EASE }}
              className="w-[256px] max-w-[82vw] h-full bg-white border-r border-[#E6E8EE] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-16 flex items-center justify-between px-4 border-b border-[#ECEFF4]">
                <div className="flex items-center gap-2.5">
                  <SiglensMark className="w-7 h-7" />
                  <span className="font-extrabold tracking-[0.06em] text-[15px] text-[#0A0D14]">SIGLENS</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-2 rounded-lg text-[#7C8798] hover:text-[#0A0D14] hover:bg-[#F2F4F7]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-3 pt-3 pb-1">
                <KineticSegmentedControl
                  options={ASSET_CLASSES}
                  value={activeAssetClass}
                  onChange={handleAssetClassChange}
                  layoutId="shell-mobile-asset-class"
                  size="xs"
                  className="w-full justify-between"
                />
              </div>
              <SidebarNavList mobile onSelect={() => setMobileNavOpen(false)} />
              <div className="p-2.5 border-t border-[#ECEFF4]">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('settings');
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium ${
                    activeSection === 'settings'
                      ? 'sig-btn-primary'
                      : 'text-[#4B5565] hover:bg-[#F2F4F7]'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Precision Glass Top Header */}
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 flex items-center justify-between gap-4 bg-white/82 backdrop-blur-xl border-b border-[#E6E8EE]">
          {/* Left Zone: Mobile Menu + Active Section Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-xl text-[#4B5565] hover:bg-[#F2F4F7]"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
              <span className="lg:hidden text-base font-extrabold tracking-[0.06em] text-[#0A0D14]">
                SIGLENS
              </span>
              <span className="hidden lg:inline-flex items-center gap-2">
                <span className="text-[13px] font-bold tracking-tight text-[#0A0D14]">
                  {SECTION_TITLES[activeSection]}
                </span>
                <span className="text-[#D3D8E2]">/</span>
                <span className="text-[12px] font-medium text-[#7C8798]">
                  See Beyond the Market
                </span>
              </span>
            </div>
          </div>

          {/* Center Zone: Minimal Command Pill Search */}
          <div className="flex-1 max-w-md flex justify-center">
            <motion.button
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => setCommandSearchOpen(true)}
              aria-label="Search pairs"
              className="w-full max-w-[340px] flex items-center gap-2.5 px-3.5 py-2 rounded-full border border-[#E6E8EE] bg-[#F7F8FA] hover:bg-white hover:border-[#CFD6E3] text-xs text-[#64748B] transition-all shadow-[inset_0_1px_2px_rgba(10,13,20,0.03)]"
            >
              <Search className="w-3.5 h-3.5 shrink-0 text-[#7C8798]" />
              <span className="truncate">Search pairs or workspaces...</span>
              <kbd className="hidden sm:inline-flex items-center ml-auto px-1.5 py-0.5 rounded-md bg-white border border-[#E6E8EE] font-mono text-[10px] text-[#7C8798]">
                ⌘K
              </kbd>
            </motion.button>
          </div>

          {/* Right Zone: Kinetic Live Status + Clock + Exchange Selector + Alerts */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span
              data-testid="global-freshness"
              className={`hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#F7F8FA] border border-[#E6E8EE] text-[11px] font-mono font-semibold whitespace-nowrap ${freshnessColor}`}
              title="Real-time WebSocket market feed status"
            >
              <span className="relative flex h-2 w-2">
                {wsFreshness === 'LIVE' && (
                  <span className="sig-sonar-ring absolute inline-flex h-full w-full rounded-full bg-[#059669]" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    wsFreshness === 'LIVE'
                      ? 'bg-[#059669]'
                      : wsFreshness === 'RECONNECTING' || wsFreshness === 'DELAYED'
                        ? 'bg-[#D97706]'
                        : 'bg-[#E11D48]'
                  }`}
                />
              </span>
              {wsFreshness === 'LIVE' ? 'LIVE' : wsFreshness}
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
              className="hidden xl:inline-flex items-center text-[11px] font-mono text-[#64748B] hover:text-[#0A0D14] transition-colors whitespace-nowrap"
            >
              {formatHeaderClock(now, preferences.timezone)}
            </button>

            {/* Kinetic Asset Class Switcher (Crypto | Stocks | CFDs) + Venue */}
            <div className="hidden sm:flex items-center gap-2">
              <KineticSegmentedControl
                options={ASSET_CLASSES}
                value={activeAssetClass}
                onChange={handleAssetClassChange}
                layoutId="shell-asset-class"
                size="xs"
              />

              {activeAssetClass === 'crypto' && (
                <select
                  aria-label="Select exchange"
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value as ExchangeId)}
                  className="px-3 py-1.5 rounded-full border border-[#E6E8EE] bg-white hover:border-[#CFD6E3] text-[11px] font-semibold text-[#0A0D14] transition-colors focus:outline-none focus:border-[#2563EB]"
                >
                  {(['binance', 'bybit', 'kraken', 'coinbase'] as ExchangeId[]).map((ex) => (
                    <option key={ex} value={ex}>
                      {EXCHANGE_LABELS[ex]}
                    </option>
                  ))}
                </select>
              )}

              {exchange === 'bybit' && (
                <select
                  aria-label="Select market type"
                  value={marketType}
                  onChange={(e) => setMarketType(e.target.value as MarketType)}
                  className="px-3 py-1.5 rounded-full border border-[#E6E8EE] bg-white hover:border-[#CFD6E3] text-[11px] font-semibold text-[#0A0D14] transition-colors focus:outline-none focus:border-[#2563EB]"
                >
                  <option value="spot">Spot</option>
                  <option value="perpetual" disabled={!supportedMarketTypes.includes('perpetual')}>
                    Perp
                  </option>
                </select>
              )}
            </div>

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Alert notifications"
                className="relative p-2 rounded-full border border-[#E6E8EE] bg-white hover:border-[#CFD6E3] text-[#4B5565] hover:text-[#0A0D14] transition-colors"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#2563EB]" />
                )}
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: KINETIC_EASE }}
                    className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl bg-white border border-[#DCE0E8] shadow-[0_20px_50px_-14px_rgba(10,13,20,0.18)] z-50 overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#ECEFF4]">
                      <span className="text-xs font-bold text-[#0A0D14]">Alert Notifications</span>
                      {notifications.length > 0 && (
                        <button
                          type="button"
                          onClick={clearNotifications}
                          className="text-[11px] font-medium text-[#7C8798] hover:text-[#0A0D14]"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#ECEFF4]">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-xs text-[#7C8798]">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div key={n.id} className="px-4 py-3 text-xs">
                            <div className="font-mono font-semibold text-[#0A0D14]">
                              {n.displaySymbol} · {n.timeframe}
                            </div>
                            <div className="text-[#4B5565] mt-0.5">{n.message}</div>
                            <div className="text-[10px] font-mono text-[#7C8798] mt-1">
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

        {/* Kinetic Continuous Live Stream Ribbon (real live WebSocket prices only) */}
        {ribbonItems.length >= 4 && (
          <div className="border-b border-[#E6E8EE] bg-white/70 backdrop-blur-md overflow-hidden">
            <div className="sig-marquee-track py-1.5">
              {[...ribbonItems, ...ribbonItems].map((item, idx) => {
                const pos = (item.change24hPct ?? 0) >= 0;
                return (
                  <button
                    key={`${item.canonicalId}-${idx}`}
                    type="button"
                    onClick={() => selectMarket(item.exchange, item.marketType, item.displaySymbol, true)}
                    className="inline-flex items-center gap-2 px-4 border-r border-[#ECEFF4] hover:bg-[#F2F4F7] transition-colors font-mono text-[11px] tabular-nums whitespace-nowrap"
                  >
                    <span className="font-bold text-[#0A0D14]">{item.displaySymbol.split('/')[0]}</span>
                    <span className="text-[#4B5565]">${formatPrice(item.lastPrice, preferences.decimalPrecision)}</span>
                    {typeof item.change24hPct === 'number' && (
                      <span className={`font-semibold ${pos ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
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
