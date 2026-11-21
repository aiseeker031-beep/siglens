import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { AlertEventRecord, Candle, Timeframe } from '../shared/types';

/**
 * Connects to the backend /ws WebSocket aggregator on port 3000 with exponential reconnect,
 * dynamic pair/timeframe subscriptions, stale detection, and live alert dispatch.
 */
export function useMarketStream(): void {
  const exchange = useAppStore((s) => s.exchange);
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const applyLiveTickerBatch = useAppStore((s) => s.applyLiveTickerBatch);
  const applyLiveCandle = useAppStore((s) => s.applyLiveCandle);
  const setWsFreshness = useAppStore((s) => s.setWsFreshness);
  const pushNotification = useAppStore((s) => s.pushNotification);

  const wsRef = useRef<WebSocket | null>(null);
  const subRef = useRef({ exchange, symbol, timeframe });
  subRef.current = { exchange, symbol, timeframe };

  useEffect(() => {
    let closedByCleanup = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    const tickerBuffer = new Map<
      string,
      {
        canonicalId: string;
        lastPrice: number;
        change24hPct?: number;
        high24h?: number;
        low24h?: number;
        quoteVolume24h?: number;
        timestamp: number;
      }
    >();

    const flushTimer = window.setInterval(() => {
      if (tickerBuffer.size === 0) return;
      const batch = Array.from(tickerBuffer.values());
      tickerBuffer.clear();
      applyLiveTickerBatch(batch);
    }, 600);

    const connect = () => {
      if (closedByCleanup) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      setWsFreshness('RECONNECTING');

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsFreshness('LIVE', Date.now());
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            exchange: subRef.current.exchange,
            symbol: subRef.current.symbol,
            timeframe: subRef.current.timeframe,
          }),
        );
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
          if (msg.type === 'ticker:update' && typeof msg.canonicalId === 'string') {
            tickerBuffer.set(msg.canonicalId, {
              canonicalId: msg.canonicalId,
              lastPrice: Number(msg.lastPrice),
              change24hPct:
                typeof msg.change24hPct === 'number' ? msg.change24hPct : undefined,
              high24h: typeof msg.high24h === 'number' ? msg.high24h : undefined,
              low24h: typeof msg.low24h === 'number' ? msg.low24h : undefined,
              quoteVolume24h:
                typeof msg.quoteVolume24h === 'number' ? msg.quoteVolume24h : undefined,
              timestamp: Number(msg.timestamp) || Date.now(),
            });
          } else if (msg.type === 'kline:update' && msg.candle) {
            applyLiveCandle(
              String(msg.canonicalId),
              msg.timeframe as Timeframe,
              msg.candle as Candle,
            );
          } else if (msg.type === 'heartbeat') {
            setWsFreshness('LIVE', Date.now());
          } else if (msg.type === 'alert:triggered' && msg.event) {
            const ev = msg.event as AlertEventRecord;
            pushNotification(ev);
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification(`SIGLENS Alert · ${ev.displaySymbol}`, { body: ev.message });
            }
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (closedByCleanup) return;
        setWsFreshness('RECONNECTING');
        const delay = Math.min(20_000, 1200 * Math.pow(2, Math.min(attempt, 4)));
        attempt++;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        if (!closedByCleanup) setWsFreshness('DELAYED');
      };
    };

    connect();

    // Freshness monitor: marks DELAYED or STALE honestly if no updates arrive
    const staleTimer = window.setInterval(() => {
      const state = useAppStore.getState();
      if (!state.lastStreamTs) return;
      const age = Date.now() - state.lastStreamTs;
      if (age > 45_000 && state.wsFreshness !== 'STALE') {
        setWsFreshness('STALE');
      } else if (age > 20_000 && age <= 45_000 && state.wsFreshness === 'LIVE') {
        setWsFreshness('DELAYED');
      }
    }, 5_000);

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.clearInterval(flushTimer);
      window.clearInterval(staleTimer);
      wsRef.current?.close();
    };
  }, [applyLiveCandle, applyLiveTickerBatch, pushNotification, setWsFreshness]);

  // Update active kline subscription whenever pair or timeframe changes
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', exchange, symbol, timeframe }));
    }
  }, [exchange, symbol, timeframe]);
}
