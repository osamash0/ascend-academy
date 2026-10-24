import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Mark } from '@/features/landing/sections';
import { Skylight } from '@/features/spaces/components/stage';
import { cn } from '@/lib/utils';

/**
 * The stage outside the app: sign-in, sign-up and first run.
 *
 * The same black ground and single light as every v4 room, the landing's mark
 * top-left, a slot top-right, and one centred column. The light is white until
 * someone picks Luna's; when `accent` changes, the old light fades out under
 * the new one, so the room is relit rather than repainted.
 */
export function StagePage({
  accent,
  home,
  homeLabel,
  topRight,
  className,
  children,
}: {
  /** The room's light. White when null. */
  accent?: string | null;
  /** Where the mark links; omit to make it a plain mark (mid-flow). */
  home?: string;
  homeLabel?: string;
  topRight?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-[100dvh] overflow-x-clip bg-black text-white antialiased">
      <AnimatePresence initial={false}>
        <motion.div
          key={accent ?? 'white'}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <Skylight accent={accent ?? '#ffffff'} strength={accent ? 20 : 9} />
        </motion.div>
      </AnimatePresence>

      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-6">
        {home ? (
          <Link to={home} aria-label={homeLabel} className="console-focusable rounded-[11px]">
            <Mark />
          </Link>
        ) : (
          <Mark />
        )}
        <div className="flex items-center gap-1">{topRight}</div>
      </header>

      <main
        className={cn(
          'relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col items-center justify-center px-6 pb-14 pt-24',
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
