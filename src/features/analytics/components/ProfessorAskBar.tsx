import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ArrowUp, Loader2, Sparkles, ThumbsUp, ThumbsDown, RotateCcw, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { ProfessorChat } from './useProfessorChat';

const MAX_LEN = 500;

/**
 * Presentational view for the professor assistant. State lives in
 * `useProfessorChat` (owned by the host) so the bar can move between layouts
 * without losing the conversation.
 *
 * - variant "idle": centered prompt ("What should we focus on?") + suggestions.
 * - variant "panel": full-height conversation column (left pane of the console).
 */
export function ProfessorAskBar({ chat, variant }: { chat: ProfessorChat; variant: 'idle' | 'panel' }) {
  const { input, setInput, loading, suggestions, messages, aiModel, submit, regenerate } = chat;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant === 'panel') endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, variant]);

  const Pill = (
    <form onSubmit={(e) => { e.preventDefault(); submit(input); }}>
      <div className="glass-panel flex items-center gap-2.5 rounded-full px-3 py-2.5 transition-colors focus-within:border-primary/40">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/60">
          <Plus className="h-4 w-4" />
        </span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_LEN))}
          placeholder="Ask about your courses, lectures, or students…"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
          disabled={loading}
        />
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-white/40 sm:flex">
          <Sparkles className="h-3 w-3" /> {aiModel}
        </span>
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary text-white shadow transition-opacity disabled:opacity-30"
          aria-label="Send"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );

  if (variant === 'idle') {
    return (
      <div className="mx-auto w-full max-w-3xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-white/90 sm:text-4xl">
          What should we focus on?
        </h2>
        <div className="mt-6">{Pill}</div>
        {suggestions.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // variant "panel" — fills the left pane; messages scroll, input pinned bottom.
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col overflow-y-auto pr-1 custom-scrollbar">
        <div className="mt-auto space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={m.role === 'user' ? 'text-right' : 'text-left'}
              >
                {m.role === 'user' ? (
                  <span className="inline-block rounded-2xl bg-white/[0.06] px-4 py-2 text-sm text-white/85">
                    {m.content}
                  </span>
                ) : (
                  <div className="space-y-2">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{m.content}</p>
                    <div className="flex items-center gap-3 text-white/35">
                      <button onClick={() => toast.success('Thanks for the feedback')} aria-label="Helpful" className="transition-colors hover:text-white/70"><ThumbsUp className="h-3.5 w-3.5" /></button>
                      <button onClick={() => toast('Thanks — we’ll keep improving')} aria-label="Not helpful" className="transition-colors hover:text-white/70"><ThumbsDown className="h-3.5 w-3.5" /></button>
                      <button onClick={regenerate} aria-label="Regenerate" className="transition-colors hover:text-white/70"><RotateCcw className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { navigator.clipboard?.writeText(m.content); toast.success('Copied'); }} aria-label="Copy" className="transition-colors hover:text-white/70"><Copy className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {loading && (
            <div className="flex items-center gap-1.5 text-white/40">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-white/40"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className="mt-4 pb-6">{Pill}</div>
    </div>
  );
}
