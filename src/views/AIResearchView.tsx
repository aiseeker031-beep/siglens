import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  Send,
  Settings,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import { formatPercent, formatPrice, signalBgClass, signalLabel } from '../shared/format';
import type { AIProviderProfile, ScreenerRow } from '../shared/types';
import { useAppStore } from '../store/useAppStore';
import {
  getSessionApiKey,
  hasEncryptedApiKey,
  unlockEncryptedApiKey,
} from '../utils/cryptoVault';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelUsed?: string;
  contextUsed?: Record<string, unknown>;
  screenerResults?: {
    interpretedRules: string[];
    matchedCount: number;
    scannedUniverse: number;
    matches: ScreenerRow[];
  } | null;
  timestamp: number;
}

const SUGGESTED_PROMPTS = [
  { mode: 'explain' as const, text: 'Summarize the confirmed technical setup, conflicting indicators, and invalidation levels for this asset.' },
  { mode: 'explain' as const, text: 'Explain the current market regime, volatility condition, and key support/resistance zones.' },
  { mode: 'nl_screen' as const, text: 'Find USDT pairs with RSI below 40 and positive MACD histogram' },
  { mode: 'nl_screen' as const, text: 'Show bullish assets above EMA 50 with high volume RVOL above 1.5' },
];

export const AIResearchView: React.FC = () => {
  const exchange = useAppStore((s) => s.exchange);
  const marketType = useAppStore((s) => s.marketType);
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const selectMarket = useAppStore((s) => s.selectMarket);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [profiles, setProfiles] = useState<AIProviderProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [mode, setMode] = useState<'explain' | 'nl_screen'>('explain');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [expandedContextId, setExpandedContextId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unlock encrypted key modal state
  const [unlockPassphrase, setUnlockPassphrase] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [keyVersion, setKeyVersion] = useState(0);

  useEffect(() => {
    api
      .getAIProfiles()
      .then((res) => {
        const enabled = res.profiles.filter((p) => p.enabled);
        setProfiles(enabled);
        if (enabled.length > 0) setSelectedProfileId(enabled[0].id);
      })
      .catch(() => setProfiles([]));
  }, []);

  const activeProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;
  const sessionKey = activeProfile ? getSessionApiKey(activeProfile.id) : '';
  const hasEncrypted = activeProfile ? hasEncryptedApiKey(activeProfile.id) : false;
  const needsKey = Boolean(activeProfile && activeProfile.providerType !== 'ollama' && !sessionKey);

  // Use keyVersion to re-evaluate sessionKey after unlock
  void keyVersion;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;
    setUnlockError(null);
    try {
      await unlockEncryptedApiKey(activeProfile.id, unlockPassphrase);
      setUnlockPassphrase('');
      setKeyVersion((v) => v + 1);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Unable to unlock key');
    }
  };

  const submitPrompt = async (textOverride?: string, modeOverride?: 'explain' | 'nl_screen') => {
    if (!activeProfile) return;
    const finalPrompt = (textOverride ?? prompt).trim();
    const finalMode = modeOverride ?? mode;
    if (!finalPrompt) return;

    const apiKey = getSessionApiKey(activeProfile.id);
    if (activeProfile.providerType !== 'ollama' && !apiKey) {
      setError('API key is locked or missing for this session. Unlock your key or add it in Settings → AI Providers.');
      return;
    }

    setError(null);
    setSending(true);
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: finalPrompt,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!textOverride) setPrompt('');

    try {
      const res = await api.analyzeWithAI({
        prompt: finalPrompt,
        mode: finalMode,
        canonicalId: `${exchange}:${marketType}:${symbol}`,
        timeframe,
        provider: {
          providerType: activeProfile.providerType,
          model: activeProfile.model,
          baseUrl: activeProfile.baseUrl,
          apiKey: apiKey || undefined,
          temperature: activeProfile.temperature,
          maxTokens: activeProfile.maxTokens,
          timeoutMs: activeProfile.timeoutMs,
        },
      });
      const aiMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: res.response,
        modelUsed: res.modelUsed,
        contextUsed: res.contextUsed,
        screenerResults: res.screenerResults,
        timestamp: res.timestamp,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI provider request failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#047857]" />
            Optional AI Research Assistant (BYOK)
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Strictly optional Bring-Your-Own-Key assistant grounded exclusively in SIGLENS deterministic signals, market context, and executable screener rules.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setActiveSection('settings')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E6E8EE] bg-[#FFFFFF] text-xs font-medium"
        >
          <Settings className="w-3.5 h-3.5" />
          Manage AI Providers
        </button>
      </div>

      {/* Honest disabled state when no BYOK profile exists */}
      {profiles.length === 0 ? (
        <div className="rounded-xl border border-[#E6E8EE] bg-[#FFFFFF] p-8 text-center space-y-3">
          <div className="mx-auto w-11 h-11 rounded-xl bg-[#121814]/10 flex items-center justify-center text-[#047857]">
            <KeyRound className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold">AI Research Assistant Is Currently Disabled</h2>
          <p className="text-xs text-[#64748B] max-w-lg mx-auto leading-relaxed">
            SIGLENS runs 100% deterministically with zero paid keys required. To enable optional AI narrative explanations or natural-language screening, configure your own API key (OpenAI, Anthropic, Gemini, Groq, OpenAI-compatible, or local Ollama) in Settings. Keys stay in session memory or your passphrase-encrypted browser vault.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setActiveSection('settings')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg sig-btn-primary text-xs font-semibold"
            >
              Configure BYOK Provider in Settings
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active Provider + Mode Controls */}
          <div className="rounded-xl border border-[#E6E8EE] bg-[#FFFFFF] p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[#64748B]">Provider:</span>
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E6E8EE] bg-[#F2F4F7] font-medium"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.model})
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1 rounded-lg border border-[#E6E8EE] bg-[#F2F4F7] p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('explain')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                    mode === 'explain'
                      ? 'sig-btn-primary'
                      : 'text-[#64748B]'
                  }`}
                >
                  Explain {symbol} ({timeframe})
                </button>
                <button
                  type="button"
                  onClick={() => setMode('nl_screen')}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                    mode === 'nl_screen'
                      ? 'sig-btn-primary'
                      : 'text-[#64748B]'
                  }`}
                >
                  Natural-Language Screener
                </button>
              </div>
            </div>

            <div className="text-[11px] text-[#64748B]">
              Context Anchor: <strong className="text-[#0A0D14]">{symbol}</strong> ({exchange} · {timeframe})
            </div>
          </div>

          {/* Unlock Encrypted Key Prompt */}
          {needsKey && (
            <div className="rounded-xl border border-[#E6A832]/40 bg-[#E6A832]/10 p-4 text-xs space-y-2.5">
              <div className="font-semibold flex items-center gap-1.5 text-[#B7791F]">
                <Lock className="w-4 h-4" />
                {hasEncrypted
                  ? 'Unlock Passphrase-Encrypted API Key'
                  : 'Session API Key Required'}
              </div>
              {hasEncrypted ? (
                <form onSubmit={handleUnlock} className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={unlockPassphrase}
                    onChange={(e) => setUnlockPassphrase(e.target.value)}
                    placeholder="Enter your encryption passphrase"
                    className="px-3 py-1.5 rounded-lg border border-[#E6E8EE] bg-[#FFFFFF] w-64"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg sig-btn-primary font-semibold"
                  >
                    Unlock for Session
                  </button>
                  {unlockError && <span className="text-[#BE123C]">{unlockError}</span>}
                </form>
              ) : (
                <p className="text-[#64748B]">
                  This profile uses session-only storage. Re-enter your API key under Settings → AI Providers to activate it for this browser session.
                </p>
              )}
            </div>
          )}

          {/* Suggested Analytical Prompts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUGGESTED_PROMPTS.map((sp, i) => (
              <button
                key={i}
                type="button"
                disabled={sending || needsKey}
                onClick={() => {
                  setMode(sp.mode);
                  submitPrompt(sp.text, sp.mode);
                }}
                className="text-left rounded-lg border border-[#E6E8EE] bg-[#FFFFFF] hover:border-[#059669] p-3 text-xs transition-colors disabled:opacity-50"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#047857]">
                  {sp.mode === 'explain' ? 'Signal Analysis' : 'Deterministic NL Screener'}
                </div>
                <div className="mt-1 text-[#0A0D14]">{sp.text}</div>
              </button>
            ))}
          </div>

          {/* Conversation Thread */}
          <div className="rounded-xl border border-[#E6E8EE] bg-[#FFFFFF] p-4 space-y-4 min-h-[280px]">
            {messages.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#64748B]">
                Ask a technical question about {symbol} or run a natural-language market screen. Every response includes the exact verified JSON context supplied to the model.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-lg p-3.5 text-xs space-y-2 ${
                    m.role === 'user'
                      ? 'bg-[#121814]/8 border border-[#059669]/20 ml-8'
                      : 'bg-[#F2F4F7] border border-[#E6E8EE] mr-4'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                    <span className="font-semibold uppercase">
                      {m.role === 'user' ? 'Analyst Query' : `AI Research (${m.modelUsed ?? 'Model'})`}
                    </span>
                    <span className="font-mono">{new Date(m.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>

                  {/* Deterministic Screener Results */}
                  {m.screenerResults && (
                    <div className="mt-3 rounded-lg border border-[#E6E8EE] bg-[#FFFFFF] p-3 space-y-2">
                      <div className="font-semibold">
                        Verified Deterministic Matches: {m.screenerResults.matchedCount} /{' '}
                        {m.screenerResults.scannedUniverse}
                      </div>
                      {m.screenerResults.interpretedRules.length > 0 && (
                        <div className="text-[11px] text-[#64748B]">
                          Parsed Rules: {m.screenerResults.interpretedRules.join(' · ')}
                        </div>
                      )}
                      {m.screenerResults.matches.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-[#E6E8EE] text-[#64748B]">
                                <th className="text-left py-1.5">Pair</th>
                                <th className="text-right py-1.5">Price</th>
                                <th className="text-right py-1.5">24h %</th>
                                <th className="text-left py-1.5 pl-3">Signal</th>
                                <th className="text-right py-1.5">RSI</th>
                                <th className="text-right py-1.5">RVOL</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#ECEFF4]">
                              {m.screenerResults.matches.slice(0, 12).map((row) => (
                                <tr
                                  key={row.canonicalId}
                                  onClick={() => selectMarket(row.exchange, row.marketType, row.displaySymbol, true)}
                                  className="cursor-pointer hover:bg-[#F2F4F7]"
                                >
                                  <td className="py-1.5 font-semibold">{row.displaySymbol}</td>
                                  <td className="py-1.5 text-right font-mono">${formatPrice(row.price, precision)}</td>
                                  <td className="py-1.5 text-right font-mono">{formatPercent(row.change24hPct)}</td>
                                  <td className="py-1.5 pl-3">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${signalBgClass(row.classification)}`}>
                                      {signalLabel(row.classification)}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-right font-mono">{row.rsi14?.toFixed(1) ?? '—'}</td>
                                  <td className="py-1.5 text-right font-mono">{row.rvol20 ? `${row.rvol20.toFixed(2)}x` : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Grounded Context Inspector */}
                  {m.contextUsed && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedContextId(expandedContextId === m.id ? null : m.id)
                        }
                        className="inline-flex items-center gap-1 text-[11px] text-[#047857] hover:underline"
                      >
                        {expandedContextId === m.id ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        Inspect Verified Source Data JSON
                      </button>
                      {expandedContextId === m.id && (
                        <pre className="mt-2 p-2.5 rounded bg-[#0B0F14] text-[#D8E1EB] font-mono text-[10px] overflow-x-auto max-h-60">
                          {JSON.stringify(m.contextUsed, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-[#FB7185]/40 bg-[#FB7185]/10 px-3.5 py-2 text-xs text-[#BE123C]">
              {error}
            </div>
          )}

          {/* Input Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPrompt();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={prompt}
              disabled={sending || needsKey}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === 'explain'
                  ? `Ask about ${symbol} (${timeframe}) indicators, regime, or invalidation...`
                  : 'Describe a deterministic screen (e.g. "RSI below 35 above EMA 200")...'
              }
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E6E8EE] bg-[#FFFFFF] text-xs"
            />
            <button
              type="submit"
              disabled={sending || needsKey || !prompt.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#121814] text-white text-xs font-semibold disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Analyzing...' : 'Analyze'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
