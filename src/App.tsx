import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AppShell } from './components/layout/AppShell';
import { CommandSearchModal } from './components/layout/CommandSearchModal';
import { KINETIC_EASE } from './components/ui/Kinetic';
import { SkeletonBlock } from './components/ui/SignalMeter';
import { useMarketStream } from './hooks/useMarketStream';
import type { ExchangeId, MarketType, NavSection } from './shared/types';
import { useAppStore } from './store/useAppStore';

import { LandingPage } from './views/LandingPage';

const OverviewView = lazy(() =>
  import('./views/OverviewView').then((m) => ({ default: m.OverviewView })),
);
const MarketsView = lazy(() =>
  import('./views/MarketsView').then((m) => ({ default: m.MarketsView })),
);
const LiveSignalsView = lazy(() =>
  import('./views/LiveSignalsView').then((m) => ({ default: m.LiveSignalsView })),
);
const ScreenerView = lazy(() =>
  import('./views/ScreenerView').then((m) => ({ default: m.ScreenerView })),
);
const ArbitrageView = lazy(() =>
  import('./views/ArbitrageView').then((m) => ({ default: m.ArbitrageView })),
);
const AIResearchView = lazy(() =>
  import('./views/AIResearchView').then((m) => ({ default: m.AIResearchView })),
);
const DemoTradeView = lazy(() =>
  import('./views/DemoTradeView').then((m) => ({ default: m.DemoTradeView })),
);
const SettingsView = lazy(() =>
  import('./views/SettingsView').then((m) => ({ default: m.SettingsView })),
);
const HeatmapsView = lazy(() =>
  import('./views/HeatmapsView').then((m) => ({ default: m.HeatmapsView })),
);

type RouteMode = 'landing' | 'app';

function readRouteModeFromLocation(): RouteMode {
  if (typeof window === 'undefined') return 'landing';
  return window.location.pathname.startsWith('/app') ? 'app' : 'landing';
}

function readAuthErrorFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('auth_error');
  if (!code) return null;
  if (code === 'google_not_configured') {
    return 'Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET) are not configured on the server yet. Click "Continue with Google" to view the 2-step cPanel setup guide.';
  }
  if (code === 'invalid_state') {
    return 'Google sign-in session expired or state mismatch. Please try signing in again.';
  }
  if (code === 'oauth_exchange_failed') {
    return 'Google sign-in token exchange failed. Verify your Authorized Redirect URI in Google Cloud Console.';
  }
  return `Google sign-in returned: ${code}`;
}

class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode; resetKey: string }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || 'Unexpected rendering error' };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-[#FECDD3] bg-[#FFF1F2] p-6 text-xs space-y-2">
          <div className="font-bold text-sm text-[#BE123C]">
            Workspace View Encountered an Error
          </div>
          <p className="text-[#525E70]">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-3.5 py-1.5 rounded-full sig-btn-primary font-semibold"
          >
            Retry View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ViewSuspenseFallback: React.FC = () => (
  <div className="space-y-4">
    <SkeletonBlock className="h-12" />
    <SkeletonBlock className="h-80" />
  </div>
);

export function App() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const hydrateFromServer = useAppStore((s) => s.hydrateFromServer);
  const setCommandSearchOpen = useAppStore((s) => s.setCommandSearchOpen);

  const [routeMode, setRouteMode] = useState<RouteMode>(() => readRouteModeFromLocation());
  const [authNotice, setAuthNotice] = useState<string | null>(() => readAuthErrorFromLocation());

  useMarketStream();

  useEffect(() => {
    hydrateFromServer();
  }, [hydrateFromServer]);

  useEffect(() => {
    const onPopState = () => {
      setRouteMode(readRouteModeFromLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (routeMode !== 'app') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const cur = useAppStore.getState().commandSearchOpen;
        setCommandSearchOpen(!cur);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [routeMode, setCommandSearchOpen]);

  const navigateToApp = useCallback(
    (section?: NavSection) => {
      if (section) {
        setActiveSection(section);
      }
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/app')) {
        window.history.pushState({}, '', '/app');
      }
      setRouteMode('app');
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    },
    [setActiveSection],
  );

  const navigateToLanding = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    setRouteMode('landing');
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const handleInspectFromLanding = useCallback(
    (exchange: ExchangeId, marketType: MarketType, symbol: string) => {
      selectMarket(exchange, marketType, symbol, true);
      navigateToApp('overview');
    },
    [selectMarket, navigateToApp],
  );

  const dismissAuthNotice = useCallback(() => {
    setAuthNotice(null);
    if (typeof window !== 'undefined' && window.location.search.includes('auth_error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return <OverviewView />;
      case 'markets':
        return <MarketsView />;
      case 'signals':
        return <LiveSignalsView />;
      case 'screener':
        return <ScreenerView />;
      case 'heatmaps':
        return <HeatmapsView />;
      case 'arbitrage':
        return <ArbitrageView />;
      case 'demo':
        return <DemoTradeView />;
      case 'ai':
        return <AIResearchView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      {routeMode === 'landing' ? (
        <LandingPage
          onLaunchApp={navigateToApp}
          onInspectAsset={handleInspectFromLanding}
          authNotice={authNotice}
          onDismissAuthNotice={dismissAuthNotice}
        />
      ) : (
        <AppShell onNavigateLanding={navigateToLanding}>
          <ViewErrorBoundary resetKey={activeSection}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: KINETIC_EASE }}
              >
                <Suspense fallback={<ViewSuspenseFallback />}>
                  {renderSection()}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </ViewErrorBoundary>
          <CommandSearchModal />
        </AppShell>
      )}
    </MotionConfig>
  );
}

export default App;
