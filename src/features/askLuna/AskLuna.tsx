/**
 * Ask Luna — the tutor chat, with the student's own Luna as its face.
 *
 * Luna reacts to the conversation: she *thinks* while a turn is in flight
 * (latency reads as pondering, as Duolingo does with Lily), lights up when a
 * widget is solved, leans in on a hint. Answers arrive as short text plus,
 * where a concept has something to manipulate, a widget from the registry.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LunaAvatar } from '@/features/avatar/LunaAvatar';
import type { Loadout, Mood } from '@/features/avatar/types';
import { parseTurn, type LunaPart, type WidgetOutcome } from './protocol';
import { JoinPlayground } from './widgets/JoinPlayground';
import { ConceptCheck } from './widgets/ConceptCheck';

export type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'luna'; parts: LunaPart[]; outcome?: WidgetOutcome };

/** What the tutor sees of the conversation: text, plus how each widget went. */
export interface HistoryItem {
  role: 'user' | 'luna';
  content: string;
}

export type Brain = (question: string, lang: string, history?: HistoryItem[]) => Promise<unknown>;

const OUTCOME_NOTE: Record<WidgetOutcome, string> = {
  correct: 'solved it',
  hint: 'needed a hint',
  revealed: 'answer was shown after two tries',
};

/** Flatten the chat for the model — short, plain text, no widget props. */
export function toHistory(messages: Message[], limit = 6): HistoryItem[] {
  return messages.slice(-limit).map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    const text = m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ');
    const widget = m.parts.find((p) => p.type === 'widget');
    const note = widget ? ` [widget ${widget.component}: ${m.outcome ? OUTCOME_NOTE[m.outcome] : 'not attempted yet'}]` : '';
    return { role: 'luna', content: (text + note).slice(0, 1900) };
  });
}

export interface AskLunaProps {
  brain: Brain;
  loadout?: Partial<Loadout>;
  restingMood?: Mood;
}

function Part({ part, onOutcome }: { part: LunaPart; onOutcome: (o: WidgetOutcome) => void }) {
  if (part.type === 'text') return <p className="text-sm leading-relaxed text-white/90">{part.text}</p>;
  switch (part.component) {
    case 'JoinPlayground':
      return <JoinPlayground {...part.props} onOutcome={onOutcome} />;
    case 'ConceptCheck':
      return <ConceptCheck {...part.props} onOutcome={onOutcome} />;
  }
}

/**
 * In the tutor, Luna is a quiet companion, not the show: just her helmet and
 * face, no scene, aura or orbiting buddy. The lesson is the focus; her
 * expression carries the feedback. The full wardrobe lives in the Suit Locker.
 */
function calm(loadout?: Partial<Loadout>): Partial<Loadout> {
  return { ...loadout, aura: 'aura-none', companion: 'companion-none' };
}

export function AskLuna({ brain, loadout: fullLoadout, restingMood = 'bright' }: AskLunaProps) {
  const loadout = calm(fullLoadout);
  const { t, i18n } = useTranslation('askLuna');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [reaction, setReaction] = useState<{ mood: Mood; line: string } | null>(null);
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const reactionTimer = useRef<number>();

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, thinking]);
  useEffect(() => () => window.clearTimeout(reactionTimer.current), []);

  const react = (mood: Mood, line: string, ms = 3200) => {
    window.clearTimeout(reactionTimer.current);
    setReaction({ mood, line });
    reactionTimer.current = window.setTimeout(() => setReaction(null), ms);
  };

  const onOutcome = (messageId: number) => (o: WidgetOutcome) => {
    // Hints are transient; the final result (solved / revealed) is what the tutor should remember.
    setMessages((ms) => ms.map((m) => (m.id === messageId && m.role === 'luna' ? { ...m, outcome: o } : m)));
    if (o === 'correct') {
      react('celebrating', t('react.correct'));
      window.dispatchEvent(new CustomEvent('play-sound', { detail: 'success' }));
    } else if (o === 'hint') react('curious', t('react.hint'));
    else react('focused', t('react.revealed'), 4200);
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    setDraft('');
    const history = toHistory(messages);
    setMessages((m) => [...m, { id: ++idRef.current, role: 'user', text: q }]);
    setThinking(true);
    try {
      const raw = await brain(q, i18n.language, history);
      setMessages((m) => [...m, { id: ++idRef.current, role: 'luna', parts: parseTurn(raw, t('fallback')) }]);
    } catch (e) {
      const reason = (e as { reason?: string })?.reason;
      const text = reason === 'budget' ? t('errors.budget') : reason === 'rate' ? t('errors.rate') : t('error');
      setMessages((m) => [...m, { id: ++idRef.current, role: 'luna', parts: [{ type: 'text', text }] }]);
    } finally {
      setThinking(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  const mood: Mood = thinking ? 'thinking' : reaction?.mood ?? restingMood;
  const line = thinking ? t('react.thinking') : reaction?.line ?? (messages.length ? t('react.idle') : t('react.hello'));
  const suggestions = [t('suggest.join'), t('suggest.key'), t('suggest.open')];

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      {/* Luna */}
      <aside className="sticky top-0 z-10 -mx-1 flex flex-row items-center gap-3 self-start bg-black/85 px-1 py-2 backdrop-blur lg:top-6 lg:mx-0 lg:flex-col lg:items-start lg:gap-4 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="h-14 w-14 shrink-0 lg:h-24 lg:w-24">
          <LunaAvatar loadout={loadout} mood={mood} variant="head" showBackdrop={false} size={96} className="h-full w-full" />
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={line}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="w-fit rounded-2xl rounded-tl-md bg-white/95 px-4 py-2.5 text-sm font-medium text-neutral-900 shadow-lg"
            aria-live="polite"
          >
            {line}
          </motion.p>
        </AnimatePresence>
      </aside>

      {/* Conversation */}
      <section className="flex min-h-[560px] min-w-0 flex-col rounded-[28px] border border-white/10 bg-white/[0.02]">
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="grid h-full place-items-center py-16 text-center">
              <div>
                <p className="text-lg font-bold text-white">{t('empty.title')}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-white/55">{t('empty.body')}</p>
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm text-white">{m.text}</p>
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                <div className="h-8 w-8 shrink-0">
                  <LunaAvatar loadout={loadout} variant="head" showBackdrop={false} size={32} animated={false} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {m.parts.map((p, i) => (
                    <Part key={i} part={p} onOutcome={onOutcome(m.id)} />
                  ))}
                </div>
              </motion.div>
            ),
          )}
          {thinking && (
            <div className="flex items-center gap-3 text-sm text-white/50">
              <div className="h-8 w-8 shrink-0">
                <LunaAvatar loadout={loadout} variant="head" mood="thinking" showBackdrop={false} size={32} />
              </div>
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/50" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }} />
                ))}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-white/10 p-3">
          {messages.length === 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('placeholder')}
              aria-label={t('placeholder')}
              className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim() || thinking}
              aria-label={t('send')}
              className={cn('grid h-11 w-11 place-items-center rounded-2xl bg-white text-black transition hover:bg-white/90 disabled:opacity-30')}
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
