import React from 'react';
import { signalBgClass, signalLabel } from '../../shared/format';
import type { SignalClassification } from '../../shared/types';

export const SignalScoreBar: React.FC<{
  score: number;
  classification: SignalClassification;
}> = ({ score, classification }) => {
  const pct = Math.max(0, Math.min(100, ((score + 100) / 200) * 100));
  const barColor =
    score >= 25
      ? 'bg-gradient-to-r from-[#16A34A] to-[#22C55E]'
      : score <= -25
        ? 'bg-gradient-to-r from-[#E11D48] to-[#FB7185]'
        : 'bg-gradient-to-r from-[#94A39B] to-[#637369]';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${signalBgClass(classification)}`}>
          {signalLabel(classification)}
        </span>
        <span className="font-mono text-lg font-semibold tabular-nums text-[#111814] dark:text-[#F4F7F5]">
          {score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1)}
          <span className="text-xs font-normal text-[#637369] dark:text-[#8FA398]"> / 100</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[#E5EAE7] dark:bg-[#1E2B23] overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#637369]/40 z-10" />
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-[#637369] dark:text-[#8FA398]">
        <span>-100 Bearish</span>
        <span>0 Neutral</span>
        <span>+100 Bullish</span>
      </div>
    </div>
  );
};

export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = 'h-24' }) => (
  <div
    className={`rounded-2xl bg-[#E5EAE7]/70 dark:bg-[#1A251F]/70 border border-[#DCE3DF]/60 dark:border-[#24332A]/60 animate-pulse ${className}`}
  />
);
