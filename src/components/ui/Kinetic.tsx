import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';

export const KINETIC_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const KINETIC_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 34,
  mass: 0.78,
};

export const KINETIC_GENTLE = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
  mass: 0.9,
};

/** Choreographed minimal kinetic card with subtle spring entrance & tactile elevation */
export const KineticCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  delay?: number;
  interactive?: boolean;
  surface?: 'glass' | 'dark' | 'sage' | 'none';
  onClick?: () => void;
}> = ({ children, className = '', delay = 0, interactive = false, surface = 'glass', onClick }) => {
  const Component = onClick ? motion.button : motion.div;
  const surfaceClass =
    surface === 'dark'
      ? 'sig-card-dark'
      : surface === 'sage'
        ? 'sig-card-sage'
        : surface === 'none'
          ? ''
          : 'sig-glass';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay, ease: KINETIC_EASE }}
      whileHover={interactive ? { y: -2 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      className={`${surfaceClass} ${interactive && surface === 'glass' ? 'sig-glass-interactive' : ''} ${className}`}
    >
      {children}
    </Component>
  );
};

/** Spring-gliding segmented control matching SIGLENS Obsidian-Emerald pill style */
export function KineticSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  className = '',
  size = 'sm',
  variant = 'obsidian',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  className?: string;
  size?: 'xs' | 'sm';
  variant?: 'obsidian' | 'light';
}) {
  const isObsidian = variant === 'obsidian';
  return (
    <div
      className={`inline-flex items-center p-1 rounded-full ${
        isObsidian
          ? 'bg-[#121814] border border-[#1E2A22]'
          : 'bg-[#EEF2EF] border border-[#E2E8E4]'
      } ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative rounded-full font-mono font-semibold transition-colors whitespace-nowrap ${
              size === 'xs' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1 text-xs'
            } ${
              active
                ? isObsidian
                  ? 'text-[#05140A]'
                  : 'text-white'
                : isObsidian
                  ? 'text-[#9DB2A5] hover:text-white'
                  : 'text-[#55665C] hover:text-[#111814]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={KINETIC_SPRING}
                className={`absolute inset-0 rounded-full ${
                  isObsidian
                    ? 'bg-[#22C55E] shadow-[0_2px_10px_rgba(34,197,94,0.35)]'
                    : 'bg-[#121814] shadow-[0_2px_8px_rgba(12,20,16,0.22)]'
                }`}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Live kinetic numeric readout that pulses directionally when value ticks */
export const KineticPrice: React.FC<{
  value: number | null | undefined;
  formatted: string;
  className?: string;
  darkSurface?: boolean;
}> = ({ value, formatted, className = '', darkSurface = false }) => {
  const prevRef = useRef<number | null | undefined>(value);
  const [pulse, setPulse] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (
      typeof value === 'number' &&
      typeof prev === 'number' &&
      Number.isFinite(value) &&
      Number.isFinite(prev) &&
      value !== prev
    ) {
      setPulse(value > prev ? 'up' : 'down');
      const id = window.setTimeout(() => setPulse(null), 550);
      prevRef.current = value;
      return () => window.clearTimeout(id);
    }
    prevRef.current = value;
    return undefined;
  }, [value]);

  const pulseClass =
    pulse === 'up'
      ? darkSurface
        ? 'text-[#4ADE80] bg-[#22C55E]/15'
        : 'text-[#15803D] bg-[#DCFCE7]'
      : pulse === 'down'
        ? darkSurface
          ? 'text-[#FB7185] bg-[#F43F5E]/15'
          : 'text-[#BE123C] bg-[#FFE4E6]'
        : '';

  return (
    <motion.span
      key={pulse ? `${pulse}-${value}` : 'steady'}
      initial={pulse ? { y: pulse === 'up' ? 2 : -2 } : false}
      animate={{ y: 0 }}
      transition={{ duration: 0.22, ease: KINETIC_EASE }}
      className={`inline-block rounded-md px-0.5 -mx-0.5 transition-colors duration-300 font-mono tabular-nums ${pulseClass} ${className}`}
    >
      {formatted}
    </motion.span>
  );
};

/** Spring-animated horizontal meter bar */
export const KineticMeterBar: React.FC<{
  pct: number;
  barClassName: string;
  trackClassName?: string;
  heightClassName?: string;
  delay?: number;
}> = ({
  pct,
  barClassName,
  trackClassName = 'bg-[#E5EAE7]',
  heightClassName = 'h-1.5',
  delay = 0,
}) => {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`w-full rounded-full overflow-hidden ${trackClassName} ${heightClassName}`}>
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: clamped / 100 }}
        transition={{ duration: 0.55, delay, ease: KINETIC_EASE }}
        style={{ transformOrigin: 'left center' }}
        className={`h-full w-full rounded-full ${barClassName}`}
      />
    </div>
  );
};

/** Signature 5-bar animated vertical KPI sparkbar (matching siglens.ai.studio) */
export const MiniSparkBars: React.FC<{
  values: number[];
  variant: 'dark-emerald' | 'light-emerald' | 'light-rose';
}> = ({ values, variant }) => {
  const bars = values.length >= 5 ? values.slice(-5) : [42, 74, 38, 86, 62];
  const max = Math.max(...bars, 1);
  return (
    <div className="flex items-end gap-1.5 h-11 shrink-0" aria-hidden="true">
      {bars.map((val, idx) => {
        const pct = Math.max(22, Math.min(100, Math.round((val / max) * 100)));
        const isMuted = idx === 1 || idx === 3;
        const barColor =
          variant === 'dark-emerald'
            ? isMuted
              ? 'bg-[#22C55E]/35'
              : 'bg-[#22C55E]'
            : variant === 'light-rose'
              ? isMuted
                ? 'bg-[#E4EAE6]'
                : 'bg-[#E11D48]'
              : isMuted
                ? 'bg-[#E4EAE6]'
                : 'bg-[#16A34A]';
        return (
          <motion.span
            key={idx}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.45, delay: idx * 0.05, ease: KINETIC_EASE }}
            style={{ height: `${pct}%`, transformOrigin: 'bottom center' }}
            className={`w-[5px] rounded-full ${barColor}`}
          />
        );
      })}
    </div>
  );
};
