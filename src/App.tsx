import React, { Suspense, lazy, useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { CommandSearchModal } from './components/layout/CommandSearchModal';
import { SkeletonBlock } from './components/ui/SignalMeter';
import { useMarketStream } from './hooks/useMarketStream';
import { useAppStore } from './store/useAppStore';

import { OverviewView } from './views/OverviewView';
import { MarketsView } from './views/MarketsView';
import { LiveSignalsView } from './views/LiveSignalsView';
import { ScreenerView } from './views/ScreenerView';
import { AIResearchView } from './views/AIResearchView';
import { SettingsView } from './views/SettingsView';

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
        <div className="rounded-xl border border-[#F16B72]/40 bg-[#F16B72]/10 p-6 text-xs space-y-2">
          <div className="font-bold text-sm text-[#DC4C54] dark:text-[#F16B72]">
            Workspace View Encountered an Error
          </div>
          <p className="text-[#756253] dark:text-[#C5B1A0]">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-3 py-1.5 rounded-lg bg-[#2563EB] dark:bg-[#4EA1FF] text-white dark:text-[#0B0F14] font-semibold"
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
      case 'ai':
        return <AIResearchView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <AppShell>
      <ViewErrorBoundary resetKey={activeSection}>
        <Suspense fallback={<ViewSuspenseFallback />}>{renderSection()}</Suspense>
      </ViewErrorBoundary>
      <CommandSearchModal />
    </AppShell>
  );
}

export default App;
