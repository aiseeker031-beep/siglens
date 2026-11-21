import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { computeSignalSetup } from '../analytics/signalSetup';
import { StructuredSignalCard } from '../components/ui/StructuredSignalCard';
import { SkeletonBlock } from '../components/ui/SignalMeter';
import { api } from '../services/api';
import { EXCHANGE_LABELS, QUICK_TIMEFRAMES } from '../shared/constants';
import { formatTimestamp } from '../shared/format';
import type { ExchangeId, MarketType, ScreenerRow, SignalEventRecord, Timeframe } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

type FeedTab = 'realtime' | 'events';
type DirectionFilter = 'ALL' | 'BUY' | 'SELL' | 'WAIT';

export const LiveSignalsView: React.FC = () => {
  const globalExchange = useAppStore((s) => s.exchange);
  const globalMarketType = useAppStore((s) => s.marketType);
  const globalTimeframe = useAppStore((s) => s.timeframe);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const timezone = useAppStore((s) => s.preferences.timezone);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const wsFreshness = useAppStore((s) => s.wsFreshness);

  const [tab, setTab] = useState<FeedTab>('realtime');
  const [exchange, setExchange] = useState<ExchangeId>(globalExchange);
  const [marketType, setMarketType] = useState<MarketType>(globalMarketType);
  const [timeframe, setTimeframe] = useState<Timeframe>(
    QUICK_TIMEFRAMES.includes(globalTimeframe) ? globalTimeframe : '15m',
  );

  const [liveRows, setLiveRows] = useState<ScreenerRow[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [events, setEvents] = useState<SignalEventRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [assetFilter, setAssetFilter] = useState('');
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('ALL');
  const [minAgreement, setMinAgreement] = useState(0);

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const [scanRes, feedRes] = await Promise.all([
        api.getScreener(exchange, marketType, timeframe, forceRefresh),
        api.getSignalFeed(120),
      ]);
      setLiveRows(scanRes.rows);
      setScannedAt(scanRes.scannedAt);
      setEvents(feedRes.events);
    } catch {
      // retain existing snapshot if network temporarily blips
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExchange(globalExchange);
    setMarketType(globalMarketType);
  }, [globalExchange, globalMarketType]);

  useEffect(() => {
    loadData(false);
    const t = window.setInterval(() => loadData(false), 30_000);
    return () => window.clearInterval(t);
  }, [exchange, marketType, timeframe]);

  // Build real-time per-pair structured signals enriched with live WebSocket prices
  const filteredRealtime = useMemo(() => {
    return liveRows
      .map((row) => {
        const live = liveTickers[row.canonicalId];
        const livePrice = live?.lastPrice ?? row.price;
        const setup =
          row.signalSetup ??
          computeSignalSetup({
            displaySymbol: row.displaySymbol,
            classification: row.classification,
            closePrice: livePrice,
            atr14: row.atrPct !== null ? (livePrice * row.atrPct) / 100 : null,
            ema20: null,
            vwap: null,
          });
        return { row, livePrice, setup };
      })
      .filter(({ row, setup }) => {
        if (
          assetFilter &&
          !row.displaySymbol.includes(assetFilter.toUpperCase()) &&
          !setup.symbol.includes(assetFilter.toUpperCase())
        ) {
          return false;
        }
        if (dirFilter === 'BUY' && setup.direction !== 'BUY') return false;
        if (dirFilter === 'SELL' && setup.direction !== 'SELL') return false;
        if (dirFilter === 'WAIT' && setup.direction !== 'WAIT') return false;
        if (row.agreementPct < minAgreement) return false;
        return true;
      })
      .sort((a, b) => Math.abs(b.row.directionalScore) - Math.abs(a.row.directionalScore));
  }, [assetFilter, dirFilter, liveRows, liveTickers, minAgreement]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const dir =
        ev.signalSetup?.direction ??
        (ev.classification.includes('BULLISH')
          ? 'BUY'
          : ev.classification.includes('BEARISH')
            ? 'SELL'
            : 'WAIT');
      if (assetFilter && !ev.displaySymbol.includes(assetFilter.toUpperCase())) return false;
      if (dirFilter !== 'ALL' && dir !== dirFilter) return false;
      if (ev.agreementPct < minAgreement) return false;
      return true;
    });
  }, [assetFilter, dirFilter, events, minAgreement]);

  const buyCount = useMemo(
    () => liveRows.filter((r) => (r.signalSetup?.direction ?? (r.classification.includes('BULLISH') ? 'BUY' : 'WAIT')) === 'BUY').length,
    [liveRows],
  );
  const sellCount = useMemo(
    () => liveRows.filter((r) => (r.signalSetup?.direction ?? (r.classification.includes('BEARISH') ? 'SELL' : 'WAIT')) === 'SELL').length,
    [liveRows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-[#64748B]">
            Real-time structured trade setups per pair — Symbol, Direction (BUY/SELL), Entry (NOW / Zone), Stop Loss (SL), and Take Profit (TP1, TP2, TP3) derived deterministically from live ATR(14) &amp; structural S/R zones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-[11px] text-[#64748B]">
            Stream: <strong className="text-[#047857]">{wsFreshness}</strong>
            {scannedAt ? ` · ${formatTimestamp(scannedAt, timezone, false)}` : ''}
          </span>
          <button
            type="button"
            onClick={() => loadData(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl sig-btn-primary font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Signals
          </button>
        </div>
      </div>

      {/* Mode Switch + Summary Counts */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6E8EE] pb-2.5 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('realtime')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'realtime'
                ? 'sig-btn-primary'
                : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Live Pair Signals ({liveRows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('events')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              tab === 'events'
                ? 'sig-btn-primary'
                : 'text-[#64748B] hover:bg-[#EAF0EC]'
            }`}
          >
            Confirmed Signal History ({events.length})
          </button>
        </div>

        <div className="flex items-center gap-4 font-mono text-xs tabular-nums sig-glass-subtle px-3.5 py-1.5 rounded-full">
          <span className="text-[#047857] font-semibold">BUY: {buyCount}</span>
          <span className="text-[#BE123C] font-semibold">SELL: {sellCount}</span>
          <span className="text-[#64748B]">
            WAIT: {Math.max(0, liveRows.length - buyCount - sellCount)}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="sig-glass rounded-2xl p-3 flex flex-wrap items-center gap-2.5 text-xs">
        <input
          type="text"
          value={assetFilter}
          onChange={(e) => setAssetFilter(e.target.value)}
          placeholder="Symbol e.g. BTCUSDT"
          aria-label="Filter signals by symbol"
          className="w-40 px-3 py-1.5 rounded-xl sig-glass-subtle font-mono text-[#0A0D14] placeholder-[#64748B]"
        />

        {tab === 'realtime' && (
          <>
            <select
              aria-label="Signals exchange"
              value={exchange}
              onChange={(e) => {
                const ex = e.target.value as ExchangeId;
                setExchange(ex);
                if (ex === 'stocks') setMarketType('equity');
                else if (ex === 'cfds') setMarketType('cfd');
                else if (ex !== 'bybit' || marketType === 'equity' || marketType === 'cfd') setMarketType('spot');
              }}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14]"
            >
              <option value="binance" className="bg-white">Binance</option>
              <option value="bybit" className="bg-white">Bybit</option>
              <option value="kraken" className="bg-white">Kraken</option>
              <option value="coinbase" className="bg-white">Coinbase</option>
              <option value="stocks" className="bg-white">US Stocks</option>
              <option value="cfds" className="bg-white">Global CFDs</option>
            </select>

            <select
              aria-label="Signals market type"
              value={marketType}
              onChange={(e) => setMarketType(e.target.value as MarketType)}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14]"
            >
              {exchange === 'stocks' ? (
                <option value="equity" className="bg-white">Equity</option>
              ) : exchange === 'cfds' ? (
                <option value="cfd" className="bg-white">CFD</option>
              ) : (
                <>
                  <option value="spot" className="bg-white">Spot</option>
                  {exchange === 'bybit' && <option value="perpetual" className="bg-white">Perpetual</option>}
                </>
              )}
            </select>

            <select
              aria-label="Signals timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="px-3 py-1.5 rounded-xl sig-glass-subtle font-mono text-[#0A0D14]"
            >
              {QUICK_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf} className="bg-white">
                  {tf}
                </option>
              ))}
            </select>
          </>
        )}

        <select
          aria-label="Filter by direction"
          value={dirFilter}
          onChange={(e) => setDirFilter(e.target.value as DirectionFilter)}
          className="px-3 py-1.5 rounded-xl sig-glass-subtle text-[#0A0D14]"
        >
          <option value="ALL" className="bg-white">All Directions</option>
          <option value="BUY" className="bg-white">BUY (Long) Only</option>
          <option value="SELL" className="bg-white">SELL (Short) Only</option>
          <option value="WAIT" className="bg-white">Neutral / Wait</option>
        </select>

        <label className="inline-flex items-center gap-2 text-[#64748B]">
          Min Agreement: {minAgreement}%
          <input
            type="range"
            min={0}
            max={90}
            step={10}
            value={minAgreement}
            onChange={(e) => setMinAgreement(Number(e.target.value))}
            className="accent-[#059669]"
          />
        </label>

        <span className="ml-auto font-mono text-[#64748B]">
          {tab === 'realtime' ? `${filteredRealtime.length} pairs` : `${filteredEvents.length} events`}
        </span>
      </div>

      {/* Main Content */}
      {loading && liveRows.length === 0 && events.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <SkeletonBlock key={idx} className="h-64" />
          ))}
        </div>
      ) : tab === 'realtime' ? (
        filteredRealtime.length === 0 ? (
          <div className="sig-glass rounded-2xl p-8 text-center text-xs text-[#64748B]">
            No live pair signals match the selected filters. Adjust direction or agreement filters above.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredRealtime.map(({ row, livePrice, setup }) => (
              <StructuredSignalCard
                key={row.canonicalId}
                setup={setup}
                timeframe={row.timeframe}
                exchangeLabel={EXCHANGE_LABELS[row.exchange]}
                marketType={row.marketType}
                livePrice={livePrice}
                score={row.directionalScore}
                agreementPct={row.agreementPct}
                statusTag="LIVE"
                onOpenPair={() => selectMarket(row.exchange, row.marketType, row.displaySymbol, true)}
              />
            ))}
          </div>
        )
      ) : filteredEvents.length === 0 ? (
        <div className="sig-glass rounded-2xl p-8 text-center text-xs text-[#64748B]">
          No confirmed signal history events match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredEvents.map((ev) => {
            const setup =
              ev.signalSetup ??
              computeSignalSetup({
                displaySymbol: ev.displaySymbol,
                classification: ev.classification,
                closePrice: null,
                atr14: null,
                ema20: null,
                vwap: null,
              });
            return (
              <StructuredSignalCard
                key={ev.id}
                setup={setup}
                timeframe={ev.timeframe}
                exchangeLabel={EXCHANGE_LABELS[ev.exchange]}
                marketType={ev.marketType}
                score={ev.directionalScore}
                agreementPct={ev.agreementPct}
                statusTag={ev.eventType.replace(/_/g, ' ')}
                timestampLabel={formatTimestamp(ev.candleTimestamp, timezone, false)}
                onOpenPair={() => selectMarket(ev.exchange, ev.marketType, ev.displaySymbol, true)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
