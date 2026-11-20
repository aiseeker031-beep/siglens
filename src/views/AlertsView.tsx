import React, { useEffect, useState } from 'react';
import { Bell, BellRing, Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { CORE_UNIVERSE_BASES, EXCHANGE_LABELS, QUICK_TIMEFRAMES } from '../shared/constants';
import { formatTimestamp } from '../shared/format';
import type { AlertConditionType, AlertEventRecord, AlertRule, ExchangeId, MarketType, Timeframe } from '../shared/types';
import { useAppStore } from '../store/useAppStore';

const CONDITION_META: { value: AlertConditionType; label: string; needsThreshold: boolean; placeholder?: string }[] = [
  { value: 'PRICE_ABOVE', label: 'Price Above ($)', needsThreshold: true, placeholder: 'e.g. 95000' },
  { value: 'PRICE_BELOW', label: 'Price Below ($)', needsThreshold: true, placeholder: 'e.g. 80000' },
  { value: 'PCT_CHANGE_ABOVE', label: '24h Change Above (%)', needsThreshold: true, placeholder: 'e.g. 5' },
  { value: 'PCT_CHANGE_BELOW', label: '24h Change Below (%)', needsThreshold: true, placeholder: 'e.g. -5' },
  { value: 'RVOL_ABOVE', label: 'Relative Volume (RVOL) Above', needsThreshold: true, placeholder: 'e.g. 2.0' },
  { value: 'RSI_BELOW', label: 'RSI 14 Oversold Below', needsThreshold: true, placeholder: 'e.g. 30' },
  { value: 'RSI_ABOVE', label: 'RSI 14 Overbought Above', needsThreshold: true, placeholder: 'e.g. 70' },
  { value: 'ADX_ABOVE', label: 'ADX 14 Trend Strength Above', needsThreshold: true, placeholder: 'e.g. 25' },
  { value: 'MACD_BULLISH_CROSS', label: 'MACD Bullish Crossover', needsThreshold: false },
  { value: 'MACD_BEARISH_CROSS', label: 'MACD Bearish Crossover', needsThreshold: false },
  { value: 'EMA_BULLISH_CROSS', label: 'EMA Bullish Cross (Golden / 20>50)', needsThreshold: false },
  { value: 'EMA_BEARISH_CROSS', label: 'EMA Bearish Cross (Death / 20<50)', needsThreshold: false },
  { value: 'SIGNAL_STRONG_BULLISH', label: 'Confirmed Signal = Strong Bullish', needsThreshold: false },
  { value: 'SIGNAL_STRONG_BEARISH', label: 'Confirmed Signal = Strong Bearish', needsThreshold: false },
  { value: 'SIGNAL_CHANGED', label: 'Confirmed Signal Class Changed', needsThreshold: false },
  { value: 'PRICE_ABOVE_VWAP', label: 'Close Reclaimed Session VWAP', needsThreshold: false },
  { value: 'PRICE_BELOW_VWAP', label: 'Close Fell Below Session VWAP', needsThreshold: false },
  { value: 'FUNDING_ABOVE', label: 'Perpetual Funding Above (%)', needsThreshold: true, placeholder: 'e.g. 0.03' },
  { value: 'FUNDING_BELOW', label: 'Perpetual Funding Below (%)', needsThreshold: true, placeholder: 'e.g. -0.01' },
];

export const AlertsView: React.FC = () => {
  const timezone = useAppStore((s) => s.preferences.timezone);
  const globalExchange = useAppStore((s) => s.exchange);
  const globalSymbol = useAppStore((s) => s.symbol);

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );

  // Create form state
  const [exchange, setExchange] = useState<ExchangeId>(globalExchange);
  const [marketType, setMarketType] = useState<MarketType>('spot');
  const [baseAsset, setBaseAsset] = useState<string>(globalSymbol.split('/')[0] || 'BTC');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [condition, setCondition] = useState<AlertConditionType>('RSI_BELOW');
  const [threshold, setThreshold] = useState<string>('30');
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(30);
  const [recurring, setRecurring] = useState<boolean>(true);
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [creating, setCreating] = useState(false);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const res = await api.getAlerts();
      setRules(res.rules);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
    const t = window.setInterval(loadAlerts, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const condInfo = CONDITION_META.find((c) => c.value === condition) ?? CONDITION_META[0];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const quote = exchange === 'kraken' || exchange === 'coinbase' ? 'USD' : 'USDT';
    const canonicalId = `${exchange}:${marketType}:${baseAsset}/${quote}`;

    if (condInfo.needsThreshold && (threshold.trim() === '' || !Number.isFinite(Number(threshold)))) {
      setError('Please enter a valid numeric threshold for this condition.');
      return;
    }

    setCreating(true);
    try {
      const res = await api.createAlert({
        canonicalId,
        timeframe,
        condition,
        threshold: condInfo.needsThreshold ? Number(threshold) : null,
        cooldownMinutes,
        recurring,
        webhookUrl: webhookUrl.trim() ? webhookUrl.trim() : null,
      });
      setRules((prev) => [res.rule, ...prev]);
      setWebhookUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create alert rule');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (rule: AlertRule) => {
    try {
      const res = await api.toggleAlert(rule.id, !rule.enabled);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? res.rule : r)));
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAlert(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // ignore
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Smart Alert Engine</h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Persistent SQLite technical and market alerts evaluated automatically by the backend scanner with cooldown deduplication and optional HTTPS webhooks.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {notifPerm !== 'unsupported' && (
            <button
              type="button"
              onClick={requestNotificationPermission}
              disabled={notifPerm === 'granted'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium disabled:opacity-60"
            >
              <BellRing className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#4EA1FF]" />
              {notifPerm === 'granted'
                ? 'Browser Alerts Enabled'
                : notifPerm === 'denied'
                  ? 'Browser Alerts Blocked'
                  : 'Enable Browser Notifications'}
            </button>
          )}
        </div>
      </div>

      {/* Honest runtime note */}
      <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] px-3.5 py-2 text-[11px] text-[#677482] dark:text-[#8B97A5]">
        Alert rules persist in SQLite and are evaluated while the CRYPTOLENS server process is running. Browser notifications appear when a tab is open; configure an optional HTTPS webhook for off-screen delivery.
      </div>

      {/* Create Alert Form */}
      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 space-y-3 text-xs"
      >
        <div className="font-semibold flex items-center gap-1.5">
          <Plus className="w-4 h-4 text-[#2563EB] dark:text-[#4EA1FF]" />
          Create Alert Rule
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <label className="space-y-1">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Exchange</span>
            <select
              value={exchange}
              onChange={(e) => {
                const ex = e.target.value as ExchangeId;
                setExchange(ex);
                if (ex !== 'bybit') setMarketType('spot');
              }}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
              <option value="kraken">Kraken</option>
              <option value="coinbase">Coinbase</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Asset</span>
            <select
              value={baseAsset}
              onChange={(e) => setBaseAsset(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              {CORE_UNIVERSE_BASES.map((b) => (
                <option key={b} value={b}>
                  {b}/{exchange === 'kraken' || exchange === 'coinbase' ? 'USD' : 'USDT'}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Timeframe</span>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              {QUICK_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 lg:col-span-2">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Condition</span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as AlertConditionType)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              {CONDITION_META.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
              {condInfo.needsThreshold ? 'Threshold' : 'Threshold (N/A)'}
            </span>
            <input
              type="number"
              step="any"
              disabled={!condInfo.needsThreshold}
              value={condInfo.needsThreshold ? threshold : ''}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={condInfo.placeholder ?? 'Not required'}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono disabled:opacity-40"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 items-end">
          <label className="space-y-1">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Cooldown (min)</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Number(e.target.value) || 15)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Mode</span>
            <select
              value={recurring ? 'recurring' : 'once'}
              onChange={(e) => setRecurring(e.target.value === 'recurring')}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <option value="recurring">Recurring</option>
              <option value="once">One-Time</option>
            </select>
          </label>

          <label className="space-y-1 sm:col-span-2 lg:col-span-3">
            <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Optional HTTPS Webhook URL</span>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.example.com/cryptolens (optional)"
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            />
          </label>

          <button
            type="submit"
            disabled={creating}
            className="w-full px-3.5 py-2 rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] font-semibold"
          >
            {creating ? 'Creating...' : 'Save Alert Rule'}
          </button>
        </div>

        {error && <div className="text-[#DC4C54] dark:text-[#F16B72]">{error}</div>}
      </form>

      {/* Active Rules & Triggered History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E6EBF0] dark:border-[#27313C] flex items-center justify-between text-xs">
            <span className="font-semibold">Configured Rules ({rules.length})</span>
            <span className="text-[#677482] dark:text-[#8B97A5]">Evaluated on live ticks & closed bars</span>
          </div>
          {loading && rules.length === 0 ? (
            <div className="p-4 text-xs text-[#677482]">Loading rules...</div>
          ) : rules.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#677482] dark:text-[#8B97A5]">
              No alert rules configured yet. Create a price, indicator, or signal alert above.
            </div>
          ) : (
            <div className="divide-y divide-[#E6EBF0] dark:divide-[#27313C] text-xs">
              {rules.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">
                      <span>{r.displaySymbol}</span>
                      <span className="font-mono text-[10px] text-[#677482] dark:text-[#8B97A5]">
                        {EXCHANGE_LABELS[r.exchange]} · {r.timeframe}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#677482] dark:text-[#8B97A5] mt-0.5">
                      {r.condition.replace(/_/g, ' ')}
                      {r.threshold !== null ? ` (${r.threshold})` : ''} · Cooldown {r.cooldownMinutes}m ·{' '}
                      {r.recurring ? 'Recurring' : 'One-time'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggle(r)}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                        r.enabled
                          ? 'bg-[#35C89A]/15 text-[#16A378] dark:text-[#35C89A]'
                          : 'bg-[#94A3B8]/15 text-[#677482] dark:text-[#8B97A5]'
                      }`}
                    >
                      {r.enabled ? 'Active' : 'Paused'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete alert ${r.id}`}
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 rounded text-[#677482] hover:text-[#DC4C54]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#E6EBF0] dark:border-[#27313C] flex items-center justify-between text-xs">
            <span className="font-semibold flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#4EA1FF]" />
              Triggered Event Log ({events.length})
            </span>
          </div>
          {events.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#677482] dark:text-[#8B97A5]">
              No alerts have fired yet. Triggered events will appear here in real time.
            </div>
          ) : (
            <div className="divide-y divide-[#E6EBF0] dark:divide-[#27313C] max-h-[420px] overflow-y-auto text-xs">
              {events.map((ev) => (
                <div key={ev.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {ev.displaySymbol} · {ev.timeframe}
                    </span>
                    <span className="font-mono text-[10px] text-[#677482] dark:text-[#8B97A5]">
                      {formatTimestamp(ev.triggeredAt, timezone)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#677482] dark:text-[#8B97A5]">{ev.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
