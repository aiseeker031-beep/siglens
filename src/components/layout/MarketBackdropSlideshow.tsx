import React, { useEffect, useMemo, useState } from 'react';
import bullishFlowImg from '../../assets/images/abstract_bullish_flow_1795243608624.jpg';
import bullishRidgesImg from '../../assets/images/abstract_bullish_ridges_1795243607757.jpg';
import bearishPlanesImg from '../../assets/images/abstract_bearish_planes_1795243608243.jpg';
import volatileAmberImg from '../../assets/images/abstract_volatile_amber_1795243608425.jpg';
import neutralZenImg from '../../assets/images/abstract_neutral_zen_1795243608485.jpg';
import neutralGlassImg from '../../assets/images/abstract_neutral_glass_1795243608481.jpg';
import { useAppStore } from '../../store/useAppStore';
import {
  deriveMarketBackdropCondition,
  getSlideIntervalMs,
  resolveEffectiveCondition,
  type MarketBackdropCondition,
} from '../../utils/marketBackdrop';

export interface BackdropSlide {
  id: string;
  title: string;
  src: string;
  /** Subtle per-slide image treatment to keep palette harmonious per regime */
  imageFilter?: string;
  /** Measured dark-mode atmospheric readability scrim */
  darkScrim: string;
  /** Soft high-key light-mode atmospheric veil */
  lightScrim: string;
}

export const CONDITION_SLIDES: Record<MarketBackdropCondition, BackdropSlide[]> = {
  bullish: [
    {
      id: 'bullish-flow',
      title: 'Emerald Silk Current',
      src: bullishFlowImg,
      darkScrim:
        'radial-gradient(ellipse at 78% 14%, rgba(34, 197, 94, 0.34) 0%, rgba(16, 62, 35, 0.62) 48%, rgba(8, 22, 14, 0.86) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 82% 16%, rgba(34, 197, 94, 0.52) 0%, rgba(21, 98, 52, 0.64) 48%, rgba(11, 34, 21, 0.78) 100%)',
    },
    {
      id: 'bullish-ridges',
      title: 'Ascending Jade Ridges',
      src: bullishRidgesImg,
      darkScrim:
        'radial-gradient(ellipse at 72% 22%, rgba(22, 163, 74, 0.32) 0%, rgba(14, 52, 31, 0.64) 50%, rgba(8, 20, 14, 0.88) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 76% 20%, rgba(34, 197, 94, 0.48) 0%, rgba(18, 86, 47, 0.65) 50%, rgba(10, 30, 19, 0.80) 100%)',
    },
  ],
  bearish: [
    {
      id: 'bearish-planes',
      title: 'Terracotta Horizon Planes',
      src: bearishPlanesImg,
      darkScrim:
        'radial-gradient(ellipse at 76% 22%, rgba(190, 24, 60, 0.30) 0%, rgba(44, 18, 24, 0.64) 50%, rgba(14, 9, 11, 0.88) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 78% 18%, rgba(225, 29, 72, 0.38) 0%, rgba(74, 26, 36, 0.64) 50%, rgba(20, 12, 15, 0.82) 100%)',
    },
    {
      id: 'bearish-folds',
      title: 'Smoked Ember Tension',
      src: volatileAmberImg,
      imageFilter: 'hue-rotate(-24deg) saturate(0.95) brightness(0.90)',
      darkScrim:
        'radial-gradient(ellipse at 62% 36%, rgba(190, 24, 60, 0.30) 0%, rgba(40, 16, 22, 0.66) 52%, rgba(14, 9, 11, 0.88) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 64% 25%, rgba(212, 46, 72, 0.36) 0%, rgba(68, 24, 34, 0.66) 52%, rgba(20, 12, 14, 0.84) 100%)',
    },
  ],
  volatile: [
    {
      id: 'volatile-amber',
      title: 'Molten Kinetic Ribbon',
      src: volatileAmberImg,
      darkScrim:
        'radial-gradient(ellipse at 76% 18%, rgba(22, 163, 74, 0.24) 0%, rgba(44, 34, 18, 0.62) 48%, rgba(10, 22, 15, 0.86) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 78% 18%, rgba(34, 197, 94, 0.34) 0%, rgba(58, 66, 32, 0.60) 48%, rgba(12, 32, 20, 0.80) 100%)',
    },
    {
      id: 'volatile-glass',
      title: 'Refracted Amber Planes',
      src: neutralGlassImg,
      imageFilter: 'contrast(1.08) saturate(1.12) brightness(0.84)',
      darkScrim:
        'radial-gradient(ellipse at 64% 30%, rgba(234, 138, 30, 0.26) 0%, rgba(32, 38, 22, 0.66) 50%, rgba(10, 20, 14, 0.88) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 66% 24%, rgba(217, 119, 6, 0.32) 0%, rgba(42, 68, 42, 0.62) 52%, rgba(12, 30, 20, 0.82) 100%)',
    },
  ],
  neutral: [
    {
      id: 'neutral-zen',
      title: 'Obsidian Horizon Contours',
      src: neutralZenImg,
      darkScrim:
        'radial-gradient(ellipse at 78% 20%, rgba(22, 163, 74, 0.28) 0%, rgba(18, 50, 34, 0.64) 50%, rgba(9, 20, 14, 0.86) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 80% 18%, rgba(34, 197, 94, 0.42) 0%, rgba(24, 78, 48, 0.62) 50%, rgba(12, 32, 21, 0.78) 100%)',
    },
    {
      id: 'neutral-glass',
      title: 'Equilibrium Frosted Layers',
      src: neutralGlassImg,
      imageFilter: 'brightness(0.82) contrast(1.04)',
      darkScrim:
        'radial-gradient(ellipse at 68% 28%, rgba(22, 163, 74, 0.24) 0%, rgba(18, 46, 32, 0.66) 50%, rgba(9, 20, 14, 0.88) 100%)',
      lightScrim:
        'radial-gradient(ellipse at 70% 24%, rgba(34, 197, 94, 0.38) 0%, rgba(22, 72, 46, 0.64) 52%, rgba(12, 30, 20, 0.80) 100%)',
    },
  ],
};

/**
 * Shared hook that derives both live market condition and effective visual condition
 * from global store overview metrics + real-time streaming tickers.
 */
export function useMarketBackdropState() {
  const marketOverviewMetrics = useAppStore((s) => s.marketOverviewMetrics);
  const liveTickers = useAppStore((s) => s.liveTickers);
  const backdropMode = useAppStore((s) => s.backdropMode);
  const backdropSlideIndex = useAppStore((s) => s.backdropSlideIndex);

  const liveCondition = useMemo(() => {
    const liveChanges = Object.values(liveTickers)
      .map((t) => t.change24hPct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    return deriveMarketBackdropCondition({
      breadthScore: marketOverviewMetrics.breadthScore,
      volatilityRegime: marketOverviewMetrics.volatilityRegime,
      fearAndGreed: marketOverviewMetrics.fearAndGreed,
      liveChange24hPcts: liveChanges,
    });
  }, [marketOverviewMetrics, liveTickers]);

  const effectiveCondition = useMemo(
    () => resolveEffectiveCondition(backdropMode, liveCondition),
    [backdropMode, liveCondition],
  );

  const slides = CONDITION_SLIDES[effectiveCondition.condition];
  const safeSlideIndex = slides.length > 0 ? backdropSlideIndex % slides.length : 0;
  const activeSlide = slides[safeSlideIndex] ?? slides[0];

  return {
    liveCondition,
    effectiveCondition,
    slides,
    slideIndex: safeSlideIndex,
    activeSlide,
  };
}

export const MarketBackdropSlideshow: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const backdropMode = useAppStore((s) => s.backdropMode);
  const backdropPaused = useAppStore((s) => s.backdropPaused);
  const backdropCadence = useAppStore((s) => s.backdropCadence);
  const stepBackdropSlide = useAppStore((s) => s.stepBackdropSlide);
  const setBackdropSlideIndex = useAppStore((s) => s.setBackdropSlideIndex);
  const reducedMotion = useAppStore((s) => s.preferences.reducedMotion);

  const { effectiveCondition, slides, slideIndex, activeSlide } = useMarketBackdropState();
  const [failedSrcs, setFailedSrcs] = useState<Record<string, boolean>>({});

  // Reset slide index gracefully when the active market condition transitions
  useEffect(() => {
    setBackdropSlideIndex(0);
  }, [effectiveCondition.condition, setBackdropSlideIndex]);

  // Automatic crossfade slideshow timer — resets full dwell window whenever slide or condition changes
  useEffect(() => {
    if (backdropPaused || reducedMotion || slides.length <= 1) return;
    const ms = getSlideIntervalMs(backdropCadence);
    const id = window.setTimeout(() => {
      stepBackdropSlide(slides.length, 1);
    }, ms);
    return () => window.clearTimeout(id);
  }, [
    backdropPaused,
    reducedMotion,
    backdropCadence,
    slides.length,
    slideIndex,
    effectiveCondition.condition,
    stepBackdropSlide,
  ]);

  return (
    <div
      data-testid="market-backdrop-slideshow"
      data-market-condition={effectiveCondition.condition}
      data-backdrop-mode={backdropMode}
      data-slide-index={slideIndex}
      data-slide-id={activeSlide.id}
      className="fixed inset-0 -z-20 pointer-events-none overflow-hidden bg-[#0F291A] dark:bg-[#08130D]"
      aria-hidden="true"
    >
      {/* Resilient Atmospheric Gradient Fallback Base */}
      <div
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          background: isDark
            ? `radial-gradient(ellipse at 65% 20%, ${effectiveCondition.accentHex}29 0%, #0B1911 55%, #07100B 100%)`
            : `radial-gradient(circle at 78% 12%, ${effectiveCondition.accentHex}40 0%, #10321E 50%, #0A1D12 100%)`,
        }}
      />

      {/* Crossfading Abstract Minimal Slideshow Layers (Active Condition Only for Peak Compositor Speed) */}
      {slides.map((slide, index) => {
        const isActive = index === slideIndex;
        const failed = Boolean(failedSrcs[slide.src]);
        if (failed) return null;

        return (
          <div
            key={`${effectiveCondition.condition}-${slide.id}`}
            className={`absolute inset-0 transition-opacity duration-[1200ms] ease-in-out ${
              isActive ? 'opacity-85' : 'opacity-0'
            }`}
          >
            <img
              src={slide.src}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              loading="eager"
              onError={() => setFailedSrcs((prev) => ({ ...prev, [slide.src]: true }))}
              className={`w-full h-full object-cover object-center ${
                isActive && !reducedMotion && !backdropPaused ? 'sig-backdrop-kenburns' : 'scale-[1.02]'
              }`}
              style={slide.imageFilter ? { filter: slide.imageFilter } : undefined}
            />
          </div>
        );
      })}

      {/* Measured Readability & Mood Scrim synced to Active Market Slide */}
      <div
        className="absolute inset-0 transition-[background] duration-1000"
        style={{
          background: isDark ? activeSlide.darkScrim : activeSlide.lightScrim,
        }}
      />
    </div>
  );
};
