import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMarketBackdropCondition,
  getNextSlideIndex,
  getSlideIntervalMs,
  resolveEffectiveCondition,
} from './marketBackdrop';

test('deriveMarketBackdropCondition classifies bullish breadth correctly', () => {
  const res = deriveMarketBackdropCondition({
    breadthScore: 44,
    volatilityRegime: 'Normal Volatility',
    fearAndGreed: 68,
    liveChange24hPcts: [2.1, 3.4, 1.8],
  });
  assert.equal(res.condition, 'bullish');
  assert.equal(res.shortLabel, 'Bullish');
  assert.match(res.rationale, /\+44/);
});

test('deriveMarketBackdropCondition classifies bearish breadth correctly', () => {
  const res = deriveMarketBackdropCondition({
    breadthScore: -38,
    volatilityRegime: 'Normal Volatility',
    fearAndGreed: 26,
    liveChange24hPcts: [-2.8, -1.9, -3.1],
  });
  assert.equal(res.condition, 'bearish');
  assert.equal(res.shortLabel, 'Bearish');
  assert.match(res.rationale, /-38/);
});

test('deriveMarketBackdropCondition prioritizes high volatility regime', () => {
  const res = deriveMarketBackdropCondition({
    breadthScore: 32,
    volatilityRegime: 'High Volatility',
    liveChange24hPcts: [1.5, 2.0, 1.0],
  });
  assert.equal(res.condition, 'volatile');
  assert.equal(res.shortLabel, 'Volatile');
});

test('deriveMarketBackdropCondition detects high volatility from live ticker dispersion', () => {
  const res = deriveMarketBackdropCondition({
    breadthScore: 5,
    volatilityRegime: 'Normal Volatility',
    liveChange24hPcts: [6.2, -5.8, 4.9, -4.1],
  });
  assert.equal(res.condition, 'volatile');
  assert.match(res.rationale, /Avg 24h move/);
});

test('deriveMarketBackdropCondition returns neutral for balanced range', () => {
  const res = deriveMarketBackdropCondition({
    breadthScore: 4,
    volatilityRegime: 'Low Volatility',
    fearAndGreed: 51,
    liveChange24hPcts: [0.4, -0.3, 0.2],
  });
  assert.equal(res.condition, 'neutral');
  assert.equal(res.shortLabel, 'Neutral');
});

test('deriveMarketBackdropCondition falls back cleanly to live tickers before overview loads', () => {
  const bull = deriveMarketBackdropCondition({
    liveChange24hPcts: [2.5, 3.1, 1.9],
  });
  assert.equal(bull.condition, 'bullish');

  const bear = deriveMarketBackdropCondition({
    liveChange24hPcts: [-2.4, -3.0, -1.8],
  });
  assert.equal(bear.condition, 'bearish');
});

test('resolveEffectiveCondition respects auto vs manual override', () => {
  const live = deriveMarketBackdropCondition({ breadthScore: 40 });
  assert.equal(resolveEffectiveCondition('auto', live).condition, 'bullish');

  const override = resolveEffectiveCondition('bearish', live);
  assert.equal(override.condition, 'bearish');
  assert.match(override.rationale, /Live market is Bullish/);
});

test('getNextSlideIndex wraps cleanly forward and backward', () => {
  assert.equal(getNextSlideIndex(0, 2, 1), 1);
  assert.equal(getNextSlideIndex(1, 2, 1), 0);
  assert.equal(getNextSlideIndex(0, 2, -1), 1);
  assert.equal(getNextSlideIndex(0, 1, 1), 0);
});

test('getSlideIntervalMs maps cadences accurately', () => {
  assert.equal(getSlideIntervalMs('calm'), 30_000);
  assert.equal(getSlideIntervalMs('standard'), 16_000);
  assert.equal(getSlideIntervalMs('dynamic'), 9_000);
});
