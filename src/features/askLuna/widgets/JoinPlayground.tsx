/**
 * JOIN playground — "predict, then see".
 *
 * The widget *is* the question: tap the rows you think survive the join,
 * then check. First miss → a targeted hint. Second miss → Luna shows you,
 * with every surviving row lit up and the result table built underneath.
 * Once solved, the join type becomes a dial you can turn to explore.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { computeJoin } from '../join';
import type { JoinPlaygroundProps, WidgetOutcome } from '../protocol';

type Phase = 'predict' | 'hinted' | 'solved' | 'revealed';
const TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL'] as const;

function sameSet(a: Set<number>, b: Set<number>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

export function JoinPlayground({ onOutcome, ...props }: JoinPlaygroundProps & { onOutcome?: (o: WidgetOutcome) => void }) {
  const { t } = useTranslation('askLuna');
  const [joinType, setJoinType] = useState(props.joinType);
  const [pickL, setPickL] = useState<Set<number>>(new Set());
  const [pickR, setPickR] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<Phase>('predict');
  const [hint, setHint] = useState<string | null>(null);

  const truth = useMemo(() => computeJoin({ ...props, joinType }), [props, joinType]);
  const done = phase === 'solved' || phase === 'revealed';
  const lKey = props.left.columns.indexOf(props.on.left);
  const rKey = props.right.columns.indexOf(props.on.right);

  const toggle = (side: 'l' | 'r', i: number) => {
    if (done) return;
    const set = side === 'l' ? setPickL : setPickR;
    set((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };

  const check = () => {
    if (sameSet(pickL, truth.leftIn) && sameSet(pickR, truth.rightIn)) {
      setPhase('solved');
      setHint(null);
      onOutcome?.('correct');
      return;
    }
    if (phase === 'predict') {
      // Point at the most useful misconception, not just "wrong".
      const wrongL = [...props.left.rows.keys()].filter((i) => pickL.has(i) !== truth.leftIn.has(i));
      const wrongR = [...props.right.rows.keys()].filter((i) => pickR.has(i) !== truth.rightIn.has(i));
      const nullTrap = wrongL.some((i) => props.left.rows[i][lKey] === null) || wrongR.some((i) => props.right.rows[i][rKey] === null);
      setHint(nullTrap ? t('join.hint.null') : t(`join.hint.${joinType}`));
      setPhase('hinted');
      onOutcome?.('hint');
    } else {
      setPhase('revealed');
      setHint(null);
      onOutcome?.('revealed');
    }
  };

  const explore = (type: (typeof TYPES)[number]) => {
    setJoinType(type);
    const next = computeJoin({ ...props, joinType: type });
    setPickL(new Set(next.leftIn));
    setPickR(new Set(next.rightIn));
  };

  const rowState = (side: 'l' | 'r', i: number) => {
    const picked = (side === 'l' ? pickL : pickR).has(i);
    const inResult = (side === 'l' ? truth.leftIn : truth.rightIn).has(i);
    if (!done) return picked ? 'picked' : 'idle';
    if (phase === 'solved') return inResult ? 'in' : 'out';
    // revealed: show what was missed vs. extra, kindly
    if (inResult) return picked ? 'in' : 'missed';
    return picked ? 'extra' : 'out';
  };

  const Table = ({ side }: { side: 'l' | 'r' }) => {
    const tbl = side === 'l' ? props.left : props.right;
    const key = side === 'l' ? lKey : rKey;
    return (
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 font-mono text-xs font-bold text-white/70">{tbl.name}</p>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className="grid bg-white/[0.06] text-[11px] font-semibold text-white/50" style={{ gridTemplateColumns: `repeat(${tbl.columns.length}, minmax(0,1fr))` }}>
            {tbl.columns.map((c, ci) => (
              <span key={c} className={cn('truncate px-2 py-1.5 font-mono', ci === key && 'text-amber-200')}>{c}</span>
            ))}
          </div>
          {tbl.rows.map((row, i) => {
            const st = rowState(side, i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle(side, i)}
                aria-pressed={st === 'picked'}
                className={cn(
                  'grid w-full border-t border-white/5 text-left text-xs transition',
                  st === 'idle' && 'text-white/75 hover:bg-white/[0.04]',
                  st === 'picked' && 'bg-white/[0.09] text-white shadow-[inset_3px_0_0_rgba(255,255,255,0.85)]',
                  st === 'in' && 'bg-emerald-400/20 text-white',
                  st === 'out' && 'text-white/30 line-through decoration-white/20',
                  st === 'missed' && 'bg-amber-300/20 text-white ring-1 ring-inset ring-amber-300/60',
                  st === 'extra' && 'text-white/35 line-through ring-1 ring-inset ring-rose-400/40',
                  done && 'cursor-default',
                )}
                style={{ gridTemplateColumns: `repeat(${tbl.columns.length}, minmax(0,1fr))` }}
              >
                {row.map((v, ci) => (
                  <span key={ci} className={cn('truncate px-2 py-1.5 font-mono', v === null && 'italic text-white/40')}>
                    {v === null ? 'NULL' : String(v)}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const resultCols = [...props.left.columns.map((c) => `${props.left.name}.${c}`), ...props.right.columns.map((c) => `${props.right.name}.${c}`)];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0f0c1d] p-4">
      <p className="text-sm font-semibold text-white">{props.prompt ?? t('join.prompt', { type: joinType })}</p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] text-sky-200">
        {`SELECT * FROM ${props.left.name}\n  ${joinType} JOIN ${props.right.name}\n  ON ${props.left.name}.${props.on.left} = ${props.right.name}.${props.on.right};`}
      </pre>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <Table side="l" />
        <Table side="r" />
      </div>

      {hint && (
        <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          💡 {hint}
        </motion.p>
      )}

      {!done ? (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={check} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#0f0c1d] transition hover:bg-white/90 active:scale-[0.98]">
            {phase === 'hinted' ? t('join.checkAgain') : t('join.check')}
          </button>
          <span className="text-xs text-white/45">{t('join.tapHint')}</span>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <p className={cn('text-sm font-semibold', phase === 'solved' ? 'text-emerald-300' : 'text-amber-200')}>
            {phase === 'solved' ? t('join.solved', { count: truth.pairs.length }) : t('join.revealed', { count: truth.pairs.length })}
          </p>
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.06] text-white/50">
                <tr>{resultCols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 text-left font-mono font-semibold">{c}</th>)}</tr>
              </thead>
              <tbody>
                {truth.pairs.map((pair, i) => {
                  const cells = [
                    ...props.left.columns.map((_, ci) => (pair.l === null ? null : props.left.rows[pair.l][ci])),
                    ...props.right.columns.map((_, ci) => (pair.r === null ? null : props.right.rows[pair.r][ci])),
                  ];
                  return (
                    <motion.tr key={`${joinType}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }} className="border-t border-white/5 text-white/85">
                      {cells.map((v, ci) => (
                        <td key={ci} className={cn('whitespace-nowrap px-2 py-1.5 font-mono', v === null && 'italic text-white/35')}>{v === null ? 'NULL' : String(v)}</td>
                      ))}
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-white/50">{t('join.explore')}</span>
            {TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => explore(type)}
                className={cn('rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold', joinType === type ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-white/55 hover:text-white')}
              >
                {type}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
