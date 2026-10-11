/**
 * The app's loader: the student's own Luna, thinking (features/avatar/LunaSpinner).
 * Keeps the old `<LunaLoader type size />` call shape; `type` no longer picks
 * a different character, there is one Luna.
 */
import { LunaSpinner } from '@/features/avatar/LunaSpinner';

export function LunaLoader({ size = 64, className }: { type?: string; size?: number; className?: string }) {
  return <LunaSpinner size={size} className={className} />;
}
