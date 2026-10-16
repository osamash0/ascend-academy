import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronLeft, ChevronRight, Plus, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Markdown } from '../components/Markdown';
import { CARD_SETTLE_S, MARK_FADE_S } from '../motion';
import { bcnfSteps, closureSteps, fdText, violations, type FD, type Relation } from './fd';
import type { AnswerBlock } from './spec';

/**
 * The library interactive answers are built from.
 *
 * One component per block type, all on the same base: a quiet card, small
 * pills where there is a choice to make, and three colours that always mean
 * the same thing. Warm light is what is new, amber is what breaks, teal is what
 * holds. The tools compute what they show (`fd.ts`): edit the table and the
 * verdict changes, pick another start set and the closure is recomputed, so
 * trying is as good as reading.
 */

const TERM = 'rgb(var(--studio-term))';
const MARK = 'hsl(var(--studio-mark))';
const WOVEN = 'rgb(var(--studio-woven))';

const BTN =
  'flex min-h-8 min-w-8 items-center justify-center rounded-full bg-[rgb(var(--studio-chip))] text-quiet transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Fades are one short ease when motion is reduced; the settle is the full beat. */
function useBeats() {
  const reduce = useReducedMotion();
  return { reduce: !!reduce, card: reduce ? 0.15 : CARD_SETTLE_S, mark: reduce ? 0.15 : MARK_FADE_S };
}

/**
 * Inline emphasis for the short strings blocks carry: a quiz option, a
 * comparison point. Models write `**bold**` and `code` there as naturally as
 * in prose; a full markdown pass would add paragraphs these places cannot hold.
 */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} className="font-medium" style={{ color: TERM }}>
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className="rounded bg-[rgb(var(--studio-chip))] px-1 font-mono text-[0.9em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Card({
  label,
  as: Tag = 'div',
  children,
}: {
  label: string;
  as?: 'div' | 'fieldset';
  children: React.ReactNode;
}) {
  return (
    <Tag
      role="group"
      aria-label={label}
      className="min-w-0 rounded-2xl border border-[rgb(var(--studio-hairline))] bg-[rgb(var(--studio-chip))] p-5"
    >
      {children}
    </Tag>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[13px] font-medium text-quiet">{children}</p>;
}

/* ------------------------------------------------------------------ text */

function TextBlock({ md }: { md: string }) {
  return <Markdown className="!text-[15px]">{md}</Markdown>;
}

function KeyBlock({ md }: { md: string }) {
  return (
    <div className="relative pl-4">
      <span aria-hidden className="absolute inset-y-0.5 left-0 w-[2px] rounded-full" style={{ background: TERM }} />
      <Markdown className="!text-[15px]">{md}</Markdown>
    </div>
  );
}

/* --------------------------------------------------------------- compare */

function Compare({ block }: { block: Extract<AnswerBlock, { type: 'compare' }> }) {
  return (
    <div role="group" aria-label={block.columns.map((c) => c.title).join(' · ')}>
      <div className={cn('grid gap-3', block.columns.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {block.columns.map((c) => (
          <div
            key={c.title}
            className={cn(
              'rounded-2xl border border-[rgb(var(--studio-hairline))] p-4',
              c.tone === 'b' && 'bg-[rgb(var(--studio-chip))]',
            )}
            style={c.tone === 'b' ? { borderColor: `color-mix(in srgb, ${TERM} 45%, transparent)` } : undefined}
          >
            <p className="mb-3 text-[14px] font-semibold text-foreground">{c.title}</p>
            <ul className="space-y-2">
              {c.points.map((p) => (
                <li key={p} className="flex gap-2 text-[13.5px] leading-[1.5] text-quiet">
                  <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span>
                    <Inline text={p} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {block.note && <p className="mt-3 text-[13.5px] leading-[1.55] text-quiet">{block.note}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- fdTable */

type Role = 'l' | 'r' | null;

const initialRoles = (block: Extract<AnswerBlock, { type: 'fdTable' }>): Record<string, Role> =>
  Object.fromEntries(
    block.columns.map((c) => [c, block.fd.lhs.includes(c) ? 'l' : block.fd.rhs.includes(c) ? 'r' : null]),
  );

function FdTable({ block }: { block: Extract<AnswerBlock, { type: 'fdTable' }> }) {
  const beats = useBeats();
  const [rows, setRows] = useState(block.rows);
  const [roles, setRoles] = useState<Record<string, Role>>(() => initialRoles(block));
  const fd: FD = {
    lhs: block.columns.filter((c) => roles[c] === 'l'),
    rhs: block.columns.filter((c) => roles[c] === 'r'),
  };
  const bad = violations(block.columns, rows, fd);
  const badRows = new Set(bad.flat());
  const ready = fd.lhs.length > 0 && fd.rhs.length > 0;
  const cycle = (c: string) =>
    setRoles((r) => ({ ...r, [c]: r[c] === null ? 'l' : r[c] === 'l' ? 'r' : null }));

  return (
    <Card label={block.title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <CardTitle>{block.title}</CardTitle>
        <button
          type="button"
          onClick={() => {
            setRows(block.rows);
            setRoles(initialRoles(block));
          }}
          className={cn(BTN, '-mt-3 gap-1.5 px-2.5 text-[12.5px]')}
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      {/* The claim, as it stands. Only the verdict is announced, whole, when it flips. */}
      <div
        className="mb-3 flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5"
        style={{
          background: !ready
            ? 'rgb(var(--studio-chip))'
            : bad.length
              ? 'hsl(var(--studio-mark) / 0.14)'
              : 'rgb(var(--studio-woven) / 0.14)',
        }}
      >
        <span className="font-mono text-[14px] text-foreground">{ready ? fdText(fd) : 'Pick a left and a right side'}</span>
        <span aria-live="polite" aria-atomic="true" className="ml-auto">
          {ready && (
            <motion.span
              key={bad.length ? 'no' : 'yes'}
              initial={{ opacity: 0, scale: beats.reduce ? 1 : 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: beats.mark }}
              data-verdict={bad.length ? 'breaks' : 'holds'}
              className="flex items-center gap-1.5 text-[13px]"
              style={{ color: bad.length ? MARK : WOVEN }}
            >
              {bad.length ? <X aria-hidden className="h-3.5 w-3.5" /> : <Check aria-hidden className="h-3.5 w-3.5" />}
              {bad.length ? `Broken by rows ${bad[0][0] + 1} and ${bad[0][1] + 1}` : 'Holds on these rows'}
            </motion.span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgb(var(--studio-hairline))]">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className="w-8 border-b border-[rgb(var(--studio-hairline))]" />
              {block.columns.map((c) => (
                <th key={c} className="border-b border-[rgb(var(--studio-hairline))] p-1.5 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => cycle(c)}
                    aria-label={`${c}: ${roles[c] === 'l' ? 'left side' : roles[c] === 'r' ? 'right side' : 'not in the dependency'}`}
                    className={cn(
                      'flex min-h-8 w-full items-center gap-1.5 rounded-lg px-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      roles[c]
                        ? 'bg-[rgb(var(--studio-chip-hover))] text-foreground'
                        : 'text-quiet hover:bg-[rgb(var(--studio-chip))]',
                    )}
                  >
                    {c}
                    {roles[c] && (
                      <span
                        className="ml-auto rounded px-1.5 text-[11px] text-background"
                        style={{ background: roles[c] === 'l' ? 'hsl(var(--foreground) / 0.75)' : TERM }}
                      >
                        {roles[c] === 'l' ? 'left' : 'right'}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                data-violates={badRows.has(ri) ? 'true' : undefined}
                className="transition-colors"
                style={{ background: badRows.has(ri) ? 'hsl(var(--studio-mark) / 0.12)' : undefined }}
              >
                <td className="border-b border-[rgb(var(--studio-hairline))] px-2 text-center text-[12px] tabular-nums text-faint">
                  {ri + 1}
                </td>
                {row.map((v, ci) => (
                  <td key={ci} className="border-b border-[rgb(var(--studio-hairline))] p-1">
                    <input
                      value={v}
                      aria-label={`Row ${ri + 1}, ${block.columns[ci]}`}
                      onChange={(e) =>
                        setRows((rs) => rs.map((r, i) => (i === ri ? r.map((x, j) => (j === ci ? e.target.value : x)) : r)))
                      }
                      className="h-8 w-full min-w-[4.5rem] rounded-md bg-transparent px-2 text-foreground outline-none transition-colors hover:bg-[rgb(var(--studio-chip))] focus:bg-[rgb(var(--studio-chip-hover))] focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-[13px] leading-[1.5] text-quiet">{block.prompt}</p>
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, block.columns.map(() => '')])}
          className={cn(BTN, 'shrink-0 gap-1.5 px-3 text-[12.5px]')}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          Row
        </button>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- closure */

function AttrChip({ name, state }: { name: string; state: 'in' | 'new' | 'out' }) {
  const beats = useBeats();
  return (
    <motion.span
      layout={!beats.reduce}
      initial={false}
      animate={{ scale: state === 'new' && !beats.reduce ? [1, 1.18, 1] : 1 }}
      transition={{ duration: beats.card }}
      data-state={state}
      className={cn(
        'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 font-mono text-[14px]',
        state === 'out'
          ? 'border border-dashed border-[rgb(var(--studio-hairline))] text-faint'
          : 'text-background',
      )}
      style={state === 'out' ? undefined : { background: state === 'new' ? TERM : 'hsl(var(--foreground) / 0.85)' }}
    >
      {name}
    </motion.span>
  );
}

function Stepper({ at, count, onAt }: { at: number; count: number; onAt: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous step" disabled={at === 0} onClick={() => onAt(at - 1)} className={cn(BTN, 'w-8')}>
        <ChevronLeft aria-hidden className="h-4 w-4" />
      </button>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full"
            style={{ width: i === at ? 18 : 6, background: i <= at ? TERM : 'hsl(var(--foreground) / 0.15)' }}
          />
        ))}
      </div>
      <span className="text-[12.5px] tabular-nums text-quiet">
        Step {at + 1} of {count}
      </span>
      <button
        type="button"
        aria-label="Next step"
        disabled={at >= count - 1}
        onClick={() => onAt(at + 1)}
        className={cn(BTN, 'w-8')}
      >
        <ChevronRight aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

function Closure({ block }: { block: Extract<AnswerBlock, { type: 'closure' }> }) {
  const beats = useBeats();
  const [start, setStart] = useState<string[]>(block.start);
  const steps = useMemo(() => closureSteps(start, block.fds), [start, block.fds]);
  const [at, setAt] = useState(0);
  const step = steps[Math.min(at, steps.length - 1)];
  const done = at >= steps.length - 1;
  const result = steps[steps.length - 1].after;
  const isKey = block.attrs.every((a) => result.includes(a));
  const toggle = (a: string) => {
    setStart((s) => (s.includes(a) ? s.filter((x) => x !== a) : block.attrs.filter((x) => x === a || s.includes(x))));
    setAt(0);
  };

  return (
    <Card label={block.title}>
      <CardTitle>{block.title}</CardTitle>
      <p className="mb-2 text-[13px] text-quiet">Start with</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {block.attrs.map((a) => {
          const on = start.includes(a);
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(a)}
              className={cn(
                'min-h-8 min-w-8 rounded-lg px-2 font-mono text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on
                  ? 'bg-foreground/85 text-background'
                  : 'bg-[rgb(var(--studio-chip))] text-quiet hover:bg-[rgb(var(--studio-chip-hover))]',
              )}
            >
              {a}
            </button>
          );
        })}
      </div>

      <div className="mb-4 grid gap-1.5 sm:grid-cols-2">
        {block.fds.map((f) => {
          const fired = step.fired === f;
          const used = steps.slice(1, at + 1).some((s) => s.fired === f);
          return (
            <div
              key={fdText(f)}
              className={cn(
                'flex h-9 items-center rounded-lg px-3 font-mono text-[13px] transition-colors',
                fired ? 'text-foreground' : used ? 'bg-[rgb(var(--studio-chip))] text-quiet' : 'text-faint',
              )}
              style={fired ? { background: `color-mix(in srgb, ${TERM} 22%, transparent)` } : undefined}
            >
              {fdText(f)}
              {used && !fired && <Check aria-hidden className="ml-auto h-3.5 w-3.5" />}
            </div>
          );
        })}
      </div>

      <div className="mb-3 rounded-xl border border-[rgb(var(--studio-hairline))] p-4">
        <p className="mb-2.5 font-mono text-[13px] text-quiet">
          {'{'}
          {start.join(', ') || '∅'}
          {'}'}⁺ {done ? '=' : '⊇'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {block.attrs.map((a) => (
            <AttrChip
              key={a}
              name={a}
              state={step.after.includes(a) ? (step.added.includes(a) && at > 0 ? 'new' : 'in') : 'out'}
            />
          ))}
        </div>
        <div aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={`${start.join()}-${at}`}
              initial={{ opacity: 0, y: beats.reduce ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: beats.mark }}
              className="mt-3 text-[13.5px] leading-[1.5] text-quiet"
            >
              {at === 0
                ? start.length
                  ? 'Begin with the start set itself.'
                  : 'Pick at least one attribute to start from.'
                : step.fired
                  ? `${step.fired.lhs.join(', ')} is inside the set, so ${fdText(step.fired)} fires and adds ${step.added.join(', ')}.`
                  : ''}
              {done && at > 0 && (
                <span className="text-foreground">
                  {' '}
                  Nothing else fires — done.{' '}
                  {isKey
                    ? `${start.join(', ')} is a superkey.`
                    : `Not a key: it never reaches ${block.attrs.filter((x) => !result.includes(x)).join(', ')}.`}
                </span>
              )}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <Stepper at={Math.min(at, steps.length - 1)} count={steps.length} onAt={setAt} />
    </Card>
  );
}

/* ------------------------------------------------------------------ bcnf */

function RelationCard({ r, state }: { r: Relation; state: 'ok' | 'split' | 'new' | 'idle' }) {
  const beats = useBeats();
  return (
    <motion.div
      layout={!beats.reduce}
      initial={{ opacity: 0, y: beats.reduce ? 0 : 6 }}
      animate={{ opacity: state === 'split' ? 0.45 : 1, y: 0 }}
      transition={{ duration: beats.card }}
      className="rounded-xl border border-[rgb(var(--studio-hairline))] p-3"
      style={state === 'new' ? { borderColor: TERM } : undefined}
    >
      <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
        {r.name}
        {state === 'ok' && (
          <span className="text-[12px] font-normal" style={{ color: WOVEN }}>
            BCNF
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-1">
        {r.attrs.map((a) => (
          <span key={a} className="rounded-md bg-[rgb(var(--studio-chip))] px-1.5 py-0.5 font-mono text-[12px] text-quiet">
            {a}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function Bcnf({ block }: { block: Extract<AnswerBlock, { type: 'bcnf' }> }) {
  const beats = useBeats();
  const steps = useMemo(() => bcnfSteps(block.relation, block.fds), [block.relation, block.fds]);
  const [at, setAt] = useState(0);
  const step = steps[at];
  const next = steps[at + 1];
  const done = at === steps.length - 1;

  return (
    <Card label={block.title}>
      <CardTitle>{block.title}</CardTitle>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {block.fds.map((f) => {
          const breaking = next?.split && next.split.by.lhs.join() === f.lhs.join();
          return (
            <span
              key={fdText(f)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 font-mono text-[12.5px]',
                breaking ? 'text-foreground' : 'bg-[rgb(var(--studio-chip))] text-quiet',
              )}
              style={breaking ? { background: 'hsl(var(--studio-mark) / 0.2)' } : undefined}
            >
              {fdText(f)}
            </span>
          );
        })}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        {step.relations.map((r) => (
          <RelationCard
            key={r.name}
            r={r}
            state={
              next?.split?.from === r ? 'split' : done ? 'ok' : step.split?.into.includes(r) ? 'new' : 'idle'
            }
          />
        ))}
      </div>
      <div aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={at}
            initial={{ opacity: 0, y: beats.reduce ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: beats.mark }}
            className="mb-3 text-[13.5px] leading-[1.5] text-quiet"
          >
            {done ? (
              <span className="text-foreground">
                Every relation is in BCNF. {steps.length - 1} split{steps.length === 2 ? '' : 's'}, nothing lost: each
                split keeps the violating FD’s left side in both halves, so the join is lossless.
              </span>
            ) : (
              <>
                In {next.split!.from.name}, <span className="font-mono text-foreground">{fdText(next.split!.by)}</span> has
                a left side that is not a key. Split it: everything {next.split!.by.lhs.join(', ')} decides goes to one
                relation, the rest stays with {next.split!.by.lhs.join(', ')}.
              </>
            )}
          </motion.p>
        </AnimatePresence>
      </div>
      <Stepper at={at} count={steps.length} onAt={setAt} />
    </Card>
  );
}

/* ----------------------------------------------------------------- check */

function CheckBlock({ block }: { block: Extract<AnswerBlock, { type: 'check' }> }) {
  const beats = useBeats();
  const name = useId();
  /** The option you lean to: radios only choose (arrow keys move it), nothing is shown yet. */
  const [choice, setChoice] = useState<number | null>(null);
  /** What you committed to with Check: the reasons show, and the choice is fixed. */
  const [picked, setPicked] = useState<number | null>(null);
  const reasons = useRef<(HTMLElement | null)[]>([]);
  const firstRadio = useRef<HTMLInputElement>(null);
  /** Where focus goes after this commit renders: the reason you revealed, or the first option again. */
  const focusNext = useRef<'reason' | 'options' | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === 'reason' && picked !== null) reasons.current[picked]?.focus();
    else if (next === 'options') firstRadio.current?.focus();
  }, [picked]);
  return (
    <Card as="fieldset" label={block.question}>
      <legend className="mb-3 float-left w-full text-[15px] leading-[1.5] text-foreground">
        <Inline text={block.question} />
      </legend>
      <div className="clear-both space-y-1.5">
        {block.options.map((o, i) => {
          const chosen = (picked ?? choice) === i;
          const reveal = picked !== null && (picked === i || !!o.correct);
          return (
            <div key={o.text}>
              <label
                data-correct={reveal && o.correct ? 'true' : undefined}
                data-wrong={reveal && !o.correct ? 'true' : undefined}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[14px] text-foreground transition-colors focus-within:ring-2 focus-within:ring-ring',
                  picked === null
                    ? 'border-[rgb(var(--studio-hairline))] hover:bg-[rgb(var(--studio-chip))]'
                    : reveal
                      ? 'border-transparent'
                      : 'border-[rgb(var(--studio-hairline))] opacity-50',
                )}
                style={
                  reveal
                    ? { background: o.correct ? 'rgb(var(--studio-woven) / 0.14)' : 'hsl(var(--studio-mark) / 0.14)' }
                    : undefined
                }
              >
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name={name}
                  checked={chosen}
                  disabled={picked !== null}
                  onChange={() => setChoice(i)}
                  className="h-4 w-4 shrink-0 accent-[rgb(var(--studio-term))] focus-visible:outline-none"
                />
                {reveal &&
                  (o.correct ? (
                    <Check aria-hidden className="h-4 w-4 shrink-0" style={{ color: WOVEN }} />
                  ) : (
                    <X aria-hidden className="h-4 w-4 shrink-0" style={{ color: MARK }} />
                  ))}
                <span>
                  <Inline text={o.text} />
                </span>
              </label>
              <div aria-live="polite">
                <AnimatePresence initial={false}>
                  {reveal && (
                    <motion.p
                      ref={(el) => {
                        reasons.current[i] = el;
                      }}
                      tabIndex={-1}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: beats.mark }}
                      className="rounded-md px-3.5 pt-1 text-[13px] leading-[1.5] text-quiet outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Inline text={o.why} />
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
      {picked === null ? (
        <button
          type="button"
          disabled={choice === null}
          onClick={() => {
            focusNext.current = 'reason';
            setPicked(choice);
          }}
          className={cn(BTN, 'mt-2 px-3 text-[12.5px] text-foreground')}
        >
          Check
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            focusNext.current = 'options';
            setPicked(null);
            setChoice(null);
          }}
          className={cn(BTN, 'mt-2 gap-1.5 px-2.5 text-[12.5px]')}
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Try again
        </button>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- steps */

function Steps({ block }: { block: Extract<AnswerBlock, { type: 'steps' }> }) {
  const beats = useBeats();
  const [at, setAt] = useState(0);
  return (
    <Card label={block.title}>
      <CardTitle>{block.title}</CardTitle>
      <ol className="mb-4 space-y-2">
        {block.steps.map((s, i) => (
          <motion.li
            key={s.label}
            initial={false}
            animate={{ opacity: i <= at ? 1 : 0.35 }}
            transition={{ duration: beats.mark }}
            className="flex gap-3"
          >
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums text-background"
              style={{ background: i <= at ? TERM : 'hsl(var(--foreground) / 0.3)' }}
            >
              {i + 1}
            </span>
            <div>
              <p className="text-[14px] font-medium text-foreground">{s.label}</p>
              <Markdown className="!text-[14px]">{s.body}</Markdown>
            </div>
          </motion.li>
        ))}
      </ol>
      <Stepper at={at} count={block.steps.length} onAt={setAt} />
    </Card>
  );
}

/* ---------------------------------------------------------------- render */

export function AnswerBlockView({ block }: { block: AnswerBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBlock md={block.md} />;
    case 'key':
      return <KeyBlock md={block.md} />;
    case 'compare':
      return <Compare block={block} />;
    case 'fdTable':
      return <FdTable block={block} />;
    case 'closure':
      return <Closure block={block} />;
    case 'bcnf':
      return <Bcnf block={block} />;
    case 'check':
      return <CheckBlock block={block} />;
    case 'steps':
      return <Steps block={block} />;
  }
}
