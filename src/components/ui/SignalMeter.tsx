import React from 'react';
import { signalBgClass, signalLabel } from '../../shared/format';
import type { SignalClassification } from '../../shared/types';

export const SignalScoreBar: React.FC<{
  score: number;
  classification: SignalClassification;
}> = ({ score, classification }) => {
  // Map [-100, +100] to [0%, 100%]
  const pct = Math.max(0, Math.min(100, ((score + 100) / 200) * 100));
  const barColor =
    score >= 25
      ? 'bg-[#35C89A]'
      : score <= -25
        ? 'bg-[#F16B72]'
        : 'bg-[#94A3B8]';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${signalBgClass(classification)}`}>
          {signalLabel(classification)}
        </span>
        <span className="font-mono text-lg font-semibold tabular-nums text-[#17212B] dark:text-[#F4F7FA]">
          {score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1)}
          <span className="text-xs font-normal text-[#677482] dark:text-[#8B97A5]"> / 100</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[#E6EBF0] dark:bg-[#1B232D] overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#677482]/40 z-10" />
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-[#677482] dark:text-[#8B97A5]">
        <span>-100 Bearish</span>
        <span>0 Neutral</span>
        <span>+100 Bullish</span>
      </div>
    </div>
  );
};

export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = 'h-24' }) => (
  <div
    className={`rounded-xl bg-[#E6EBF0]/60 dark:bg-[#1B232D]/70 animate-pulse ${className}`}
  />
);
