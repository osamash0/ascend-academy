import type { InsightAttention } from '@/features/analytics/types';

/**
 * Clean-analytical palette for the Insight Garden. Calm → teal, watch → sand,
 * act → coral. No harsh red/green; one accent reserved for "needs attention".
 */
export interface AttentionStyle {
  label: string;
  dot: string;
  border: string;
  text: string;
  ring: string;
  glow: string;
}

export const attentionStyles: Record<InsightAttention, AttentionStyle> = {
  calm: {
    label: 'Minor',
    dot: 'bg-teal-400',
    border: 'border-teal-500/25',
    text: 'text-teal-300',
    ring: 'hover:border-teal-400/50',
    glow: '',
  },
  watch: {
    label: 'Worth a look',
    dot: 'bg-amber-400',
    border: 'border-amber-500/30',
    text: 'text-amber-300',
    ring: 'hover:border-amber-400/60',
    glow: 'shadow-[0_0_40px_-12px_rgba(251,191,36,0.25)]',
  },
  act: {
    label: 'Needs attention',
    dot: 'bg-rose-400',
    border: 'border-rose-500/40',
    text: 'text-rose-300',
    ring: 'hover:border-rose-400/70',
    glow: 'shadow-[0_0_48px_-10px_rgba(251,113,133,0.32)]',
  },
};

export function attentionStyle(a: InsightAttention): AttentionStyle {
  return attentionStyles[a] ?? attentionStyles.calm;
}
