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
    ? 'text-[#15803D] dark:text-[#4ADE80]'
    : isSell
      ? 'text-[#BE123C] dark:text-[#FB7185]'
      : 'text-[#92400E] dark:text-[#FBBF24]';

  const dirBadge = isBuy
    ? 'bg-[#DCFCE7] dark:bg-[#22C55E]/18 text-[#15803D] dark:text-[#4ADE80] border border-[#BBF7D0] dark:border-[#22C55E]/30'
    : isSell
      ? 'bg-[#FFE4E6] dark:bg-[#F43F5E]/16 text-[#BE123C] dark:text-[#FB7185] border border-[#FECDD3] dark:border-[#F43F5E]/30'
      : 'bg-[#FEF3C7] dark:bg-[#F59E0B]/16 text-[#92400E] dark:text-[#FBBF24] border border-[#FDE68A] dark:border-[#F59E0B]/28';

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
      className={`sig-glass rounded-2xl ${compact ? 'p-3.5' : 'p-4'} space-y-3`}
    >
      {/* Card Header: Symbol + Meta + Copy */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {onOpenPair ? (
              <button
                type="button"
                onClick={onOpenPair}
                className="inline-flex items-center gap-1 font-mono text-sm font-bold text-[#111814] dark:text-[#F4F7F5] hover:text-[#16A34A] dark:hover:text-[#4ADE80] transition-colors"
              >
                {setup.symbol}
                <ExternalLink className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <span className="font-mono text-sm font-bold text-[#111814] dark:text-[#F4F7F5]">
                {setup.symbol}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold ${dirBadge}`}>
              {setup.directionLabel}
            </span>
            {statusTag && (
              <span className="text-[10px] font-mono text-[#637369] dark:text-[#8FA398]">
                {statusTag}
              </span>
            )}
          </div>
          {(exchangeLabel || timeframe || timestampLabel) && (
            <div className="text-[11px] font-mono text-[#637369] dark:text-[#8FA398] mt-0.5">
              {[exchangeLabel, marketType, timeframe, timestampLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          title="Copy formatted signal"
          aria-label={`Copy ${setup.symbol} signal`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg sig-glass-subtle text-[11px] font-medium text-[#4D5E54] dark:text-[#B4C6BC] hover:text-[#111814] dark:hover:text-white transition-colors shrink-0"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#16A34A] dark:text-[#4ADE80]" />
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
        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E8EEEA] dark:border-[#213028]">
          <dt className="text-[#637369] dark:text-[#8FA398]">• Symbol:</dt>
          <dd className="font-mono font-semibold tabular-nums text-[#111814] dark:text-[#F4F7F5]">
            {setup.symbol}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E8EEEA] dark:border-[#213028]">
          <dt className="text-[#637369] dark:text-[#8FA398]">• Direction:</dt>
          <dd className={`font-mono font-bold ${dirColor}`}>
            {setup.directionLabel}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E8EEEA] dark:border-[#213028]">
          <dt className="text-[#637369] dark:text-[#8FA398] shrink-0">• Entry:</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#111814] dark:text-[#F4F7F5]">
            {setup.direction === 'WAIT' ? (
              <span className="text-[#637369] dark:text-[#8FA398]">
                WAIT (Price: ${formatPrice(activeEntryPrice, precision)})
              </span>
            ) : setup.entryMode === 'NOW' ? (
              <div>
                <span className="text-[#16A34A] dark:text-[#4ADE80] font-bold">NOW</span>{' '}
                <span>(${formatPrice(activeEntryPrice, precision)})</span>
                {setup.entryZoneLow !== null && setup.entryZoneHigh !== null && (
                  <div className="text-[10px] font-normal text-[#637369] dark:text-[#8FA398]">
                    Zone: ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <span>
                  ${formatPrice(setup.entryZoneLow, precision)} – ${formatPrice(setup.entryZoneHigh, precision)}
                </span>
                <div className="text-[10px] font-normal text-[#637369] dark:text-[#8FA398]">
                  Live: ${formatPrice(activeEntryPrice, precision)}
                </div>
              </div>
            )}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-[#E8EEEA] dark:border-[#213028]">
          <dt className="text-[#637369] dark:text-[#8FA398] shrink-0">• Stop Loss (SL):</dt>
          <dd className="font-mono font-semibold tabular-nums text-right text-[#BE123C] dark:text-[#FB7185]">
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
              <span className="text-[#637369] dark:text-[#8FA398]">—</span>
            )}
          </dd>
        </div>

        <div className="space-y-1.5">
          <dt className="text-[#637369] dark:text-[#8FA398]">• Take Profit (TP):</dt>
          {setup.takeProfits.length === 0 ? (
            <dd className="font-mono text-[11px] text-[#637369] dark:text-[#8FA398] pl-3">
              No active targets (Neutral confluence)
            </dd>
          ) : (
            <dd className="grid grid-cols-3 gap-1.5 pt-0.5">
              {setup.takeProfits.map((tp) => (
                <div
                  key={tp.label}
                  className="rounded-xl sig-glass-subtle px-2 py-1.5 font-mono tabular-nums"
                >
                  <div className="flex items-center justify-between text-[10px] text-[#637369] dark:text-[#8FA398]">
                    <span className="font-semibold text-[#15803D] dark:text-[#4ADE80]">{tp.label}</span>
                    <span>{tp.rrRatio.toFixed(1)}R</span>
                  </div>
                  <div className="text-[11px] font-semibold text-[#111814] dark:text-[#F4F7F5] mt-0.5 truncate">
                    ${formatPrice(tp.price, precision)}
                  </div>
                  <div className="text-[10px] text-[#16A34A] dark:text-[#4ADE80]">
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
      <div className="pt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono text-[#637369] dark:text-[#8FA398]">
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
