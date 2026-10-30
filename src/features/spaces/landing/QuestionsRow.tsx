import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '../components/Avatar';
import { ghostPillSm, stageCard, whitePillSm } from '../components/stage';
import type { LandingLesson, LandingQuestion } from './types';

/**
 * Questions for you.
 *
 * A person is waiting, so these come before any finding. Each one is the
 * question as it was sent, the page it was sent from (a way into the reader),
 * who — or "Someone", when they chose to send it without a name — and when.
 * Answering happens here: write, then choose whether it goes to them alone or
 * lands on that page for every member.
 */

/** "just now", "2 hours ago", "yesterday", "3 days ago". */
function when(t: (k: string, v?: Record<string, number>) => string, iso: string, now = Date.now()): string {
  const hours = Math.floor((now - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return t('questions.when.now');
  if (hours < 24) return t('questions.when.hours', { count: hours });
  return t('questions.when.days', { count: Math.floor(hours / 24) });
}

export function QuestionsRow({
  questions,
  lessons,
  spaceId,
  accent,
  onAnswer,
}: {
  questions: LandingQuestion[];
  lessons: Map<string, LandingLesson>;
  spaceId: string;
  accent: string;
  onAnswer: (questionId: string, text: string, forEveryone: boolean) => void;
}) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const ordered = [...questions].sort((a, b) => Number(Boolean(a.answer)) - Number(Boolean(b.answer)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (ordered.length === 0) return <p className="text-[15px] text-quiet">{t('questions.none')}</p>;

  const send = (q: LandingQuestion, forEveryone: boolean) => {
    const text = draft.trim();
    if (!text) return;
    onAnswer(q.id, text, forEveryone);
    setOpenId(null);
    setDraft('');
  };

  return (
    <ol className="space-y-3">
      {ordered.map((q) => {
        const lesson = lessons.get(q.lessonId);
        const open = openId === q.id;
        const pageHref = `/v4/space/${spaceId}/lesson/${q.lessonId}/faces?page=${q.page}`;
        return (
          <motion.li
            key={q.id}
            layout={!reduce}
            className={cn(stageCard, 'p-5 sm:p-6', q.answer && 'opacity-80')}
            style={!q.answer && open ? { borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` } : undefined}
          >
            <div className="flex items-start gap-4">
              {q.asker ? (
                <Avatar person={q.asker} size="md" />
              ) : (
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.18] text-[12px] text-quiet">
                  ?
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-quiet">
                  <span className="text-foreground">{q.asker?.name ?? t('questions.someone')}</span>
                  <span aria-hidden>·</span>
                  <span>{when(t, q.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <Link to={pageHref} className="console-focusable rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[12px] text-foreground hover:bg-white/[0.12]">
                    {lesson?.title}, {t('questions.page', { page: q.page })}
                  </Link>
                </p>
                <p className="mt-2 text-[16px] leading-relaxed">{q.text}</p>

                {q.answer ? (
                  <div className="mt-4 border-l-2 pl-4" style={{ borderColor: `color-mix(in srgb, ${accent} 60%, transparent)` }}>
                    <p className="flex items-center gap-1.5 text-[12.5px] text-quiet">
                      <Check aria-hidden className="h-3.5 w-3.5" />
                      {q.answer.forEveryone ? t('questions.answered.everyone') : t('questions.answered.them')}
                    </p>
                    <p className="mt-1.5 text-[15px] leading-relaxed">{q.answer.text}</p>
                  </div>
                ) : open ? (
                  <div className="mt-4">
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t('questions.placeholder')}
                      aria-label={t('questions.placeholder')}
                      rows={3}
                      className="console-focusable w-full resize-none rounded-xl border border-white/[0.1] bg-black/40 px-4 py-3 text-[15px] leading-relaxed placeholder:text-quiet/70"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => send(q, true)} disabled={!draft.trim()} className={whitePillSm}>
                        {t('questions.everyone')}
                      </button>
                      <button type="button" onClick={() => send(q, false)} disabled={!draft.trim()} className={ghostPillSm}>
                        {t('questions.them')}
                      </button>
                      <span className="text-[12.5px] text-quiet">{t('questions.everyoneHint')}</span>
                      <button type="button" onClick={() => setOpenId(null)} className="console-focusable ml-auto rounded-full px-3 py-1.5 text-[13px] text-quiet hover:text-foreground">
                        {t('questions.close')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <button type="button" onClick={() => { setOpenId(q.id); setDraft(''); }} className={ghostPillSm}>
                      {t('questions.answer')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}
