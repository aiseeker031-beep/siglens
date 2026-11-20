import React, { useEffect, useState } from 'react';
import { Layers, RefreshCw } from 'lucide-react';
import { Chart3DStudio } from '../components/charts/Chart3DStudio';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api, type AssetSignalBundle } from '../services/api';
import { EXCHANGE_LABELS, QUICK_TIMEFRAMES } from '../shared/constants';
import { formatPrice, signalBgClass, signalLabel } from '../shared/format';
import type { OrderBookSnapshot } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

const STUDIO_QUICK_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'LINK/USDT', 'SUI/USDT'];

export const ChartStudioView: React.FC = () => {
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setTimeframe = useAppStore((s) => s.setTimeframe);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [bundle, setBundle] = useState<AssetSignalBundle | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sigRes, obRes] = await Promise.all([
        api.getAssetSignals(exchange, marketType, symbol, timeframe, 220),
        api.getOrderBook(exchange, marketType, symbol).catch(() => null),
      ]);
      setBundle(sigRes);
      setOrderBook(obRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load 3D market data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [exchange, marketType, symbol, timeframe]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#2563EB] dark:text-[#4EA1FF]" />
            3D Chart Studio
          </h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Interactive WebGL Three.js financial geometry rendered directly from live OHLCV candles, indicator series, and exchange order books.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-1">
            {STUDIO_QUICK_PAIRS.map((pair) => {
              const display =
                exchange === 'kraken' || exchange === 'coinbase'
                  ? pair.replace('/USDT', '/USD')
                  : pair;
              const active = symbol === display;
              return (
                <button
                  key={pair}
                  type="button"
                  onClick={() => selectMarket(exchange, marketType, display, false)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14]'
                      : 'text-[#677482] dark:text-[#8B97A5] hover:text-[#17212B] dark:hover:text-[#F4F7FA]'
                  }`}
                >
                  {display.split('/')[0]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-1">
            {QUICK_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 rounded text-[11px] font-mono ${
                  timeframe === tf
                    ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] font-semibold'
                    : 'text-[#677482] dark:text-[#8B97A5]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Live Context Strip */}
      {bundle && (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="font-bold text-sm">{symbol}</span>{' '}
              <span className="text-[#677482] dark:text-[#8B97A5]">
                {EXCHANGE_LABELS[exchange]} · {marketType} · {timeframe}
              </span>
            </div>
            <div className="font-mono font-semibold tabular-nums">
              Close: ${formatPrice(bundle.confirmed.metadata.candleClosePrice, precision)}
            </div>
            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${signalBgClass(bundle.confirmed.classification)}`}>
              {signalLabel(bundle.confirmed.classification)} ({bundle.confirmed.directionalScore > 0 ? '+' : ''}
              {bundle.confirmed.directionalScore.toFixed(1)})
            </span>
            <span className="text-[#677482] dark:text-[#8B97A5]">
              Regime: <strong className="text-[#17212B] dark:text-[#F4F7FA]">{bundle.confirmed.regime.combinedLabel}</strong>
            </span>
          </div>
          <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
            {orderBook
              ? `Order Book: ${orderBook.bids.length} bids / ${orderBook.asks.length} asks (spread ${orderBook.spreadPct?.toFixed(3) ?? '—'}%)`
              : 'Order book snapshot unavailable for current pair'}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[#F16B72]/40 bg-[#F16B72]/10 p-4 text-xs text-[#DC4C54] dark:text-[#F16B72]">
          {error}
        </div>
      )}

      {loading && !bundle ? (
        <SkeletonBlock className="h-[580px]" />
      ) : bundle ? (
        <Chart3DStudio
          candles={bundle.candles}
          series={bundle.series}
          supportResistance={bundle.supportResistance}
          orderBook={orderBook}
          symbol={symbol}
          timeframe={timeframe}
          height={580}
          onFallbackTo2D={() => setActiveSection('explorer')}
        />
      ) : null}

      {/* Analytical Mode Legend */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
        {[
          {
            title: 'A. 3D Candlesticks',
            desc: 'Extruded OHLC bodies and wicks with selectable Z-axis depth (Volume, ATR Volatility, or RSI Momentum) plus EMA & S/R planes.',
          },
          {
            title: 'B. Volume Landscape',
            desc: '3D terrain heightmap combining candle participation and close direction to highlight accumulation vs distribution clusters.',
          },
          {
            title: 'C. Observed Volatility Surface',
            desc: 'Empirical realized volatility and ATR% surface across rolling windows (strictly observed OHLCV data, not synthetic IV).',
          },
          {
            title: 'D. Live Market Depth',
            desc: 'Real-time cumulative bid/ask liquidity walls fetched directly from exchange order books around mid-price.',
          },
          {
            title: 'E. Indicator Landscape',
            desc: 'Multi-plane 3D ribbon comparing EMA alignment, RSI momentum energy, and Bollinger envelope expansion over time.',
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3"
          >
            <div className="font-semibold text-[#17212B] dark:text-[#F4F7FA]">{item.title}</div>
            <p className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-1 leading-relaxed">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
