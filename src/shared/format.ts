import type { SignalClassification } from './types';

export function formatPrice(
  price: number | null | undefined,
  precision: 'auto' | 2 | 4 | 6 = 'auto',
): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '—';
  if (precision !== 'auto') {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }
  const abs = Math.abs(price);
  if (abs >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (abs >= 0.01) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 5 });
  }
  return price.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 8 });
}

export function formatPercent(val: number | null | undefined, digits = 2, showSign = true): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const sign = showSign && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(digits)}%`;
}

export function formatCompactUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatNumber(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatTimestamp(
  ts: number | null | undefined,
  timezone: 'UTC' | 'local' = 'UTC',
  includeDate = true,
): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  if (timezone === 'UTC') {
    const iso = d.toISOString();
    if (!includeDate) return `${iso.slice(11, 19)} UTC`;
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
  }
  if (!includeDate) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function signalLabel(c: SignalClassification): string {
  switch (c) {
    case 'STRONG_BULLISH':
      return 'Strong Bullish';
    case 'BULLISH':
      return 'Bullish';
    case 'NEUTRAL':
      return 'Neutral';
    case 'BEARISH':
      return 'Bearish';
    case 'STRONG_BEARISH':
      return 'Strong Bearish';
    case 'INSUFFICIENT_DATA':
      return 'Insufficient Data';
  }
}

export function signalColorClass(c: SignalClassification): string {
  switch (c) {
    case 'STRONG_BULLISH':
      return 'text-[#047857]';
    case 'BULLISH':
      return 'text-[#059669]';
    case 'NEUTRAL':
      return 'text-[#525E70]';
    case 'BEARISH':
      return 'text-[#E11D48]';
    case 'STRONG_BEARISH':
      return 'text-[#BE123C]';
    case 'INSUFFICIENT_DATA':
      return 'text-[#64748B]';
  }
}

export function signalBgClass(c: SignalClassification): string {
  switch (c) {
    case 'STRONG_BULLISH':
      return 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]';
    case 'BULLISH':
      return 'bg-[#F0FDF4] text-[#059669] border border-[#BBF7D0]';
    case 'NEUTRAL':
      return 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]';
    case 'BEARISH':
      return 'bg-[#FFF1F2] text-[#BE123C] border border-[#FECDD3]';
    case 'STRONG_BEARISH':
      return 'bg-[#FFE4E6] text-[#9F1239] border border-[#FDA4AF]';
    case 'INSUFFICIENT_DATA':
      return 'bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]';
  }
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]): void {
  const escape = (cell: string | number | boolean | null | undefined) => {
    const str = cell === null || cell === undefined ? '' : String(cell);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
