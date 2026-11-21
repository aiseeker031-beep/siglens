import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid2x2,
  Home,
  Menu,
  Moon,
  Radio,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import sunsetBackdropUrl from '../../assets/images/sunset_valley_backdrop_1795240978899.jpg';
import { EXCHANGE_LABELS, EXCHANGE_MARKET_TYPES } from '../../shared/constants';
import { formatTimestamp } from '../../shared/format';
import type { ExchangeId, MarketType, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

const PRIMARY_NAV: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'markets', label: 'Markets', icon: BarChart3 },
  { id: 'signals', label: 'Signals', icon: Radio },
  { id: 'screener', label: 'Screener', icon: Filter },
  { id: 'heatmaps', label: 'Heatmaps', icon: Grid2x2 },
  { id: 'ai', label: 'AI Insights', icon: Sparkles },
];

/** Geometric emerald hexagonal aperture emblem for SIGLENS */
const SiglensMark: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="siglensHexGrad" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#34F5A8" />
        <stop offset="100%" stopColor="#0EB878" />
      </linearGradient>
    </defs>
    {/* Top-left wedge */}
    <path d="M18.6 4.2L7.2 10.8L18.6 17.4V4.2Z" fill="url(#siglensHexGrad)" />
    {/* Top-right wedge */}
    <path d="M21.4 4.2V17.4L32.8 10.8L21.4 4.2Z" fill="url(#siglensHexGrad)" opacity="0.92" />
    {/* Right wedge */}
    <path d="M34.2 13.2L22.8 19.8L34.2 26.4V13.2Z" fill="url(#siglensHexGrad)" opacity="0.84" />
    {/* Bottom-right wedge */}
    <path d="M21.4 22.6V35.8L32.8 29.2L21.4 22.6Z" fill="url(#siglensHexGrad)" />
    {/* Bottom-left wedge */}
    <path d="M18.6 35.8V22.6L7.2 29.2L18.6 35.8Z" fill="url(#siglensHexGrad)" opacity="0.9" />
    {/* Left wedge */}
    <path d="M5.8 26.4L17.2 19.8L5.8 13.2V26.4Z" fill="url(#siglensHexGrad)" opacity="0.82" />
  </svg>
);

function formatHeaderClock(date: Date, timezone: 'UTC' | 'local'): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timezone === 'UTC' ? { timeZone: 'UTC' } : {}),
    };
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('month')} ${get('day')}, ${get('year')} · ${get('hour')}:${get('minute')} ${timezone === 'UTC' ? 'UTC' : 'Local'}`;
  } catch {
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const preferences = useAppStore((s) => s.preferences);
  const wsFreshness = useAppStore((s) => s.wsFreshness);
  const notifications = useAppStore((s) => s.notifications);
  const clearNotifications = useAppStore((s) => s.clearNotifications);
  const setExchange = useAppStore((s) => s.setExchange);
  const setMarketType = useAppStore((s) => s.setMarketType);
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

  const isDark =
    preferences.theme === 'dark' ||
    (preferences.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const freshnessColor =
    wsFreshness === 'LIVE'
      ? 'text-[#12A875] dark:text-[#22E59B]'
      : wsFreshness === 'DELAYED' || wsFreshness === 'RECONNECTING'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-[#DC4C54] dark:text-[#FF747B]';

  const SidebarNavList = ({ onSelect }: { onSelect?: () => void }) => (
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
            title={collapsed ? item.label : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
              active
                ? 'sig-btn-primary font-semibold'
                : 'text-[#6A5749] dark:text-[#C5B1A0] hover:bg-[#EFE4D7]/75 dark:hover:bg-[#2A1B11]/70 hover:text-[#1D150F] dark:hover:text-[#FFF8F0]'
            }`}
          >
            <span className="relative shrink-0">
              <Icon className="w-[17px] h-[17px]" />
            </span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="relative min-h-screen flex text-[#1D150F] dark:text-[#FFF8F0]">
      {/* Fixed Full-Viewport Sunset Valley Landscape Backdrop */}
      <div className="fixed inset-0 -z-20 pointer-events-none overflow-hidden bg-[#FAF6F0] dark:bg-[#0B0705]">
        {isDark ? (
          <>
            <img
              src={sunsetBackdropUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover object-center opacity-85 scale-[1.01]"
            />
            {/* Measured atmospheric readability scrim */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse at 74% 10%, rgba(255, 140, 42, 0.14) 0%, rgba(12, 7, 4, 0.42) 48%, rgba(9, 6, 4, 0.82) 100%)',
              }}
            />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 80% 0%, rgba(255, 182, 108, 0.24) 0%, rgba(250, 246, 240, 0.96) 52%, #F4ECE2 100%)',
            }}
          />
        )}
      </div>

      {/* Desktop Left Navigation Rail */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-[#E4D6C7] dark:border-[#FFA95C]/14 bg-[#FFFBF6]/90 dark:bg-[#110A07]/88 backdrop-blur-xl sticky top-0 h-screen transition-[width] duration-200 z-20 ${
          collapsed ? 'w-[70px]' : 'w-[186px]'
        }`}
      >
        {/* Top Emblem + Collapse Toggle */}
        <div className="h-16 flex items-center justify-between px-4">
          <button
            type="button"
            onClick={() => setActiveSection('overview')}
            aria-label="SIGLENS Home"
            className="flex items-center justify-center"
          >
            <SiglensMark className="w-9 h-9 shrink-0 drop-shadow-[0_0_14px_rgba(34,229,155,0.4)]" />
          </button>
          <button
            type="button"
            onClick={() => updatePreferences({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-[#756253] dark:text-[#B9A392] hover:bg-[#EFE4D7] dark:hover:bg-[#2A1B11]/80 transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <SidebarNavList />

        {/* Bottom Pinned Settings */}
        <div className="p-2.5 border-t border-[#E4D6C7]/70 dark:border-[#FFA95C]/12 space-y-1.5">
          <button
            type="button"
            onClick={() => setActiveSection('settings')}
            aria-current={activeSection === 'settings' ? 'page' : undefined}
            title={collapsed ? 'Settings' : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all whitespace-nowrap ${
              activeSection === 'settings'
                ? 'sig-btn-primary font-semibold'
                : 'text-[#6A5749] dark:text-[#C5B1A0] hover:bg-[#EFE4D7]/75 dark:hover:bg-[#2A1B11]/70 hover:text-[#1D150F] dark:hover:text-[#FFF8F0]'
            }`}
          >
            <Settings className="w-[17px] h-[17px] shrink-0" />
            {!collapsed && <span>Settings</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex bg-black/65 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="w-[248px] max-w-[82vw] h-full bg-[#FFFBF6] dark:bg-[#130C08]/95 border-r border-[#E4D6C7] dark:border-[#FFA95C]/18 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-16 flex items-center justify-between px-4 border-b border-[#E4D6C7] dark:border-[#FFA95C]/14">
              <div className="flex items-center gap-2.5">
                <SiglensMark className="w-7 h-7" />
                <span className="font-extrabold tracking-[0.06em] text-[15px]">SIGLENS</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-lg text-[#756253] dark:text-[#B9A392]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <SidebarNavList onSelect={() => setMobileNavOpen(false)} />
            <div className="p-2.5 border-t border-[#E4D6C7] dark:border-[#FFA95C]/14">
              <button
                type="button"
                onClick={() => {
                  setActiveSection('settings');
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium ${
                  activeSection === 'settings'
                    ? 'sig-btn-primary'
                    : 'text-[#6A5749] dark:text-[#C5B1A0]'
                }`}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Atmospheric Header matching Sunset Valley Layout */}
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 flex items-center justify-between gap-4 bg-[#FAF6F0]/80 dark:bg-[#100A06]/55 backdrop-blur-xl border-b border-[#E4D6C7]/70 dark:border-[#FFA95C]/12">
          {/* Left Zone: Mobile Menu + SIGLENS Wordmark & Tagline */}
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-xl text-[#756253] dark:text-[#D9C6B6] hover:bg-[#EFE4D7] dark:hover:bg-[#2A1B11]/70"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('overview')}
              className="flex items-center gap-3 text-left whitespace-nowrap shrink-0"
            >
              <span className="text-lg sm:text-xl font-extrabold tracking-[0.05em] text-[#1D150F] dark:text-[#FFF8F0]">
                SIGLENS
              </span>
              <span
                aria-hidden="true"
                className="hidden xl:inline-block h-4 w-px bg-[#D6C3AE] dark:bg-[#FFA95C]/25"
              />
              <span className="hidden xl:inline text-[13px] font-medium text-[#756253] dark:text-[#D5C2B2]">
                See Beyond the Market
              </span>
            </button>
          </div>

          {/* Center Zone: Rounded Pill Global Pair Search */}
          <div className="flex-1 max-w-md flex justify-center">
            <button
              type="button"
              onClick={() => setCommandSearchOpen(true)}
              aria-label="Search pairs"
              className="w-full max-w-[340px] flex items-center gap-2.5 px-4 py-2 rounded-full border border-[#DFCBB6] dark:border-[#FFA95C]/24 bg-[#FFFFFF]/80 dark:bg-[#24160D]/70 backdrop-blur-md text-xs text-[#756253] dark:text-[#C5B1A0] hover:border-[#EA731E]/60 transition-colors shadow-[inset_0_1px_0_rgba(255,212,162,0.08)]"
            >
              <Search className="w-3.5 h-3.5 shrink-0 opacity-80" />
              <span className="truncate">Search pairs...</span>
              <span className="hidden sm:inline ml-auto font-mono text-[10px] opacity-65">
                Ctrl K
              </span>
            </button>
          </div>

          {/* Right Zone: Live Market Status + Clock + Exchange Selector + Theme */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span
              data-testid="global-freshness"
              className={`hidden md:inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${freshnessColor}`}
              title="Real-time WebSocket market feed status"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  wsFreshness === 'LIVE'
                    ? 'bg-[#22E59B] shadow-[0_0_8px_#22E59B]'
                    : wsFreshness === 'RECONNECTING' || wsFreshness === 'DELAYED'
                      ? 'bg-amber-400'
                      : 'bg-[#FF747B]'
                }`}
              />
              {wsFreshness === 'LIVE' ? 'Live Market' : wsFreshness}
            </span>

            <span
              aria-hidden="true"
              className="hidden lg:inline-block h-4 w-px bg-[#D6C3AE] dark:bg-[#FFA95C]/20"
            />

            <button
              type="button"
              onClick={() =>
                updatePreferences({
                  timezone: preferences.timezone === 'UTC' ? 'local' : 'UTC',
                })
              }
              title="Toggle UTC / Local clock"
              aria-label="Toggle timezone"
              className="hidden lg:inline-flex items-center text-xs font-mono text-[#6A5749] dark:text-[#DECBB9] hover:text-[#1D150F] dark:hover:text-[#FFF8F0] whitespace-nowrap"
            >
              {formatHeaderClock(now, preferences.timezone)}
            </button>

            {/* Compact Exchange Selector */}
            <div className="hidden sm:flex items-center gap-1.5">
              <select
                aria-label="Select exchange"
                value={exchange}
                onChange={(e) => setExchange(e.target.value as ExchangeId)}
                className="px-2.5 py-1.5 rounded-full border border-[#DFCBB6] dark:border-[#FFA95C]/22 bg-[#FFFFFF]/80 dark:bg-[#23150C]/75 text-[11px] font-medium text-[#1D150F] dark:text-[#FFF8F0]"
              >
                {(['binance', 'bybit', 'kraken', 'coinbase'] as ExchangeId[]).map((ex) => (
                  <option key={ex} value={ex} className="bg-[#FFFBF6] dark:bg-[#19100A]">
                    {EXCHANGE_LABELS[ex]}
                  </option>
                ))}
              </select>

              {exchange === 'bybit' && (
                <select
                  aria-label="Select market type"
                  value={marketType}
                  onChange={(e) => setMarketType(e.target.value as MarketType)}
                  className="px-2.5 py-1.5 rounded-full border border-[#DFCBB6] dark:border-[#FFA95C]/22 bg-[#FFFFFF]/80 dark:bg-[#23150C]/75 text-[11px] font-medium text-[#1D150F] dark:text-[#FFF8F0]"
                >
                  <option value="spot" className="bg-[#FFFBF6] dark:bg-[#19100A]">
                    Spot
                  </option>
                  <option
                    value="perpetual"
                    disabled={!supportedMarketTypes.includes('perpetual')}
                    className="bg-[#FFFBF6] dark:bg-[#19100A]"
                  >
                    Perp
                  </option>
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={() => updatePreferences({ theme: isDark ? 'light' : 'dark' })}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-full border border-[#DFCBB6]/70 dark:border-[#FFA95C]/18 bg-[#FFFFFF]/70 dark:bg-[#23150C]/70 text-[#756253] dark:text-[#D5C2B2] hover:text-[#1D150F] dark:hover:text-[#FFF8F0] transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Alert notifications"
                className="relative p-2 rounded-full border border-[#DFCBB6]/70 dark:border-[#FFA95C]/18 bg-[#FFFFFF]/70 dark:bg-[#23150C]/70 text-[#756253] dark:text-[#D5C2B2] hover:text-[#1D150F] dark:hover:text-[#FFF8F0] transition-colors"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#FF8A1F]" />
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl sig-glass shadow-2xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8DDD1] dark:border-[#FFA95C]/14">
                    <span className="text-xs font-semibold">Alert Notifications</span>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={clearNotifications}
                        className="text-[11px] text-[#756253] dark:text-[#B9A392] hover:text-[#1D150F] dark:hover:text-[#FFF8F0]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#E8DDD1]/70 dark:divide-[#FFA95C]/12">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-[#756253] dark:text-[#B9A392]">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="px-4 py-3 text-xs">
                          <div className="font-mono font-semibold text-[#1D150F] dark:text-[#FFF8F0]">
                            {n.displaySymbol} · {n.timeframe}
                          </div>
                          <div className="text-[#756253] dark:text-[#B9A392] mt-0.5">{n.message}</div>
                          <div className="text-[10px] font-mono text-[#756253] dark:text-[#B9A392] mt-1">
                            {formatTimestamp(n.triggeredAt, preferences.timezone)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Scrollable Workspace */}
        <main className="flex-1 w-full max-w-[1520px] mx-auto px-4 sm:px-6 py-5 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};
