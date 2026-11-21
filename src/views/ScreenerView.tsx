import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Download,
  Filter,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { filterScreenerRows } from '../analytics/screenerRules';
import { api } from '../services/api';
import { BUILT_IN_SCREENER_PRESETS, EXCHANGE_LABELS, QUICK_TIMEFRAMES } from '../shared/constants';
import {
  exportToCsv,
  formatCompactUsd,
  formatNumber,
  formatPercent,
  formatPrice,
  formatTimestamp,
  signalBgClass,
  signalLabel,
} from '../shared/format';
import type {
  ExchangeId,
  MarketType,
  ScreenerFilters,
  ScreenerPreset,
  ScreenerRow,
  SignalClassification,
  Timeframe,
} from '../shared/types';
import { useAppStore } from '../store/useAppStore';
import { SkeletonBlock } from '../components/ui/SignalMeter';

type SortKey =
  | 'directionalScore'
  | 'change24hPct'
  | 'volume24hUsd'
  | 'rsi14'
  | 'adx14'
  | 'rvol20'
  | 'atrPct'
  | 'agreementPct'
  | 'price';

export const ScreenerView: React.FC = () => {
  const globalExchange = useAppStore((s) => s.exchange);
  const globalMarketType = useAppStore((s) => s.marketType);
  const globalTimeframe = useAppStore((s) => s.timeframe);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const timezone = useAppStore((s) => s.preferences.timezone);
  const denseMode = useAppStore((s) => s.preferences.denseMode);
  const watchlist = useAppStore((s) => s.watchlist);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);
  const selectMarket = useAppStore((s) => s.selectMarket);

  const [scanExchange, setScanExchange] = useState<ExchangeId>(globalExchange);
  const [scanMarketType, setScanMarketType] = useState<MarketType>(globalMarketType);
  const [scanTimeframe, setScanTimeframe] = useState<Timeframe>(
    QUICK_TIMEFRAMES.includes(globalTimeframe) ? globalTimeframe : '1h',
  );

  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [scanMeta, setScanMeta] = useState<{
    totalScanned: number;
    universeSize: number;
    completedCount: number;
    inProgress: boolean;
    scannedAt: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customPresets, setCustomPresets] = useState<ScreenerPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [presetCategory, setPresetCategory] = useState<string>('ALL');
  const [filters, setFilters] = useState<ScreenerFilters>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showFiltersPanel, setShowFiltersPanel] = useState(true);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('directionalScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const allPresets = useMemo(
    () => [...BUILT_IN_SCREENER_PRESETS, ...customPresets],
    [customPresets],
  );

  const presetCategories = useMemo(
    () => ['ALL', ...Array.from(new Set(allPresets.map((p) => p.category)))],
    [allPresets],
  );

  const loadPresets = async () => {
    try {
      const res = await api.getScreenerPresets();
      setCustomPresets(res.presets.filter((p) => !p.isBuiltIn));
    } catch {
      // built-in presets remain available
    }
  };

  const loadScreener = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getScreener(scanExchange, scanMarketType, scanTimeframe, forceRefresh);
      setRows(res.rows);
      setScanMeta({
        totalScanned: res.totalScanned,
        universeSize: res.universeSize,
        completedCount: res.completedCount,
        inProgress: res.inProgress,
        scannedAt: res.scannedAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to execute market scan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPresets();
  }, []);

  useEffect(() => {
    loadScreener(false);
  }, [scanExchange, scanMarketType, scanTimeframe]);

  const applyPreset = (preset: ScreenerPreset) => {
    if (activePresetId === preset.id) {
      setActivePresetId(null);
      setFilters({});
      return;
    }
    setActivePresetId(preset.id);
    setFilters({ ...preset.filters });
  };

  const resetFilters = () => {
    setActivePresetId(null);
    setFilters({});
    setSearchQuery('');
  };

  const handleSaveCustomPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    setSavingPreset(true);
    try {
      const res = await api.saveScreenerPreset({
        name: newPresetName.trim(),
        description: newPresetDesc.trim() || 'Custom multi-indicator filter configuration.',
        category: 'Custom',
        filters: filters as Record<string, unknown>,
      });
      setCustomPresets((prev) => [res.preset, ...prev]);
      setActivePresetId(res.preset.id);
      setNewPresetName('');
      setNewPresetDesc('');
      setSaveModalOpen(false);
    } catch {
      // keep modal open on error
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeleteCustomPreset = async (id: string) => {
    try {
      await api.deleteScreenerPreset(id);
      setCustomPresets((prev) => prev.filter((p) => p.id !== id));
      if (activePresetId === id) {
        setActivePresetId(null);
        setFilters({});
      }
    } catch {
      // ignore
    }
  };

  const filteredRows = useMemo(() => {
    const matched = filterScreenerRows(rows, filters);
    const searched = searchQuery.trim()
      ? matched.filter((r) =>
          r.displaySymbol.toLowerCase().includes(searchQuery.trim().toLowerCase()),
        )
      : matched;

    return [...searched].sort((a, b) => {
      const av = a[sortKey] ?? -999999;
      const bv = b[sortKey] ?? -999999;
      return sortDir === 'desc' ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
  }, [rows, filters, searchQuery, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleClassification = (cls: SignalClassification) => {
    setActivePresetId(null);
    setFilters((prev) => {
      const cur = prev.classifications ?? [];
      const next = cur.includes(cls) ? cur.filter((c) => c !== cls) : [...cur, cls];
      return { ...prev, classifications: next.length ? next : undefined };
    });
  };

  const updateNumFilter = (key: keyof ScreenerFilters, raw: string) => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      [key]: raw === '' ? undefined : Number(raw),
    }));
  };

  const updateBoolFilter = (key: keyof ScreenerFilters, raw: string) => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      [key]: raw === 'ANY' ? undefined : raw === 'TRUE',
    }));
  };

  const handleExportCsv = () => {
    exportToCsv(
      `siglens-screener-${scanExchange}-${scanTimeframe}.csv`,
      [
        'Symbol',
        'Exchange',
        'MarketType',
        'Timeframe',
        'Price',
        '24h Change %',
        '24h Volume USD',
        'Signal',
        'Score',
        'Agreement %',
        'RSI 14',
        'ADX 14',
        'RVOL 20',
        'ATR %',
        'Regime',
      ],
      filteredRows.map((r) => [
        r.displaySymbol,
        r.exchange,
        r.marketType,
        r.timeframe,
        r.price,
        r.change24hPct.toFixed(2),
        Math.round(r.volume24hUsd),
        r.classification,
        r.directionalScore.toFixed(1),
        r.agreementPct,
        r.rsi14?.toFixed(2) ?? '',
        r.adx14?.toFixed(2) ?? '',
        r.rvol20?.toFixed(2) ?? '',
        r.atrPct?.toFixed(2) ?? '',
        r.regime,
      ]),
    );
  };

  const visiblePresets = useMemo(
    () =>
      presetCategory === 'ALL'
        ? allPresets
        : allPresets.filter((p) => p.category === presetCategory),
    [allPresets, presetCategory],
  );

  const rowPad = denseMode ? 'py-1.5' : 'py-2.5';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Advanced Crypto Screener</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Deterministic multi-indicator filtering across {scanMeta?.totalScanned ?? 0} real markets on{' '}
            {EXCHANGE_LABELS[scanExchange]} ({scanMarketType}, {scanTimeframe}).
            {scanMeta?.scannedAt
              ? ` Last scan: ${formatTimestamp(scanMeta.scannedAt, timezone, false)}.`
              : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Screener exchange"
            value={scanExchange}
            onChange={(e) => {
              const ex = e.target.value as ExchangeId;
              setScanExchange(ex);
              if (ex === 'stocks') setScanMarketType('equity');
              else if (ex === 'cfds') setScanMarketType('cfd');
              else if (ex !== 'bybit' || scanMarketType === 'equity' || scanMarketType === 'cfd') setScanMarketType('spot');
            }}
            className="px-2.5 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#FFFFFF]"
          >
            <option value="binance">Binance</option>
            <option value="bybit">Bybit</option>
            <option value="kraken">Kraken</option>
            <option value="coinbase">Coinbase</option>
            <option value="stocks">US Stocks</option>
            <option value="cfds">Global CFDs</option>
          </select>

          <select
            aria-label="Screener market type"
            value={scanMarketType}
            onChange={(e) => setScanMarketType(e.target.value as MarketType)}
            className="px-2.5 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#FFFFFF]"
          >
            {scanExchange === 'stocks' ? (
              <option value="equity">Equity</option>
            ) : scanExchange === 'cfds' ? (
              <option value="cfd">CFD</option>
            ) : (
              <>
                <option value="spot">Spot</option>
                {scanExchange === 'bybit' && <option value="perpetual">Perpetual</option>}
              </>
            )}
          </select>

          <select
            aria-label="Screener timeframe"
            value={scanTimeframe}
            onChange={(e) => setScanTimeframe(e.target.value as Timeframe)}
            className="px-2.5 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#FFFFFF]"
          >
            {QUICK_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowFiltersPanel((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#FFFFFF] font-medium"
          >
            <Filter className="w-3.5 h-3.5" />
            {showFiltersPanel ? 'Hide Filters' : 'Show Filters'}
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#FFFFFF] font-medium disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>

          <button
            type="button"
            onClick={() => loadScreener(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg sig-btn-primary font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Rescan
          </button>
        </div>
      </div>

      {/* Built-in & Custom Executable Presets */}
      <div className="rounded-xl border border-[#ECEFF4] bg-[#FFFFFF] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold mr-1">Presets ({allPresets.length}):</span>
            {presetCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setPresetCategory(cat)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  presetCategory === cat
                    ? 'sig-btn-primary'
                    : 'bg-[#F6EFE6] text-[#64748B] hover:text-[#0A0D14]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSaveModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#ECEFF4] text-[11px] font-medium hover:bg-[#F6EFE6]"
            >
              <Plus className="w-3 h-3" />
              Save Custom Preset
            </button>
            {(activePresetId || Object.keys(filters).length > 0) && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-[#E11D48] hover:bg-[#F16B72]/10"
              >
                <X className="w-3 h-3" />
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
          {visiblePresets.map((preset) => {
            const active = activePresetId === preset.id;
            const matchCount = filterScreenerRows(rows, preset.filters).length;
            return (
              <div
                key={preset.id}
                className={`group relative rounded-lg border p-2.5 text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[#2563EB] bg-[#2563EB]/8'
                    : 'border-[#ECEFF4] bg-[#F6EFE6] hover:border-[#2563EB]/50'
                }`}
                onClick={() => applyPreset(preset)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold truncate">{preset.name}</span>
                  <span className="font-mono text-[11px] font-semibold tabular-nums text-[#2563EB]">
                    {matchCount}
                  </span>
                </div>
                <p className="text-[10px] text-[#64748B] line-clamp-2 mt-1">
                  {preset.description}
                </p>
                {!preset.isBuiltIn && (
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCustomPreset(preset.id);
                    }}
                    className="absolute top-1.5 right-6 p-0.5 text-[#64748B] hover:text-[#E11D48] opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Multi-category Rule Builder */}
      {showFiltersPanel && (
        <div className="rounded-xl border border-[#ECEFF4] bg-[#FFFFFF] p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* Market */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                Market & Liquidity
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search symbol (e.g. BTC)"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="any"
                  value={filters.minChange24h ?? ''}
                  onChange={(e) => updateNumFilter('minChange24h', e.target.value)}
                  placeholder="Min 24h %"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
                <input
                  type="number"
                  step="any"
                  value={filters.maxChange24h ?? ''}
                  onChange={(e) => updateNumFilter('maxChange24h', e.target.value)}
                  placeholder="Max 24h %"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
              </div>
              <input
                type="number"
                step="any"
                value={filters.minVolume24h ?? ''}
                onChange={(e) => updateNumFilter('minVolume24h', e.target.value)}
                placeholder="Min 24h Volume (USD)"
                className="w-full px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
              />
            </div>

            {/* Trend */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                Trend Structure
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['aboveEma20', 'EMA 20'],
                    ['aboveEma50', 'EMA 50'],
                    ['aboveEma200', 'EMA 200'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="space-y-1">
                    <span className="block text-[10px] text-[#64748B]">{label}</span>
                    <select
                      value={
                        filters[field] === undefined ? 'ANY' : filters[field] ? 'TRUE' : 'FALSE'
                      }
                      onChange={(e) => updateBoolFilter(field, e.target.value)}
                      className="w-full px-1.5 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
                    >
                      <option value="ANY">Any</option>
                      <option value="TRUE">Above</option>
                      <option value="FALSE">Below</option>
                    </select>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="1"
                  value={filters.minAdx ?? ''}
                  onChange={(e) => updateNumFilter('minAdx', e.target.value)}
                  placeholder="Min ADX 14"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
                <select
                  aria-label="EMA cross filter"
                  value={filters.emaCross ?? 'ANY'}
                  onChange={(e) => {
                    setActivePresetId(null);
                    setFilters((prev) => ({
                      ...prev,
                      emaCross: e.target.value === 'ANY' ? undefined : e.target.value,
                    }));
                  }}
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
                >
                  <option value="ANY">EMA Cross: Any</option>
                  <option value="GOLDEN">Golden / Bullish</option>
                  <option value="DEATH">Death / Bearish</option>
                </select>
              </div>
            </div>

            {/* Momentum */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                Momentum & Divergence
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="1"
                  value={filters.minRsi ?? ''}
                  onChange={(e) => updateNumFilter('minRsi', e.target.value)}
                  placeholder="Min RSI 14"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
                <input
                  type="number"
                  step="1"
                  value={filters.maxRsi ?? ''}
                  onChange={(e) => updateNumFilter('maxRsi', e.target.value)}
                  placeholder="Max RSI 14"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="MACD histogram direction"
                  value={filters.macdHistDirection ?? 'ANY'}
                  onChange={(e) => {
                    setActivePresetId(null);
                    setFilters((prev) => ({
                      ...prev,
                      macdHistDirection:
                        e.target.value === 'ANY'
                          ? undefined
                          : (e.target.value as 'POSITIVE' | 'NEGATIVE'),
                    }));
                  }}
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
                >
                  <option value="ANY">MACD Hist: Any</option>
                  <option value="POSITIVE">Positive (&gt; 0)</option>
                  <option value="NEGATIVE">Negative (&lt; 0)</option>
                </select>
                <select
                  aria-label="RSI divergence"
                  value={filters.rsiDivergence ?? 'ANY'}
                  onChange={(e) => {
                    setActivePresetId(null);
                    setFilters((prev) => ({
                      ...prev,
                      rsiDivergence:
                        e.target.value === 'ANY'
                          ? undefined
                          : (e.target.value as 'BULLISH' | 'BEARISH'),
                    }));
                  }}
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
                >
                  <option value="ANY">RSI Div: Any</option>
                  <option value="BULLISH">Bullish Div</option>
                  <option value="BEARISH">Bearish Div</option>
                </select>
              </div>
            </div>

            {/* Volume & Volatility */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                Volume, Volatility & Structure
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={filters.minRvol ?? ''}
                  onChange={(e) => updateNumFilter('minRvol', e.target.value)}
                  placeholder="Min RVOL"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
                <input
                  type="number"
                  step="0.1"
                  value={filters.minAtrPct ?? ''}
                  onChange={(e) => updateNumFilter('minAtrPct', e.target.value)}
                  placeholder="Min ATR %"
                  className="px-2 py-1.5 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono"
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {(
                  [
                    ['bbSqueeze', 'BB Squeeze'],
                    ['bbExpanding', 'BB Expanding'],
                    ['nearSupport', 'Near Support'],
                    ['nearResistance', 'Near Resistance'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(filters[key])}
                      onChange={(e) => {
                        setActivePresetId(null);
                        setFilters((prev) => ({
                          ...prev,
                          [key]: e.target.checked ? true : undefined,
                        }));
                      }}
                      className="rounded border-[#27313C]"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Signal Class Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#ECEFF4] text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[#64748B] mr-1">
                Signal Classification:
              </span>
              {(
                [
                  'STRONG_BULLISH',
                  'BULLISH',
                  'NEUTRAL',
                  'BEARISH',
                  'STRONG_BEARISH',
                ] as SignalClassification[]
              ).map((cls) => {
                const selected = filters.classifications?.includes(cls) ?? false;
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => toggleClassification(cls)}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-opacity ${
                      selected
                        ? signalBgClass(cls)
                        : 'border border-[#ECEFF4] text-[#64748B] opacity-75 hover:opacity-100'
                    }`}
                  >
                    {signalLabel(cls)}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#64748B]">Min Agreement %:</span>
              <input
                type="number"
                min={0}
                max={100}
                value={filters.minAgreementPct ?? ''}
                onChange={(e) => updateNumFilter('minAgreementPct', e.target.value)}
                placeholder="0"
                className="w-16 px-2 py-1 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6] font-mono text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="rounded-xl border border-[#ECEFF4] bg-[#FFFFFF] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#ECEFF4] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-semibold">
            Matching Markets: <span className="font-mono tabular-nums">{filteredRows.length}</span>{' '}
            <span className="font-normal text-[#64748B]">
              / {rows.length} scanned ({scanMeta?.inProgress ? 'scan updating...' : 'confirmed close snapshots'})
            </span>
          </div>
          {error && <span className="text-[#E11D48]">{error}</span>}
        </div>

        {loading && rows.length === 0 ? (
          <div className="p-4 space-y-2">
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#ECEFF4] text-[11px] text-[#64748B] bg-[#F6EFE6]">
                  <th className="text-left px-3 py-2 font-medium w-8" />
                  <th className="text-left px-3 py-2 font-medium">Pair</th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('price')} className="inline-flex items-center gap-1">
                      Price <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('change24hPct')} className="inline-flex items-center gap-1">
                      24h % <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('volume24hUsd')} className="inline-flex items-center gap-1">
                      24h Vol <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Signal</th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('directionalScore')} className="inline-flex items-center gap-1">
                      Score <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('agreementPct')} className="inline-flex items-center gap-1">
                      Agree <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('rsi14')} className="inline-flex items-center gap-1">
                      RSI <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('adx14')} className="inline-flex items-center gap-1">
                      ADX <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('rvol20')} className="inline-flex items-center gap-1">
                      RVOL <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 font-medium">
                    <button type="button" onClick={() => toggleSort('atrPct')} className="inline-flex items-center gap-1">
                      ATR% <ArrowDownUp className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Regime & Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECEFF4]">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-8 text-center text-[#64748B]">
                      No assets match the current filter combination. Clear one or more rules or try another timeframe.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const inWatchlist = watchlist.includes(row.canonicalId);
                    const flags: string[] = [];
                    if (row.bbSqueeze) flags.push('BB Squeeze');
                    if (row.nearSupport) flags.push('Near S');
                    if (row.nearResistance) flags.push('Near R');
                    if (row.macdCross !== 'NONE') flags.push(`MACD ${row.macdCross === 'BULLISH' ? '↑' : '↓'}`);
                    if (row.rsiDivergence !== 'NONE') flags.push(`RSI ${row.rsiDivergence === 'BULLISH' ? 'Bull' : 'Bear'} Div`);

                    return (
                      <tr
                        key={row.canonicalId}
                        onClick={() => selectMarket(row.exchange, row.marketType, row.displaySymbol, true)}
                        className="hover:bg-[#F6EFE6] cursor-pointer transition-colors"
                      >
                        <td className={`px-3 ${rowPad}`} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            aria-label={`Toggle ${row.displaySymbol} watchlist`}
                            onClick={() => toggleWatchlist(row.canonicalId)}
                            className="p-1 text-[#64748B] hover:text-[#E6A832]"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                inWatchlist ? 'fill-[#E6A832] text-[#E6A832]' : ''
                              }`}
                            />
                          </button>
                        </td>
                        <td className={`px-3 ${rowPad} font-semibold whitespace-nowrap`}>
                          <div>{row.displaySymbol}</div>
                          <div className="text-[10px] font-normal text-[#64748B]">
                            {EXCHANGE_LABELS[row.exchange]} · {row.marketType}
                          </div>
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums`}>
                          ${formatPrice(row.price, precision)}
                        </td>
                        <td
                          className={`px-3 ${rowPad} text-right font-mono tabular-nums font-medium ${
                            row.change24hPct >= 0
                              ? 'text-[#16A378]'
                              : 'text-[#E11D48]'
                          }`}
                        >
                          {formatPercent(row.change24hPct)}
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums text-[#64748B]`}>
                          {formatCompactUsd(row.volume24hUsd)}
                        </td>
                        <td className={`px-3 ${rowPad} whitespace-nowrap`}>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${signalBgClass(row.classification)}`}>
                            {signalLabel(row.classification)}
                          </span>
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums font-semibold`}>
                          {row.directionalScore > 0 ? `+${row.directionalScore.toFixed(1)}` : row.directionalScore.toFixed(1)}
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums`}>
                          {row.agreementPct}%
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums`}>
                          {formatNumber(row.rsi14, 1)}
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums`}>
                          {formatNumber(row.adx14, 1)}
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums`}>
                          {row.rvol20 !== null ? `${row.rvol20.toFixed(2)}x` : '—'}
                        </td>
                        <td className={`px-3 ${rowPad} text-right font-mono tabular-nums`}>
                          {row.atrPct !== null ? `${row.atrPct.toFixed(2)}%` : '—'}
                        </td>
                        <td className={`px-3 ${rowPad}`}>
                          <div className="text-[11px] truncate max-w-[180px]">{row.regime}</div>
                          {flags.length > 0 && (
                            <div className="text-[10px] text-[#2563EB] truncate max-w-[180px]">
                              {flags.join(' · ')}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Save Custom Preset Modal */}
      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSaveCustomPreset}
            className="w-full max-w-md rounded-xl border border-[#ECEFF4] bg-[#FFFFFF] p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Save Custom Screener Preset</h2>
              <button type="button" onClick={() => setSaveModalOpen(false)}>
                <X className="w-4 h-4 text-[#64748B]" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block mb-1 font-medium">Preset Name</label>
                <input
                  type="text"
                  required
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="e.g. Breakout Momentum RVOL 2x"
                  className="w-full px-3 py-2 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
                />
              </div>
              <div>
                <label className="block mb-1 font-medium">Description</label>
                <textarea
                  rows={2}
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  placeholder="Brief note on what this filter identifies"
                  className="w-full px-3 py-2 rounded-lg border border-[#ECEFF4] bg-[#F6EFE6]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSaveModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-[#ECEFF4]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPreset}
                className="px-3.5 py-1.5 rounded-lg sig-btn-primary font-semibold"
              >
                {savingPreset ? 'Saving...' : 'Save Preset'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
