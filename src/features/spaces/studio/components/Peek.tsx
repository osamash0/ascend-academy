import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Maximize2, Pin, PinOff, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { boxStyle } from '../geometry';
import type { Region } from '../geometry';
import { FLIGHT_EASE, GLIDE_S } from '../motion';

interface Props {
  region: Region;
  materialName: string;
  pinned: boolean;
  sourceRemoved: boolean;
  onTogglePin(): void;
  onFullPage(): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

const action =
  'inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted';

/**
 * The original page, with the spot outlined — spec §4.1.
 *
 * The outline is animated, not re-mounted: moving to the next paragraph on
 * the same page glides it there. A different page crossfades the image.
 */
export function Peek({
  region, materialName, pinned, sourceRemoved, onTogglePin, onFullPage, onPointerEnter, onPointerLeave,
}: Props) {
  const { page, box } = region;
  // Retries belong to one page: a different page starts clean.
  const [retry, setRetry] = useState({ url: page.imageUrl, n: 0 });
  const attempt = retry.url === page.imageUrl ? retry.n : 0;
  const [failed, setFailed] = useState<string | null>(null);
  const src = attempt ? `${page.imageUrl}?retry=${attempt}` : page.imageUrl;

  return (
    <motion.aside
      aria-label="Original page"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="rounded-2xl border border-border bg-card p-3 shadow-sm"
    >
      {sourceRemoved ? (
        <p className="p-3 text-sm text-muted-foreground">
          The original file was removed. Your clean version keeps working.
        </p>
      ) : failed === src ? (
        <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
          Couldn’t load this page.
          <button type="button" className={action} onClick={() => setRetry({ url: page.imageUrl, n: attempt + 1 })}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : (
        <div
          className="relative overflow-hidden rounded-lg border border-border bg-[hsl(var(--studio-paper))]"
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
        >
          <AnimatePresence initial={false}>
            <motion.img
              key={src}
              src={src}
              alt={`Page ${page.page} of ${materialName}`}
              onError={() => setFailed(src)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </AnimatePresence>
          {box && (
            <motion.div
              data-testid="peek-outline"
              aria-hidden
              initial={false}
              animate={boxStyle(box)}
              transition={{ duration: GLIDE_S, ease: FLIGHT_EASE }}
              className="absolute rounded-[4px] border-2 border-[hsl(var(--studio-mark))] bg-[hsl(var(--studio-mark)/0.18)]"
            />
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Original · {materialName} · page {page.page}
        </span>
        <button type="button" aria-pressed={pinned} onClick={onTogglePin} className={cn(action, pinned && 'bg-muted')}>
          {pinned ? <PinOff aria-hidden className="h-3.5 w-3.5" /> : <Pin aria-hidden className="h-3.5 w-3.5" />}
          Pin
        </button>
        {!sourceRemoved && (
          <button type="button" onClick={onFullPage} className={action}>
            <Maximize2 aria-hidden className="h-3.5 w-3.5" /> Full page
          </button>
        )}
      </div>
    </motion.aside>
  );
}

/** Mounts the Peek while there is a region to show, so it can animate out as well as in. */
export function PeekSlot({ region, ...rest }: Omit<Props, 'region'> & { region: Region | null }) {
  return (
    <AnimatePresence>
      {region && <Peek key="peek" region={region} {...rest} />}
    </AnimatePresence>
  );
}
