import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NotebookPen, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Starting from the text.
 *
 * Select a sentence in a passage and two things become possible that were
 * already possible from the header — ask the tutor, write a note — except that
 * they now start from the sentence rather than from a blank field. That is the
 * whole of it: this popover adds no capability, it removes the retyping.
 *
 * Five decisions worth naming:
 *
 *   • **Scoped to the article, by element rather than by class.** The rail
 *     holds a thread and a note editor, both full of selectable text, and a
 *     selection there is somebody copying what they wrote, not asking about
 *     the Lesson. The check is `article.contains(range.commonAncestorContainer)`,
 *     so a selection that *starts* in the prose and runs out of it fails too —
 *     its common ancestor is above the article.
 *   • **It never takes focus.** A popover anchored to a pointer gesture has no
 *     control that opened it, so there is nowhere to hand focus back to when it
 *     goes; and moving focus mid-drag would fight the gesture that summoned it.
 *     What it does instead is sit *first* in the reader's DOM, so the Tab after
 *     a selection reaches it rather than walking the whole header first. See
 *     `ReaderScreen`, where it is mounted, for why that ordering costs nothing
 *     when it is closed. Neither action is reachable only this way: the
 *     header's two buttons open both panels without a pointer at all.
 *   • **A mouse press inside it must not destroy the selection it is about.**
 *     `mousedown` on a button collapses the document selection, which fires
 *     `selectionchange`, which unmounts this — before `click`. The action would
 *     be unreachable by mouse, which is the only way it is reachable at all.
 *     So the root cancels the default of `mousedown`: the selection survives
 *     the press, and the quote is still there when the handler runs.
 *   • **Escape peels one layer.** The listener is on the document in the
 *     *capture* phase and stops propagation, so the rail's own Escape handler
 *     never sees the press. With both up, the first Escape takes the popover
 *     and the second takes the rail, rather than one press taking both.
 *   • **Position is inline style, never a computed class.** Tailwind scans
 *     source text, so a class assembled from a number at runtime generates no
 *     CSS at all — the class list looks right and `getComputedStyle` says
 *     nothing happened. `ReaderScreen`'s dock lost a day to exactly that. Every
 *     class here is a literal and every number is a style.
 *
 * Selecting a sentence is not progress. Nothing here touches `progress`, and
 * asking about an idea is not the same as having cleared it.
 */

/**
 * Below this, a selection is a mis-click rather than a question.
 *
 * A double-click on one short word ("key", "row") is the common accident, and
 * a popover appearing over the text every time somebody double-clicks is the
 * kind of chrome that makes a reader feel nervous. Eight characters is roughly
 * one real word; it is a floor, not a sentence detector.
 */
export const MIN_SELECTION = 8;

/** Room between the popover and the selection it hangs off. */
const GAP = 8;
/** Room between the popover and the edge of the window. */
const PAD = 8;

interface Props {
  /**
   * The one element a selection may come from. Null on the Lessons that have
   * no prose — there is no article, so there is nothing to select from, and
   * this quietly does nothing rather than needing a second mounting rule.
   */
  articleRef: React.RefObject<HTMLElement>;
  onAsk: (quote: string) => void;
  onSaveNote: (quote: string) => void;
}

/**
 * What the popover is hanging off: the words, and the box they occupy.
 *
 * The rectangle is copied out rather than the `Range` being kept. A live range
 * is invalidated by the next re-render of the passage under it, and the two
 * numbers actually wanted are the ones read at the moment of selection.
 */
interface Anchor {
  quote: string;
  centreX: number;
  top: number;
  bottom: number;
}

export function SelectionAsk({ articleRef, onAsk, onSaveNote }: Props) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [saved, setSaved] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popover = useRef<HTMLDivElement>(null);

  const shown = anchor !== null;

  useEffect(() => {
    const onSelectionChange = () => {
      const article = articleRef.current;
      const sel = document.getSelection();
      if (!article || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setAnchor(null);

      const range = sel.getRangeAt(0);
      if (!article.contains(range.commonAncestorContainer)) return setAnchor(null);

      /*
       * Collapsed whitespace, because a selection across two paragraphs picks
       * up the newline and the indentation between them. The quote is going
       * into a tutor's composer and into a note body, and both of those are
       * one line of prose about the Lesson, not a transcript of the markup.
       */
      const quote = sel.toString().replace(/\s+/g, ' ').trim();
      if (quote.length < MIN_SELECTION) return setAnchor(null);

      /*
       * `getBoundingClientRect` of the whole range, so a selection spanning
       * two paragraphs is anchored to the box around both. Viewport
       * coordinates, which is what a `position: fixed` popover wants —
       * provided nothing between it and the viewport carries a transform.
       * `ReaderScreen` mounts this outside the docked wrapper for that reason.
       */
      const r = range.getBoundingClientRect();
      setSaved(false);
      setAnchor({ quote, centreX: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [articleRef]);

  /*
   * Measured, then placed, in one pass before paint.
   *
   * The width cannot be assumed — it is two labels in whatever the reader's
   * font renders them at, and it changes again when the confirmation replaces
   * them — so the element is rendered, measured, and moved. `useLayoutEffect`
   * runs before the browser paints, so the un-placed first pass is never seen;
   * `visibility` keeps it from flashing at the origin on the very first show,
   * while still giving it a box to measure.
   */
  useLayoutEffect(() => {
    const el = popover.current;
    if (!anchor || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const left = Math.max(PAD, Math.min(anchor.centreX - width / 2, vw - width - PAD));
    /*
     * Above the selection, which is where it belongs — below it would cover
     * the next line, which is the line you are about to read. It flips under
     * only when there is no room above, and that case is real: a selection in
     * the first line of a passage scrolled to the top of the window.
     */
    const above = anchor.top - GAP - height;
    const top =
      above >= PAD ? above : Math.max(PAD, Math.min(anchor.bottom + GAP, vh - height - PAD));

    setPos({ left, top });
  }, [anchor, saved]);

  useEffect(() => {
    if (!shown) return;

    /*
     * Capture, and it stops there. A bubble-phase listener would reach the
     * document *after* the rail's, so Escape would close both layers at once.
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAnchor(null);
    };
    /*
     * `pointerdown` rather than `click`: the popover has to be gone before the
     * press that starts the *next* selection lands, or it sits over the words
     * being dragged through. Its own presses are excluded by containment —
     * and by the `mousedown` default being cancelled below, so the selection
     * behind it survives the press too.
     */
    const onDown = (e: PointerEvent) => {
      if (popover.current?.contains(e.target as Node)) return;
      setAnchor(null);
    };
    /*
     * Capture on scroll, because the passage does not scroll — the window
     * does, and so does the rail, and a popover pinned to a rectangle that has
     * moved is pointing at the wrong sentence.
     */
    const onScroll = () => setAnchor(null);

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [shown]);

  /* The confirmation is a beat, not a state to dismiss by hand. */
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => {
      setSaved(false);
      setAnchor(null);
    }, 2200);
    return () => clearTimeout(t);
  }, [saved]);

  if (!anchor) return null;

  return (
    <div
      ref={popover}
      role="group"
      aria-label="What to do with the selected sentence"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? undefined : 'hidden',
      }}
      className={cn(
        'fixed z-[60] flex items-center gap-0.5 rounded-full p-1',
        'border border-white/[0.10] bg-[#0b1020]/95 shadow-lg shadow-black/40 backdrop-blur-md',
      )}
    >
      {/*
        Live from the moment the popover exists, so the confirmation is a text
        change inside a region that is already there — which is announced
        reliably, where a region inserted along with its own text is not. Empty
        and `sr-only` until there is something to say.
      */}
      <p
        aria-live="polite"
        className={cn(
          'px-3 text-[12.5px] font-medium text-secondary',
          !saved && 'sr-only',
        )}
      >
        {saved ? 'Saved to your notes.' : ''}
      </p>

      {!saved && (
        <>
          <button
            type="button"
            onClick={() => {
              onAsk(anchor.quote);
              setAnchor(null);
            }}
            className="console-focusable flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-white/[0.08]"
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            Ask the tutor
          </button>
          <button
            type="button"
            onClick={() => {
              onSaveNote(anchor.quote);
              setSaved(true);
            }}
            className="console-focusable flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-white/[0.08]"
          >
            <NotebookPen aria-hidden className="h-3.5 w-3.5" />
            Save as note
          </button>
        </>
      )}
    </div>
  );
}
