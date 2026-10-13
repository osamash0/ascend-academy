import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BookOpen, Check, PenLine } from 'lucide-react';
import { PdfPage } from '@/components/pdf';
import { cn } from '@/lib/utils';
import type { Light } from '../course/light';
import type { Concept } from '../../types';

/**
 * The Lesson's ideas, each shown where it lives in the deck.
 *
 * A numbered chain on the left — the order the deck teaches them in — and,
 * for the one chosen, its first slide, how many pages it spans, and what
 * Explain says it is in one line. Two ways on: read from that page, or open
 * the idea's own overview. Progress is a readout of what the engine knows;
 * nothing here changes it.
 */

export interface IdeaEntry {
  concept: Concept;
  firstPage: number;
  lastPage: number;
  /** The page shown for it — where Explain has the most to say. */
  previewPage: number;
  /** Explain's headline for the idea's first page. */
  gist: string;
  /** What checkpoints and rehearsals have proven (real courses); replaces `progress` when set. */
  light?: Light;
}

interface Props {
  ideas: IdeaEntry[];
  file: string;
  readHref: (page: number) => string;
  conceptHref: (id: string) => string;
  /** Real courses: explain the idea back instead of the (demo-only) idea page. */
  onTeach?: (idea: IdeaEntry) => void;
}

const LIGHT_WORD: Record<Light, string | null> = {
  lit: 'Tested right',
  fading: 'Fading',
  weak: 'To revisit',
  dark: null,
};

const STATE: Record<Concept['progress'], string | null> = {
  cleared: 'Cleared',
  discovered: 'Read',
  untouched: null,
};

export function IdeaExplorer({ ideas, file, readHref, conceptHref, onTeach }: Props) {
  const firstOpen = ideas.find((i) => i.concept.progress !== 'cleared') ?? ideas[0];
  const [on, setOn] = useState(firstOpen?.concept.id ?? '');
  const idea = ideas.find((i) => i.concept.id === on) ?? ideas[0];
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(240, Math.min(520, el.clientWidth - 48)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!idea) return null;
  const pages = idea.lastPage - idea.firstPage + 1;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <ol role="tablist" aria-label="Ideas in this Lesson" className="space-y-1.5">
        {ideas.map((it, i) => {
          const active = it.concept.id === idea.concept.id;
          return (
            <li key={it.concept.id}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setOn(it.concept.id)}
                className={cn(
                  'console-focusable relative flex w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left transition-colors',
                  active ? 'text-foreground' : 'text-quiet hover:bg-white/[0.04] hover:text-foreground',
                )}
              >
                {active && (
                  <motion.span
                    layoutId="lesson-idea"
                    transition={{ duration: 0.28 }}
                    className="absolute inset-0 rounded-2xl border border-white/[0.1] bg-white/[0.06]"
                  />
                )}
                <span
                  className={cn(
                    'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums',
                    it.light === 'lit' || (!it.light && it.concept.progress === 'cleared')
                      ? 'bg-success/20 text-success'
                      : it.light === 'fading'
                        ? 'bg-success/[0.08] text-success'
                        : it.light === 'weak'
                          ? 'bg-destructive/20 text-destructive'
                          : active
                            ? 'bg-white text-background'
                            : 'bg-white/[0.08]',
                  )}
                >
                  {it.light === 'lit' || (!it.light && it.concept.progress === 'cleared') ? <Check aria-hidden className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{it.concept.name}</span>
                  <span className="block text-[12.5px] text-faint">
                    {/* Said only when there is something to say: an unproven idea is just its pages. */}
                    {(it.light !== undefined ? LIGHT_WORD[it.light] : STATE[it.concept.progress]) && (
                      <>{it.light !== undefined ? LIGHT_WORD[it.light] : STATE[it.concept.progress]} · </>
                    )}
                    Pages {it.firstPage}–{it.lastPage}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div ref={box} className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={idea.concept.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            <div
              className="mb-5 overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]"
              style={{ width, height: Math.round(width * (405 / 720)) }}
            >
              <PdfPage file={file} page={idea.previewPage} width={width} loading="" error="" />
            </div>
            <p className="mb-1 text-[12.5px] text-quiet">
              {pages} page{pages === 1 ? '' : 's'}
            </p>
            <p className="mb-5 text-[20px] font-medium leading-[1.3] tracking-[-0.01em] text-foreground">{idea.gist}</p>
            <div className="flex flex-wrap gap-2">
              <Link
                to={readHref(idea.firstPage)}
                className="console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-medium text-background"
              >
                <BookOpen aria-hidden className="h-4 w-4" />
                Read from page {idea.firstPage}
              </Link>
              {onTeach ? (
                <button
                  type="button"
                  onClick={() => onTeach(idea)}
                  className="console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white/[0.07] px-4 text-[13.5px] text-foreground transition-colors hover:bg-white/[0.12]"
                >
                  <PenLine aria-hidden className="h-4 w-4" />
                  Teach it back
                </button>
              ) : (
                <Link
                  to={conceptHref(idea.concept.id)}
                  className="console-focusable inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  About this idea
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
