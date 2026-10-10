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
    const check = () => {
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
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [enabled, column, onBlock]);
}
