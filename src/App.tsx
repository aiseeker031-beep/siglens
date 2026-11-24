import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AppShell } from './components/layout/AppShell';
import { CommandSearchModal } from './components/layout/CommandSearchModal';
import { KINETIC_EASE } from './components/ui/Kinetic';
import { SkeletonBlock } from './components/ui/SignalMeter';
import { useMarketStream } from './hooks/useMarketStream';
import { useAppStore } from './store/useAppStore';

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

const AuthenticatedWorkspace: React.FC<{ onNavigateLanding: () => void }> = ({
  onNavigateLanding,
}) => {
  const activeSection = useAppStore((s) => s.activeSection);
  const hydrateFromServer = useAppStore((s) => s.hydrateFromServer);
  const setCommandSearchOpen = useAppStore((s) => s.setCommandSearchOpen);

  useMarketStream();

  useEffect(() => {
    hydrateFromServer();
  }, [hydrateFromServer]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const cur = useAppStore.getState().commandSearchOpen;
        setCommandSearchOpen(!cur);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandSearchOpen]);

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
    <AppShell onNavigateLanding={onNavigateLanding}>
      <ViewErrorBoundary resetKey={activeSection}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: KINETIC_EASE }}
          >
            <Suspense fallback={<ViewSuspenseFallback />}>{renderSection()}</Suspense>
          </motion.div>
        </AnimatePresence>
      </ViewErrorBoundary>
      <CommandSearchModal />
    </AppShell>
  );
};

export function App() {
  const auth = useAppStore((s) => s.auth);
  const fetchAuthState = useAppStore((s) => s.fetchAuthState);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAuthState().finally(() => {
      if (active) setAuthChecked(true);
    });
    return () => {
      active = false;
    };
  }, [fetchAuthState]);

  // Enforce strict Google login gate client-side as well as server-side
  useEffect(() => {
    if (authChecked && !auth?.user && typeof window !== 'undefined') {
      window.location.replace('/?auth_required=1');
    }
  }, [authChecked, auth]);

  const navigateToLanding = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#080A0B] text-[#F4F6F3] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-10 h-10 rounded-xl bg-[#C6FF3D] flex items-center justify-center animate-pulse">
            <svg viewBox="0 0 32 32" className="w-6 h-6" aria-hidden="true">
              <circle cx="15" cy="15" r="7" fill="none" stroke="#080A0B" strokeWidth="2.4" />
              <path d="M20.5 20.5 26 26" stroke="#080A0B" strokeWidth="2.6" strokeLinecap="round" />
              <path
                d="M11 17l3-3 2 2 3-4"
                fill="none"
                stroke="#080A0B"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="text-sm font-semibold tracking-tight">Verifying Google Session…</div>
          <div className="text-xs text-[#929A95] font-mono">SigLens Terminal Access Gate</div>
        </div>
      </div>
    );
  }

  if (!auth?.user) {
    return (
      <div className="min-h-screen bg-[#080A0B] text-[#F4F6F3] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl border border-[#252B27] bg-[#111513] p-8 text-center space-y-5 shadow-2xl">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#C6FF3D]">
            <svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden="true">
              <circle cx="15" cy="15" r="7" fill="none" stroke="#080A0B" strokeWidth="2.4" />
              <path d="M20.5 20.5 26 26" stroke="#080A0B" strokeWidth="2.6" strokeLinecap="round" />
              <path
                d="M11 17l3-3 2 2 3-4"
                fill="none"
                stroke="#080A0B"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight">Sign in to SigLens</h1>
            <p className="text-xs text-[#929A95] leading-relaxed">
              Access to the live SigLens terminal, multi-exchange markets, quant signals, and demo trading requires a verified Google account.
            </p>
          </div>
          <a
            href="/api/auth/google"
            className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-full bg-[#C6FF3D] hover:brightness-105 text-[#080A0B] font-semibold text-sm transition-all"
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
                <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z" />
                <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z" />
                <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
              </svg>
            </span>
            <span>Continue with Google</span>
          </a>
          <div>
            <a href="/" className="text-xs text-[#929A95] hover:text-[#C6FF3D] transition-colors">
              ← Return to SigLens Landing Page
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <AuthenticatedWorkspace onNavigateLanding={navigateToLanding} />
    </MotionConfig>
  );
}

export default App;
