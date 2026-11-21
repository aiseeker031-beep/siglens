import React from 'react';
import { motion } from 'motion/react';
import { signalBgClass, signalLabel } from '../../shared/format';
import type { SignalClassification } from '../../shared/types';
import { KINETIC_EASE } from './Kinetic';

export const SignalScoreBar: React.FC<{
  score: number;
  classification: SignalClassification;
}> = ({ score, classification }) => {
  const pct = Math.max(0, Math.min(100, ((score + 100) / 200) * 100));
  const barColor =
    score >= 25
      ? 'bg-gradient-to-r from-[#059669] to-[#10B981]'
      : score <= -25
        ? 'bg-gradient-to-r from-[#E11D48] to-[#F43F5E]'
        : 'bg-gradient-to-r from-[#64748B] to-[#94A3B8]';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${signalBgClass(classification)}`}>
          {signalLabel(classification)}
        </span>
        <span className="font-mono text-lg font-bold tabular-nums text-[#0A0D14]">
          {score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1)}
          <span className="text-xs font-normal text-[#7C8798]"> / 100</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[#ECEFF4] overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#94A3B8]/60 z-10" />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.45, ease: KINETIC_EASE }}
          className={`h-full rounded-full ${barColor}`}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-[#7C8798]">
        <span>-100 Bearish</span>
        <span>0 Neutral</span>
        <span>+100 Bullish</span>
      </div>
    </div>
  );
};

export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = 'h-24' }) => (
  <div
    className={`rounded-2xl sig-skeleton border border-[#E6E8EE] ${className}`}
  />
);
