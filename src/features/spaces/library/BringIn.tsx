import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Plus, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { importWillFail, shelfActions } from '../data/useShelf';
import { inDialog, isTyping } from '../studio/keys';
import { FLIGHT_EASE } from '../studio/motion';

/**
 * Bring in (One Library spec §5.3): the first cell, a drop anywhere on the
 * screen, and the `U` key. A file becomes a cover that develops in place.
 */

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files');

/**
 * The window-level half: the input to click, the veil, and the keys.
 * `enabled` is false while the shelf is not on screen (loading, error).
 * `onBrought` hears the ids of what just came in.
 */
export function useBringIn(enabled: boolean, onBrought?: (ids: string[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [veil, setVeil] = useState(false);
  const depth = useRef(0);
  const onBroughtRef = useRef(onBrought);
  onBroughtRef.current = onBrought;

  /* The development itself runs in the store (`mocks/shelf.ts`), not in a cover. */
  const bringFiles = useCallback((files: FileList | File[] | null | undefined) => {
    const fail = importWillFail();
    const ids = Array.from(files ?? []).map((f) => shelfActions.bringIn(f.name, undefined, { fail }));
    if (ids.length) onBroughtRef.current?.(ids);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setVeil(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // allow the drop
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVeil(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setVeil(false);
      bringFiles(e.dataTransfer?.files);
    };
    const reset = () => {
      depth.current = 0;
      setVeil(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'u' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || inDialog(e.target)) return;
      const input = inputRef.current;
      if (!input) return;
      e.preventDefault();
      input.click();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', reset);
      window.removeEventListener('dragend', reset);
      depth.current = 0;
      setVeil(false);
    };
  }, [enabled, bringFiles]);

  return { inputRef, veil, bringFiles };
}

/** The full-page veil: a dashed hairline frame and one line. */
export function DropVeil({ show }: { show: boolean }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="veil"
          data-testid="drop-veil"
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.24, ease: FLIGHT_EASE }}
        >
          <div className="flex h-full w-full items-center justify-center rounded-[28px] border border-dashed border-white/40">
            <p className="text-[22px] font-medium tracking-[-0.02em] text-foreground">Drop to bring it in</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface TileProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList | null) => void;
  /** `cell` is the first grid cell; `empty` is the whole invitation of an empty shelf. */
  variant: 'cell' | 'empty';
}

/** A label wrapping the real file input. It is the picker, wherever it sits. */
export function BringInTile({ inputRef, onFiles, variant }: TileProps) {
  return (
    <label
      className={cn(
        'group relative block cursor-pointer border border-dashed text-center transition-colors focus-within:border-white/60 hover:border-white/40 hover:bg-white/[0.03]',
        variant === 'cell'
          ? 'flex h-full min-h-[260px] items-center justify-center rounded-2xl border-white/[0.18] p-5'
          : 'mt-12 flex min-h-[44vh] items-center justify-center rounded-[28px] border-white/15 bg-white/[0.015] px-6 py-16',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.pptx,image/*"
        multiple
        aria-label="Bring something in"
        className="sr-only"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <span className="flex flex-col items-center gap-1 text-[13px] text-quiet">
        {variant === 'cell' ? (
          <Plus aria-hidden className="mb-1 h-5 w-5" />
        ) : (
          <Upload aria-hidden className="mb-4 h-6 w-6" />
        )}
        <span className={cn('font-medium text-foreground', variant === 'cell' ? 'text-[15px]' : 'text-[19px]')}>
          {variant === 'cell' ? 'Bring something in' : 'Bring in your first file'}
        </span>
        <span className={cn(variant === 'empty' && 'mt-1 max-w-[44ch] text-[14.5px] leading-relaxed')}>
          {variant === 'cell'
            ? 'PDF, PPTX or a photo — drop it, or click'
            : 'PDF, PPTX or a photo. It becomes a page you can read, ask and remember.'}
        </span>
      </span>
    </label>
  );
}
