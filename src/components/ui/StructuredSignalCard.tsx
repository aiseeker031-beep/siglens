import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { formatSignalCopyText } from '../../analytics/signalSetup';
import { formatPrice } from '../../shared/format';
import type { SignalSetupPlan } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';
import { KINETIC_EASE } from './Kinetic';

interface StructuredSignalCardProps {
  setup: SignalSetupPlan;
  timeframe: string;
  exchangeLabel?: string;
  marketType?: string;
  livePrice?: number | null;
  score?: number;
  agreementPct?: number;
  statusTag?: string;
  timestampLabel?: string;
  compact?: boolean;
  onOpenPair?: () => void;
}

export const StructuredSignalCard: React.FC<StructuredSignalCardProps> = ({
  setup,
  timeframe,
  exchangeLabel,
  marketType,
  livePrice,
  score,
  agreementPct,
  statusTag,
  timestampLabel,
  compact = false,
  onOpenPair,
}) => {
  const precision = useAppStore((s) => s.preferences.decimalPrecision);
  const [copied, setCopied] = useState(false);

  const isBuy = setup.direction === 'BUY';
  const isSell = setup.direction === 'SELL';

  const cardSurface = isBuy
    ? 'sig-signal-buy'
    : isSell
      ? 'sig-signal-sell'
      : 'sig-signal-neutral';

  const dirColor = isBuy ? 'text-[#4ADE80]' : isSell ? 'text-[#FB7185]' : 'text-[#A3ABA6]';

  const dirBadge = isBuy
    ? 'bg-[#22C55E]/20 text-[#4ADE80]'
    : isSell
      ? 'bg-[#F43F5E]/20 text-[#FB7185]'
      : 'bg-white/[0.09] text-[#C8D0CC]';

  const activeEntryPrice = livePrice ?? setup.entryPrice;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = formatSignalCopyText(setup, timeframe, livePrice);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <motion.div
      data-testid="structured-signal-card"
      data-direction={setup.direction}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.25, ease: KINETIC_EASE }}
      onClick={onOpenPair}
      className={`${cardSurface} ${compact ? 'p-3' : 'p-4'} space-y-2.5 ${onOpenPair ? 'cursor-pointer' : ''}`}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 font-mono text-[13px] font-bold tracking-tight text-white truncate">
              {setup.symbol}
              {onOpenPair && <ExternalLink className="w-3 h-3 opacity-55" />}
            </span>
            <span className="font-mono text-[10px] text-white/50 uppercase">{timeframe}</span>
            <span className={`px-2 py-0.5 rounded-[6px] text-[10px] font-mono font-bold tracking-wide ${dirBadge}`}>
              {setup.direction}
            </span>
            {statusTag && <span className="text-[10px] font-mono text-white/50">{statusTag}</span>}
          </div>
          {(exchangeLabel || marketType || timestampLabel) && (
            <div className="text-[10px] font-mono text-white/50 mt-0.5">
              {[exchangeLabel, marketType, timestampLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy formatted signal"
          aria-label={`Copy ${setup.symbol} signal`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] bg-white/[0.08] hover:bg-white/[0.16] text-[10px] font-medium text-white/80 hover:text-white transition-colors shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#4ADE80]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* 5-Field Structured Signal Layout */}
      <dl className="space-y-1.5 text-[11px]">
        <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-white/[0.08]">
          <dt className="text-white/55">• Symbol</dt>
          <dd className="font-mono font-semibold tabular-nums text-white">{setup.symbol}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-white/[0.08]">
          <dt className="text-white/55">• Direction</dt>
          <dd className={`font-mono font-bold ${dirColor}`}>{setup.directionLabel}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-white/[0.08]">
          <dt className="text-white/55 shrink-0">• Entry</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-white">
            {setup.direction === 'WAIT' ? (
              <span className="text-white/60">WAIT (${formatPrice(activeEntryPrice, precision)})</span>
            ) : setup.entryMode === 'NOW' ? (
              <div>
                <span className="text-[#4ADE80] font-bold">NOW</span>{' '}
                <span>(${formatPrice(activeEntryPrice, precision)})</span>
              </div>
            ) : (
              <div>
                ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
              </div>
            )}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1 border-b border-white/[0.08]">
          <dt className="text-white/55 shrink-0">• Stop Loss</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#FB7185]">
            {setup.stopLoss !== null ? (
              <>
                ${formatPrice(setup.stopLoss, precision)}{' '}
                {setup.stopLossPct !== null && (
                  <span className="text-[10px] font-normal opacity-80">
                    ({setup.stopLossPct > 0 ? '+' : ''}
                    {setup.stopLossPct.toFixed(2)}%)
                  </span>
                )}
              </>
            ) : (
              <span className="text-white/45">—</span>
            )}
          </dd>
        </div>

        <div className="space-y-1.5">
          <dt className="text-white/55">• Take Profit</dt>
          {setup.takeProfits.length === 0 ? (
            <dd className="font-mono text-[10px] text-white/50 pl-3">No active targets (Neutral confluence)</dd>
          ) : (
            <dd className="grid grid-cols-3 gap-1.5 pt-0.5">
              {setup.takeProfits.map((tp) => (
                <div
                  key={tp.label}
                  className="rounded-lg bg-white/[0.06] px-2 py-1.5 font-mono tabular-nums"
                >
                  <div className="flex items-center justify-between text-[9px] text-white/60">
                    <span className="font-bold text-[#4ADE80]">{tp.label}</span>
                    <span>{tp.rrRatio.toFixed(1)}R</span>
                  </div>
                  <div className="text-[11px] font-semibold text-white mt-0.5 truncate">
                    ${formatPrice(tp.price, precision)}
                  </div>
                </div>
              ))}
            </dd>
          )}
        </div>
      </dl>

      {!compact && (
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-white/45">
          <span className="truncate">{setup.methodology}</span>
          {(score !== undefined || agreementPct !== undefined) && (
            <span className="shrink-0">
              {score !== undefined ? `Score ${score > 0 ? `+${score}` : score}` : ''}
              {score !== undefined && agreementPct !== undefined ? ' · ' : ''}
              {agreementPct !== undefined ? `Agree ${agreementPct}%` : ''}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
};
