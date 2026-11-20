import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { formatSignalCopyText } from '../../analytics/signalSetup';
import { formatPrice } from '../../shared/format';
import type { SignalSetupPlan } from '../../shared/types';
import { useAppStore } from '../../store/useAppStore';

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
    ? 'text-[#16A378] dark:text-[#35C89A]'
    : isSell
      ? 'text-[#DC4C54] dark:text-[#F16B72]'
      : 'text-[#64748B] dark:text-[#94A3B8]';

  const dirBadge = isBuy
    ? 'bg-[#35C89A]/15 text-[#16A378] dark:text-[#35C89A] border border-[#35C89A]/30'
    : isSell
      ? 'bg-[#F16B72]/15 text-[#DC4C54] dark:text-[#F16B72] border border-[#F16B72]/30'
      : 'bg-[#94A3B8]/12 text-[#64748B] dark:text-[#94A3B8] border border-[#94A3B8]/25';

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
    <div
      data-testid="structured-signal-card"
      className={`rounded-xl border border-[#E6EBF0] dark:border-[#27313C] bg-[#FFFFFF] dark:bg-[#151B23] ${
        compact ? 'p-3.5' : 'p-4'
      } space-y-3`}
    >
      {/* Card Header: Symbol + Meta + Copy */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {onOpenPair ? (
              <button
                type="button"
                onClick={onOpenPair}
                className="inline-flex items-center gap-1 font-mono text-sm font-bold text-[#17212B] dark:text-[#F4F7FA] hover:text-[#6B9F30] dark:hover:text-[#B6F36A] transition-colors"
              >
                {setup.symbol}
                <ExternalLink className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <span className="font-mono text-sm font-bold text-[#17212B] dark:text-[#F4F7FA]">
                {setup.symbol}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${dirBadge}`}>
              {setup.directionLabel}
            </span>
            {statusTag && (
              <span className="text-[10px] font-mono text-[#677482] dark:text-[#8B97A5]">
                {statusTag}
              </span>
            )}
          </div>
          {(exchangeLabel || timeframe || timestampLabel) && (
            <div className="text-[11px] font-mono text-[#677482] dark:text-[#8B97A5] mt-0.5">
              {[exchangeLabel, marketType, timeframe, timestampLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy formatted signal"
          aria-label={`Copy ${setup.symbol} signal`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#E6EBF0] dark:border-[#27313C] bg-[#F7F9FB] dark:bg-[#10151C] text-[11px] font-medium text-[#677482] dark:text-[#8B97A5] hover:text-[#17212B] dark:hover:text-[#F4F7FA] shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#35C89A]" />
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
        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E6EBF0]/60 dark:border-[#27313C]/60">
          <dt className="text-[#677482] dark:text-[#8B97A5]">• Symbol:</dt>
          <dd className="font-mono font-semibold tabular-nums text-[#17212B] dark:text-[#F4F7FA]">
            {setup.symbol}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E6EBF0]/60 dark:border-[#27313C]/60">
          <dt className="text-[#677482] dark:text-[#8B97A5]">• Direction:</dt>
          <dd className={`font-mono font-bold ${dirColor}`}>
            {setup.directionLabel}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E6EBF0]/60 dark:border-[#27313C]/60">
          <dt className="text-[#677482] dark:text-[#8B97A5] shrink-0">• Entry:</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#17212B] dark:text-[#F4F7FA]">
            {setup.direction === 'WAIT' ? (
              <span className="text-[#677482] dark:text-[#8B97A5]">
                WAIT (Price: ${formatPrice(activeEntryPrice, precision)})
              </span>
            ) : setup.entryMode === 'NOW' ? (
              <div>
                <span className="text-[#6B9F30] dark:text-[#B6F36A] font-bold">NOW</span>{' '}
                <span>(${formatPrice(activeEntryPrice, precision)})</span>
                {setup.entryZoneLow !== null && setup.entryZoneHigh !== null && (
                  <div className="text-[10px] font-normal text-[#677482] dark:text-[#8B97A5]">
                    Zone: ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <span>
                  ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
                </span>
                <div className="text-[10px] font-normal text-[#677482] dark:text-[#8B97A5]">
                  Live: ${formatPrice(activeEntryPrice, precision)}
                </div>
              </div>
            )}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E6EBF0]/60 dark:border-[#27313C]/60">
          <dt className="text-[#677482] dark:text-[#8B97A5] shrink-0">• Stop Loss (SL):</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#DC4C54] dark:text-[#F16B72]">
            {setup.stopLoss !== null ? (
              <>
                ${formatPrice(setup.stopLoss, precision)}{' '}
                {setup.stopLossPct !== null && (
                  <span className="text-[10px] font-normal opacity-85">
                    ({setup.stopLossPct > 0 ? '+' : ''}
                    {setup.stopLossPct.toFixed(2)}%)
                  </span>
                )}
              </>
            ) : (
              <span className="text-[#677482] dark:text-[#8B97A5]">—</span>
            )}
          </dd>
        </div>

        <div className="space-y-1.5">
          <dt className="text-[#677482] dark:text-[#8B97A5]">• Take Profit (TP):</dt>
          {setup.takeProfits.length === 0 ? (
            <dd className="font-mono text-[11px] text-[#677482] dark:text-[#8B97A5] pl-3">
              No active targets (Neutral confluence)
            </dd>
          ) : (
            <dd className="grid grid-cols-3 gap-1.5 pt-0.5">
              {setup.takeProfits.map((tp) => (
                <div
                  key={tp.label}
                  className="rounded-lg bg-[#F7F9FB] dark:bg-[#10151C] border border-[#E6EBF0] dark:border-[#27313C] px-2 py-1.5 font-mono tabular-nums"
                >
                  <div className="flex items-center justify-between text-[10px] text-[#677482] dark:text-[#8B97A5]">
                    <span className="font-semibold text-[#16A378] dark:text-[#35C89A]">{tp.label}</span>
                    <span>{tp.rrRatio.toFixed(1)}R</span>
                  </div>
                  <div className="text-[11px] font-semibold text-[#17212B] dark:text-[#F4F7FA] mt-0.5 truncate">
                    ${formatPrice(tp.price, precision)}
                  </div>
                  <div className="text-[10px] text-[#16A378] dark:text-[#35C89A]">
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
      <div className="pt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono text-[#677482] dark:text-[#8B97A5]">
        <span className="leading-snug">{setup.methodology}</span>
        {(score !== undefined || agreementPct !== undefined) && (
          <span className="shrink-0">
            {score !== undefined ? `Score ${score > 0 ? `+${score}` : score}` : ''}
            {score !== undefined && agreementPct !== undefined ? ' · ' : ''}
            {agreementPct !== undefined ? `Agree ${agreementPct}%` : ''}
          </span>
        )}
      </div>
    </div>
  );
};
