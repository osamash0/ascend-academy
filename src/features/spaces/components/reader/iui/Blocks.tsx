import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, X } from 'lucide-react';
import { Prose } from '@/components/markdown';
import { cn } from '@/lib/utils';
import { timing } from '../Planes';
import { bcnfSteps, closureSteps, fdText, violations, type FD, type Relation } from './fd';
import type { ExplainBlock } from './spec';

/**
 * The library Explain answers are built from.
 *
 * One component per block type, all on the same foundation: a dark card, a
 * row of quiet pills where there is a choice to make, the Lesson's accent for
 * the one thing that is "on". The tools compute what they show (`fd.ts`) —
 * edit the table and the verdict changes, pick another start set and the
 * closure is recomputed — so trying is as good as reading.
 */

const ACCENT = 'var(--reader-accent,hsl(var(--secondary)))';

/** A choice among a few: the quiet pill row every block shares. */
function Pills<T extends string>({
  items,
  value,
  onChange,
  group,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  group: string;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            className={cn(
              'console-focusable relative h-8 rounded-full px-3.5 text-[13px] transition-colors',
              on ? 'text-foreground' : 'bg-white/[0.05] text-quiet hover:bg-white/[0.09] hover:text-foreground',
            )}
          >
            {on && (
              <motion.span
                layoutId={`pill-${group}`}
                transition={{ duration: timing.card }}
                className="absolute inset-0 rounded-full bg-white/[0.16]"
              />
            )}
            <span className="relative">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5', className)}>{children}</div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[13px] font-medium text-quiet">{children}</p>;
}

/* ------------------------------------------------------------------ text */

function TextBlock({ md }: { md: string }) {
  return <Prose variant="compact" className="[&_p]:text-[15px]">{md}</Prose>;
}

function KeyBlock({ md }: { md: string }) {
  return (
    <div className="relative pl-4">
      <span aria-hidden className="absolute inset-y-0.5 left-0 w-[2px] rounded-full" style={{ background: ACCENT }} />
      <Prose variant="compact" className="[&_p]:text-[15px]">{md}</Prose>
    </div>
  );
}

/* --------------------------------------------------------------- explore */

function Explore({
  block,
  onSpot,
}: {
  block: Extract<ExplainBlock, { type: 'explore' }>;
  onSpot: (words: string | null) => void;
}) {
  const [on, setOn] = useState<string>('all');
  const part = block.parts.find((p) => p.id === on) ?? null;
  const choose = (id: string) => {
    setOn(id);
    const p = block.parts.find((x) => x.id === id);
    onSpot(p?.spot ?? null);
  };

  return (
    <Card>
      <CardTitle>{block.title}</CardTitle>
      {block.flow ? (
        <ol className="mb-4 flex flex-wrap items-center gap-y-2">
          {block.parts.map((p, i) => {
            const active = p.id === on;
            return (
              <li key={p.id} className="flex items-center">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(active ? 'all' : p.id)}
                  className={cn(
                    'console-focusable flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors',
                    active
                      ? 'border-transparent bg-white/[0.16] text-foreground'
                      : 'border-white/[0.08] text-quiet hover:bg-white/[0.06] hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] tabular-nums text-background"
                    style={{ background: active ? ACCENT : 'rgba(255,255,255,0.35)' }}
                  >
                    {i + 1}
                  </span>
                  {p.label}
                </button>
                {i < block.parts.length - 1 && (
                  <ArrowRight aria-hidden className="mx-1 h-3.5 w-3.5 text-faint" />
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mb-4">
          <Pills
            group={block.title}
            value={on}
            onChange={choose}
            items={[{ id: 'all', label: 'All' }, ...block.parts.map((p) => ({ id: p.id, label: p.label }))]}
          />
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={on}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: timing.mark }}
        >
          {part ? (
            <>
              <p className="mb-1.5 text-[17px] font-semibold text-foreground">{part.label}</p>
              <Prose variant="compact" className="[&_p]:text-[15px]">{part.body}</Prose>
            </>
          ) : (
            <p className="text-[15px] leading-[1.6] text-quiet">{block.intro}</p>
          )}
        </motion.div>
      </AnimatePresence>
    </Card>
  );
}

/* --------------------------------------------------------------- compare */

function Compare({ block }: { block: Extract<ExplainBlock, { type: 'compare' }> }) {
  return (
    <div>
      <div className={cn('grid gap-3', block.columns.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {block.columns.map((c) => (
          <div
            key={c.title}
            className={cn(
              'rounded-2xl border p-4',
              c.tone === 'b' ? 'bg-white/[0.05]' : 'border-white/[0.07] bg-white/[0.02]',
            )}
            style={c.tone === 'b' ? { borderColor: `color-mix(in srgb, ${ACCENT} 45%, transparent)` } : undefined}
          >
            <p className="mb-3 text-[14px] font-semibold text-foreground">{c.title}</p>
            <ul className="space-y-2">
              {c.points.map((p) => (
                <li key={p} className="flex gap-2 text-[13.5px] leading-[1.5] text-quiet">
                  <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span>{p}</span>
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

function FdTable({ block }: { block: Extract<ExplainBlock, { type: 'fdTable' }> }) {
  const [rows, setRows] = useState(block.rows);
  const [roles, setRoles] = useState<Record<string, Role>>(() =>
    Object.fromEntries(
      block.columns.map((c) => [c, block.fd.lhs.includes(c) ? 'l' : block.fd.rhs.includes(c) ? 'r' : null]),
    ),
  );
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
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <CardTitle>{block.title}</CardTitle>
        <button
          type="button"
          onClick={() => {
            setRows(block.rows);
            setRoles(
              Object.fromEntries(
                block.columns.map((c) => [c, block.fd.lhs.includes(c) ? 'l' : block.fd.rhs.includes(c) ? 'r' : null]),
              ),
            );
          }}
          className="console-focusable -mt-3 flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      {/* The claim, as it stands. */}
      <div
        className="mb-3 flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5"
        style={{
          background: !ready
            ? 'rgba(255,255,255,0.04)'
            : bad.length
              ? 'hsl(var(--destructive) / 0.12)'
              : 'hsl(var(--success) / 0.12)',
        }}
      >
        <span className="font-mono text-[14px] text-foreground">{ready ? fdText(fd) : 'Pick a left and a right side'}</span>
        {ready && (
          <motion.span
            key={bad.length ? 'no' : 'yes'}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: timing.mark }}
            className={cn('ml-auto flex items-center gap-1.5 text-[13px]', bad.length ? 'text-destructive' : 'text-success')}
          >
            {bad.length ? <X aria-hidden className="h-3.5 w-3.5" /> : <Check aria-hidden className="h-3.5 w-3.5" />}
            {bad.length
              ? `Broken by rows ${bad[0][0] + 1} and ${bad[0][1] + 1}`
              : 'Holds on these rows'}
          </motion.span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className="w-8 border-b border-white/[0.07]" />
              {block.columns.map((c) => (
                <th key={c} className="border-b border-white/[0.07] p-1.5 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => cycle(c)}
                    aria-label={`${c}: ${roles[c] === 'l' ? 'left side' : roles[c] === 'r' ? 'right side' : 'not in the dependency'}`}
                    className={cn(
                      'console-focusable flex h-8 w-full items-center gap-1.5 rounded-lg px-2 font-medium transition-colors',
                      roles[c] ? 'bg-white/[0.08] text-foreground' : 'text-quiet hover:bg-white/[0.05]',
                    )}
                  >
                    {c}
                    {roles[c] && (
                      <span
                        className="ml-auto rounded px-1.5 text-[11px] text-background"
                        style={{ background: roles[c] === 'l' ? 'rgba(255,255,255,0.75)' : ACCENT }}
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
                className="transition-colors"
                style={{ background: badRows.has(ri) ? 'hsl(var(--destructive) / 0.10)' : undefined }}
              >
                <td className="border-b border-white/[0.05] px-2 text-center text-[12px] tabular-nums text-faint">{ri + 1}</td>
                {row.map((v, ci) => (
                  <td key={ci} className="border-b border-white/[0.05] p-1">
                    <input
                      value={v}
                      aria-label={`Row ${ri + 1}, ${block.columns[ci]}`}
                      onChange={(e) =>
                        setRows((rs) => rs.map((r, i) => (i === ri ? r.map((x, j) => (j === ci ? e.target.value : x)) : r)))
                      }
                      className="console-focusable h-8 w-full min-w-[4.5rem] rounded-md bg-transparent px-2 text-foreground outline-none transition-colors hover:bg-white/[0.04] focus:bg-white/[0.06]"
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
          className="console-focusable flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.1] hover:text-foreground"
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
  return (
    <motion.span
      layout
      initial={false}
      animate={{ scale: state === 'new' ? [1, 1.18, 1] : 1 }}
      transition={{ duration: timing.card }}
      className={cn(
        'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 font-mono text-[14px]',
        state === 'out' ? 'border border-dashed border-white/[0.14] text-faint' : 'text-background',
      )}
      style={state === 'out' ? undefined : { background: state === 'new' ? ACCENT : 'rgba(255,255,255,0.85)' }}
    >
      {name}
    </motion.span>
  );
}

function Stepper({ at, count, onAt }: { at: number; count: number; onAt: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous step"
        disabled={at === 0}
        onClick={() => onAt(at - 1)}
        className="console-focusable flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-quiet transition-colors hover:bg-white/[0.1] hover:text-foreground disabled:opacity-30"
      >
        <ChevronLeft aria-hidden className="h-4 w-4" />
      </button>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full"
            style={{ width: i === at ? 18 : 6, background: i <= at ? ACCENT : 'rgba(255,255,255,0.15)' }}
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
        className="console-focusable flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-quiet transition-colors hover:bg-white/[0.1] hover:text-foreground disabled:opacity-30"
      >
        <ChevronRight aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

function Closure({ block }: { block: Extract<ExplainBlock, { type: 'closure' }> }) {
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
    <Card>
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
                'console-focusable h-8 min-w-8 rounded-lg px-2 font-mono text-[13px] transition-colors',
                on ? 'bg-white/[0.85] text-background' : 'bg-white/[0.05] text-quiet hover:bg-white/[0.1]',
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
                fired ? 'text-foreground' : used ? 'bg-white/[0.04] text-quiet' : 'bg-white/[0.02] text-faint',
              )}
              style={fired ? { background: `color-mix(in srgb, ${ACCENT} 22%, transparent)` } : undefined}
            >
              {fdText(f)}
              {used && !fired && <Check aria-hidden className="ml-auto h-3.5 w-3.5" />}
            </div>
          );
        })}
      </div>

      <div className="mb-3 rounded-xl bg-black/30 p-4">
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={`${start.join()}-${at}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: timing.mark }}
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
                {isKey ? `${start.join(', ')} is a superkey.` : `Not a key: it never reaches ${block.attrs.filter((x) => !result.includes(x)).join(', ')}.`}
              </span>
            )}
          </motion.p>
        </AnimatePresence>
      </div>
      <Stepper at={Math.min(at, steps.length - 1)} count={steps.length} onAt={setAt} />
    </Card>
  );
}

/* ------------------------------------------------------------------ bcnf */

function RelationCard({ r, state }: { r: Relation; state: 'ok' | 'split' | 'new' | 'idle' }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: state === 'split' ? 0.45 : 1, y: 0 }}
      transition={{ duration: timing.card }}
      className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3"
      style={state === 'new' ? { borderColor: ACCENT } : undefined}
    >
      <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-foreground">
        {r.name}
        {state === 'ok' && <span className="text-[12px] font-normal text-success">BCNF</span>}
      </p>
      <div className="flex flex-wrap gap-1">
        {r.attrs.map((a) => (
          <span key={a} className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12px] text-quiet">
            {a}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function Bcnf({ block }: { block: Extract<ExplainBlock, { type: 'bcnf' }> }) {
  const steps = useMemo(() => bcnfSteps(block.relation, block.fds), [block.relation, block.fds]);
  const [at, setAt] = useState(0);
  const step = steps[at];
  const next = steps[at + 1];
  const done = at === steps.length - 1;

  return (
    <Card>
      <CardTitle>{block.title}</CardTitle>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {block.fds.map((f) => {
          const breaking = next?.split && next.split.by.lhs.join() === f.lhs.join();
          return (
            <span
              key={fdText(f)}
              className={cn('rounded-lg px-2.5 py-1.5 font-mono text-[12.5px]', breaking ? 'text-foreground' : 'bg-white/[0.04] text-quiet')}
              style={breaking ? { background: 'hsl(var(--destructive) / 0.18)' } : undefined}
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
              next?.split?.from === r
                ? 'split'
                : done
                  ? 'ok'
                  : step.split?.into.includes(r)
                    ? 'new'
                    : 'idle'
            }
          />
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={at}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: timing.mark }}
          className="mb-3 text-[13.5px] leading-[1.5] text-quiet"
        >
          {done ? (
            <span className="text-foreground">
              Every relation is in BCNF. {steps.length - 1} split{steps.length === 2 ? '' : 's'}, nothing lost — each split
              keeps the violating FD’s left side in both halves, so the join is lossless.
            </span>
          ) : (
            <>
              In {next.split!.from.name}, <span className="font-mono text-foreground">{fdText(next.split!.by)}</span> has a
              left side that is not a key. Split it: everything {next.split!.by.lhs.join(', ')} decides goes to one relation,
              the rest stays with {next.split!.by.lhs.join(', ')}.
            </>
          )}
        </motion.p>
      </AnimatePresence>
      <Stepper at={at} count={steps.length} onAt={setAt} />
    </Card>
  );
}

/* ----------------------------------------------------------------- check */

function CheckBlock({ block }: { block: Extract<ExplainBlock, { type: 'check' }> }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <Card>
      <CardTitle>Check yourself</CardTitle>
      <p className="mb-3 text-[15px] leading-[1.5] text-foreground">{block.question}</p>
      <div className="space-y-1.5">
        {block.options.map((o, i) => {
          const chosen = picked === i;
          const reveal = picked !== null && (chosen || o.correct);
          return (
            <button
              key={o.text}
              type="button"
              disabled={picked !== null}
              onClick={() => setPicked(i)}
              className={cn(
                'console-focusable block w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                picked === null
                  ? 'border-white/[0.08] hover:bg-white/[0.05]'
                  : o.correct
                    ? 'border-transparent'
                    : chosen
                      ? 'border-transparent'
                      : 'border-white/[0.05] opacity-50',
              )}
              style={
                reveal
                  ? { background: o.correct ? 'hsl(var(--success) / 0.12)' : 'hsl(var(--destructive) / 0.12)' }
                  : undefined
              }
            >
              <span className="flex items-center gap-2 text-[14px] text-foreground">
                {reveal &&
                  (o.correct ? (
                    <Check aria-hidden className="h-4 w-4 text-success" />
                  ) : (
                    <X aria-hidden className="h-4 w-4 text-destructive" />
                  ))}
                {o.text}
              </span>
              <AnimatePresence initial={false}>
                {reveal && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: timing.mark }}
                    className="mt-1 block text-[13px] leading-[1.5] text-quiet"
                  >
                    {o.why}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <button
          type="button"
          onClick={() => setPicked(null)}
          className="console-focusable mt-2 flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-quiet transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5" />
          Try again
        </button>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- steps */

function Steps({ block }: { block: Extract<ExplainBlock, { type: 'steps' }> }) {
  const [at, setAt] = useState(0);
  return (
    <Card>
      <CardTitle>{block.title}</CardTitle>
      <ol className="mb-4 space-y-2">
        {block.steps.map((s, i) => (
          <motion.li
            key={s.label}
            initial={false}
            animate={{ opacity: i <= at ? 1 : 0.35 }}
            transition={{ duration: timing.mark }}
            className="flex gap-3"
          >
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums text-background"
              style={{ background: i <= at ? ACCENT : 'rgba(255,255,255,0.3)' }}
            >
              {i + 1}
            </span>
            <div>
              <p className="text-[14px] font-medium text-foreground">{s.label}</p>
              <Prose variant="compact" className="[&_p]:text-[14px]">{s.body}</Prose>
            </div>
          </motion.li>
        ))}
      </ol>
      <Stepper at={at} count={block.steps.length} onAt={setAt} />
    </Card>
  );
}

/* ---------------------------------------------------------------- render */

export function BlockView({ block, onSpot }: { block: ExplainBlock; onSpot: (words: string | null) => void }) {
  switch (block.type) {
    case 'text':
      return <TextBlock md={block.md} />;
    case 'key':
      return <KeyBlock md={block.md} />;
    case 'explore':
      return <Explore block={block} onSpot={onSpot} />;
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
