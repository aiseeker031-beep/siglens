import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type Time,
} from 'lightweight-charts';
import { Camera, Maximize2 } from 'lucide-react';
import { toHeikinAshi } from '../../analytics/indicators';
import { formatPrice } from '../../shared/format';
import type {
  Candle,
  IndicatorSeriesPack,
  SignalSetupPlan,
  SupportResistanceZone,
} from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

export type Chart2DStyle = 'candlestick' | 'bars' | 'line' | 'area' | 'heikin_ashi';

interface Chart2DProps {
  candles: Candle[];
  series: IndicatorSeriesPack | null;
  supportResistance: SupportResistanceZone[];
  signalSetup?: SignalSetupPlan | null;
  symbol: string;
  timeframe: string;
  height?: number;
}

export const Chart2D: React.FC<Chart2DProps> = ({
  candles,
  series,
  supportResistance,
  signalSetup = null,
  symbol,
  timeframe,
  height = 460,
}) => {
  const theme = useAppStore((s) => s.preferences.theme);
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [chartStyle, setChartStyle] = useState<Chart2DStyle>('candlestick');
  const [showEma20, setShowEma20] = useState(true);
  const [showEma50, setShowEma50] = useState(true);
  const [showEma200, setShowEma200] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [showVwap, setShowVwap] = useState(true);
  const [showSR, setShowSR] = useState(true);
  const [showSignalLevels, setShowSignalLevels] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  const isDark = useMemo(() => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, [theme]);

  const activeCandles = useMemo(
    () => (chartStyle === 'heikin_ashi' ? toHeikinAshi(candles) : candles),
    [candles, chartStyle],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || activeCandles.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: isDark ? '#151B23' : '#FFFFFF' },
        textColor: isDark ? '#8B97A5' : '#677482',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? '#1F2833' : '#EDF2F7' },
        horzLines: { color: isDark ? '#1F2833' : '#EDF2F7' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: isDark ? '#3E4C5E' : '#94A3B8', style: LineStyle.Dashed },
        horzLine: { color: isDark ? '#3E4C5E' : '#94A3B8', style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: isDark ? '#27313C' : '#E6EBF0',
      },
      timeScale: {
        borderColor: isDark ? '#27313C' : '#E6EBF0',
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const toTime = (ms: number) => Math.floor(ms / 1000) as Time;

    // Deduplicate sorted timestamps strictly for Lightweight Charts
    const uniqueCandles: Candle[] = [];
    const seen = new Set<number>();
    for (const c of activeCandles) {
      const sec = Math.floor(c.openTime / 1000);
      if (!seen.has(sec)) {
        seen.add(sec);
        uniqueCandles.push(c);
      }
    }

    let mainSeries: ReturnType<IChartApi['addSeries']>;

    if (chartStyle === 'candlestick' || chartStyle === 'heikin_ashi') {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#35C89A',
        downColor: '#F16B72',
        borderUpColor: '#35C89A',
        borderDownColor: '#F16B72',
        wickUpColor: '#35C89A',
        wickDownColor: '#F16B72',
      });
      mainSeries.setData(
        uniqueCandles.map((c) => ({
          time: toTime(c.openTime),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else if (chartStyle === 'bars') {
      mainSeries = chart.addSeries(BarSeries, {
        upColor: '#35C89A',
        downColor: '#F16B72',
      });
      mainSeries.setData(
        uniqueCandles.map((c) => ({
          time: toTime(c.openTime),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
    } else if (chartStyle === 'area') {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: isDark ? '#B6F36A' : '#6B9F30',
        topColor: isDark ? 'rgba(182, 243, 106, 0.24)' : 'rgba(107, 159, 48, 0.20)',
        bottomColor: 'rgba(182, 243, 106, 0.0)',
        lineWidth: 2,
      });
      mainSeries.setData(uniqueCandles.map((c) => ({ time: toTime(c.openTime), value: c.close })));
    } else {
      mainSeries = chart.addSeries(LineSeries, {
        color: isDark ? '#B6F36A' : '#6B9F30',
        lineWidth: 2,
      });
      mainSeries.setData(uniqueCandles.map((c) => ({ time: toTime(c.openTime), value: c.close })));
    }

    // Volume histogram on bottom overlay scale
    if (showVolume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volSeries.setData(
        uniqueCandles.map((c) => ({
          time: toTime(c.openTime),
          value: c.volume,
          color: c.close >= c.open ? 'rgba(53, 200, 154, 0.28)' : 'rgba(241, 107, 114, 0.28)',
        })),
      );
    }

    // Helper for indicator line overlays
    const addLineOverlay = (
      values: (number | null)[] | undefined,
      color: string,
      lineWidth: 1 | 2 = 1,
      style = LineStyle.Solid,
    ) => {
      if (!values || values.length === 0) return;
      const offset = candles.length - values.length;
      const pts: { time: Time; value: number }[] = [];
      const seenLine = new Set<number>();
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const c = candles[i + offset];
        if (v === null || !Number.isFinite(v) || !c) continue;
        const sec = Math.floor(c.openTime / 1000);
        if (seenLine.has(sec)) continue;
        seenLine.add(sec);
        pts.push({ time: sec as Time, value: v });
      }
      if (pts.length < 2) return;
      const ls = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      ls.setData(pts);
    };

    if (series) {
      if (showEma20) addLineOverlay(series.ema20, '#38BDF8', 2);
      if (showEma50) addLineOverlay(series.ema50, '#F59E0B', 2);
      if (showEma200) addLineOverlay(series.ema200, '#A78BFA', 2);
      if (showVwap) addLineOverlay(series.vwap, '#B6F36A', 1, LineStyle.Dashed);
      if (showBB) {
        addLineOverlay(series.bbUpper, 'rgba(148, 163, 184, 0.55)', 1, LineStyle.Dotted);
        addLineOverlay(series.bbLower, 'rgba(148, 163, 184, 0.55)', 1, LineStyle.Dotted);
      }
    }

    // Support & Resistance horizontal levels
    if (showSR && supportResistance.length > 0) {
      for (const z of supportResistance.slice(0, 6)) {
        mainSeries.createPriceLine({
          price: z.price,
          color: z.type === 'SUPPORT' ? 'rgba(53, 200, 154, 0.55)' : 'rgba(241, 107, 114, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${z.type === 'SUPPORT' ? 'S' : 'R'} (${z.touches})`,
        });
      }
    }

    // Structured Signal Setup price lines (Entry / SL / TP1-TP3)
    if (showSignalLevels && signalSetup && signalSetup.direction !== 'WAIT') {
      if (signalSetup.entryPrice !== null) {
        mainSeries.createPriceLine({
          price: signalSetup.entryPrice,
          color: '#B6F36A',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${signalSetup.direction} ENTRY (${signalSetup.entryMode})`,
        });
      }
      if (signalSetup.stopLoss !== null) {
        mainSeries.createPriceLine({
          price: signalSetup.stopLoss,
          color: '#F16B72',
          lineWidth: 2,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'SL',
        });
      }
      for (const tp of signalSetup.takeProfits) {
        mainSeries.createPriceLine({
          price: tp.price,
          color: '#35C89A',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: `${tp.label} (${tp.rrRatio.toFixed(0)}R)`,
        });
      }
    }

    chart.timeScale().fitContent();

    const candleBySec = new Map<number, Candle>();
    uniqueCandles.forEach((c) => candleBySec.set(Math.floor(c.openTime / 1000), c));

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverInfo(null);
        return;
      }
      const c = candleBySec.get(Number(param.time));
      if (c) {
        setHoverInfo({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      }
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [
    activeCandles,
    candles,
    chartStyle,
    height,
    isDark,
    series,
    showBB,
    showEma20,
    showEma50,
    showEma200,
    showSR,
    showSignalLevels,
    showVolume,
    showVwap,
    signalSetup,
    supportResistance,
  ]);

  const handleFit = () => chartRef.current?.timeScale().fitContent();

  const handleScreenshot = () => {
    if (!chartRef.current) return;
    const canvas = chartRef.current.takeScreenshot();
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `cryptolens-${symbol.replace('/', '-')}-${timeframe}-2d.png`;
    a.click();
  };

  const latest = activeCandles[activeCandles.length - 1];
  const displayBar = hoverInfo ?? (latest ? { open: latest.open, high: latest.high, low: latest.low, close: latest.close, volume: latest.volume } : null);

  return (
    <div className="flex flex-col">
      {/* Chart toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-2 border-b border-[#E6EBF0] dark:border-[#27313C]">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['candlestick', 'heikin_ashi', 'bars', 'line', 'area'] as Chart2DStyle[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setChartStyle(st)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                chartStyle === st
                  ? 'bg-[#17212B] text-white dark:bg-[#B6F36A] dark:text-[#0B0F14]'
                  : 'text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]'
              }`}
            >
              {st === 'heikin_ashi' ? 'Heikin-Ashi' : st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { label: 'EMA 20', active: showEma20, toggle: () => setShowEma20((v) => !v), color: '#38BDF8' },
            { label: 'EMA 50', active: showEma50, toggle: () => setShowEma50((v) => !v), color: '#F59E0B' },
            { label: 'EMA 200', active: showEma200, toggle: () => setShowEma200((v) => !v), color: '#A78BFA' },
            { label: 'VWAP', active: showVwap, toggle: () => setShowVwap((v) => !v), color: '#B6F36A' },
            { label: 'BB', active: showBB, toggle: () => setShowBB((v) => !v), color: '#94A3B8' },
            { label: 'S/R', active: showSR, toggle: () => setShowSR((v) => !v), color: '#35C89A' },
            { label: 'SL/TP', active: showSignalLevels, toggle: () => setShowSignalLevels((v) => !v), color: '#B6F36A' },
            { label: 'Vol', active: showVolume, toggle: () => setShowVolume((v) => !v), color: '#64748B' },
          ].map((ov) => (
            <button
              key={ov.label}
              type="button"
              onClick={ov.toggle}
              className={`px-2 py-1 text-xs font-mono rounded-md border transition-colors whitespace-nowrap ${
                ov.active
                  ? 'border-[#CBD5E1] dark:border-[#364352] bg-[#F1F5F9] dark:bg-[#1B232D] text-[#17212B] dark:text-[#F4F7FA]'
                  : 'border-transparent text-[#677482] dark:text-[#8B97A5] opacity-60 hover:opacity-100'
              }`}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: ov.color }}
              />
              {ov.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleFit}
            title="Auto-fit chart"
            aria-label="Auto-fit chart"
            className="p-1.5 rounded-md text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleScreenshot}
            title="Export PNG screenshot"
            aria-label="Export PNG screenshot"
            className="p-1.5 rounded-md text-[#677482] dark:text-[#8B97A5] hover:bg-[#F1F5F9] dark:hover:bg-[#1B232D]"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live OHLCV legend strip */}
      {displayBar && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-[#677482] dark:text-[#8B97A5] pb-2">
          <span className="font-semibold text-[#17212B] dark:text-[#F4F7FA]">
            {symbol} · {timeframe}
          </span>
          <span>O {formatPrice(displayBar.open, precision)}</span>
          <span>H {formatPrice(displayBar.high, precision)}</span>
          <span>L {formatPrice(displayBar.low, precision)}</span>
          <span
            className={
              displayBar.close >= displayBar.open
                ? 'text-[#16A378] dark:text-[#35C89A]'
                : 'text-[#DC4C54] dark:text-[#F16B72]'
            }
          >
            C {formatPrice(displayBar.close, precision)}
          </span>
          <span>Vol {displayBar.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        </div>
      )}

      <div ref={containerRef} data-testid="chart-2d-canvas" className="w-full rounded-lg overflow-hidden" />
    </div>
  );
};
