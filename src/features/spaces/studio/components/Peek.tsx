import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Maximize2, Pin, PinOff, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  onClose(): void;
  onFullPage(): void;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

/** Touch fires pointerleave after every tap inside; only a mouse really leaves. */
const isMouseLike = (e: React.PointerEvent) => e.pointerType !== 'touch' && e.pointerType !== 'pen';

const action =
  'console-focusable inline-flex h-8 items-center gap-1.5 rounded-full bg-[rgb(var(--studio-chip))] px-3 text-[12.5px] text-quiet transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground';

/**
 * The original page, with the spot outlined — spec §4.1.
 *
 * The outline is animated, not re-mounted: moving to the next paragraph on
 * the same page glides it there. A different page crossfades the image.
 */
export function Peek({
  region, materialName, pinned, sourceRemoved, onTogglePin, onClose, onFullPage, onPointerEnter, onPointerLeave,
}: Props) {
  const { t } = useTranslation('v4Library', { keyPrefix: 'studio.canvas' });
  const { page, box } = region;
  // Retries belong to one page: a different page starts clean.
  const [retry, setRetry] = useState({ url: page.imageUrl, n: 0 });
  const attempt = retry.url === page.imageUrl ? retry.n : 0;
  const [failed, setFailed] = useState<string | null>(null);
  const src = attempt ? `${page.imageUrl}?retry=${attempt}` : page.imageUrl;

  return (
    <motion.aside
      aria-label={t('peek.label')}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(e) => isMouseLike(e) && onPointerLeave()}
      className="w-full rounded-2xl border border-[rgb(var(--studio-hairline))] bg-card p-3 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.8)]"
    >
      {sourceRemoved ? (
        <p className="p-3 text-[14px] leading-relaxed text-quiet">
          {t('peek.removed')}
        </p>
      ) : failed === src ? (
        <div className="flex flex-col items-center gap-3 p-6 text-[14px] text-quiet">
          {t('peek.failed')}
          <button type="button" className={action} onClick={() => setRetry({ url: page.imageUrl, n: attempt + 1 })}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" /> {t('peek.retry')}
          </button>
        </div>
      ) : (
        <div
          className="relative overflow-hidden rounded-xl bg-[hsl(var(--studio-paper))] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_2px_6px_rgba(0,0,0,0.3)]"
          style={{ aspectRatio: `${page.width} / ${page.height}` }}
        >
          <AnimatePresence initial={false}>
            <motion.img
              key={src}
              src={src}
              alt={t('page.alt', { page: page.page, name: materialName })}
              loading="lazy"
              decoding="async"
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">
          {t('peek.caption', { name: materialName, page: page.page })}
        </span>
        <button type="button" aria-pressed={pinned} onClick={onTogglePin} className={cn(action, pinned && 'bg-foreground text-background hover:bg-foreground hover:text-background')}>
          {pinned ? <PinOff aria-hidden className="h-3.5 w-3.5" /> : <Pin aria-hidden className="h-3.5 w-3.5" />}
          {t('peek.pin')}
        </button>
        {!sourceRemoved && (
          <button type="button" onClick={onFullPage} className={action}>
            <Maximize2 aria-hidden className="h-3.5 w-3.5" /> {t('peek.fullPage')}
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={t('peek.close')} className={cn(action, 'w-8 justify-center px-0')}>
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
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
