/**
 * Home Chat Lab — a design spike, dev only (`/v4/lab/home-chat`).
 *
 * The question it answers: what happens on Home between pressing send and
 * reading Luna's answer? Today the answer is a box that appears under the
 * pill. Here the room leans in instead:
 *
 *   1. The pill you typed into is the composer — it travels to the foot of the
 *      screen rather than being replaced by a second input. Your question
 *      rises out of it into the thread.
 *   2. Luna is the speaker — her head shrinks from hero to companion and sits
 *      at the head of the thread. Same Luna, same helmet, smaller. She glances
 *      at each page as she cites it.
 *   3. Home's list (Up next, Also today) steps aside; the thread takes its
 *      place and reads downward from Luna, following the words as they arrive
 *      and letting go when you scroll up to re-read.
 *   4. On the right, the page Luna is citing *right now* stands large as white
 *      paper, with the very line she drew on washed in the Lesson's accent.
 *      Below it a trail of every page the thread has cited. Each citation
 *      sits inline at the end of the sentence that earned it, as a small page
 *      mark; hovering it brings that page and line up. Any page is a door into
 *      the reader at that page — the reader is the product, the chat is how
 *      you get there.
 *   5. An answer is a list of **blocks**, not one paragraph: prose that
 *      arrives word by word, the one sentence that matters, a hairline table,
 *      a map of the Lesson's ideas that lights up as the lesson goes on, a
 *      worked example as a flow, and a check you commit to. The shapes are
 *      the ones the reader's Luna sessions already speak (text, key, compare,
 *      steps, check); see docs/research/2026-10-31-generative-ui-for-luna.md.
 *   6. "Teach me" starts a planned lesson: a strip of steps, one step per
 *      turn, and a Next pill that takes you to the following step. Luna
 *      offers what to ask next when there is no plan to follow.
 *   7. Back (or Escape) reverses the same motion. The conversation is kept.
 *
 * Everything is the product's own: `LunaHero`, `AskBar`, the stage
 * primitives, the fixture world. Only the answers are canned, in the shape
 * the live tutor returns, so the choreography is honest about what arrives.
 * Lives in `src/pages` so the v4 string guard does not demand i18n for a
 * throwaway.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, Flame } from 'lucide-react';
import { useStickToBottom } from 'use-stick-to-bottom';
import { LunaHero } from '@/features/avatar/LunaHero';
import { useViewerLight, useViewerLoadout } from '@/features/avatar/viewerLoadout';
import { AskBar } from '@/features/spaces/components/AskBar';
import { Scene, SURFACES } from '@/features/spaces/components/Scene';
import { SpacesTopBar } from '@/features/spaces/components/SpacesTopBar';
import { Masthead, Sep, Skylight, UpNext, StageRow, ghostPillSm, stageAccentFor } from '@/features/spaces/components/stage';
import { useHome } from '@/features/spaces/data/useSpaces';
import { useViewer } from '@/features/spaces/data/viewer';
import { askSuggestionsNow } from '@/features/spaces/data/assistant';
import { say } from '@/features/spaces/data/phrases';
import { lunaLive, type LunaMove } from '@/features/spaces/data/lunaSession';
import { useLunaSession } from '@/features/spaces/data/useLunaSession';
import { BlockView } from '@/features/spaces/components/reader/iui/Blocks';
import { lessonsForSpace } from '@/features/spaces/mocks/lessons';
import type { MaterialPage } from '@/features/spaces/types';
import { cn } from '@/lib/utils';

/* ── The canned tutor, in the live shape ─────────────────────────────── */

/** A page and, when known, the line on it. */
interface Spot {
  page: number;
  line?: number;
}

/** One stretch of prose; when it begins, its spot comes up on the right. */
interface Segment extends Partial<Spot> {
  text: string;
}

/**
 * What an answer is made of. `text` arrives word by word; every other block
 * arrives whole, after a breath. A block may carry the spot it draws on.
 */
type Block =
  | { type: 'text'; segments: Segment[] }
  | { type: 'key'; text: string; spot?: Spot }
  | { type: 'table'; columns: [string, string]; rows: [string, string][]; spot?: Spot }
  | { type: 'map'; lit: string[] }
  | { type: 'flow'; steps: { label: string; body: string; spot?: Spot; verdict?: string }[] }
  | { type: 'check'; question: string; options: { text: string; correct: boolean; why: string }[]; hint: string; spot?: Spot };

interface Turn {
  id: number;
  /** A question you asked, or a step of the plan you moved to. */
  kind: 'ask' | 'step';
  question: string;
  answerId: string | null;
  blocks: Block[];
  /** Which block is arriving. -1 = still reading. blocks.length = whole. */
  at: number;
  /** Words shown of the arriving text block. */
  shown: number;
  /** Ticks to wait before a whole block appears. */
  wait: number;
  /** The check in this turn was answered. */
  answered: boolean;
}

const SPACE = { id: 's-dbs', name: 'Database Systems' };
const LESSON = { id: 'l-s-dbs-4', title: 'Normalization' };
const readerPath = (page: number) => `/v4/space/${SPACE.id}/lesson/${LESSON.id}/faces?page=${page}`;

/** The Lesson's ideas — what the map draws. Order is the Lesson's own. */
const IDEAS: { id: string; label: string; body: string; spot: Spot }[] = [
  { id: 'why', label: 'One fact, one place', body: 'What normalization is for', spot: { page: 1, line: 0 } },
  { id: 'fd', label: 'Functional dependency', body: 'A → B, for every row', spot: { page: 2, line: 0 } },
  { id: 'keys', label: 'Keys', body: 'Superkey, candidate, prime', spot: { page: 3, line: 1 } },
  { id: '1nf', label: '1NF', body: 'One value per cell', spot: { page: 4, line: 0 } },
  { id: '2nf', label: '2NF', body: 'Nothing hangs off part of a key', spot: { page: 7, line: 0 } },
  { id: '3nf', label: '3NF', body: 'Nothing hangs off a non-key', spot: { page: 10, line: 0 } },
];
/** How the map is laid out: rows of idea ids. */
const MAP_ROWS: string[][] = [['why'], ['fd', 'keys'], ['1nf', '2nf', '3nf']];

interface Answer {
  id: string;
  /** How you would ask for it — the chip Luna offers. */
  ask: string;
  match: RegExp;
  blocks: Block[];
}

const ANSWERS: Answer[] = [
  {
    id: 'simply',
    ask: 'Explain it more simply',
    match: /simpl|plain|shorter/i,
    blocks: [
      { type: 'key', text: 'Store one fact in one place.', spot: { page: 1, line: 0 } },
      {
        type: 'text',
        segments: [
          { text: 'That is the whole of it; every normal form is that sentence made stricter.', page: 1, line: 0 },
          { text: ' **1NF** says a cell holds one value rather than a list.', page: 4, line: 2 },
          { text: ' **2NF** says a fact about part of a key belongs beside that part, not on every row that mentions it.', page: 7, line: 0 },
          { text: ' **3NF** says a fact about a non-key attribute belongs beside that attribute. Each step moves a repeated fact somewhere it is written down once.', page: 10, line: 0 },
        ],
      },
    ],
  },
  {
    id: 'example',
    ask: 'Show me an example',
    match: /example|concrete|show me/i,
    blocks: [
      {
        type: 'text',
        segments: [{ text: 'Take an order-line table keyed on (order, product) that also carries the product name.', page: 6, line: 2 }],
      },
      {
        type: 'flow',
        steps: [
          { label: 'The table', body: '(order, product) → quantity, productName', spot: { page: 6, line: 2 } },
          { label: 'The repeat', body: 'The name depends on the product alone, so it repeats on every line that mentions that product.', spot: { page: 8, line: 0 } },
          { label: 'The bruise', body: 'Rename the product and you have to find every line. Miss one and two rows disagree.', spot: { page: 8, line: 2 } },
          { label: 'The fix', body: 'Move the name into its own relation, keyed by product.', spot: { page: 7, line: 1 }, verdict: 'The fact is now stored once' },
        ],
      },
    ],
  },
  {
    id: 'why',
    ask: 'Why does it matter?',
    match: /matter|why|point|bother/i,
    blocks: [
      {
        type: 'text',
        segments: [{ text: 'Because a table that repeats a fact can be made to contradict itself. The anomalies are the same bruise seen from three sides.', page: 1, line: 2 }],
      },
      {
        type: 'table',
        columns: ['Anomaly', 'What goes wrong'],
        rows: [
          ['Insert', 'You need data you do not have yet'],
          ['Update', 'It lands on some copies and not the others'],
          ['Delete', 'It takes an unrelated fact away with it'],
        ],
        spot: { page: 1, line: 1 },
      },
      {
        type: 'text',
        segments: [{ text: 'Normal forms are the sequence of guarantees that removes the repetition those depend on.', page: 1, line: 3 }],
      },
    ],
  },
  {
    id: 'quiz',
    ask: 'Quiz me on this',
    match: /quiz|test|check/i,
    blocks: [
      {
        type: 'check',
        question: 'A table holds (order, product, productName, qty). Which normal form does it break?',
        options: [
          { text: '1NF', correct: false, why: 'Every cell holds one value, so 1NF holds.' },
          { text: '2NF', correct: true, why: 'productName depends on product alone, which is part of the key.' },
          { text: '3NF', correct: false, why: 'The offender depends on part of the key, not on another non-key attribute.' },
        ],
        hint: 'Which attribute depends on only part of the key?',
        spot: { page: 6, line: 1 },
      },
    ],
  },
];

/**
 * A planned lesson: one step per turn, each a list of blocks. The map is the
 * same block every time, lit a little further — the thing that makes a
 * lesson feel like it is going somewhere.
 */
const PLAN: { title: string; blocks: Block[] }[] = [
  {
    title: 'What it is for',
    blocks: [
      { type: 'key', text: 'Store one fact in one place.', spot: { page: 1, line: 0 } },
      {
        type: 'text',
        segments: [
          { text: 'Redundancy is one fact stored in more than one row. A table that repeats a fact can be made to contradict itself, and every anomaly follows from that.', page: 1, line: 2 },
        ],
      },
      {
        type: 'table',
        columns: ['Anomaly', 'What goes wrong'],
        rows: [
          ['Insert', 'You need data you do not have yet'],
          ['Update', 'It lands on some copies and not the others'],
          ['Delete', 'It takes an unrelated fact away with it'],
        ],
        spot: { page: 1, line: 1 },
      },
      { type: 'map', lit: ['why'] },
    ],
  },
  {
    title: 'Dependencies and keys',
    blocks: [
      {
        type: 'text',
        segments: [
          { text: 'A *functional dependency* A → B says that any two rows agreeing on A must agree on B. It is a claim about every row the table will ever hold, so you read it off the meaning of the data, never off a sample.', page: 2, line: 0 },
        ],
      },
      {
        type: 'table',
        columns: ['Word', 'Meaning'],
        rows: [
          ['Superkey', 'An attribute set that determines all the others'],
          ['Candidate key', 'A superkey with nothing left to remove'],
          ['Prime attribute', 'One that belongs to some candidate key'],
        ],
        spot: { page: 3, line: 0 },
      },
      { type: 'text', segments: [{ text: 'Every normal form below is stated in these three words.', page: 3, line: 3 }] },
      { type: 'map', lit: ['why', 'fd', 'keys'] },
    ],
  },
  {
    title: 'The normal forms',
    blocks: [
      {
        type: 'text',
        segments: [
          { text: '**1NF**: every cell holds one value, no lists.', page: 4, line: 0 },
          { text: ' **2NF**: no non-prime attribute depends on part of a key.', page: 7, line: 0 },
          { text: ' **3NF**: no non-prime attribute is determined by another non-prime one.', page: 10, line: 0 },
        ],
      },
      {
        type: 'flow',
        steps: [
          { label: 'The table', body: '(order, product) → quantity, productName', spot: { page: 6, line: 2 } },
          { label: 'The repeat', body: 'productName depends on product alone, so it repeats on every line.', spot: { page: 8, line: 0 } },
          { label: 'The fix', body: 'Project it out into its own relation.', spot: { page: 7, line: 1 }, verdict: 'Stored once, and the database can check it' },
        ],
      },
      { type: 'map', lit: ['why', 'fd', 'keys', '1nf', '2nf', '3nf'] },
    ],
  },
  {
    title: 'Check yourself',
    blocks: [
      {
        type: 'check',
        question: 'A table holds (order, product, productName, qty). Which normal form does it break?',
        options: [
          { text: '1NF', correct: false, why: 'Every cell holds one value, so 1NF holds.' },
          { text: '2NF', correct: true, why: 'productName depends on product alone, which is part of the key.' },
          { text: '3NF', correct: false, why: 'The offender depends on part of the key, not on another non-key attribute.' },
        ],
        hint: 'Which attribute depends on only part of the key?',
        spot: { page: 6, line: 1 },
      },
    ],
  },
];

const TEACH = /teach|lesson|step by step|walk me|from the start/i;

const FALLBACK: Block[] = [
  {
    type: 'text',
    segments: [
      { text: 'Work it from the definition outward. State what the idea has to be true of, then look for the smallest case where it fails — that failure is almost always the thing the idea was invented to prevent.', page: 1, line: 3 },
    ],
  },
];

/** What Luna offers after an answer: three at most, never one already asked. */
const OFFERED: Answer['id'][] = ['example', 'why', 'quiz', 'simply'];

const words = (s: string) => s.split(/(\s+)/);
/* Tokenised per segment and then joined — never the other way round, or the
   spans below and the text they slice disagree by one token a sentence. */
const tokens = (segments: Segment[]) => segments.flatMap((s) => words(s.text));
const wordCount = (segments: Segment[]) => tokens(segments).length;

/** Where (in words) each segment begins and ends. */
const spans = (segments: Segment[]) => {
  let n = 0;
  return segments.map((s) => {
    const start = n;
    n += words(s.text).length;
    return { start, end: n };
  });
};

const spotOf = (s: Partial<Spot>): Spot | null => (s.page ? { page: s.page, line: s.line } : null);
const blockSpot = (b: Block): Spot | null => {
  switch (b.type) {
    case 'text':
      return null;
    case 'map':
      return IDEAS.find((i) => i.id === b.lit[b.lit.length - 1])?.spot ?? null;
    case 'flow':
      return b.steps[b.steps.length - 1].spot ?? null;
    default:
      return b.spot ?? null;
  }
};
/** Every spot a block can light, for the trail. */
const blockSpots = (b: Block): Spot[] => {
  switch (b.type) {
    case 'text':
      return b.segments.map(spotOf).filter((s): s is Spot => s !== null);
    case 'map':
      return b.lit.map((id) => IDEAS.find((i) => i.id === id)!.spot);
    case 'flow':
      return b.steps.map((s) => s.spot).filter((s): s is Spot => s !== undefined);
    default:
      return b.spot ? [b.spot] : [];
  }
};

/* ── Motion ──────────────────────────────────────────────────────────── */

const EASE = [0.2, 0, 0, 1] as const;
const ROOM = { duration: 0.5, ease: EASE } as const;
/** A whole block arriving: a short fade and lift, like a word but larger. */
const ARRIVE = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: EASE },
} as const;

/**
 * The words of an answer, each arriving on its own: a short fade and a lift
 * of a few pixels, opacity and transform only. Markup is the tutor's:
 * `**bold**` within one word, `*emphasis*` that may span several.
 */
function Arriving({ tokens: all, upTo, offset = 0 }: { tokens: string[]; upTo: number; offset?: number }) {
  let em = false;
  return (
    <>
      {all.slice(0, upTo).map((tok, i) => {
        if (/^\s+$/.test(tok)) return <span key={offset + i}>{tok}</span>;
        const strong = tok.startsWith('**') && tok.endsWith('**') && tok.length > 4;
        let text = strong ? tok.slice(2, -2) : tok;
        let opens = false;
        let closes = false;
        if (!strong) {
          const m = /^\*(.*?)(\*?)([.,;:!?]*)$/.exec(text);
          if (m && text.startsWith('*')) {
            opens = true;
            closes = m[2] === '*';
            text = m[1] + m[3];
          } else if (/\*[.,;:!?]*$/.test(text) && em) {
            closes = true;
            text = text.replace(/\*([.,;:!?]*)$/, '$1');
          }
        }
        const italic = em || opens;
        if (opens) em = !closes;
        else if (closes) em = false;
        return (
          <motion.span
            key={offset + i}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className={cn('inline-block', strong && 'font-semibold', italic && 'italic')}
          >
            {text}
          </motion.span>
        );
      })}
    </>
  );
}

/* ── Paper ───────────────────────────────────────────────────────────── */

function Paper({ page, large, line, accent }: { page: MaterialPage; large: boolean; line?: number; accent: string }) {
  return (
    <div className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl bg-white text-slate-900', large ? 'px-6 py-5' : 'px-2.5 py-2')}>
      <p className={cn('font-semibold leading-[1.25] tracking-[-0.015em]', large ? 'text-[17px]' : 'text-[8px]')}>{page.title}</p>
      <ul className={cn('list-disc marker:text-slate-300', large ? 'mt-4 space-y-1.5 pl-5' : 'mt-1.5 space-y-0.5 pl-2.5')}>
        {page.bullets.slice(0, large ? 4 : 3).map((b, i) => (
          <li key={b} className={cn('text-slate-600', large ? 'text-[12.5px] leading-[1.55]' : 'text-[5.5px] leading-[1.4]')}>
            <motion.span
              initial={false}
              animate={{
                backgroundColor: line === i ? `color-mix(in srgb, ${accent} 22%, transparent)` : 'rgba(255,255,255,0)',
                color: line === i ? '#0f172a' : '#475569',
              }}
              transition={{ duration: 0.4, ease: EASE }}
              className={cn('-mx-1 rounded px-1 box-decoration-clone', large ? 'py-0.5' : 'py-px')}
            >
              {b}
            </motion.span>
          </li>
        ))}
      </ul>
      <span className={cn('mt-auto self-end tabular-nums text-slate-400', large ? 'text-[11px]' : 'text-[6px]')}>{page.page}</span>
    </div>
  );
}

function FocusPage({ page, line, accent, reading }: { page: MaterialPage | null; line?: number; accent: string; reading: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 220, damping: 22, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 220, damping: 22, mass: 0.6 });
  const rotateY = useTransform(sx, (v) => v * 5);
  const rotateX = useTransform(sy, (v) => v * -4);
  const lean = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width) * 2 - 1);
    py.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const rest = () => {
    px.set(0);
    py.set(0);
  };
  return (
    <div className="relative aspect-[16/10] w-full" style={{ perspective: 900 }} onPointerMove={lean} onPointerLeave={rest}>
      <AnimatePresence initial={false}>
        {page ? (
          <motion.div
            key={page.page}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.35, ease: EASE }}
            style={{ rotateX, rotateY }}
            className="absolute inset-0"
          >
            <Link
              to={readerPath(page.page)}
              aria-label={`Open ${LESSON.title}, page ${page.page}, in the reader`}
              className="console-focusable group block h-full w-full rounded-xl"
              style={{ boxShadow: `0 0 0 2px ${accent}` }}
            >
              <Paper page={page} large line={line} accent={accent} />
              <span className="pointer-events-none absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/90 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </span>
            </Link>
          </motion.div>
        ) : (
          <motion.div
            key="cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="absolute inset-0 flex flex-col justify-end overflow-hidden rounded-xl border border-white/[0.08] px-6 py-5"
            style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 16%, transparent), transparent 70%)` }}
          >
            <span className="text-[12.5px] text-quiet">{SPACE.name}</span>
            <span className="mt-1 text-[22px] font-medium tracking-[-0.02em]">{LESSON.title}</span>
            <motion.span
              className="mt-3 text-[12.5px] text-quiet"
              animate={reading ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.7 }}
              transition={reading ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
            >
              {reading ? 'Luna is reading' : 'Ask about it'}
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Live: where Luna is on the real Lesson. The reader draws the page itself;
 * here the page is named and the words she lit are quoted, and the card is
 * the door into the reader at that page with the same words lit.
 */
function LiveFocus({ spot, accent, reading, title, space, to }: { spot: LunaMove | null; accent: string; reading: boolean; title: string; space: string; to: string | null }) {
  return (
    <div className="relative aspect-[16/10] w-full">
      <AnimatePresence initial={false}>
        {spot && to ? (
          <motion.div key={`${spot.page}-${spot.spot ?? ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ duration: 0.35, ease: EASE }} className="absolute inset-0">
            <Link to={to} aria-label={`Open ${title}, page ${spot.page}, in the reader`} className="console-focusable group flex h-full w-full flex-col justify-between rounded-xl border border-white/[0.10] bg-white/[0.03] px-6 py-5" style={{ boxShadow: `0 0 0 2px ${accent}` }}>
              <span className="flex items-start justify-between">
                <span className="text-[12.5px] text-quiet">Page</span>
                <ArrowUpRight aria-hidden className="h-4 w-4 text-quiet opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="text-[44px] font-medium leading-none tabular-nums tracking-[-0.03em]">{spot.page}</span>
              {spot.spot ? (
                <span className="mt-3 line-clamp-2 text-[13.5px] leading-[1.5]">
                  <span className="rounded px-1 box-decoration-clone" style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)` }}>{spot.spot}</span>
                </span>
              ) : (
                <span className="mt-3 text-[13px] text-quiet">{title}</span>
              )}
            </Link>
          </motion.div>
        ) : (
          <motion.div key="cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} className="absolute inset-0 flex flex-col justify-end overflow-hidden rounded-xl border border-white/[0.08] px-6 py-5" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 16%, transparent), transparent 70%)` }}>
            <span className="text-[12.5px] text-quiet">{space}</span>
            <span className="mt-1 text-[22px] font-medium tracking-[-0.02em]">{title}</span>
            <motion.span className="mt-3 text-[12.5px] text-quiet" animate={reading ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.7 }} transition={reading ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}>
              {reading ? 'Luna is reading' : 'Ask about it'}
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Thumb({ page, lit, focused, accent, onPick }: { page: MaterialPage; lit: boolean; focused: boolean; accent: string; onPick: () => void }) {
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="relative list-none">
      <button
        type="button"
        onClick={onPick}
        onMouseEnter={onPick}
        aria-label={`Show page ${page.page}`}
        aria-pressed={focused}
        className="console-focusable relative block aspect-[16/10] w-[4.25rem] overflow-hidden rounded-md"
        style={{ boxShadow: focused ? `0 0 0 2px ${accent}` : '0 0 0 1px rgba(255,255,255,0.10)' }}
      >
        <span className="absolute inset-0 flex items-center justify-center bg-white/[0.04] text-[11px] tabular-nums text-quiet">{page.page}</span>
        <motion.span className="absolute inset-0" initial={false} animate={{ opacity: lit ? 1 : 0 }} transition={{ duration: 0.45, ease: EASE }}>
          <Paper page={page} large={false} accent={accent} />
        </motion.span>
      </button>
    </motion.li>
  );
}

function Mark({ spot, accent, active, onHover }: { spot: Spot; accent: string; active: boolean; onHover: (s: Spot | null) => void }) {
  return (
    <Link
      to={readerPath(spot.page)}
      aria-label={`${LESSON.title}, page ${spot.page}`}
      onMouseEnter={() => onHover(spot)}
      onMouseLeave={() => onHover(null)}
      className="console-focusable mx-1 inline-flex h-[18px] min-w-[18px] translate-y-[-2px] items-center justify-center rounded-[5px] px-1 align-middle text-[10.5px] font-semibold tabular-nums leading-none transition-colors"
      style={{ background: active ? accent : `color-mix(in srgb, ${accent} 18%, transparent)`, color: active ? '#000' : accent }}
    >
      {spot.page}
    </Link>
  );
}

function PageRow({ page, line, accent, reading }: { page: MaterialPage | null; line?: number; accent: string; reading: boolean }) {
  return (
    <div className="relative h-[4.75rem] md:hidden">
      <AnimatePresence initial={false}>
        {page ? (
          <motion.div key={page.page} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.3, ease: EASE }} className="absolute inset-0">
            <Link to={readerPath(page.page)} aria-label={`Open ${LESSON.title}, page ${page.page}, in the reader`} className="console-focusable flex h-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 pr-3">
              <span className="block aspect-[16/10] h-full shrink-0 overflow-hidden rounded-md" style={{ boxShadow: `0 0 0 1.5px ${accent}` }}>
                <Paper page={page} large={false} line={line} accent={accent} />
              </span>
              <span className="min-w-0 flex-1 line-clamp-3 text-[13px] leading-[1.45] text-foreground">{line !== undefined ? page.bullets[line] : page.bullets[0]}</span>
              <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
            </Link>
          </motion.div>
        ) : (
          <motion.div key="cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} className="absolute inset-0 flex items-center rounded-xl border border-white/[0.08] px-4" style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${accent} 14%, transparent), transparent 70%)` }}>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">{LESSON.title}</span>
              <span className="block text-[12px] text-quiet">{reading ? 'Luna is reading' : SPACE.name}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Blocks ──────────────────────────────────────────────────────────── */

/** All non-prose blocks share one base: a quiet card on a hairline. */
const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.02]';

function KeyLine({ text, accent, spot, focus, onHover }: { text: string; accent: string; spot?: Spot; focus: Spot | null; onHover: (s: Spot | null) => void }) {
  return (
    <motion.p {...ARRIVE} className="flex items-baseline gap-3 text-[19px] font-medium leading-[1.4] tracking-[-0.01em]">
      <span aria-hidden className="mt-1 h-[1.1em] w-px shrink-0 self-start" style={{ background: accent }} />
      <span>
        {text}
        {spot && <Mark spot={spot} accent={accent} active={focus?.page === spot.page} onHover={onHover} />}
      </span>
    </motion.p>
  );
}

function TableBlock({ block, accent, focus, onHover }: { block: Extract<Block, { type: 'table' }>; accent: string; focus: Spot | null; onHover: (s: Spot | null) => void }) {
  return (
    <motion.div {...ARRIVE} className={cn(card, 'overflow-hidden')} onMouseEnter={() => block.spot && onHover(block.spot)} onMouseLeave={() => onHover(null)}>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[12.5px] text-quiet">
            <th className="px-4 pb-2 pt-3 font-normal">{block.columns[0]}</th>
            <th className="px-4 pb-2 pt-3 font-normal">{block.columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map(([a, b], i) => (
            <tr key={a} className="border-t border-white/[0.08]">
              <td className="whitespace-nowrap px-4 py-2.5 font-medium">{a}</td>
              <td className="px-4 py-2.5 text-quiet">
                {b}
                {i === block.rows.length - 1 && block.spot && <Mark spot={block.spot} accent={accent} active={focus?.page === block.spot.page} onHover={onHover} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  );
}

/** The Lesson's ideas, lit as far as the lesson has gone. The same map every step, a little brighter. */
function MapBlock({ block, accent, focus, onHover }: { block: Extract<Block, { type: 'map' }>; accent: string; focus: Spot | null; onHover: (s: Spot | null) => void }) {
  const lit = new Set(block.lit);
  const current = block.lit[block.lit.length - 1];
  return (
    <motion.div {...ARRIVE} className={cn(card, 'px-4 py-4')}>
      <div className="flex flex-col items-center gap-2">
        {MAP_ROWS.map((row, r) => (
          <div key={r} className="contents">
            {r > 0 && <ArrowDown aria-hidden className="h-3.5 w-3.5 text-quiet" />}
            <div className="grid w-full gap-2" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
              {row.map((id) => {
                const idea = IDEAS.find((i) => i.id === id)!;
                const on = lit.has(id);
                return (
                  <motion.button
                    key={id}
                    type="button"
                    layout
                    onMouseEnter={() => on && onHover(idea.spot)}
                    onMouseLeave={() => onHover(null)}
                    aria-label={`${idea.label}: ${idea.body}`}
                    animate={{ opacity: on ? 1 : 0.38 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className={cn('console-focusable rounded-xl border px-3 py-2.5 text-center', on ? 'border-white/[0.16] bg-white/[0.04]' : 'border-white/[0.08]')}
                    style={id === current || focus?.page === idea.spot.page ? { boxShadow: `0 0 0 1.5px ${accent}` } : undefined}
                  >
                    <span className="block text-[13.5px] font-medium">{idea.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-[1.35] text-quiet">{idea.body}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/** A worked example as a flow: cards down the page, one arrow between each, a verdict at the end. */
function FlowBlock({ block, accent, focus, onHover }: { block: Extract<Block, { type: 'flow' }>; accent: string; focus: Spot | null; onHover: (s: Spot | null) => void }) {
  return (
    <motion.ol {...ARRIVE} className={cn(card, 'flex flex-col items-stretch px-4 py-4')}>
      {block.steps.map((s, i) => (
        <li key={s.label} className="contents">
          {i > 0 && <ArrowDown aria-hidden className="my-1.5 h-3.5 w-3.5 self-center text-quiet" />}
          <div
            className={cn('rounded-xl border border-white/[0.08] px-4 py-3', s.verdict && 'bg-white/[0.03]')}
            style={s.spot && focus?.page === s.spot.page ? { boxShadow: `0 0 0 1.5px ${accent}` } : undefined}
            onMouseEnter={() => s.spot && onHover(s.spot)}
            onMouseLeave={() => onHover(null)}
          >
            <p className="text-[12.5px] text-quiet">{s.label}</p>
            <p className="mt-0.5 text-[14px] leading-[1.5]">
              {s.body}
              {s.spot && <Mark spot={s.spot} accent={accent} active={focus?.page === s.spot.page} onHover={onHover} />}
            </p>
            {s.verdict && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: accent }}>
                <Check aria-hidden className="h-3.5 w-3.5" />
                {s.verdict}
              </p>
            )}
          </div>
        </li>
      ))}
    </motion.ol>
  );
}

/**
 * A check you commit to. The card grades, not the model: which option is
 * right is data the tutor wrote, the hint ladder and the feedback are ours.
 */
function CheckBlock({
  block,
  accent,
  onAnswered,
  onCommit,
}: {
  block: Extract<Block, { type: 'check' }>;
  accent: string;
  onAnswered: () => void;
  /** The first committed answer, right or wrong — what a live session records. */
  onCommit?: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const commit = () => {
    if (picked === null) return;
    const ok = block.options[picked].correct;
    setResult(ok ? 'right' : 'wrong');
    if (tries === 0) onCommit?.(ok);
    setTries((n) => n + 1);
    if (ok) onAnswered();
  };
  const done = result === 'right';
  return (
    <motion.div {...ARRIVE} className={cn(card, 'px-5 py-4')}>
      <p className="text-[15.5px] font-medium leading-[1.5]">{block.question}</p>
      <ul className="mt-3 space-y-1">
        {block.options.map((o, i) => {
          const chosen = picked === i;
          return (
            <li key={o.text}>
              <button
                type="button"
                disabled={done}
                onClick={() => {
                  setPicked(i);
                  if (result === 'wrong') setResult(null);
                }}
                aria-pressed={chosen}
                className="console-focusable flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[14.5px] transition-colors hover:bg-white/[0.04] disabled:hover:bg-transparent"
              >
                <span
                  aria-hidden
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                  style={{ borderColor: chosen ? accent : 'rgba(255,255,255,0.25)' }}
                >
                  {chosen && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
                </span>
                {o.text}
              </button>
            </li>
          );
        })}
      </ul>
      <AnimatePresence mode="wait" initial={false}>
        {result && picked !== null && (
          <motion.p key={`${result}-${tries}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 text-[13.5px] leading-[1.55]" style={{ color: result === 'right' ? accent : undefined }}>
            {result === 'right' ? block.options[picked].why : tries >= 2 ? block.options[picked].why : block.hint}
          </motion.p>
        )}
      </AnimatePresence>
      {!done && (
        <button
          type="button"
          onClick={commit}
          disabled={picked === null}
          className="console-focusable mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900 disabled:opacity-30"
        >
          {result === 'wrong' ? 'Try again' : 'Check'}
        </button>
      )}
    </motion.div>
  );
}

/** Where you are in the lesson. */
function PlanStrip({ steps, current }: { steps: string[]; current: number }) {
  return (
    <motion.ol {...ARRIVE} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/[0.08] pb-3 text-[12.5px]">
      {steps.map((s, i) => (
        <li key={s} className={cn('flex items-center gap-1.5', i === current ? 'text-foreground' : 'text-quiet')}>
          {i < current ? <Check aria-hidden className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
          {s}
        </li>
      ))}
    </motion.ol>
  );
}

/* ── The screen ──────────────────────────────────────────────────────── */

const greetingKey = () => {
  const h = new Date().getHours();
  if (h < 5) return 'home.greeting.night';
  if (h < 12) return 'home.greeting.morning';
  if (h < 18) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
};

const BREATH = 9; /* ticks a whole block waits before it appears (~340 ms) */

export default function HomeChatLab() {
  const viewer = useViewer();
  const { t } = useTranslation('v4Spaces');
  const { state, next, feed, streakDays } = useHome();
  const greeting = t(greetingKey(), { name: viewer.name });
  const loadout = useViewerLoadout();
  const viewerLight = useViewerLight();
  const accent = (next ? stageAccentFor(next.lessonOrder) : viewerLight) ?? '#ffffff';

  const [mode, setMode] = useState<'home' | 'chat'>('home');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [plan, setPlan] = useState<{ steps: string[]; current: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [keys, setKeys] = useState(0);
  const [sent, setSent] = useState(0);
  const [hover, setHover] = useState<Spot | null>(null);
  const [pinned, setPinned] = useState<Spot | null>(null);
  const [glance, setGlance] = useState<{ x: number; y: number } | null>(null);

  /*
   * Live: the real Luna session, scoped to the Lesson Home already points at.
   * Same API the reader uses; nothing new on the backend. Where she goes
   * (`move`) and what she lights (`spot`) drive the right-hand page.
   */
  const live = lunaLive();
  const [liveSpot, setLiveSpot] = useState<LunaMove | null>(null);
  const onMove = useCallback((m: LunaMove) => {
    setLiveSpot(m);
    setGlance({ x: 0.95, y: 0.1 });
    window.setTimeout(() => setGlance(null), 1100);
  }, []);
  const luna = useLunaSession({
    spaceId: next?.spaceId ?? '',
    lessonId: next?.lessonId ?? '',
    onMove,
    readingAt: () => liveSpot?.page ?? 1,
    active: live && mode === 'chat' && next !== null,
  });
  const ls = luna.state;
  const liveBusy = live && (ls.busy || ls.planning);
  const liveAccepted = ls.plan.some((s) => s.status !== 'todo');
  const liveOpen = ls.plan.some((s) => s.status === 'todo' || s.status === 'current');
  const liveLastLuna = [...ls.thread].reverse().find((i) => i.kind === 'luna');
  const liveCheckOpen = liveLastLuna?.kind === 'luna' && Boolean(liveLastLuna.check);
  const liveCanContinue = Boolean(ls.sessionId) && liveAccepted && !ls.busy && !ls.wrap && !ls.offerWrap && liveOpen && !liveCheckOpen;
  const liveCanAccept = Boolean(ls.sessionId) && !liveAccepted && !ls.busy && !ls.wrap && ls.plan.length > 0;
  const livePages = useMemo(() => {
    const seen: number[] = [];
    ls.thread.forEach((i) => i.kind === 'move' && !seen.includes(i.move.page) && seen.push(i.move.page));
    return seen;
  }, [ls.thread]);

  const pages = useMemo(() => lessonsForSpace(SPACE.id).find((l) => l.id === LESSON.id)?.material?.pages ?? [], []);
  const pageOf = (n: number | null | undefined) => (n == null ? null : pages.find((p) => p.page === n) ?? null);

  const thinking = turns.some((x) => x.at === -1);
  const streaming = turns.some((x) => x.at >= 0 && x.at < x.blocks.length);
  const busy = thinking || streaming;

  const begin = useCallback((turn: Omit<Turn, 'at' | 'shown' | 'wait' | 'answered'>) => {
    setMode('chat');
    setPinned(null);
    setTurns((prev) => [...prev, { ...turn, at: -1, shown: 0, wait: BREATH, answered: false }]);
    /* Luna reads first. Then the blocks arrive. */
    window.setTimeout(() => setTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, at: 0 } : x))), 1100);
  }, []);

  const ask = useCallback(
    (q: string) => {
      setSent((n) => n + 1);
      if (live) {
        setMode('chat');
        setPinned(null);
        if (luna.state.sessionId) void luna.send(q);
        else void luna.start(q);
        return;
      }
      const id = Date.now();
      if (TEACH.test(q)) {
        setPlan({ steps: PLAN.map((s) => s.title), current: 0 });
        begin({ id, kind: 'ask', question: q, answerId: 'teach', blocks: PLAN[0].blocks });
        return;
      }
      const a = ANSWERS.find((x) => x.match.test(q)) ?? null;
      begin({ id, kind: 'ask', question: q, answerId: a?.id ?? null, blocks: a?.blocks ?? FALLBACK });
    },
    [begin, live, luna],
  );

  const nextStep = useCallback(() => {
    if (!plan || plan.current + 1 >= plan.steps.length) return;
    const i = plan.current + 1;
    setPlan({ ...plan, current: i });
    setSent((n) => n + 1);
    begin({ id: Date.now(), kind: 'step', question: PLAN[i].title, answerId: null, blocks: PLAN[i].blocks });
  }, [plan, begin]);

  /* The stream: words a few per tick; whole blocks after a breath. */
  useEffect(() => {
    if (!streaming) return;
    const h = window.setInterval(() => {
      setTurns((prev) =>
        prev.map((x) => {
          if (x.at < 0 || x.at >= x.blocks.length) return x;
          const b = x.blocks[x.at];
          if (b.type === 'text') {
            const total = wordCount(b.segments);
            if (x.shown < total) return { ...x, shown: Math.min(total, x.shown + 2) };
            return { ...x, at: x.at + 1, shown: 0, wait: BREATH };
          }
          if (x.wait > 0) return { ...x, wait: x.wait - 1 };
          return { ...x, at: x.at + 1, shown: 0, wait: BREATH };
        }),
      );
    }, 38);
    return () => window.clearInterval(h);
  }, [streaming]);

  useEffect(() => {
    if (mode !== 'chat') return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setMode('home');
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [mode]);

  /* The thread follows the words and lets go when you scroll up. */
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ initial: 'instant', resize: 'smooth' });
  const turnCount = turns.length;
  const snap = useRef(scrollToBottom);
  snap.current = scrollToBottom;
  useEffect(() => {
    if (turnCount > 0) void snap.current();
  }, [turnCount]);

  /* Pages the thread has cited, in order; which are lit; where she is now. */
  const { cited, lit, current } = useMemo(() => {
    const cited: number[] = [];
    const lit = new Set<number>();
    let current: Spot | null = null;
    turns.forEach((x) => {
      x.blocks.forEach((b, i) => {
        blockSpots(b).forEach((s) => !cited.includes(s.page) && cited.push(s.page));
        if (b.type === 'text') {
          const sp = spans(b.segments);
          const shown = i < x.at ? Infinity : i === x.at ? x.shown : 0;
          b.segments.forEach((s, j) => {
            const spot = spotOf(s);
            if (spot && shown > sp[j].start) {
              lit.add(spot.page);
              current = spot;
            }
          });
        } else if (i < x.at) {
          blockSpots(b).forEach((s) => lit.add(s.page));
          current = blockSpot(b) ?? current;
        }
      });
    });
    return { cited, lit, current };
  }, [turns]);
  const focus: Spot | null = hover ?? pinned ?? current;

  const currentPage = current?.page ?? null;
  useEffect(() => {
    if (currentPage === null) return;
    setGlance({ x: 0.95, y: 0.1 });
    const h = window.setTimeout(() => setGlance(null), 1100);
    return () => window.clearTimeout(h);
  }, [currentPage]);

  const asked = new Set(turns.map((x) => x.answerId));
  const offers = OFFERED.filter((id) => !asked.has(id))
    .map((id) => ANSWERS.find((a) => a.id === id)!)
    .slice(0, 3);
  const lastTurn = turns[turns.length - 1];
  const settled = lastTurn ? lastTurn.at >= lastTurn.blocks.length && (!lastTurn.blocks.some((b) => b.type === 'check') || lastTurn.answered) : false;
  const planHasNext = plan !== null && plan.current + 1 < plan.steps.length;
  const planDone = plan !== null && !planHasNext;

  const chatting = mode === 'chat';
  const lunaSize = chatting ? 64 : 340;
  /* What Luna is doing, whichever world this is. */
  const reading = live ? liveBusy : thinking;
  const strip = live
    ? ls.plan.length > 0
      ? { steps: ls.plan.map((s) => s.title), current: Math.max(0, ls.plan.findIndex((s) => s.status === 'current')) }
      : null
    : plan;

  if (state !== 'ready' || !next) return null;

  const liveReaderPath = (m: LunaMove) =>
    `/v4/space/${next.spaceId}/lesson/${m.lecture_id}/faces?page=${m.page}${m.spot ? `&spot=${encodeURIComponent(m.spot)}` : ''}&luna=1`;

  const renderBlock = (x: Turn, b: Block, i: number): ReactNode => {
    const visible = i < x.at || (i === x.at && b.type === 'text');
    if (!visible) return null;
    switch (b.type) {
      case 'text': {
        const sp = spans(b.segments);
        const all = tokens(b.segments);
        const shown = i < x.at ? all.length : x.shown;
        const marked = new Set<number>();
        return (
          <p key={i} className="text-[16px] leading-[1.8] text-foreground">
            {b.segments.map((s, j) => {
              const { start, end } = sp[j];
              if (shown <= start) return null;
              const seg = all.slice(start, Math.min(end, shown));
              const spot = spotOf(s);
              const first = spot !== null && !marked.has(spot.page);
              if (spot) marked.add(spot.page);
              return (
                <span key={j}>
                  <Arriving tokens={seg} upTo={seg.length} offset={start} />
                  {spot && first && shown >= end && <Mark spot={spot} accent={accent} active={focus?.page === spot.page} onHover={setHover} />}
                </span>
              );
            })}
          </p>
        );
      }
      case 'key':
        return <KeyLine key={i} text={b.text} spot={b.spot} accent={accent} focus={focus} onHover={setHover} />;
      case 'table':
        return <TableBlock key={i} block={b} accent={accent} focus={focus} onHover={setHover} />;
      case 'map':
        return <MapBlock key={i} block={b} accent={accent} focus={focus} onHover={setHover} />;
      case 'flow':
        return <FlowBlock key={i} block={b} accent={accent} focus={focus} onHover={setHover} />;
      case 'check':
        return (
          <CheckBlock
            key={i}
            block={b}
            accent={accent}
            onAnswered={() => setTurns((prev) => prev.map((y) => (y.id === x.id ? { ...y, answered: true } : y)))}
          />
        );
    }
  };

  return (
    <Scene surface={SURFACES.home} status="progress" motionKey="home-chat-lab" accent={accent}>
      <SpacesTopBar active="home" viewer={viewer} />
      <div className="relative">
        <Skylight accent={accent} />
        <motion.div
          layout
          transition={ROOM}
          className={cn(
            'relative mx-auto flex max-w-5xl flex-col px-6 lg:px-8',
            chatting ? 'h-[calc(100dvh-5rem-68px)] pb-4 pt-4 md:h-[calc(100dvh-5rem)] md:pb-5 md:pt-5' : 'items-center pb-24 pt-10',
          )}
        >
          {/* ── Luna: hero on Home, companion at the head of the thread. One element. ── */}
          <motion.div layout transition={ROOM} className={cn('flex shrink-0 items-center', chatting ? 'gap-3 self-start' : 'flex-col self-center')}>
            <motion.div layout transition={ROOM} style={{ width: lunaSize, height: lunaSize }}>
              <LunaHero
                loadout={loadout}
                size={lunaSize}
                accent={accent}
                attention={reading || asking ? 'listening' : streaming ? 'typing' : 'idle'}
                nudge={keys}
                cheer={sent}
                glance={glance}
              />
            </motion.div>
            <AnimatePresence>
              {chatting && (
                <motion.div key="who" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.25 }} className="min-w-0">
                  <p className="text-[15px] font-medium">Luna</p>
                  <p className="truncate text-[12.5px] text-quiet">{live ? next.spaceName : SPACE.name}</p>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {chatting && (
                <motion.button key="back" type="button" onClick={() => setMode('home')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.3 }} className={cn(ghostPillSm, 'ml-auto inline-flex items-center gap-1.5')}>
                  <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                  Home
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── Home's words. They step aside for the thread. ── */}
          <AnimatePresence initial={false}>
            {!chatting && (
              <motion.div key="masthead" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10, transition: { duration: 0.18 } }} className="w-full">
                <Masthead
                  className="mt-4"
                  eyebrow={
                    <>
                      {greeting}
                      {streakDays > 0 && (
                        <>
                          <Sep />
                          <Flame aria-hidden className="mb-0.5 mr-1 inline h-3.5 w-3.5 text-streak" />
                          {t('home.streak', { count: streakDays })}
                        </>
                      )}
                    </>
                  }
                  title={t('home.focus')}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── The thread, and the page she is on. ── */}
          <AnimatePresence initial={false}>
            {chatting && (
              <motion.div
                key="thread"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.2, duration: 0.3 } }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className="mt-5 grid min-h-0 flex-1 gap-12 md:mt-7 md:grid-cols-[minmax(0,1fr)_20rem]"
              >
                <div className="flex min-h-0 flex-col">
                  {!live && (
                    <div className="mb-4 md:hidden">
                      <PageRow page={pageOf(focus?.page)} line={focus?.line} accent={accent} reading={reading} />
                    </div>
                  )}
                  {strip && (
                    <div className="mb-5 md:pl-[4.75rem]">
                      <PlanStrip steps={strip.steps} current={strip.current} />
                    </div>
                  )}
                  <div className="relative min-h-0 flex-1">
                    <div ref={scrollRef} className="h-full overflow-y-auto pr-2 [scrollbar-width:thin]">
                      <ol ref={contentRef} className="space-y-8 pb-3 md:pl-[4.75rem]">
                        {/* Live: the real session's thread, through the reader's own block renderer. */}
                        {live &&
                          ls.thread.map((item) => {
                            if (item.kind === 'learner')
                              return (
                                <motion.li key={item.id} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex justify-end">
                                  <span className="inline-block max-w-[85%] rounded-2xl bg-white/[0.07] px-4 py-2 text-[14.5px] leading-6">{item.text}</span>
                                </motion.li>
                              );
                            if (item.kind === 'move')
                              return (
                                <motion.li key={item.id} {...ARRIVE}>
                                  <button type="button" onClick={() => setLiveSpot(item.move)} className="console-focusable inline-flex items-center gap-1.5 text-[12.5px] text-quiet hover:text-foreground">
                                    <ArrowRight aria-hidden className="h-3 w-3" />
                                    Page {item.move.page}
                                  </button>
                                </motion.li>
                              );
                            const toks = words(item.md ?? '');
                            return (
                              <motion.li key={item.id} className="max-w-[60ch] space-y-5">
                                {item.md && (
                                  <p className="text-[16px] leading-[1.8] text-foreground">
                                    <Arriving tokens={toks} upTo={toks.length} />
                                  </p>
                                )}
                                {item.blocks.map((b, i) => (
                                  <motion.div key={i} {...ARRIVE}>
                                    <BlockView block={b} onSpot={(w) => liveSpot && setLiveSpot({ ...liveSpot, spot: w ?? undefined })} onAsk={(q) => void luna.send(q)} />
                                  </motion.div>
                                ))}
                                {item.check && (
                                  <CheckBlock
                                    block={{ type: 'check', question: item.check.question, options: item.check.options, hint: 'Look at the page once more, then try again.' }}
                                    accent={accent}
                                    onAnswered={() => undefined}
                                    onCommit={(ok) => void luna.answerCheck(item.check!.question, ok)}
                                  />
                                )}
                              </motion.li>
                            );
                          })}
                        {live && (
                          <>
                            {liveBusy && (
                              <li aria-label="Luna is reading" className="inline-flex items-center gap-1.5 py-2">
                                {[0, 1, 2].map((i) => (
                                  <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/50" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
                                ))}
                              </li>
                            )}
                            {ls.error && <li className="text-[13px] text-quiet">{ls.error}</li>}
                            {(liveCanAccept || liveCanContinue || (ls.offerWrap && !ls.wrap)) && (
                              <li className="flex flex-wrap gap-2">
                                {liveCanAccept && (
                                  <button type="button" onClick={() => void luna.act('accept_plan')} className="console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900">
                                    Start
                                    <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {liveCanContinue && (
                                  <button type="button" onClick={() => void luna.act('continue')} className="console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900">
                                    Next
                                    <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {ls.offerWrap && !ls.wrap && (
                                  <button type="button" onClick={() => void luna.wrapUp()} className={ghostPillSm}>
                                    Wrap up
                                  </button>
                                )}
                              </li>
                            )}
                            {ls.wrap && <li className="text-[13.5px] text-quiet">That was the session. Open the Lesson to keep reading.</li>}
                          </>
                        )}
                        {!live && turns.map((x, idx) => (
                          <motion.li key={x.id} className="space-y-5">
                            {/* Your question, risen from the pill — or the step you moved to. */}
                            {x.kind === 'ask' ? (
                              <motion.p initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex justify-end">
                                <span className="inline-block max-w-[85%] rounded-2xl bg-white/[0.07] px-4 py-2 text-[14.5px] leading-6">{x.question}</span>
                              </motion.p>
                            ) : (
                              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 text-[12.5px] text-quiet">
                                <span className="h-px flex-1 bg-white/[0.08]" />
                                {x.question}
                                <span className="h-px flex-1 bg-white/[0.08]" />
                              </motion.p>
                            )}
                            <div className="max-w-[60ch] space-y-5">
                              {x.at < 0 ? (
                                <span className="inline-flex items-center gap-1.5 py-2" aria-label="Luna is reading">
                                  {[0, 1, 2].map((i) => (
                                    <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/50" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
                                  ))}
                                </span>
                              ) : (
                                x.blocks.map((b, i) => renderBlock(x, b, i))
                              )}
                              {/* What comes next: the plan's next step, or what to ask. */}
                              <AnimatePresence>
                                {idx === turns.length - 1 && settled && planHasNext && (
                                  <motion.div key="next" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.3 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                                    <button type="button" onClick={nextStep} className="console-focusable inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-semibold text-slate-900">
                                      Next
                                      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                                    </button>
                                  </motion.div>
                                )}
                                {idx === turns.length - 1 && settled && !planHasNext && offers.length > 0 && (
                                  <motion.div
                                    key="offers"
                                    initial="hidden"
                                    animate="shown"
                                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                                    variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } } }}
                                    className="flex flex-wrap gap-2"
                                  >
                                    {planDone && (
                                      <motion.p variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }} className="w-full text-[13.5px] text-quiet">
                                        That is the whole of {LESSON.title}. Where next?
                                      </motion.p>
                                    )}
                                    {offers.map((o) => (
                                      <motion.button
                                        key={o.id}
                                        type="button"
                                        onClick={() => ask(o.ask)}
                                        variants={{ hidden: { opacity: 0, y: 6 }, shown: { opacity: 1, y: 0 } }}
                                        className="console-focusable rounded-full border border-white/[0.10] bg-white/[0.03] px-3.5 py-1.5 text-[12.5px] text-quiet transition-colors hover:border-white/25 hover:text-foreground"
                                      >
                                        {o.ask}
                                      </motion.button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </motion.li>
                        ))}
                      </ol>
                    </div>
                    <AnimatePresence>
                      {!isAtBottom && (live ? ls.thread.length : turns.length) > 0 && (
                        <motion.button
                          key="newest"
                          type="button"
                          onClick={() => void scrollToBottom()}
                          initial={{ opacity: 0, y: 6, x: '-50%' }}
                          animate={{ opacity: 1, y: 0, x: '-50%' }}
                          exit={{ opacity: 0, y: 6, x: '-50%' }}
                          className={cn(ghostPillSm, 'absolute bottom-3 left-1/2 inline-flex items-center gap-1.5 bg-black')}
                        >
                          <ArrowDown aria-hidden className="h-3.5 w-3.5" />
                          Newest
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* The page she is on, large; the trail of pages she has cited, small. */}
                <aside className="hidden min-h-0 flex-col md:flex">
                  {live ? (
                    <LiveFocus spot={liveSpot} accent={accent} reading={liveBusy} title={next.lessonTitle} space={next.spaceName} to={liveSpot ? liveReaderPath(liveSpot) : null} />
                  ) : (
                    <FocusPage page={pageOf(focus?.page)} line={focus?.line} accent={accent} reading={reading} />
                  )}
                  <div className="mt-2.5 flex items-baseline justify-between text-[12.5px]">
                    <span className="text-quiet">{live ? next.lessonTitle : LESSON.title}</span>
                    <AnimatePresence>
                      {(live ? liveSpot : focus) && (
                        <motion.span key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <Link to={live && liveSpot ? liveReaderPath(liveSpot) : readerPath(focus!.page)} className="console-focusable rounded text-foreground underline-offset-4 hover:underline">
                            Open in the reader
                          </Link>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="relative mt-5">
                    {(live ? livePages : cited).length > 1 && <span aria-hidden className="pointer-events-none absolute left-2 right-2 top-1/2 h-px bg-white/[0.10]" />}
                    <motion.ul layout className="relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <AnimatePresence initial={false}>
                        {live
                          ? livePages.map((n) => (
                              <motion.li key={n} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="list-none">
                                <button
                                  type="button"
                                  onClick={() => setLiveSpot({ lecture_id: next.lessonId, page: n })}
                                  aria-label={`Show page ${n}`}
                                  aria-pressed={liveSpot?.page === n}
                                  className="console-focusable flex aspect-[16/10] w-[4.25rem] items-center justify-center rounded-md bg-white/[0.04] text-[12px] tabular-nums"
                                  style={{ boxShadow: liveSpot?.page === n ? `0 0 0 2px ${accent}` : '0 0 0 1px rgba(255,255,255,0.10)' }}
                                >
                                  {n}
                                </button>
                              </motion.li>
                            ))
                          : cited.map((n) => {
                              const page = pageOf(n);
                              return page ? <Thumb key={n} page={page} lit={lit.has(n)} focused={focus?.page === n} accent={accent} onPick={() => setPinned({ page: n })} /> : null;
                            })}
                      </AnimatePresence>
                    </motion.ul>
                  </div>
                </aside>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── The pill. Centre of Home; foot of the thread. One element. ── */}
          <motion.div
            layout
            transition={ROOM}
            className={cn('w-full shrink-0', chatting ? 'mt-4' : 'mt-10')}
            onFocusCapture={() => setAsking(true)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAsking(false);
            }}
            onKeyDownCapture={() => setKeys((k) => k + 1)}
          >
            <AskBar
              placeholder={chatting ? 'Ask Luna more…' : t('home.askPlaceholder')}
              suggestions={
                chatting ? [] : live ? askSuggestionsNow().map((p) => say(t, p)) : ['Teach me normalization step by step', 'Explain normalization more simply', 'Show me an example']
              }
              model="auto"
              busy={busy}
              onSubmit={ask}
            />
            <AnimatePresence>
              {!chatting && turns.length > 0 && (
                <motion.p key="kept" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 text-center text-[12.5px] text-quiet">
                  Your conversation with Luna is kept.{' '}
                  <button type="button" onClick={() => setMode('chat')} className="console-focusable rounded text-foreground underline-offset-4 hover:underline">
                    Open it
                  </button>
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── Home's list. ── */}
          <AnimatePresence initial={false}>
            {!chatting && (
              <motion.div key="list" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }} exit={{ opacity: 0, y: 12, transition: { duration: 0.18 } }} className="w-full">
                <div className="mt-14">
                  <UpNext
                    to={`/v4/space/${next.spaceId}/lesson/${next.lessonId}`}
                    number={next.lessonOrder}
                    kicker={`${next.spaceName} · ${t('home.percentRead', { percent: next.percentComplete })}`}
                    title={next.lessonTitle}
                    percent={next.percentComplete}
                    accent={accent}
                    verb={t('home.continue')}
                  />
                </div>
                {feed.length > 0 && (
                  <StageRow id="lab-feed" title={t('home.alsoToday')} count={feed.length}>
                    <ul className="space-y-2.5">
                      {feed.map((item) => (
                        <li key={`${item.lessonId}-${item.reason}`}>
                          <Link to={`/v4/space/${item.spaceId}/lesson/${item.lessonId}`} className="console-focusable flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12.5px] text-faint">{t(`home.reason.${item.reason}`)}</span>
                              <span className="mt-0.5 block truncate text-[15.5px] font-semibold">{item.lessonTitle}</span>
                              <span className="mt-0.5 block text-[13px] text-quiet">{t('home.lessonIn', { space: item.spaceName, order: item.lessonOrder })}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </StageRow>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </Scene>
  );
}
