import { useRef, useState } from 'react';
import { ArrowUp, Loader2, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The assistant's input pill — Luna's prompt on Home.
 *
 * Ported from `features/analytics/ProfessorAskBar`, not imported from it. That
 * file belongs to the old product, which this namespace may not reach into, and
 * it arrives with `sonner`, `framer-motion` and `react-markdown` in tow. What
 * carries across is the *shape* — a round `+`, a growing textarea, the model
 * named quietly on the right, one send button — because that shape is already
 * this product's and repeating it is the point.
 *
 * What deliberately does **not** carry across is the copy. The original reads
 * "Ask about your courses, lectures, or students…" and suggests "Which lectures
 * lose the most students?". Three of those words are banned outright
 * (`scripts/check-vocabulary.mjs` fails the build on them), and the question
 * behind them belongs to somebody reading a cohort — a Space's Owner looking at
 * Members. Home is the opposite altitude: one person, mid-study, being asked
 * what *they* should do next. Same control, different speaker.
 */

const MAX_LEN = 500;

export interface AskBarProps {
  /** Placeholder for the input. Screen-specific, so it stays a prop. */
  placeholder: string;
  /** Prompts offered under the bar. Empty renders no row at all. */
  suggestions: readonly string[];
  /** Which model is answering. Reported, never chosen here. */
  model: string;
  /** Mock-only: what to do with a submitted question. */
  onSubmit: (question: string) => void;
  busy?: boolean;
  className?: string;
}

export function AskBar({
  placeholder,
  suggestions,
  model,
  onSubmit,
  busy = false,
  className,
}: AskBarProps) {
  const [input, setInput] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    onSubmit(q);
    setInput('');
    if (box.current) box.current.style.height = 'auto';
  };

  return (
    <div className={cn('mx-auto w-full max-w-2xl', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2.5 rounded-[26px] border border-white/[0.10] bg-white/[0.045] px-3 py-2.5 backdrop-blur-xl transition-colors focus-within:border-primary/40">
          {/*
            Decorative today. It is a `span`, not a `button`: an enabled control
            that silently does nothing is the defect `deadends.test.tsx` exists
            to catch, and attaching something arbitrary to make it "work" would
            be worse. It becomes a button when it has an action.
          */}
          <span
            aria-hidden
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-quiet"
          >
            {/* Marked on the icon too, not just the wrapper — `a11y.test.tsx`
                checks the element, and inheriting the parent's `aria-hidden`
                is a fact about this tree rather than about the icon. */}
            <Plus aria-hidden className="h-4 w-4" />
          </span>

          <label htmlFor="ask-luna" className="sr-only">
            {placeholder}
          </label>
          <textarea
            id="ask-luna"
            ref={box}
            rows={1}
            value={input}
            disabled={busy}
            placeholder={placeholder}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention every
              // chat input in this product already follows.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
            className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] leading-6 text-foreground outline-none placeholder:text-faint"
          />

          <span className="mb-1 hidden shrink-0 items-center gap-1.5 text-[11px] font-medium text-faint sm:flex">
            <Sparkles aria-hidden className="h-3 w-3" />
            {model}
          </span>

          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Ask Luna"
            /*
              `disabled:opacity-30` without `transition-opacity`: the dim state
              is a state, not an animation. CSS here may transition colour and
              nothing else — `MotionConfig reducedMotion="user"` governs Motion
              and sails straight past a CSS transform or fade, so anything that
              moves belongs to Motion. `motion.test.tsx` caught this exact class
              on this exact button.
            */
            className="console-focusable mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-white disabled:opacity-30"
          >
            {busy ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={busy}
              className="console-focusable rounded-full border border-white/[0.10] bg-white/[0.03] px-3.5 py-1.5 text-[12.5px] text-quiet transition-colors hover:border-white/25 hover:text-foreground disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
