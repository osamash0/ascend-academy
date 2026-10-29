import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { BlockView } from '../iui/Blocks';
import type { LunaCheck, PlanStep } from '../../../data/lunaSession';
import type { useLunaSession } from '../../../data/useLunaSession';
import { MoveMark } from './MoveMark';
import { PlanStrip } from './PlanStrip';
import { RevisitDeck } from './RevisitDeck';
import { WrapCard } from './WrapCard';

type Luna = ReturnType<typeof useLunaSession>;

function Check({ check, onAnswer }: { check: LunaCheck; onAnswer: (correct: boolean) => void }) {
  const { t } = useTranslation('v4Luna');
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="text-[11.5px] text-quiet">{t('check.label')}</p>
      <p className="text-[13.5px]">{check.question}</p>
      {check.options.map((o, i) => (
        <button
          key={i}
          type="button"
          disabled={picked !== null}
          aria-pressed={picked === i}
          onClick={() => {
            setPicked(i);
            onAnswer(o.correct);
          }}
          className={cn(
            'console-focusable rounded-xl border px-3 py-2 text-left text-[13px]',
            picked === null && 'border-white/15 hover:border-white/40',
            picked !== null && o.correct && 'border-success/60 bg-success/10',
            picked === i && !o.correct && 'border-destructive/50 bg-destructive/10',
          )}
        >
          {o.text}
          {picked === i && <span className="mt-1 block text-[12px] text-quiet">{t(o.correct ? 'check.right' : 'check.wrong')}</span>}
          {picked !== null && (picked === i || o.correct) && <span className="mt-1 block text-[12px] text-quiet">{o.why}</span>}
        </button>
      ))}
    </div>
  );
}

const isOpen = (s: PlanStep) => s.status === 'todo' || s.status === 'current';

/** Tap to change the plan: rename or drop the steps still ahead, keep their order. */
function PlanEditor({
  plan, onSave, onCancel,
}: { plan: PlanStep[]; onSave: (steps: { id: string; title: string }[]) => void; onCancel: () => void }) {
  const { t } = useTranslation('v4Luna');
  const [steps, setSteps] = useState(() => plan.filter(isOpen).map(({ id, title }) => ({ id, title })));
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={t('plan.change')}
      onSubmit={(e) => {
        e.preventDefault();
        if (steps.length) onSave(steps.map((s) => ({ id: s.id, title: s.title.trim() })));
      }}
    >
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <input
            value={s.title}
            maxLength={60}
            aria-label={t('plan.stepTitle', { n: i + 1 })}
            onChange={(e) => setSteps((all) => all.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))}
            className="console-focusable flex-1 rounded-full border border-white/15 bg-transparent px-3 py-1 text-[12.5px] outline-none"
          />
          <button
            type="button"
            aria-label={t('plan.remove')}
            onClick={() => setSteps((all) => all.filter((x) => x.id !== s.id))}
            className="console-focusable flex h-6 w-6 items-center justify-center rounded-full text-quiet hover:text-foreground"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="submit" disabled={!steps.length}
          className="console-focusable rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900 disabled:opacity-40">
          {t('plan.save')}
        </button>
        <button type="button" onClick={onCancel} className="console-focusable rounded-full px-2 py-1 text-[12.5px] text-quiet hover:text-foreground">
          {t('plan.cancel')}
        </button>
      </div>
    </form>
  );
}

/** The conversation beside the page. The page stays the centre; this column follows it. */
export function SessionColumn({
  luna, lessonId, onOpenPage, onClose, onSpot,
}: {
  luna: Luna;
  lessonId: string;
  onOpenPage: (lectureId: string, page: number, spot?: string) => void;
  onClose: () => void;
  onSpot: (words: string | null) => void;
}) {
  const { t } = useTranslation('v4Luna');
  const { state } = luna;
  const [draft, setDraft] = useState('');
  const [revisit, setRevisit] = useState(true);
  const [editing, setEditing] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const accepted = state.plan.some((s) => s.status !== 'todo');
  const canEdit = Boolean(state.sessionId) && !state.wrap && !state.busy && state.plan.some(isOpen);
  const lastLuna = [...state.thread].reverse().find((i) => i.kind === 'luna');
  /* A way forward between turns. An open check is its own way forward: answering it continues. */
  const canContinue =
    Boolean(state.sessionId) && accepted && !state.busy && !state.wrap && !state.offerWrap && state.plan.some(isOpen) &&
    !(lastLuna?.kind === 'luna' && lastLuna.check);

  /* A check or blocks land on Luna's last item without adding one, so follow its contents too. */
  const tail = state.thread[state.thread.length - 1];
  const tailKey = tail?.kind === 'luna' ? `${tail.id}:${tail.blocks.length}:${tail.check ? 1 : 0}` : tail?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [state.thread.length, tailKey, state.busy, state.offerWrap, state.wrap, reduceMotion]);

  const submit = () => {
    const text = draft.trim();
    if (!text || state.busy) return;
    setDraft('');
    if (state.sessionId) void luna.send(text);
    else void luna.start(text);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-5">
        <span className="text-[13px] font-medium">{t('column.label')}</span>
        <div className="flex items-center gap-3">
          {state.sessionId && !state.wrap && (
            <button type="button" onClick={() => void luna.wrapUp()} disabled={state.busy}
              className="console-focusable text-[12.5px] text-quiet hover:text-foreground disabled:opacity-40">
              {t('column.done')}
            </button>
          )}
          <button type="button" onClick={onClose} className="console-focusable text-[12.5px] text-quiet hover:text-foreground">
            {t('column.close')}
          </button>
        </div>
      </div>

      <div className="px-5 pt-3">
        {editing && canEdit ? (
          <PlanEditor
            plan={state.plan}
            onCancel={() => setEditing(false)}
            onSave={(steps) => {
              setEditing(false);
              void luna.act('edit_plan', { plan: steps });
            }}
          />
        ) : (
          <PlanStrip
            plan={state.plan}
            accepted={accepted}
            onAccept={() => void luna.act('accept_plan')}
            onChange={canEdit ? () => setEditing(true) : undefined}
            onSkip={() => void luna.act('skip_step')}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {!state.sessionId && !state.planning && (
          <div className="flex flex-col gap-3">
            {revisit && <RevisitDeck lectureId={lessonId} onDone={() => setRevisit(false)} />}
            <p className="text-[13.5px] text-quiet">{t('start.intro')}</p>
            <div className="flex flex-wrap gap-2">
              {(['examFriday', 'stuck'] as const).map((k) => (
                <button key={k} type="button" onClick={() => void luna.start(t(`start.${k}`))}
                  className="console-focusable rounded-full border border-white/15 px-3 py-1 text-[12.5px]">
                  {t(`start.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {state.thread.map((item) => {
            if (item.kind === 'move') return <MoveMark key={item.id} move={item.move} onGo={onOpenPage} />;
            if (item.kind === 'learner')
              return (
                <p key={item.id} className="self-end rounded-2xl bg-white/[0.08] px-3 py-2 text-[13.5px]">
                  {item.text}
                </p>
              );
            return (
              <div key={item.id} className="text-[13.5px] leading-relaxed">
                <p>{item.md}</p>
                {item.blocks.map((b, i) => (
                  <BlockView key={i} block={b} onSpot={onSpot} onAsk={(q) => void luna.send(q)} />
                ))}
                {item.check && <Check check={item.check} onAnswer={(correct) => void luna.answerCheck(item.check!.question, correct)} />}
              </div>
            );
          })}
          {state.busy && <p className="text-[12.5px] text-quiet">{t(state.planning ? 'column.planning' : 'column.thinking')}</p>}
          {state.error && <p className="text-[12.5px] text-quiet">{state.error}</p>}
          {canContinue && (
            <button type="button" onClick={() => void luna.act('continue')} className="console-focusable self-start rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900">
              {t('column.continue')}
            </button>
          )}
          {state.offerWrap && !state.wrap && (
            <button type="button" onClick={() => void luna.wrapUp()} className="console-focusable self-start rounded-full bg-white px-3 py-1 text-[12.5px] text-slate-900">
              {t('wrap.offer')}
            </button>
          )}
          {state.wrap && (
            <WrapCard
              wrap={state.wrap}
              kept={state.kept}
              practiceAdded={state.practiceAdded}
              onKeep={() => void luna.keep()}
              onPractise={() => void luna.practise()}
              onOpenPage={(l, p) => onOpenPage(l, p)}
            />
          )}
          <div ref={end} />
        </div>
      </div>

      {!state.wrap && (
        <form
          className="flex items-center gap-2 border-t border-white/10 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('column.placeholder')}
            maxLength={2000}
            className="flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-quiet"
          />
          <button type="submit" aria-label={t('column.send')} disabled={state.busy}
            className="console-focusable flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-900 disabled:opacity-40">
            <ArrowUp aria-hidden className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  );
}
