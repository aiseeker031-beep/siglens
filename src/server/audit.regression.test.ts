import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Candle } from '../shared/types';
import {
  calculateATR,
  calculateBollingerBands,
  calculateMACD,
  calculateRSI,
} from '../analytics/indicators';
import { buildSignalReport } from '../analytics/signals';
import { assertSafeExternalUrlSync, isPrivateOrReservedIp } from './ssrf';
import { validateProviderBaseUrl } from './aiAdapters';

// Prevent server.ts from binding port 3000 when imported for tests
process.env.SIGLENS_NO_AUTOSTART = 'true';

// =========================================================================
// 1. SSRF PROTECTION REGRESSION TESTS (SIG-001)
// =========================================================================

test('SSRF: blocks RFC1918, loopback, link-local, metadata, and IPv6 private addresses', () => {
  const blockedIps = [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
  ];
  for (const ip of blockedIps) {
    assert.equal(isPrivateOrReservedIp(ip), true, `Expected IP ${ip} to be blocked`);
  }

  const publicIps = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'];
  for (const ip of publicIps) {
    assert.equal(isPrivateOrReservedIp(ip), false, `Expected public IP ${ip} to be allowed`);
  }

  const blockedUrls = [
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://localhost/hook',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/internal',
    'https://192.168.0.1/admin',
    'https://[::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://user:pass@example.com/hook',
    'ftp://example.com/file',
  ];
  for (const url of blockedUrls) {
    assert.throws(() => assertSafeExternalUrlSync(url), `Expected URL ${url} to be blocked`);
  }

  const safeUrl = assertSafeExternalUrlSync('https://hooks.slack.com/services/T00/B00/XXX');
  assert.equal(safeUrl.hostname, 'hooks.slack.com');
});

test('SSRF: AI provider validator blocks non-loopback private IPs for Ollama and enforces prod guard', () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    assert.throws(() => validateProviderBaseUrl('http://169.254.169.254/latest', 'ollama'));
    assert.equal(validateProviderBaseUrl('http://127.0.0.1:11434', 'ollama').hostname, '127.0.0.1');

    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_LOCAL_OLLAMA;
    assert.throws(() => validateProviderBaseUrl('http://127.0.0.1:11434', 'ollama'));
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

// =========================================================================
// 2. INDEPENDENT NUMERICAL REFERENCE VERIFICATION (PHASE 6.2)
// =========================================================================

test('Independent reference Wilder RSI(14), MACD(12,26,9), BB(20,2), and ATR(14) match within 1e-9', () => {
  // Deterministic non-monotonic realistic price vector (45 bars)
  const closes = [
    100.0, 101.2, 100.8, 102.5, 103.1, 102.0, 101.4, 102.9, 104.3, 103.8,
    105.0, 106.2, 105.5, 104.9, 106.8, 107.4, 106.1, 105.7, 107.2, 108.9,
    109.5, 108.2, 107.6, 108.4, 110.1, 111.0, 110.3, 109.8, 111.5, 112.2,
    111.4, 110.7, 112.0, 113.4, 114.1, 113.2, 112.8, 114.5, 115.0, 114.2,
    115.8, 116.4, 115.9, 117.1, 118.0,
  ];
  const candles: Candle[] = closes.map((c, i) => ({
    openTime: Date.UTC(2026, 0, 1) + i * 3_600_000,
    closeTime: Date.UTC(2026, 0, 1) + (i + 1) * 3_600_000 - 1,
    open: i === 0 ? c : closes[i - 1],
    high: Math.max(c, i === 0 ? c : closes[i - 1]) + 0.9,
    low: Math.min(c, i === 0 ? c : closes[i - 1]) - 0.7,
    close: c,
    volume: 1000 + (i % 5) * 150,
    isClosed: true,
  }));

  // Independent reference Wilder RSI(14)
  let gSum = 0;
  let lSum = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gSum += d;
    else lSum += -d;
  }
  let ag = gSum / 14;
  let al = lSum / 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * 13 + (d > 0 ? d : 0)) / 14;
    al = (al * 13 + (d < 0 ? -d : 0)) / 14;
  }
  const refRsi = 100 - 100 / (1 + ag / al);
  const actualRsi = calculateRSI(closes, 14)[closes.length - 1]!;
  assert.ok(Math.abs(actualRsi - refRsi) < 1e-9, `RSI mismatch: ${actualRsi} vs ${refRsi}`);

  // Independent reference EMA helper for MACD
  const refEma = (arr: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = ema;
    for (let i = period; i < arr.length; i++) {
      ema = arr[i] * k + ema * (1 - k);
      out[i] = ema;
    }
    return out;
  };
  const e12 = refEma(closes, 12);
  const e26 = refEma(closes, 26);
  const macdVals: number[] = [];
  for (let i = 25; i < closes.length; i++) macdVals.push(e12[i] - e26[i]);
  const sigRef = refEma(macdVals, 9);
  const lastMacdRef = macdVals[macdVals.length - 1];
  const lastSigRef = sigRef[sigRef.length - 1];
  const actualMacd = calculateMACD(closes, 12, 26, 9);
  assert.ok(Math.abs(actualMacd.macdLine[closes.length - 1]! - lastMacdRef) < 1e-9);
  assert.ok(Math.abs(actualMacd.signalLine[closes.length - 1]! - lastSigRef) < 1e-9);

  // Independent reference Bollinger Bands(20, 2)
  const w20 = closes.slice(-20);
  const mean20 = w20.reduce((a, b) => a + b, 0) / 20;
  const sd20 = Math.sqrt(w20.reduce((s, v) => s + (v - mean20) ** 2, 0) / 20);
  const actualBb = calculateBollingerBands(closes, 20, 2);
  assert.ok(Math.abs(actualBb.middle[closes.length - 1]! - mean20) < 1e-9);
  assert.ok(Math.abs(actualBb.upper[closes.length - 1]! - (mean20 + 2 * sd20)) < 1e-9);
  assert.ok(Math.abs(actualBb.lower[closes.length - 1]! - (mean20 - 2 * sd20)) < 1e-9);

  // Independent reference Wilder ATR(14)
  const trs = candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
  let refAtr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (let i = 14; i < trs.length; i++) {
    refAtr = (refAtr * 13 + trs[i]) / 14;
  }
  const actualAtr = calculateATR(candles, 14).atr[candles.length - 1]!;
  assert.ok(Math.abs(actualAtr - refAtr) < 1e-9);
});

test('Signal explanation consistency: reported RSI/EMA evidence matches underlying rawValues', () => {
  const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + i * 0.9;
    return {
      openTime: Date.UTC(2026, 0, 1) + i * 3_600_000,
      closeTime: Date.UTC(2026, 0, 1) + (i + 1) * 3_600_000 - 1,
      open: close - 0.5,
      high: close + 0.6,
      low: close - 0.8,
      close,
      volume: 1000 + i * 10,
      isClosed: true,
    };
  });
  const report = buildSignalReport(candles, 'CONFIRMED', {
    canonicalId: 'binance:spot:BTC/USDT',
    exchange: 'binance',
    marketType: 'spot',
    displaySymbol: 'BTC/USDT',
    timeframe: '1h',
    nowMs: Date.UTC(2026, 0, 10),
  });
  const rsiInd = report.indicators.find((i) => i.id === 'rsi')!;
  const emaInd = report.indicators.find((i) => i.id === 'ema')!;
  assert.ok((rsiInd.rawValues.rsi14 as number) > 55);
  assert.ok((emaInd.rawValues.close as number) > (emaInd.rawValues.ema20 as number));
  assert.ok(report.supportingEvidence.every((line) => !line.toLowerCase().includes('oversold')));
});

// =========================================================================
// 3. EXPRESS API, SECURITY HEADERS, VALIDATION & CSRF REGRESSION TESTS
// =========================================================================

test('API & Security: headers, JSON 404, malformed JSON 400, validation, SSRF, CSRF, and orderbook schema', async () => {
  const { createApp } = await import('../../server');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Health + Security headers + Cache-Control
    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-powered-by'), null, 'x-powered-by must be disabled');
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.ok(healthRes.headers.get('content-security-policy')?.includes("default-src 'self'"));
    assert.equal(healthRes.headers.get('cache-control'), 'no-store');
    const healthJson = (await healthRes.json()) as { status: string; app: string };
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.app, 'SIGLENS');

    // 2. Unknown /api/* route returns 404 JSON (not 200 HTML)
    const notFoundRes = await fetch(`${base}/api/this-route-does-not-exist`);
    assert.equal(notFoundRes.status, 404);
    assert.ok((notFoundRes.headers.get('content-type') || '').includes('application/json'));

    // 3. Malformed JSON returns 400 JSON
    const badJsonRes = await fetch(`${base}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken_json":',
    });
    assert.equal(badJsonRes.status, 400);
    assert.ok((badJsonRes.headers.get('content-type') || '').includes('application/json'));

    // 4. Cross-Origin CSRF guard blocks foreign Origin on mutating endpoints
    const csrfRes = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://malicious.example',
      },
      body: JSON.stringify({ denseMode: true }),
    });
    assert.equal(csrfRes.status, 403);

    // 5. Strict query validation rejects invalid exchange / timeframe / feeBps with 400
    assert.equal((await fetch(`${base}/api/markets?exchange=INVALID`)).status, 400);
    assert.equal((await fetch(`${base}/api/screener?exchange=INVALID`)).status, 400);
    assert.equal((await fetch(`${base}/api/signals/current?timeframe=99x`)).status, 400);
    assert.equal((await fetch(`${base}/api/arbitrage?feeBps=999`)).status, 400);

    // 6. Alert webhook SSRF protection rejects private/metadata URLs with 400
    const ssrfAlertRes = await fetch(`${base}/api/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonicalId: 'binance:spot:BTC/USDT',
        timeframe: '1h',
        condition: 'PRICE_ABOVE',
        threshold: 999999,
        webhookUrl: 'https://169.254.169.254/latest/meta-data/',
      }),
    });
    assert.equal(ssrfAlertRes.status, 400);

    // 7. PUT /api/settings rejects unknown fields & out-of-range weights with 400
    const badSettingsRes = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ injectedField: 'evil', weights: { ema: 9999 } }),
    });
    assert.equal(badSettingsRes.status, 400);

    // 8. Orderbook schema for stocks returns null bestBid/bestAsk/spreadPct (no invalid midPrice)
    const bookRes = await fetch(`${base}/api/orderbook?exchange=stocks&marketType=equity&symbol=AAPL/USD`);
    assert.equal(bookRes.status, 200);
    const bookJson = (await bookRes.json()) as Record<string, unknown>;
    assert.equal(bookJson.bestBid, null);
    assert.equal(bookJson.bestAsk, null);
    assert.equal(bookJson.spreadPct, null);
    assert.equal('midPrice' in bookJson, false);

    // 9. Auth state endpoint responds honestly
    const authRes = await fetch(`${base}/api/auth/me`);
    assert.equal(authRes.status, 200);
    const authJson = (await authRes.json()) as { configured: boolean; callbackUrl: string; user: unknown };
    assert.equal(typeof authJson.configured, 'boolean');
    assert.ok(authJson.callbackUrl.endsWith('/api/auth/google/callback'));

    // 10. CRON_SECRET guard blocks unauthorized non-browser POST /api/paper/tick when configured
    const prevCron = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = 'test-audit-cron-secret-123';
      const unauthTick = await fetch(`${base}/api/paper/tick`, { method: 'POST' });
      assert.equal(unauthTick.status, 401);
    } finally {
      if (prevCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCron;
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});


test('Landing Page & Strict Google Auth Gate: serves new landing page at /, blocks /app and /api/* when unauthenticated', async () => {
  const { createApp } = await import('../../server');
  const prevReqAuth = process.env.SIGLENS_REQUIRE_AUTH;
  process.env.SIGLENS_REQUIRE_AUTH = 'true';

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Public landing page at / renders new SigLens HTML with Continue with Google CTA
    const landingRes = await fetch(`${base}/`);
    assert.equal(landingRes.status, 200);
    const html = await landingRes.text();
    assert.ok(html.includes('See Beyond'), 'Landing page should render new SigLens hero');
    assert.ok(html.includes('Continue with Google'), 'Landing page should include Continue with Google CTA');
    assert.ok(html.includes('/api/auth/google'), 'Landing page CTA must point to /api/auth/google');

    // 2. Unauthenticated GET /app redirects to /?auth_required=1
    const appRes = await fetch(`${base}/app`, { redirect: 'manual' });
    assert.equal(appRes.status, 302);
    assert.equal(appRes.headers.get('location'), '/?auth_required=1');

    // 3. Direct /index.html cannot bypass /app auth gate
    const idxRes = await fetch(`${base}/index.html`, { redirect: 'manual' });
    assert.equal(idxRes.status, 302);
    assert.equal(idxRes.headers.get('location'), '/app');

    // 4. Unauthenticated app API call is blocked with 401
    const marketsRes = await fetch(`${base}/api/markets?exchange=binance&marketType=spot`);
    assert.equal(marketsRes.status, 401);
    const mJson = (await marketsRes.json()) as { authRequired?: boolean };
    assert.equal(mJson.authRequired, true);

    // 5. Public auth & health routes remain accessible
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 200);
  } finally {
    if (prevReqAuth === undefined) delete process.env.SIGLENS_REQUIRE_AUTH;
    else process.env.SIGLENS_REQUIRE_AUTH = prevReqAuth;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
