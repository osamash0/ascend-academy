import { useEffect } from 'react';

/** 40% from the top: where the eye reads, so a pinned Peek follows it (spec §4.1 rule 3). */
export const READING_LINE = 0.4;

export function useReadingLine(
  enabled: boolean,
  column: React.RefObject<HTMLElement>,
  onBlock: (blockId: string) => void,
): void {
  useEffect(() => {
    if (!enabled || typeof document.elementsFromPoint !== 'function') return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const r = column.current?.getBoundingClientRect();
      const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
      for (const el of document.elementsFromPoint(x, window.innerHeight * READING_LINE)) {
        const block = (el as HTMLElement).closest?.('[data-block-id][data-extracted="true"]') as HTMLElement | null;
        if (block?.dataset.blockId) {
          onBlock(block.dataset.blockId);
          return;
        }
      }
    };
    // One hit-test per frame, however many scroll events arrive.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [enabled, column, onBlock]);
}

/** The block under the reading line right now, once (Living Learn spec §4.2, last fallback). */
export function blockAtReadingLine(column: HTMLElement | null): string | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const r = column?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  for (const el of document.elementsFromPoint(x, window.innerHeight * READING_LINE)) {
    const block = (el as HTMLElement).closest?.('[data-block-id]:not([data-woven])') as HTMLElement | null;
    if (block?.dataset.blockId) return block.dataset.blockId;
  }
  return null;
}
