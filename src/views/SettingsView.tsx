import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../services/api';
import { DEFAULT_PREFERENCES, DEFAULT_WEIGHTS, QUICK_TIMEFRAMES } from '../shared/constants';
import { exportToCsv, formatTimestamp } from '../shared/format';
import type {
  AIProviderProfile,
  AIProviderType,
  ExchangeId,
  IndicatorWeights,
  ProviderStatus,
  Timeframe,
  UserPreferences,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';
import {
  getSessionApiKey,
  hasEncryptedApiKey,
  removeStoredApiKey,
  saveEncryptedApiKey,
  setSessionApiKey,
} from '../utils/cryptoVault';

type SettingsTab = 'general' | 'charts' | 'signals' | 'diagnostics' | 'ai' | 'data';

const PROVIDER_DEFAULTS: Record<AIProviderType, { baseUrl: string; model: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest', label: 'Anthropic Claude' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', label: 'Google Gemini' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', label: 'Groq' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1', label: 'Ollama (Local)' },
  openai_compatible: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', label: 'OpenAI-Compatible' },
};

const WEIGHT_LABELS: [keyof IndicatorWeights, string][] = [
  ['ema', 'EMA Stack (9/20/50/100/200)'],
  ['macd', 'MACD (12/26/9)'],
  ['adx', 'ADX / DMI (14)'],
  ['rsi', 'RSI (14)'],
  ['bollinger', 'Bollinger Bands (20, 2)'],
  ['stochRsi', 'Stochastic RSI'],
  ['obv', 'On-Balance Volume (OBV)'],
  ['vwap', 'Session VWAP (UTC)'],
  ['rvol', 'Relative Volume (RVOL 20)'],
];

export const SettingsView: React.FC = () => {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const wsFreshness = useAppStore((s) => s.wsFreshness);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof api.getDiagnostics>> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  // BYOK AI Providers state
  const [aiProfiles, setAiProfiles] = useState<AIProviderProfile[]>([]);
  const [aiName, setAiName] = useState('My Research LLM');
  const [aiType, setAiType] = useState<AIProviderType>('openai');
  const [aiBaseUrl, setAiBaseUrl] = useState(PROVIDER_DEFAULTS.openai.baseUrl);
  const [aiModel, setAiModel] = useState(PROVIDER_DEFAULTS.openai.model);
  const [aiKey, setAiKey] = useState('');
  const [aiStorageMode, setAiStorageMode] = useState<'session' | 'encrypted_local'>('session');
  const [aiPassphrase, setAiPassphrase] = useState('');
  const [aiStatusMsg, setAiStatusMsg] = useState<string | null>(null);
  const [aiErrorMsg, setAiErrorMsg] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);

  const flashNotice = (msg: string) => {
    setSavedNotice(msg);
    window.setTimeout(() => setSavedNotice(null), 2800);
  };

  const loadDiagnostics = async () => {
    setDiagLoading(true);
    try {
      const res = await api.getDiagnostics();
      setDiagnostics(res);
    } catch {
      // ignore
    } finally {
      setDiagLoading(false);
    }
  };

  const loadAIProfiles = async () => {
    try {
      const res = await api.getAIProfiles();
      setAiProfiles(res.profiles);
    } catch {
      setAiProfiles([]);
    }
  };

  useEffect(() => {
    if (tab === 'diagnostics') loadDiagnostics();
    if (tab === 'ai') loadAIProfiles();
  }, [tab]);

  const handleSavePref = async (patch: Partial<UserPreferences>, msg = 'Preferences saved') => {
    await updatePreferences(patch);
    flashNotice(msg);
  };

  const handleWeightChange = (key: keyof IndicatorWeights, val: number) => {
    handleSavePref({ weights: { ...preferences.weights, [key]: val } }, 'Signal weights updated');
  };

  const totalWeight = Object.values(preferences.weights).reduce((a, b) => a + b, 0);

  const handleSaveAIProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiErrorMsg(null);
    setAiStatusMsg(null);

    if (aiType !== 'ollama' && !aiKey.trim()) {
      setAiErrorMsg('Please enter an API key for this provider.');
      return;
    }
    if (aiStorageMode === 'encrypted_local' && aiType !== 'ollama' && aiPassphrase.length < 6) {
      setAiErrorMsg('Encryption passphrase must be at least 6 characters.');
      return;
    }

    try {
      const res = await api.saveAIProfile({
        name: aiName.trim() || PROVIDER_DEFAULTS[aiType].label,
        providerType: aiType,
        model: aiModel.trim() || PROVIDER_DEFAULTS[aiType].model,
        baseUrl: aiBaseUrl.trim() || PROVIDER_DEFAULTS[aiType].baseUrl,
        temperature: 0.2,
        maxTokens: 900,
        timeoutMs: 25000,
        enabled: true,
        storageMode: aiStorageMode,
      });

      if (aiType !== 'ollama' && aiKey.trim()) {
        if (aiStorageMode === 'encrypted_local') {
          await saveEncryptedApiKey(res.profile.id, aiKey.trim(), aiPassphrase);
        } else {
          setSessionApiKey(res.profile.id, aiKey.trim());
        }
      }

      setAiProfiles((prev) => [res.profile, ...prev.filter((p) => p.id !== res.profile.id)]);
      setAiKey('');
      setAiPassphrase('');
      setAiStatusMsg('AI provider profile saved locally.');
    } catch (err) {
      setAiErrorMsg(err instanceof Error ? err.message : 'Failed to save AI provider');
    }
  };

  const handleTestAI = async () => {
    setAiErrorMsg(null);
    setAiStatusMsg(null);
    setTestingAi(true);
    try {
      const res = await api.testAIConnection({
        providerType: aiType,
        model: aiModel.trim(),
        baseUrl: aiBaseUrl.trim(),
        apiKey: aiKey.trim() || undefined,
        timeoutMs: 15000,
      });
      setAiStatusMsg(`Connection verified (${res.modelUsed}): "${res.sample}"`);
    } catch (err) {
      setAiErrorMsg(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTestingAi(false);
    }
  };

  const handleDeleteAIProfile = async (id: string) => {
    try {
      await api.deleteAIProfile(id);
      removeStoredApiKey(id);
      setAiProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore
    }
  };

  const handleExportSettings = () => {
    const blob = new Blob([JSON.stringify(preferences, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cryptolens-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<UserPreferences>;
        await handleSavePref(parsed, 'Settings imported successfully');
      } catch {
        flashNotice('Invalid JSON settings file');
      }
    };
    reader.readAsText(file);
  };

  const handleExportSignalCsv = async () => {
    try {
      const res = await api.getSignalFeed(500);
      exportToCsv(
        'cryptolens-signal-history.csv',
        ['Timestamp', 'Symbol', 'Exchange', 'Timeframe', 'Event', 'Classification', 'Score', 'Agreement %', 'Summary'],
        res.events.map((ev) => [
          new Date(ev.triggeredAt).toISOString(),
          ev.displaySymbol,
          ev.exchange,
          ev.timeframe,
          ev.eventType,
          ev.classification,
          ev.directionalScore,
          ev.agreementPct,
          ev.summary,
        ]),
      );
    } catch {
      flashNotice('Unable to export signal history');
    }
  };

  const handleClearCache = async () => {
    await api.clearCache();
    flashNotice('Local SQLite candle cache cleared');
    if (tab === 'diagnostics') loadDiagnostics();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings & Diagnostics</h1>
          <p className="text-xs text-[#677482] dark:text-[#8B97A5] mt-0.5">
            Configure workspace defaults, deterministic signal weights, optional BYOK AI providers, and monitor live exchange data adapters.
          </p>
        </div>
        {savedNotice && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A378] dark:text-[#35C89A]">
            <CheckCircle2 className="w-4 h-4" />
            {savedNotice}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-[#E6EBF0] dark:border-[#27313C] pb-2 text-xs">
        {(
          [
            ['general', 'General'],
            ['charts', 'Charts & Motion'],
            ['signals', 'Signal Engine'],
            ['diagnostics', 'Market Data Diagnostics'],
            ['ai', 'AI Providers (BYOK)'],
            ['data', 'Data Management'],
          ] as [SettingsTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              tab === id
                ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14]'
                : 'text-[#677482] dark:text-[#8B97A5] hover:bg-[#F7F9FB] dark:hover:bg-[#1B232D]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* GENERAL TAB */}
      {tab === 'general' && (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <label className="space-y-1.5">
            <span className="font-semibold">Color Theme</span>
            <select
              value={preferences.theme}
              onChange={(e) => handleSavePref({ theme: e.target.value as UserPreferences['theme'] })}
              className="w-full px-3 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <option value="dark">Dark (Institutional Default)</option>
              <option value="light">Light (Clean Day Mode)</option>
              <option value="system">System Preference</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="font-semibold">Timestamp Display Timezone</span>
            <select
              value={preferences.timezone}
              onChange={(e) => handleSavePref({ timezone: e.target.value as 'UTC' | 'local' })}
              className="w-full px-3 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <option value="UTC">UTC (Exchange Candle Standard)</option>
              <option value="local">Local Browser Timezone</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="font-semibold">Decimal Precision</span>
            <select
              value={String(preferences.decimalPrecision)}
              onChange={(e) => {
                const v = e.target.value;
                handleSavePref({
                  decimalPrecision: v === 'auto' ? 'auto' : (Number(v) as 2 | 4 | 6),
                });
              }}
              className="w-full px-3 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <option value="auto">Adaptive (Auto by Asset Magnitude)</option>
              <option value="2">2 Decimal Places</option>
              <option value="4">4 Decimal Places</option>
              <option value="6">6 Decimal Places</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="font-semibold">Default Exchange</span>
            <select
              value={preferences.defaultExchange}
              onChange={(e) => handleSavePref({ defaultExchange: e.target.value as ExchangeId })}
              className="w-full px-3 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              <option value="binance">Binance</option>
              <option value="bybit">Bybit</option>
              <option value="kraken">Kraken</option>
              <option value="coinbase">Coinbase</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="font-semibold">Default Timeframe</span>
            <select
              value={preferences.defaultTimeframe}
              onChange={(e) => handleSavePref({ defaultTimeframe: e.target.value as Timeframe })}
              className="w-full px-3 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
            >
              {QUICK_TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] px-3.5 py-2.5">
            <div>
              <div className="font-semibold">Compact Table Density</div>
              <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                Tighter row height for high-density market tables
              </div>
            </div>
            <input
              type="checkbox"
              checked={preferences.denseMode}
              onChange={(e) => handleSavePref({ denseMode: e.target.checked })}
              className="h-4 w-4"
            />
          </div>
        </div>
      )}

      {/* CHARTS TAB */}
      {tab === 'charts' && (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="font-semibold">Default Asset Explorer Chart Mode</span>
              <select
                value={preferences.defaultChartMode}
                onChange={(e) => handleSavePref({ defaultChartMode: e.target.value as '2d' | '3d' })}
                className="w-full px-3 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
              >
                <option value="2d">2D Professional Chart (Lightweight Charts)</option>
                <option value="3d">3D Interactive Financial Studio (Three.js)</option>
              </select>
            </label>

            <div className="flex items-center justify-between rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] px-3.5 py-2.5">
              <div>
                <div className="font-semibold">Show Live Provisional (Forming Candle) Signal</div>
                <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                  Always displayed separately from confirmed closed-candle signals
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.showLiveProvisional}
                onChange={(e) => handleSavePref({ showLiveProvisional: e.target.checked })}
                className="h-4 w-4"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] px-3.5 py-2.5">
              <div>
                <div className="font-semibold">Reduced Motion & 3D Damping</div>
                <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                  Disables smooth orbit inertia and subtle UI animations
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences.reducedMotion}
                onChange={(e) => handleSavePref({ reducedMotion: e.target.checked })}
                className="h-4 w-4"
              />
            </div>
          </div>
        </div>
      )}

      {/* SIGNAL ENGINE TAB */}
      {tab === 'signals' && (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold">Deterministic Signal Engine Weights</h2>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                Weights are automatically normalized across available indicators. ATR (14) acts as a non-directional volatility quality modifier (0.5x–1.0x).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs">
                Total Weight: <strong>{totalWeight}</strong>
              </span>
              <button
                type="button"
                onClick={() => handleSavePref({ weights: { ...DEFAULT_WEIGHTS } }, 'Weights reset to defaults')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E6EBF0] dark:border-[#27313C]"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Weights
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {WEIGHT_LABELS.map(([key, label]) => (
              <div
                key={key}
                className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{label}</span>
                  <span className="font-mono font-bold text-[#2563EB] dark:text-[#4EA1FF]">
                    {preferences.weights[key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={preferences.weights[key]}
                  onChange={(e) => handleWeightChange(key, Number(e.target.value))}
                  className="w-full"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#E6EBF0] dark:border-[#27313C]">
            <label className="space-y-1">
              <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Strong Bullish (&ge;)</span>
              <input
                type="number"
                value={preferences.thresholds.strongBullish}
                onChange={(e) =>
                  handleSavePref({
                    thresholds: { ...preferences.thresholds, strongBullish: Number(e.target.value) },
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Bullish (&ge;)</span>
              <input
                type="number"
                value={preferences.thresholds.bullish}
                onChange={(e) =>
                  handleSavePref({
                    thresholds: { ...preferences.thresholds, bullish: Number(e.target.value) },
                  })
                }
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Min Coverage (%)</span>
              <input
                type="number"
                min={30}
                max={100}
                value={preferences.minCoveragePct}
                onChange={(e) => handleSavePref({ minCoveragePct: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Min Strong Agreement (%)</span>
              <input
                type="number"
                min={40}
                max={100}
                value={preferences.minAgreementForStrongPct}
                onChange={(e) => handleSavePref({ minAgreementForStrongPct: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
              />
            </label>
          </div>
        </div>
      )}

      {/* DIAGNOSTICS TAB */}
      {tab === 'diagnostics' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="text-[#677482] dark:text-[#8B97A5]">
              Browser WebSocket Status:{' '}
              <strong className="font-mono text-[#17212B] dark:text-[#F4F7FA]">{wsFreshness}</strong>
              {diagnostics ? ` · Server Uptime: ${Math.floor(diagnostics.uptimeSeconds / 60)}m` : ''}
            </div>
            <button
              type="button"
              onClick={loadDiagnostics}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
              Refresh Health
            </button>
          </div>

          {diagnostics && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3.5">
                  <div className="text-[#677482] dark:text-[#8B97A5]">SQLite Database Size</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {(diagnostics.storage.dbSizeBytes / 1024).toFixed(1)} KB
                  </div>
                </div>
                <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3.5">
                  <div className="text-[#677482] dark:text-[#8B97A5]">Cached Candles</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {diagnostics.storage.cachedCandles.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3.5">
                  <div className="text-[#677482] dark:text-[#8B97A5]">Persisted Signal Events</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {diagnostics.storage.signalEvents.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-3.5">
                  <div className="text-[#677482] dark:text-[#8B97A5]">Active Alert Rules</div>
                  <div className="text-lg font-bold font-mono tabular-nums mt-0.5">
                    {diagnostics.storage.alertRules}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-[11px] text-[#677482] dark:text-[#8B97A5]">
                      <th className="text-left px-3 py-2 font-medium">Public Data Provider</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-left px-3 py-2 font-medium">WebSocket</th>
                      <th className="text-right px-3 py-2 font-medium">Latency</th>
                      <th className="text-right px-3 py-2 font-medium">Requests / Errors</th>
                      <th className="text-left px-3 py-2 font-medium">Last REST Success</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                    {diagnostics.providers.map((p: ProviderStatus) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2.5 font-semibold">{p.name}</td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">
                          <span
                            className={
                              p.status === 'LIVE'
                                ? 'text-[#16A378] dark:text-[#35C89A]'
                                : p.status === 'DELAYED'
                                  ? 'text-[#E6A832]'
                                  : 'text-[#677482] dark:text-[#8B97A5]'
                            }
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11px]">
                          {p.wsConnected ? 'Connected' : 'REST Polling'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {p.latencyMs !== null ? `${p.latencyMs} ms` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {p.requestCount} / {p.errorCount}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-[#677482] dark:text-[#8B97A5]">
                          {formatTimestamp(p.lastRestSuccessAt, preferences.timezone, false)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* AI PROVIDERS BYOK TAB */}
      {tab === 'ai' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-3.5 text-xs flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#16A378] dark:text-[#35C89A] shrink-0 mt-0.5" />
            <div className="text-[#677482] dark:text-[#8B97A5]">
              <strong className="text-[#17212B] dark:text-[#F4F7FA]">Zero Server-Side Key Persistence:</strong>{' '}
              Provider metadata is stored in SQLite, while your API keys stay exclusively in browser <code className="font-mono">sessionStorage</code> or passphrase-derived AES-GCM 256-bit Web Crypto storage. Keys are never logged or committed.
            </div>
          </div>

          <form
            onSubmit={handleSaveAIProfile}
            className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-4 space-y-3 text-xs"
          >
            <div className="font-semibold flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-[#2563EB] dark:text-[#4EA1FF]" />
              Add or Update BYOK AI Provider
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Provider Type</span>
                <select
                  value={aiType}
                  onChange={(e) => {
                    const next = e.target.value as AIProviderType;
                    setAiType(next);
                    setAiBaseUrl(PROVIDER_DEFAULTS[next].baseUrl);
                    setAiModel(PROVIDER_DEFAULTS[next].model);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
                >
                  {Object.entries(PROVIDER_DEFAULTS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Profile Label</span>
                <input
                  type="text"
                  value={aiName}
                  onChange={(e) => setAiName(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Model Identifier</span>
                <input
                  type="text"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">Base URL</span>
                <input
                  type="url"
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                  Key Storage Mode
                </span>
                <select
                  value={aiStorageMode}
                  onChange={(e) => setAiStorageMode(e.target.value as 'session' | 'encrypted_local')}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
                >
                  <option value="session">Session-Only (Memory / SessionStorage)</option>
                  <option value="encrypted_local">AES-GCM Passphrase Encrypted Local Vault</option>
                </select>
              </label>

              {aiType !== 'ollama' && (
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">API Key</span>
                  <input
                    type="password"
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    placeholder="sk-... or provider key"
                    className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] font-mono"
                  />
                </label>
              )}

              {aiType !== 'ollama' && aiStorageMode === 'encrypted_local' && (
                <label className="space-y-1">
                  <span className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                    Vault Passphrase (min 6 chars)
                  </span>
                  <input
                    type="password"
                    value={aiPassphrase}
                    onChange={(e) => setAiPassphrase(e.target.value)}
                    placeholder="Passphrase to encrypt key"
                    className="w-full px-2.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C]"
                  />
                </label>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14] font-semibold"
              >
                Save Provider Profile
              </button>
              <button
                type="button"
                onClick={handleTestAI}
                disabled={testingAi}
                className="px-3.5 py-2 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] font-medium"
              >
                {testingAi ? 'Testing...' : 'Test Connection'}
              </button>
              {aiStatusMsg && <span className="text-[#16A378] dark:text-[#35C89A]">{aiStatusMsg}</span>}
              {aiErrorMsg && <span className="text-[#DC4C54] dark:text-[#F16B72]">{aiErrorMsg}</span>}
            </div>
          </form>

          {/* Saved Profiles */}
          <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] overflow-hidden text-xs">
            <div className="px-4 py-2.5 border-b border-[#E6EBF0] dark:border-[#27313C] font-semibold">
              Configured AI Profiles ({aiProfiles.length})
            </div>
            {aiProfiles.length === 0 ? (
              <div className="p-5 text-center text-[#677482] dark:text-[#8B97A5]">
                No AI provider profiles configured. AI Research Assistant remains cleanly disabled.
              </div>
            ) : (
              <div className="divide-y divide-[#E6EBF0] dark:divide-[#27313C]">
                {aiProfiles.map((p) => {
                  const unlocked = Boolean(getSessionApiKey(p.id));
                  const encrypted = hasEncryptedApiKey(p.id);
                  return (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          {p.name}{' '}
                          <span className="font-mono text-[11px] font-normal text-[#677482] dark:text-[#8B97A5]">
                            ({p.providerType} · {p.model})
                          </span>
                        </div>
                        <div className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                          {p.baseUrl} ·{' '}
                          {p.providerType === 'ollama'
                            ? 'Local Endpoint'
                            : unlocked
                              ? 'Key loaded in session'
                              : encrypted
                                ? 'Encrypted key stored (locked)'
                                : 'Key not set in current session'}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete AI profile ${p.name}`}
                        onClick={() => handleDeleteAIProfile(p.id)}
                        className="p-1.5 text-[#677482] hover:text-[#DC4C54]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DATA MANAGEMENT TAB */}
      {tab === 'data' && (
        <div className="rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-4 space-y-2.5">
              <div className="font-semibold flex items-center gap-1.5">
                <Download className="w-4 h-4 text-[#2563EB] dark:text-[#4EA1FF]" />
                Export & Import Settings
              </div>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                Export your CRYPTOLENS weights, thresholds, and display preferences as JSON, or export persisted signal history to CSV.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportSettings}
                  className="px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
                >
                  Export Settings JSON
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Import JSON
                  <input type="file" accept="application/json" onChange={handleImportSettings} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={handleExportSignalCsv}
                  className="px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
                >
                  Export Signal History CSV
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] p-4 space-y-2.5">
              <div className="font-semibold flex items-center gap-1.5">
                <Database className="w-4 h-4 text-[#E6A832]" />
                Cache & Reset Controls
              </div>
              <p className="text-[11px] text-[#677482] dark:text-[#8B97A5]">
                Clear cached historical OHLCV candles from local SQLite or restore factory default indicator weights and preferences.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClearCache}
                  className="px-3 py-1.5 rounded-lg border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] font-medium"
                >
                  Clear SQLite Candle Cache
                </button>
                <button
                  type="button"
                  onClick={() => handleSavePref({ ...DEFAULT_PREFERENCES }, 'Restored default preferences')}
                  className="px-3 py-1.5 rounded-lg border border-[#F16B72]/40 text-[#DC4C54] dark:text-[#F16B72] font-medium"
                >
                  Reset Default Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
