import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Quote, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { askTutor, type TutorCitation, type TutorReply } from '../../mocks/tutor';
import type { Lesson } from '../../types';

/**
 * Asking about what you are reading.
 *
 * A thread, in the rail, about this Lesson and nothing else. The reason it is
 * worth building at all is the last line of every answer: a citation chip that
 * turns back into the Lesson — a passage to scroll to, a page of the Material
 * to turn to — so an answer is a way *into* the text rather than a substitute
 * for having read it.
 *
 * Four decisions worth naming:
 *
 *   • **The marker is chrome and the prose is not.** One quiet line at the
 *     top, and only where the Space has grounding switched on; where it is off
 *     there is no marker at all, not a greyed one (Doc 1: "a marker on
 *     everything would be a marker on nothing"). No answer's text ever claims
 *     to be grounded — the chips carry that structurally, which is a claim you
 *     can press rather than one you have to believe.
 *   • **A citation is a button only where there is somewhere to land.** The
 *     brief says a page citation goes inert when the Material was deleted; the
 *     rule underneath that is broader and is the one implemented — a chip is a
 *     control when the thing it names is *in this Lesson*, and a sentence
 *     otherwise. A Material with no pages read, or a page number past the end
 *     of one, both produce a chip that would look live and do nothing, which
 *     is the same dead end the Source view's sync line was rebuilt to remove.
 *   • **One question in flight.** The composer and the quick prompts go quiet
 *     while an answer is coming. Two overlapping asks would interleave in a
 *     thread that reads top to bottom, and a reader would have no way to tell
 *     which answer belonged to which question.
 *   • **The thread is per Lesson.** It clears when the Lesson does. Carrying
 *     it across would make "this Lesson" — the thing the empty state promises
 *     and the citations rely on — quietly untrue on the second Lesson.
 *
 * Asking is not progress. Nothing here touches `progress` or awards anything,
 * for the same reason reading does not: what learning does to the map is an
 * open question in Doc 1 and a panel must not answer one.
 */

/** Openers for somebody who does not yet know what to ask. */
export const QUICK_PROMPTS = ['Explain more simply', 'Concrete example', 'Why does this matter?'];

interface Props {
  lesson: Lesson;
  /** The Space's setting. False renders no marker at all. */
  groundingEnabled: boolean;
  onCiteConcept: (conceptId: string) => void;
  onCiteMaterial: (page: number) => void;
  /** A sentence carried in from the text, waiting to be asked about. */
  pendingQuote?: string;
  /** Called when that sentence has been sent, or dropped. */
  onQuoteConsumed: () => void;
}

/**
 * One question and its answer.
 *
 * `status` rather than a nullable reply: pending, failed and answered are
 * three states the panel renders differently, and `reply === undefined` can
 * only tell two of them apart.
 */
interface Turn {
  id: number;
  question: string;
  quote?: string;
  status: 'pending' | 'done' | 'error';
  reply?: TutorReply;
}

export function TutorPanel({
  lesson,
  groundingEnabled,
  onCiteConcept,
  onCiteMaterial,
  pendingQuote,
  onQuoteConsumed,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');

  /*
   * Ids that never restart, even though the thread does.
   *
   * A counter reset alongside the thread would hand the next Lesson's first
   * question the id an in-flight request from the previous one is still
   * holding, and that answer would land in the wrong thread under the wrong
   * question. Monotonic across the panel's life, so a stale resolution matches
   * nothing and falls on the floor, which is exactly what it should do.
   */
  const nextId = useRef(0);

  /*
   * Clear on a change of Lesson, during render rather than in an effect —
   * React's documented way to adjust state when a prop changes, and it avoids
   * the frame where the previous Lesson's thread is still on screen under the
   * new Lesson's title.
   */
  const [threadFor, setThreadFor] = useState(lesson.id);
  if (threadFor !== lesson.id) {
    setThreadFor(lesson.id);
    setTurns([]);
    setDraft('');
  }

  const busy = turns.some((t) => t.status === 'pending');

  /*
   * Keep the newest turn in view.
   *
   * Assigned rather than animated: `scrollIntoView` on a page whose stylesheet
   * sets `scroll-behavior: smooth` would animate past anybody who asked for
   * less motion, which is the trap `ReaderScreen`'s jump had to be written
   * around. Setting `scrollTop` is instant by definition.
   */
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const run = (id: number, question: string, quote?: string) => {
    askTutor(lesson.id, question, quote).then(
      (reply) =>
        setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'done', reply } : t))),
      () => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, status: 'error' } : t))),
    );
  };

  const ask = (question: string) => {
    if (busy) return;
    const quote = pendingQuote;
    const id = nextId.current++;
    setTurns((ts) => [...ts, { id, question, quote, status: 'pending' }]);
    if (quote) onQuoteConsumed();
    run(id, question, quote);
  };

  const submit = () => {
    const question = draft.trim();
    // An empty send is a mis-hit, not a question.
    if (!question || busy) return;
    setDraft('');
    ask(question);
  };

  const retry = (turn: Turn) => {
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'pending' } : t)));
    run(turn.id, turn.question, turn.quote);
  };

  /*
   * Does this citation point at something this Lesson can show?
   *
   * A Concept needs a passage to scroll to — on a Lesson with a Material and
   * no text there is none — and a page needs to be a page the Material has.
   * Both questions have to be asked here rather than after the press, because
   * a control that answers "nowhere" is a control that should not have looked
   * like one.
   */
  const landable = (c: TutorCitation) =>
    (c.conceptId !== undefined && (lesson.passages ?? []).some((p) => p.conceptId === c.conceptId)) ||
    (c.materialPage !== undefined &&
      (lesson.material?.pages ?? []).some((p) => p.page === c.materialPage));

  const follow = (c: TutorCitation) => {
    if (c.conceptId !== undefined) onCiteConcept(c.conceptId);
    else if (c.materialPage !== undefined) onCiteMaterial(c.materialPage);
  };

  return (
    <div className="flex h-full flex-col">
      {/*
        Dormant by default, and absent rather than dimmed when it is. The Space
        either makes this claim or it does not.
      */}
      {groundingEnabled && (
        <p className="flex items-start gap-1.5 border-b border-white/[0.06] px-4 py-2.5 text-[11.5px] leading-[1.45] text-faint">
          <Quote aria-hidden className="mt-[3px] h-2.5 w-2.5 shrink-0" />
          Grounded — answers draw on this Space&rsquo;s Lessons and name where they came from.
        </p>
      )}

      {/*
        The panel scrolls its own thread rather than letting the rail scroll
        the whole of it, so the composer stays where you left it. `h-full` on
        the wrapper is what makes that possible inside the rail's scroller
        without the rail having to know a tutor is in there.
      */}
      <div ref={thread} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <p className="px-1 text-[13px] leading-[1.55] text-faint">
            Ask about anything in this Lesson — or select a sentence in the text and start from
            there.
          </p>
        ) : (
          turns.map((t) => (
            <div key={t.id} className="mb-6 last:mb-0">
              {t.quote && (
                <p className="mb-2 border-l-2 border-white/[0.14] pl-3 text-[12.5px] italic leading-[1.5] text-faint">
                  &ldquo;{t.quote}&rdquo;
                </p>
              )}

              {/*
                Who said what, for somebody who cannot see that one of these
                is a filled bubble and the other is not. The label is a
                separate span rather than a prefix on the same node so the
                question is still one addressable string.
              */}
              <p className="rounded-2xl bg-white/[0.05] px-3.5 py-2.5 text-[13.5px] leading-[1.55] text-foreground">
                <span className="sr-only">You asked: </span>
                <span>{t.question}</span>
              </p>

              {/*
                A live region per turn, and it is here rather than around the
                whole thread on purpose: a live thread announces your own
                question back at you the moment you send it, which is the one
                thing in the panel you already know.

                It is rendered with the turn, so the "Thinking…" it opens with
                arrives as part of an insertion — some screen readers announce
                that and some do not. The reply, which is the part worth
                hearing, replaces text in a region that by then exists, and
                that change is announced reliably. Getting the second one right
                is what this is for.
              */}
              <div aria-live="polite" className="mt-2.5">
                {t.status === 'pending' && (
                  <p className="px-1 text-[12.5px] text-faint">Thinking…</p>
                )}

                {t.status === 'error' && (
                  <div className="px-1">
                    <p className="text-[12.5px] leading-[1.5] text-quiet">
                      That answer did not come back.
                    </p>
                    <button
                      type="button"
                      onClick={() => retry(t)}
                      className="console-focusable mt-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-white/[0.08]"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {t.status === 'done' && t.reply && (
                  <>
                    <p className="px-1 text-[14px] leading-[1.65] text-foreground">
                      <span className="sr-only">Answer: </span>
                      <span>{t.reply.text}</span>
                    </p>
                    {t.reply.citations.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 px-1">
                        {t.reply.citations.map((c) =>
                          landable(c) ? (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => follow(c)}
                              className={cn(
                                'console-focusable inline-flex items-center gap-1 rounded-full',
                                'border border-white/[0.10] bg-white/[0.04] px-2.5 py-[3px]',
                                'text-[11.5px] font-medium text-secondary transition-colors hover:bg-white/[0.08]',
                              )}
                            >
                              {c.label}
                              <ArrowUpRight aria-hidden className="h-2.5 w-2.5" />
                            </button>
                          ) : (
                            /*
                              Named, not offered. The answer still says where it
                              came from — that is the whole promise of the
                              marker above — but this Lesson has no copy of it
                              left to open.
                            */
                            <span
                              key={c.label}
                              className="inline-flex items-center rounded-full border border-white/[0.06] px-2.5 py-[3px] text-[11.5px] font-medium text-faint"
                            >
                              {c.label}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.07] px-3 py-3">
        {/*
          The carried selection, before it is asked about. Visible because
          otherwise it is state with no representation: you would send a
          question and get an answer shaped by a sentence you had forgotten
          you picked. Droppable for the same reason.
        */}
        {pendingQuote && (
          <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <p className="line-clamp-3 min-w-0 flex-1 text-[12px] italic leading-[1.45] text-quiet">
              &ldquo;{pendingQuote}&rdquo;
            </p>
            <button
              type="button"
              aria-label="Drop the selected sentence"
              onClick={onQuoteConsumed}
              className="console-focusable -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy}
              onClick={() => ask(p)}
              className="console-focusable rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-[5px] text-[12px] text-quiet transition-colors hover:bg-white/[0.07] hover:text-foreground disabled:text-faint disabled:hover:bg-white/[0.03]"
            >
              {p}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-2.5 flex items-center gap-2"
        >
          {/* A form, so Enter sends without a keydown handler to get wrong. */}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Ask about this Lesson"
            placeholder="Ask about this Lesson"
            className="console-focusable h-10 min-w-0 flex-1 rounded-full border border-white/[0.10] bg-white/[0.04] px-4 text-[13.5px] text-foreground outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || draft.trim().length === 0}
            className="console-focusable flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 disabled:bg-white/[0.10] disabled:text-quiet"
          >
            <ArrowUp aria-hidden className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
