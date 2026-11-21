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
  onClick?: () => void;
}> = ({ children, className = '', delay = 0, interactive = false, onClick }) => {
  const Component = onClick ? motion.button : motion.div;
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay, ease: KINETIC_EASE }}
      whileHover={interactive ? { y: -2 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      className={`sig-glass ${interactive ? 'sig-glass-interactive' : ''} ${className}`}
    >
      {children}
    </Component>
  );
};

/** Spring-gliding segmented control using Framer Motion shared layoutId */
export function KineticSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  className = '',
  size = 'sm',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  className?: string;
  size?: 'xs' | 'sm';
}) {
  return (
    <div
      className={`inline-flex items-center p-1 rounded-full bg-[#F1F3F7] border border-[#E6E8EE] ${className}`}
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
            } ${active ? 'text-white' : 'text-[#525E70] hover:text-[#0A0D14]'}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={KINETIC_SPRING}
                className="absolute inset-0 rounded-full bg-[#0A0D14] shadow-[0_2px_8px_rgba(10,13,20,0.22)]"
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
}> = ({ value, formatted, className = '' }) => {
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
      ? 'text-[#059669] bg-[#ECFDF5]'
      : pulse === 'down'
        ? 'text-[#E11D48] bg-[#FFF1F2]'
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
  trackClassName = 'bg-[#ECEFF4]',
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

