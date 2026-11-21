import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { CORE_UNIVERSE_BASES } from '../shared/constants';
import type { Candle, ExchangeId, Timeframe } from '../shared/types';
import { updateWsProviderHealth } from './providers';

interface ClientSub {
  ws: WebSocket;
  symbol: string; // e.g., BTCUSDT
  exchange: ExchangeId;
  timeframe: Timeframe;
}

export class MarketWebSocketHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientSub>();
  private binanceTickerWs: WebSocket | null = null;
  private binanceKlineWs: WebSocket | null = null;
  private bybitLinearWs: WebSocket | null = null;
  private activeBinanceKlineStream = 'btcusdt@kline_15m';
  private reconnectTimers: NodeJS.Timeout[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastBroadcastPrices = new Map<string, number>();

  public attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const sub: ClientSub = {
        ws,
        symbol: 'BTCUSDT',
        exchange: 'binance',
        timeframe: '15m',
      };
      this.clients.add(sub);

      ws.send(
        JSON.stringify({
          type: 'connection:ready',
          timestamp: Date.now(),
          message: 'Connected to SIGLENS real-time stream aggregator',
        }),
      );

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as {
            type?: string;
            symbol?: string;
            exchange?: ExchangeId;
            timeframe?: Timeframe;
          };
          if (msg.type === 'subscribe' && msg.symbol && msg.timeframe) {
            sub.symbol = msg.symbol.replace('/', '').toUpperCase();
            sub.exchange = msg.exchange ?? 'binance';
            sub.timeframe = msg.timeframe;
            this.ensureBinanceKlineStream(sub.symbol, sub.timeframe);
          }
        } catch {
          // ignore malformed client frame
        }
      });

      ws.on('close', () => {
        this.clients.delete(sub);
      });
    });

    this.connectBinanceMiniTickers();
    this.connectBinanceKline(this.activeBinanceKlineStream);
    this.connectBybitLinearTickers();

    // Periodic heartbeat to connected clients
    this.heartbeatTimer = setInterval(() => {
      this.broadcast({ type: 'heartbeat', timestamp: Date.now() });
    }, 15_000);
  }

  public broadcast(payload: Record<string, unknown>): void {
    if (!this.wss) return;
    const text = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(text);
      }
    }
  }

  private ensureBinanceKlineStream(symbol: string, timeframe: Timeframe): void {
    const stream = `${symbol.toLowerCase()}@kline_${timeframe}`;
    if (stream === this.activeBinanceKlineStream && this.binanceKlineWs?.readyState === WebSocket.OPEN) {
      return;
    }
    this.activeBinanceKlineStream = stream;
    if (this.binanceKlineWs) {
      try {
        this.binanceKlineWs.removeAllListeners();
        this.binanceKlineWs.close();
      } catch {
        // ignore
      }
      this.binanceKlineWs = null;
    }
    this.connectBinanceKline(stream);
  }

  private connectBinanceMiniTickers(attempt = 0): void {
    const streams = CORE_UNIVERSE_BASES.slice(0, 20)
      .map((b) => `${b.toLowerCase()}usdt@miniTicker`)
      .join('/');
    const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;

    try {
      const ws = new WebSocket(url);
      this.binanceTickerWs = ws;

      ws.on('open', () => {
        updateWsProviderHealth('binance', true, Date.now());
      });

      ws.on('message', (buf) => {
        try {
          const parsed = JSON.parse(String(buf)) as {
            data?: { s: string; c: string; o: string; h: string; l: string; v: string; q: string; E: number };
          };
          const d = parsed.data;
          if (!d || !d.s) return;
          const price = Number(d.c);
          const open = Number(d.o);
          if (!Number.isFinite(price) || price <= 0) return;

          const base = d.s.replace(/USDT$/, '');
          const canonicalId = `binance:spot:${base}/USDT`;
          const prev = this.lastBroadcastPrices.get(canonicalId);
          // Throttle identical ticks
          if (prev === price) return;
          this.lastBroadcastPrices.set(canonicalId, price);

          const change24hPct = open > 0 ? ((price - open) / open) * 100 : 0;
          updateWsProviderHealth('binance', true, Date.now());

          this.broadcast({
            type: 'ticker:update',
            canonicalId,
            exchange: 'binance',
            marketType: 'spot',
            displaySymbol: `${base}/USDT`,
            lastPrice: price,
            change24hPct,
            high24h: Number(d.h),
            low24h: Number(d.l),
            quoteVolume24h: Number(d.q),
            timestamp: d.E || Date.now(),
          });
        } catch {
          // ignore malformed ticker frame
        }
      });

      ws.on('close', () => {
        updateWsProviderHealth('binance', false);
        const delay = Math.min(30_000, 1500 * Math.pow(2, Math.min(attempt, 5)));
        const t = setTimeout(() => this.connectBinanceMiniTickers(attempt + 1), delay);
        this.reconnectTimers.push(t);
      });

      ws.on('error', () => {
        updateWsProviderHealth('binance', false);
      });
    } catch {
      updateWsProviderHealth('binance', false);
    }
  }

  private connectBinanceKline(stream: string, attempt = 0): void {
    const url = `wss://data-stream.binance.vision/ws/${stream}`;
    try {
      const ws = new WebSocket(url);
      this.binanceKlineWs = ws;

      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(String(buf)) as {
            s?: string;
            k?: {
              t: number;
              T: number;
              i: Timeframe;
              o: string;
              h: string;
              l: string;
              c: string;
              v: string;
              x: boolean;
            };
          };
          if (!msg.k || !msg.s) return;
          const k = msg.k;
          const base = msg.s.replace(/USDT$/, '');
          const candle: Candle = {
            openTime: k.t,
            closeTime: k.T,
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
            isClosed: Boolean(k.x),
          };
          updateWsProviderHealth('binance', true, Date.now());
          this.broadcast({
            type: 'kline:update',
            canonicalId: `binance:spot:${base}/USDT`,
            timeframe: k.i,
            candle,
            timestamp: Date.now(),
          });
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        if (this.activeBinanceKlineStream !== stream) return;
        const delay = Math.min(30_000, 2000 * Math.pow(2, Math.min(attempt, 4)));
        const t = setTimeout(() => this.connectBinanceKline(stream, attempt + 1), delay);
        this.reconnectTimers.push(t);
      });

      ws.on('error', () => {
        // handled by close reconnect
      });
    } catch {
      // ignore
    }
  }

  private connectBybitLinearTickers(attempt = 0): void {
    const url = 'wss://stream.bybit.com/v5/public/linear';
    try {
      const ws = new WebSocket(url);
      this.bybitLinearWs = ws;

      ws.on('open', () => {
        updateWsProviderHealth('bybit', true, Date.now());
        const args = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT'].map(
          (s) => `tickers.${s}`,
        );
        ws.send(JSON.stringify({ op: 'subscribe', args }));
      });

      ws.on('message', (buf) => {
        try {
          const msg = JSON.parse(String(buf)) as {
            topic?: string;
            data?: { symbol?: string; lastPrice?: string; price24hPcnt?: string; fundingRate?: string };
            ts?: number;
          };
          if (!msg.topic?.startsWith('tickers.') || !msg.data?.symbol) return;
          const price = Number(msg.data.lastPrice);
          if (!Number.isFinite(price) || price <= 0) return;
          const base = msg.data.symbol.replace(/USDT$/, '');
          const canonicalId = `bybit:perpetual:${base}/USDT`;
          updateWsProviderHealth('bybit', true, Date.now());
          this.broadcast({
            type: 'ticker:update',
            canonicalId,
            exchange: 'bybit',
            marketType: 'perpetual',
            displaySymbol: `${base}/USDT`,
            lastPrice: price,
            change24hPct:
              msg.data.price24hPcnt !== undefined ? Number(msg.data.price24hPcnt) * 100 : undefined,
            timestamp: msg.ts || Date.now(),
          });
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        updateWsProviderHealth('bybit', false);
        const delay = Math.min(30_000, 2000 * Math.pow(2, Math.min(attempt, 5)));
        const t = setTimeout(() => this.connectBybitLinearTickers(attempt + 1), delay);
        this.reconnectTimers.push(t);
      });

      ws.on('error', () => {
        updateWsProviderHealth('bybit', false);
      });
    } catch {
      updateWsProviderHealth('bybit', false);
    }
  }

  public dispose(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimers.forEach((t) => clearTimeout(t));
    this.binanceTickerWs?.close();
    this.binanceKlineWs?.close();
    this.bybitLinearWs?.close();
    this.wss?.close();
  }
}

export const wsHub = new MarketWebSocketHub();
