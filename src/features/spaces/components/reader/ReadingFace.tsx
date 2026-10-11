import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Prose } from '@/components/markdown';
import { Block, Plane, anchorY } from './Planes';
import { blockId, type Anchor, type ReadingSection } from './anchors';

/**
 * The reading face: the parsed text, typeset, at reading distance.
 *
 * One column, 52ch of measure, 18px on a 1.7 line — the numbers a person can
 * sit inside for an hour. Every page of the Material is here, in the order
 * the file has them, under the Concept it explains. Nothing else is on the
 * face at first. What appears later appears *in the text*: a heading you can
 * press for its notes, a small white page beside each block that opens the
 * Material at that page, a formula that opens a question about itself. Those
 * are marks, and they arrive only once the Learner has engaged — until then
 * the column is a column.
 *
 * The face owns its scroll and reports where it is as an anchor — the block
 * under the anchor line. It is told the anchor back when it is the room, so
 * that the moment it comes forward it is already where the Learner was.
 */

interface Props {
  title: string;
  sections: ReadingSection[];
  focused: boolean;
  engaged: boolean;
  anchor: Anchor | null;
  onAnchor: (a: Anchor) => void;
  onOpenPage: (page: number) => void;
  /** The idea whose heading was pressed, and the page its section starts on. */
  onOpenNotes: (conceptId: string, page: number) => void;
  onAskFormula: (tex: string) => void;
  /** Whether a companion card fits beside the column; below it otherwise. */
  wide: boolean;
  companion?: { page: number; node: ReactNode } | null;
  /** The one line that is there before anything is earned. */
  hint?: ReactNode;
  /** What comes after the last passage. */
  footer?: ReactNode;
  scrollRef: RefObject<HTMLDivElement>;
  /** Classes for the article — the studio's column is narrower than a page's. */
  articleClassName?: string;
  /** The studio's narrow column takes a smaller scale than a page-wide one. */
  compact?: boolean;
}

/** "Functional Dependencies" and "Functional dependency" are the same heading. */
const sameHeading = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '') ===
  b.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');

/** Put a page's block on the anchor line. Instant unless asked otherwise. */
export function scrollToBlock(container: HTMLElement, page: number, behavior: ScrollBehavior) {
  const el = container.querySelector<HTMLElement>(`#${blockId(page)}`);
  if (!el) return;
  /*
   * Measured against the container, not read off `offsetTop`: a block sits in
   * a positioned wrapper (the companion hangs off it), so its `offsetTop` is
   * the distance to that wrapper — zero — and not to the scroller.
   */
  const top =
    el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - anchorY() + 8;
  container.scrollTo({ top: Math.max(0, top), behavior });
}

export function ReadingFace({
  title,
  sections,
  focused,
  engaged,
  anchor,
  onAnchor,
  onOpenPage,
  onOpenNotes,
  onAskFormula,
  wide,
  companion,
  hint,
  footer,
  scrollRef,
  articleClassName = 'mx-auto max-w-2xl px-6 pb-[40vh] pt-[22vh]',
  compact = false,
}: Props) {
  const reduce = useReducedMotion();
  /* The last anchor this face itself reported, so being told it back is a no-op. */
  const reported = useRef<number | null>(null);

  /*
   * Follow the anchor while it comes from elsewhere — the other face, a
   * citation, the spine. A layout effect, so the scroll lands before the
   * blocks measure their distance for the ripple.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !anchor) return;
    if (reported.current === anchor.page) return;
    scrollToBlock(el, anchor.page, 'auto');
    /*
     * `focused` is a dependency on purpose: coming forward re-lands on the
     * anchor even when the anchor did not move, so nothing that touched the
     * room's scroll while it was the room (an automated `scrollIntoView`, a
     * browser's find-in-page) can leave the face somewhere else.
     */
  }, [anchor, focused, scrollRef]);

  /* Report the block under the anchor line, once per frame at most. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !focused) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const fy = el.getBoundingClientRect().top + anchorY();
      const blocks = el.querySelectorAll<HTMLElement>('[data-page]');
      let hit: HTMLElement | null = null;
      for (const b of blocks) {
        const r = b.getBoundingClientRect();
        if (r.top <= fy) hit = b;
        else break;
      }
      if (!hit) return;
      const page = Number(hit.dataset.page);
      const conceptId = hit.dataset.concept ?? '';
      if (reported.current === page) return;
      reported.current = page;
      onAnchor({ conceptId, page });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [focused, onAnchor, scrollRef]);

  /* Once the face is the room again, whatever it reported is stale. */
  useEffect(() => {
    if (!focused) reported.current = null;
  }, [focused]);

  const onArticleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!engaged) return;
    const formula = (e.target as HTMLElement).closest<HTMLElement>('.katex-display');
    if (!formula) return;
    const tex = formula.querySelector('annotation')?.textContent?.trim();
    if (tex) onAskFormula(tex);
  };

  return (
    <Plane focused={focused} label="The text">
      <div
        ref={scrollRef}
        data-reading-face
        className={cn('relative h-full', focused ? 'overflow-y-auto' : 'overflow-hidden')}
      >
        <article
          onClick={onArticleClick}
          className={cn(
            articleClassName,
            engaged && '[&_.katex-display]:cursor-pointer [&_.katex-display]:rounded-md [&_.katex-display]:border-b [&_.katex-display]:border-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))]/40',
          )}
        >
          <Block focused={focused} className="max-w-[52ch]">
            <h1
              className={cn(
                'font-bold leading-[1.15] tracking-[-0.02em] text-foreground',
                compact ? 'text-[26px]' : 'text-[34px]',
              )}
            >
              {title}
            </h1>
            {hint && <div className="mt-4">{hint}</div>}
          </Block>

          {sections.map((s) => (
            <section
              key={s.conceptId}
              id={`section-${s.conceptId}`}
              className={cn('scroll-mt-24', compact ? 'mt-14' : 'mt-[4.9em]')}
            >
              <Block focused={focused} className="max-w-[52ch]">
                <h2
                  className={cn(
                    'font-semibold leading-[1.25] tracking-[-0.01em] text-foreground',
                    compact
                      ? 'mb-5 text-[13.5px] text-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))]'
                      : 'mb-[1.7em] text-[22px]',
                  )}
                >
                  {engaged ? (
                    /*
                     * The heading is the mark. Pressing an idea's name opens
                     * your notes on it — a hairline in the margin says it can
                     * be pressed, and nothing else changes about the word.
                     */
                    <button
                      type="button"
                      onClick={() => onOpenNotes(s.conceptId, s.firstPage)}
                      aria-label={`Notes for ${s.name}`}
                      className={cn(
                        'console-focusable relative -ml-5 rounded-sm pl-5 text-left transition-colors',
                        'before:absolute before:left-0 before:top-[0.55em] before:h-px before:w-3 before:bg-white/[0.18] before:content-[""]',
                        'hover:before:bg-[color:var(--reader-accent,theme(colors.secondary.DEFAULT))]',
                      )}
                    >
                      {s.name}
                    </button>
                  ) : (
                    s.name
                  )}
                </h2>
              </Block>

              {s.blocks.map((b) => {
                const isAnchor = anchor?.page === b.page;
                const withCompanion = companion && companion.page === b.page;
                return (
                  <div key={b.id} className="relative">
                    <Block
                      focused={focused}
                      as="div"
                      id={b.id}
                      anchor={isAnchor}
                      data-page={b.page}
                      className="relative mb-[1.7em] max-w-[52ch] last:mb-0"
                    >
                      {/* The section's id rides on each block for the scroll reader. */}
                      <span hidden data-concept={s.conceptId} />
                      <PageChip page={b.page} engaged={engaged} onOpen={onOpenPage} />
                      {/*
                        A page's own subtitle, when it says something the
                        headings above it do not. The parser falls back to the
                        deck's running section header when a page has no
                        subtitle, which would print "Functional dependency"
                        under "Functional dependency" on every other page.
                      */}
                      {b.title && !sameHeading(b.title, s.name) && !sameHeading(b.title, title) && (
                        <h3
                          className={cn(
                            'mb-2 font-semibold leading-[1.4] text-foreground',
                            compact ? 'text-[16.5px]' : 'text-[18px]',
                          )}
                        >
                          {b.title}
                        </h3>
                      )}
                      <Prose>{b.markdown}</Prose>
                    </Block>
                    {withCompanion &&
                      (wide ? (
                        <div className="absolute left-full top-0 ml-6 w-96">{companion.node}</div>
                      ) : (
                        <div className="mb-[1.7em] max-w-[52ch]">{companion.node}</div>
                      ))}
                  </div>
                );
              })}
            </section>
          ))}

          {footer && <Block focused={focused} className="max-w-[52ch]">{footer}</Block>}
        </article>
      </div>
      <span hidden data-reduce={reduce ? '1' : '0'} />
    </Plane>
  );
}

/**
 * The page in miniature: a trace of the other face, in the other face's
 * material. A readout at first; a mark once the Learner has engaged.
 */
function PageChip({ page, engaged, onOpen }: { page: number; engaged: boolean; onOpen: (p: number) => void }) {
  const shape = 'block h-[9px] w-3 rounded-[2px] bg-white/[0.85] shadow-[0_0_12px_rgba(255,255,255,0.18)]';
  if (!engaged)
    return <span aria-hidden className={cn('absolute -left-10 top-[0.6em]', shape)} />;
  return (
    <button
      type="button"
      onClick={() => onOpen(page)}
      aria-label={`Page ${page} of the Material`}
      className="console-focusable absolute -left-12 top-0 flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/[0.06]"
    >
      <span aria-hidden className={shape} />
    </button>
  );
}
