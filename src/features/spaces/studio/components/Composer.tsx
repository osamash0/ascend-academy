import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inDialog, isTyping } from '../keys';

export type ComposerNotice =
  | { kind: 'unknown' }
  | { kind: 'removed'; onUndo(): void }
  | { kind: 'below'; onJump(): void };

interface Props {
  answering: boolean;
  suggestions: string[];
  showSuggestions: boolean;
  notice: ComposerNotice | null;
  hint: string | null;
  pager: React.ReactNode;
  onAsk(question: string): void;
}

const chip =
  'console-focusable pointer-events-auto min-h-7 rounded-full bg-[rgb(var(--studio-chip))] px-3 text-[12.5px] text-quiet backdrop-blur-md transition-colors hover:bg-[rgb(var(--studio-chip-hover))] hover:text-foreground';
const fade = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 }, transition: { duration: 0.2 } };

/**
 * Ask, at the bottom of the page — Living Learn spec §4.1. The reader's pill:
 * the question on the left, the pager tucked in at the right end. Above it,
 * one line at a time: the hint, an honest "can't answer that here", Undo, or
 * "Added below". `/` jumps in, unless you're typing or in a dialog.
 */
export function Composer({ answering, suggestions, showSuggestions, notice, hint, pager, onAsk }: Props) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  /* After Remove the answer and its button are gone: Undo takes the focus, if nothing else has it. */
  const removed = notice?.kind === 'removed';
  useEffect(() => {
    if (removed && (document.activeElement === document.body || document.activeElement === null)) undo.current?.focus();
  }, [removed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || inDialog(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = (q: string, fromInput = false) => {
    const question = q.trim();
    if (!question || answering) return;
    // A chip vanishes while answering: hold focus in the input so it never drops to the page.
    if (!fromInput) input.current?.focus();
    onAsk(question);
    if (fromInput) setValue('');
  };
  const chips = (showSuggestions || notice?.kind === 'unknown') && !answering && value.trim() === '' && suggestions.length > 0;
  /* A notice or the suggestions sit over the page: give them a soft ground so no words show through. */
  const backed = !!notice || chips;

  return (
    <div data-composer className="relative flex w-full max-w-[560px] flex-col items-center gap-2">
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl transition-colors',
          backed && 'bg-background/80 px-3 py-2 backdrop-blur-md',
        )}
      >
        <div role="status" aria-live="polite" className="flex flex-col items-center">
        <AnimatePresence initial={false} mode="popLayout">
          {notice?.kind === 'unknown' ? (
            <motion.p key="unknown" {...fade} className="pointer-events-auto text-center text-[12.5px] text-quiet">
              In this preview I can answer a few questions about this Material — try one of these:
            </motion.p>
          ) : notice?.kind === 'removed' ? (
            <motion.div key="removed" {...fade} className="pointer-events-auto flex items-center gap-2 text-[12.5px] text-quiet">
              Answer removed
              <button ref={undo} type="button" onClick={notice.onUndo} className={chip}>Undo</button>
            </motion.div>
          ) : notice?.kind === 'below' ? (
            <motion.button key="below" type="button" {...fade} onClick={notice.onJump} className={chip}>
              Added below ↓
            </motion.button>
          ) : hint ? (
            <motion.p key="hint" {...fade} className="pointer-events-auto hidden text-center text-[12px] text-quiet sm:block">
              {hint}
            </motion.p>
          ) : null}
        </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {chips && (
            <motion.div key="chips" {...fade} className="flex flex-wrap justify-center gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className={chip}>{s}</button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(value, true);
        }}
        className="pointer-events-auto flex w-full items-center gap-1 rounded-full border border-[rgb(var(--studio-hairline))] bg-[rgb(var(--studio-chip))] p-1 pl-4 backdrop-blur-md"
      >
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={answering}
          aria-label="Ask about this Material"
          placeholder="Ask about this Material…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-faint disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={answering}
          className="console-focusable flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-background disabled:opacity-60"
        >
          {answering ? 'Answering…' : <><ArrowUp aria-hidden className="h-3.5 w-3.5" />Ask</>}
        </button>
        <div className="ml-1 hidden border-l border-[rgb(var(--studio-hairline))] pl-1 sm:flex">{pager}</div>
      </form>
    </div>
  );
}
