import { BUILT_IN_SCREENER_PRESETS } from '../shared/constants';
import type { ScreenerFilters, ScreenerRow } from '../shared/types';

/**
 * Deterministic filter evaluator for the Advanced Crypto Screener.
 * Executes arbitrary combined filter rules and all 20 built-in presets against real ScreenerRows.
 */
export function filterScreenerRows(rows: ScreenerRow[], rawFilters: ScreenerFilters): ScreenerRow[] {
  let filters: ScreenerFilters = { ...rawFilters };
  if (rawFilters.presetId) {
    const preset = BUILT_IN_SCREENER_PRESETS.find((p) => p.id === rawFilters.presetId);
    if (preset) {
      filters = { ...preset.filters, ...rawFilters };
    }
  }

  return rows.filter((r) => {
    if (filters.exchange && filters.exchange !== 'all' && r.exchange !== filters.exchange) return false;
    if (filters.marketType && filters.marketType !== 'all' && r.marketType !== filters.marketType) return false;
    if (filters.quoteAsset && filters.quoteAsset !== 'ALL' && r.quoteAsset !== filters.quoteAsset) return false;

    if (filters.minPrice !== undefined && r.price < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && r.price > filters.maxPrice) return false;
    if (filters.minChange24h !== undefined && r.change24hPct < filters.minChange24h) return false;
    if (filters.maxChange24h !== undefined && r.change24hPct > filters.maxChange24h) return false;
    if (filters.minVolume24h !== undefined && r.volume24hUsd < filters.minVolume24h) return false;

    if (filters.minRsi !== undefined && (r.rsi14 === null || r.rsi14 < filters.minRsi)) return false;
    if (filters.maxRsi !== undefined && (r.rsi14 === null || r.rsi14 > filters.maxRsi)) return false;
    if (filters.minAdx !== undefined && (r.adx14 === null || r.adx14 < filters.minAdx)) return false;
    if (filters.minRvol !== undefined && (r.rvol20 === null || r.rvol20 < filters.minRvol)) return false;
    if (filters.minAtrPct !== undefined && (r.atrPct === null || r.atrPct < filters.minAtrPct)) return false;
    if (filters.maxAtrPct !== undefined && (r.atrPct === null || r.atrPct > filters.maxAtrPct)) return false;

    if (filters.aboveEma20 !== undefined && r.aboveEma20 !== filters.aboveEma20) return false;
    if (filters.aboveEma50 !== undefined && r.aboveEma50 !== filters.aboveEma50) return false;
    if (filters.aboveEma200 !== undefined && r.aboveEma200 !== filters.aboveEma200) return false;

    if (filters.emaCross && filters.emaCross !== 'ANY') {
      if (filters.emaCross === 'GOLDEN' && r.emaCross !== 'GOLDEN' && r.emaCross !== 'BULLISH_20_50') {
        return false;
      }
      if (filters.emaCross === 'DEATH' && r.emaCross !== 'DEATH' && r.emaCross !== 'BEARISH_20_50') {
        return false;
      }
    }

    if (filters.macdCross && filters.macdCross !== 'ANY' && r.macdCross !== filters.macdCross) {
      return false;
    }

    if (filters.macdHistDirection === 'POSITIVE' && (r.macdHist === null || r.macdHist <= 0)) {
      return false;
    }
    if (filters.macdHistDirection === 'NEGATIVE' && (r.macdHist === null || r.macdHist >= 0)) {
      return false;
    }

    if (filters.bbSqueeze === true && !r.bbSqueeze) return false;
    if (filters.bbExpanding === true && !r.bbExpanding) return false;
    if (filters.rsiDivergence && r.rsiDivergence !== filters.rsiDivergence) return false;
    if (filters.obvDivergence && r.obvDivergence !== filters.obvDivergence) return false;
    if (filters.nearSupport === true && !r.nearSupport) return false;
    if (filters.nearResistance === true && !r.nearResistance) return false;

    if (
      filters.classifications &&
      filters.classifications.length > 0 &&
      !filters.classifications.includes(r.classification)
    ) {
      return false;
    }

    if (filters.minAgreementPct !== undefined && r.agreementPct < filters.minAgreementPct) {
      return false;
    }

    return true;
  });
}

/**
 * Translates natural-language screening prompts into validated structured ScreenerFilters
 * (used both offline and as a validation guardrail for optional AI screener queries).
 */
export function parseNaturalLanguageToScreenerFilters(prompt: string): {
  filters: ScreenerFilters;
  interpretedRules: string[];
} {
  const q = prompt.toLowerCase();
  const filters: ScreenerFilters = {};
  const rules: string[] = [];

  const rsiBelow = q.match(/rsi\s*(?:below|under|<|<=)\s*(\d+(?:\.\d+)?)/);
  if (rsiBelow) {
    filters.maxRsi = Number(rsiBelow[1]);
    rules.push(`RSI 14 <= ${filters.maxRsi}`);
  }
  const rsiAbove = q.match(/rsi\s*(?:above|over|>|>=)\s*(\d+(?:\.\d+)?)/);
  if (rsiAbove) {
    filters.minRsi = Number(rsiAbove[1]);
    rules.push(`RSI 14 >= ${filters.minRsi}`);
  }
  if (q.includes('oversold') && filters.maxRsi === undefined) {
    filters.maxRsi = 35;
    rules.push('RSI 14 <= 35 (oversold)');
  }
  if (q.includes('overbought') && filters.minRsi === undefined) {
    filters.minRsi = 68;
    rules.push('RSI 14 >= 68 (overbought)');
  }

  if (q.includes('positive macd') || q.includes('bullish macd')) {
    filters.macdHistDirection = 'POSITIVE';
    rules.push('MACD histogram > 0');
  }
  if (q.includes('negative macd') || q.includes('bearish macd')) {
    filters.macdHistDirection = 'NEGATIVE';
    rules.push('MACD histogram < 0');
  }
  if (q.includes('macd cross') && q.includes('bullish')) {
    filters.macdCross = 'BULLISH';
    rules.push('Bullish MACD crossover');
  }

  if (q.includes('above ema 200') || q.includes('above ema200')) {
    filters.aboveEma200 = true;
    rules.push('Price > EMA 200');
  }
  if (q.includes('above ema 50') || q.includes('above ema50')) {
    filters.aboveEma50 = true;
    rules.push('Price > EMA 50');
  }
  if (q.includes('above ema 20') || q.includes('above ema20')) {
    filters.aboveEma20 = true;
    rules.push('Price > EMA 20');
  }

  const adxAbove = q.match(/adx\s*(?:above|over|>|>=)\s*(\d+(?:\.\d+)?)/);
  if (adxAbove) {
    filters.minAdx = Number(adxAbove[1]);
    rules.push(`ADX >= ${filters.minAdx}`);
  }

  const rvolAbove = q.match(/rvol\s*(?:above|over|>|>=)\s*(\d+(?:\.\d+)?)/);
  if (rvolAbove) {
    filters.minRvol = Number(rvolAbove[1]);
    rules.push(`RVOL >= ${filters.minRvol}x`);
  } else if (q.includes('high volume') || q.includes('volume spike')) {
    filters.minRvol = 1.5;
    rules.push('RVOL >= 1.5x');
  }

  if (q.includes('squeeze')) {
    filters.bbSqueeze = true;
    rules.push('Bollinger Squeeze active');
  }
  if (q.includes('strong bullish')) {
    filters.classifications = ['STRONG_BULLISH'];
    rules.push('Signal = Strong Bullish');
  } else if (q.includes('strong bearish')) {
    filters.classifications = ['STRONG_BEARISH'];
    rules.push('Signal = Strong Bearish');
  } else if (q.includes('bullish') && !q.includes('macd')) {
    filters.classifications = ['STRONG_BULLISH', 'BULLISH'];
    rules.push('Signal in [Strong Bullish, Bullish]');
  } else if (q.includes('bearish') && !q.includes('macd')) {
    filters.classifications = ['STRONG_BEARISH', 'BEARISH'];
    rules.push('Signal in [Strong Bearish, Bearish]');
  }

  if (q.includes('usdt')) {
    filters.quoteAsset = 'USDT';
    rules.push('Quote asset = USDT');
  }

  return { filters, interpretedRules: rules };
}
