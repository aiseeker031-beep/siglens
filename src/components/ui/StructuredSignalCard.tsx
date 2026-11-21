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

  const dirColor = isBuy
    ? 'text-[#059669]'
    : isSell
      ? 'text-[#E11D48]'
      : 'text-[#B45309]';

  const dirBadge = isBuy
    ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]'
    : isSell
      ? 'bg-[#FFF1F2] text-[#BE123C] border border-[#FECDD3]'
      : 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]';

  const activeEntryPrice = livePrice ?? setup.entryPrice;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = formatSignalCopyText(setup, timeframe, livePrice);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable in restricted contexts
    }
  };

  return (
    <motion.div
      data-testid="structured-signal-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.28, ease: KINETIC_EASE }}
      className={`sig-glass sig-glass-interactive rounded-2xl ${compact ? 'p-3.5' : 'p-4'} space-y-3`}
    >
      {/* Card Header: Symbol + Meta + Copy */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {onOpenPair ? (
              <button
                type="button"
                onClick={onOpenPair}
                className="inline-flex items-center gap-1 font-mono text-sm font-bold text-[#0A0D14] hover:text-[#2563EB] transition-colors"
              >
                {setup.symbol}
                <ExternalLink className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <span className="font-mono text-sm font-bold text-[#0A0D14]">
                {setup.symbol}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold ${dirBadge}`}>
              {setup.directionLabel}
            </span>
            {statusTag && (
              <span className="text-[10px] font-mono text-[#7C8798]">
                {statusTag}
              </span>
            )}
          </div>
          {(exchangeLabel || timeframe || timestampLabel) && (
            <div className="text-[11px] font-mono text-[#7C8798] mt-0.5">
              {[exchangeLabel, marketType, timeframe, timestampLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy formatted signal"
          aria-label={`Copy ${setup.symbol} signal`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full sig-glass-subtle text-[11px] font-medium text-[#4B5565] hover:text-[#0A0D14] hover:border-[#CFD6E3] transition-colors shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#059669]" />
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

      {/* Exact 5-Field Structured Signal Layout */}
      <dl className="space-y-2 text-xs">
        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#ECEFF4]">
          <dt className="text-[#64748B]">• Symbol:</dt>
          <dd className="font-mono font-semibold tabular-nums text-[#0A0D14]">
            {setup.symbol}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#ECEFF4]">
          <dt className="text-[#64748B]">• Direction:</dt>
          <dd className={`font-mono font-bold ${dirColor}`}>
            {setup.directionLabel}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#ECEFF4]">
          <dt className="text-[#64748B] shrink-0">• Entry:</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#0A0D14]">
            {setup.direction === 'WAIT' ? (
              <span className="text-[#64748B]">
                WAIT (Price: ${formatPrice(activeEntryPrice, precision)})
              </span>
            ) : setup.entryMode === 'NOW' ? (
              <div>
                <span className="text-[#059669] font-bold">NOW</span>{' '}
                <span>(${formatPrice(activeEntryPrice, precision)})</span>
                {setup.entryZoneLow !== null && setup.entryZoneHigh !== null && (
                  <div className="text-[10px] font-normal text-[#7C8798]">
                    Zone: ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <span>
                  ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
                </span>
                <div className="text-[10px] font-normal text-[#7C8798]">
                  Live: ${formatPrice(activeEntryPrice, precision)}
                </div>
              </div>
            )}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#ECEFF4]">
          <dt className="text-[#64748B] shrink-0">• Stop Loss (SL):</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#E11D48]">
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
              <span className="text-[#7C8798]">—</span>
            )}
          </dd>
        </div>

        <div className="space-y-1.5">
          <dt className="text-[#64748B]">• Take Profit (TP):</dt>
          {setup.takeProfits.length === 0 ? (
            <dd className="font-mono text-[11px] text-[#7C8798] pl-3">
              No active targets (Neutral confluence)
            </dd>
          ) : (
            <dd className="grid grid-cols-3 gap-1.5 pt-0.5">
              {setup.takeProfits.map((tp) => (
                <div
                  key={tp.label}
                  className="rounded-xl sig-glass-subtle px-2 py-1.5 font-mono tabular-nums"
                >
                  <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                    <span className="font-semibold text-[#059669]">{tp.label}</span>
                    <span>{tp.rrRatio.toFixed(1)}R</span>
                  </div>
                  <div className="text-[11px] font-semibold text-[#0A0D14] mt-0.5 truncate">
                    ${formatPrice(tp.price, precision)}
                  </div>
                  <div className="text-[10px] text-[#059669]">
                    {tp.pctFromEntry > 0 ? '+' : ''}
                    {tp.pctFromEntry.toFixed(2)}%
                  </div>
                </div>
              ))}
            </dd>
          )}
        </div>
      </dl>

      {/* Footer Transparency Strip */}
      <div className="pt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono text-[#7C8798]">
        <span className="leading-snug">{setup.methodology}</span>
        {(score !== undefined || agreementPct !== undefined) && (
          <span className="shrink-0">
            {score !== undefined ? `Score ${score > 0 ? `+${score}` : score}` : ''}
            {score !== undefined && agreementPct !== undefined ? ' · ' : ''}
            {agreementPct !== undefined ? `Agree ${agreementPct}%` : ''}
          </span>
        )}
      </div>
    </motion.div>
  );
};
