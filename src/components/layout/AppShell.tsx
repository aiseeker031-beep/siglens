import React, { useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Box,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Filter,
  GitCompare,
  Grid2x2,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  Radio,
  Search,
  Settings,
  Sparkles,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  EXCHANGE_LABELS,
  EXCHANGE_MARKET_TYPES,
  EXCHANGE_TIMEFRAMES,
  QUICK_TIMEFRAMES,
} from '../../shared/constants';
import { formatTimestamp } from '../../shared/format';
import type { ExchangeId, MarketType, NavSection } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'markets', label: 'Markets', icon: BarChart3 },
  { id: 'explorer', label: 'Asset Explorer', icon: Compass },
  { id: 'signals', label: 'Live Signals', icon: Radio },
  { id: 'screener', label: 'Advanced Screener', icon: Filter },
  { id: 'studio3d', label: '3D Chart Studio', icon: Box },
  { id: 'heatmaps', label: 'Market Heatmaps', icon: Grid2x2 },
  { id: 'derivatives', label: 'Derivatives', icon: TrendingUp },
  { id: 'defi', label: 'DeFi Intelligence', icon: Layers },
  { id: 'compare', label: 'Compare Assets', icon: GitCompare },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'ai', label: 'AI Research', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const preferences = useAppStore((s) => s.preferences);
  const wsFreshness = useAppStore((s) => s.wsFreshness);
  const notifications = useAppStore((s) => s.notifications);
  const clearNotifications = useAppStore((s) => s.clearNotifications);
  const setExchange = useAppStore((s) => s.setExchange);
  const setMarketType = useAppStore((s) => s.setMarketType);
  const setTimeframe = useAppStore((s) => s.setTimeframe);
  const setCommandSearchOpen = useAppStore((s) => s.setCommandSearchOpen);
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [notifOpen, setNotifOpen] = useState(false);

  const collapsed = preferences.sidebarCollapsed;
  const supportedTimeframes = EXCHANGE_TIMEFRAMES[exchange];
  const supportedMarketTypes = EXCHANGE_MARKET_TYPES[exchange];

  const isDark =
    preferences.theme === 'dark' ||
    (preferences.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const freshnessColor =
    wsFreshness === 'LIVE'
      ? 'text-[#16A378] dark:text-[#35C89A]'
      : wsFreshness === 'DELAYED' || wsFreshness === 'RECONNECTING'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-[#DC4C54] dark:text-[#F16B72]';

  const SidebarNavList = ({ onSelect }: { onSelect?: () => void }) => (
    <nav aria-label="Primary Workspace Navigation" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
      {NAV_ITEMS.map((item) => {
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
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-[#17212B] text-[#FFFFFF] dark:bg-[#1B232D] dark:text-[#B6F36A]'
                : 'text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#151B23] hover:text-[#17212B] dark:hover:text-[#F4F7FA]'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-[#F7F9FB] dark:bg-[#0B0F14] text-[#17212B] dark:text-[#F4F7FA]">
      {/* Desktop Collapsible Left Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#10151C] sticky top-0 h-screen transition-[width] duration-200 ${
          collapsed ? 'w-[68px]' : 'w-[236px]'
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-[#E6EBF0] dark:border-[#27313C]">
          <button
            type="button"
            onClick={() => setActiveSection('overview')}
            className="flex items-center gap-2.5 min-w-0 text-left"
          >
            <span className="w-7 h-7 rounded-lg bg-[#17212B] dark:bg-[#B6F36A] text-[#FFFFFF] dark:text-[#0B0F14] flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4" />
            </span>
            {!collapsed && (
              <span className="font-bold tracking-tight text-[15px] text-[#17212B] dark:text-[#F4F7FA] whitespace-nowrap">
                CRYPTOLENS
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => updatePreferences({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1 rounded-md text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <SidebarNavList />

        {!collapsed && (
          <div className="px-4 py-3 border-t border-[#E6EBF0] dark:border-[#27313C] text-[11px] text-[#677482] dark:text-[#8B97A5]">
            Analytics-Only Terminal · Zero Execution
          </div>
        )}
      </aside>

      {/* Mobile Drawer Navigation */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex bg-black/60"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="w-[260px] max-w-[82vw] h-full bg-[#FFFFFF] dark:bg-[#10151C] border-r border-[#E6EBF0] dark:border-[#27313C] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-14 flex items-center justify-between px-4 border-b border-[#E6EBF0] dark:border-[#27313C]">
              <span className="font-bold tracking-tight text-[15px]">CRYPTOLENS</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 rounded-md text-[#677482] dark:text-[#8B97A5]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <SidebarNavList onSelect={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Utility & Context Header */}
        <header className="sticky top-0 z-30 h-14 border-b border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF]/95 dark:bg-[#10151C]/95 px-3 sm:px-5 flex items-center justify-between gap-3">
          {/* Left: Mobile drawer + Global Pair Search */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
            >
              <Menu className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setCommandSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#151B23] text-xs text-[#677482] dark:text-[#8B97A5] hover:border-[#94A3B8] dark:hover:border-[#3E4C5E] transition-colors min-w-[140px] sm:min-w-[220px]"
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate font-mono text-[#17212B] dark:text-[#F4F7FA]">
                {symbol}
              </span>
              <span className="hidden sm:inline ml-auto font-mono text-[10px] text-[#677482] dark:text-[#8B97A5]">
                Ctrl K
              </span>
            </button>

            {/* Exchange & Market-Type Selectors */}
            <div className="hidden md:flex items-center gap-1.5">
              <select
                aria-label="Select exchange"
                value={exchange}
                onChange={(e) => setExchange(e.target.value as ExchangeId)}
                className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#151B23] text-xs font-medium text-[#17212B] dark:text-[#F4F7FA]"
              >
                {(['binance', 'bybit', 'kraken', 'coinbase'] as ExchangeId[]).map((ex) => (
                  <option key={ex} value={ex}>
                    {EXCHANGE_LABELS[ex]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Select market type"
                value={marketType}
                onChange={(e) => setMarketType(e.target.value as MarketType)}
                className="px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#151B23] text-xs font-medium text-[#17212B] dark:text-[#F4F7FA]"
              >
                <option value="spot">Spot</option>
                <option value="perpetual" disabled={!supportedMarketTypes.includes('perpetual') && exchange !== 'bybit'}>
                  Perpetual {exchange !== 'bybit' ? '(Bybit)' : ''}
                </option>
              </select>
            </div>
          </div>

          {/* Center: Quick Timeframes (Desktop) */}
          <div className="hidden xl:flex items-center gap-1 p-1 rounded-lg bg-[#F1F5F9] dark:bg-[#151B23] border border-[#E6EBF0] dark:border-[#27313C]">
            {QUICK_TIMEFRAMES.map((tf) => {
              const supported = supportedTimeframes.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  disabled={!supported}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors whitespace-nowrap ${
                    timeframe === tf
                      ? 'bg-[#FFFFFF] dark:bg-[#1B232D] text-[#17212B] dark:text-[#B6F36A] font-semibold'
                      : 'text-[#677482] dark:text-[#8B97A5] hover:text-[#17212B] dark:hover:text-[#F4F7FA]'
                  } disabled:opacity-35`}
                >
                  {tf}
                </button>
              );
            })}
          </div>

          {/* Right: Data Status, Timezone, Theme, Notifications, Settings */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span
              data-testid="global-freshness"
              className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2 py-1 whitespace-nowrap ${freshnessColor}`}
              title="Real-time WebSocket market feed status"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsFreshness === 'LIVE'
                    ? 'bg-[#35C89A]'
                    : wsFreshness === 'RECONNECTING' || wsFreshness === 'DELAYED'
                      ? 'bg-amber-400'
                      : 'bg-[#F16B72]'
                }`}
              />
              {wsFreshness}
            </span>

            <button
              type="button"
              onClick={() =>
                updatePreferences({
                  timezone: preferences.timezone === 'UTC' ? 'local' : 'UTC',
                })
              }
              title="Toggle UTC / Local timezone"
              aria-label="Toggle timezone"
              className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-mono text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D] whitespace-nowrap"
            >
              <Clock className="w-3.5 h-3.5" />
              {preferences.timezone === 'UTC' ? 'UTC' : 'Local'}
            </button>

            <button
              type="button"
              onClick={() => updatePreferences({ theme: isDark ? 'light' : 'dark' })}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-lg text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Alert notifications"
                className="relative p-2 rounded-lg text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#B6F36A]" />
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#E6EBF0] dark:border-[#27313C]">
                    <span className="text-xs font-semibold">Alert Notifications</span>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={clearNotifications}
                        className="text-[11px] text-[#677482] dark:text-[#8B97A5] hover:text-[#17212B] dark:hover:text-[#F4F7FA]"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-[#677482] dark:text-[#8B97A5]">
                        No triggered alert events yet. Configure rules in Alerts.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="px-3.5 py-2.5 text-xs">
                          <div className="font-mono font-semibold text-[#17212B] dark:text-[#F4F7FA]">
                            {n.displaySymbol} · {n.timeframe}
                          </div>
                          <div className="text-[#677482] dark:text-[#8B97A5] mt-0.5">{n.message}</div>
                          <div className="text-[10px] font-mono text-[#677482] dark:text-[#8B97A5] mt-1">
                            {formatTimestamp(n.triggeredAt, preferences.timezone)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveSection('settings')}
              aria-label="Open Settings"
              className="p-2 rounded-lg text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Scrollable Workspace */}
        <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-5 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};
