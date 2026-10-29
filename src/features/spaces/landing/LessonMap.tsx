import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { whitePillSm } from '../components/stage';
import { cardCopy } from './copy';
import { RING, cellColor } from './light';
import { GridPicture, ThemesPicture } from './Picture';
import type { LandingInsight, LandingLesson, Themes } from './types';

/**
 * The map: every Lesson drawn as its pages.
 *
 * One cell per page, lit in the Lesson's colour by how much that page asked
 * of people; a page a finding is about is lit outright, labelled, and opens
 * that page. Under each strip, each finding as one sentence. A sentence
 * opens in place onto why it matters and its evidence (what people asked,
 * clicked against missed), with the way into the page. Nothing is listed
 * twice: the map is the findings.
 */
export function LessonMap({
  spaceId,
  lessons,
  insights,
  themes,
}: {
  spaceId: string;
  lessons: LandingLesson[];
  insights: LandingInsight[];
  themes: Themes[];
}) {
  const { t } = useTranslation('v4Landing');
  const reduce = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);

  const pageHref = (lessonId: string, page: number) => `/v4/space/${spaceId}/lesson/${lessonId}/faces?page=${page}`;

  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-8 left-[19px] top-6 w-px bg-gradient-to-b from-white/[0.18] via-white/[0.08] to-transparent" />
      {lessons.map((l, li) => {
        const few = l.light === 'few';
        const finds = insights.filter((i) => i.lessonId === l.id);
        // The pages each finding is about: one page, or a stretch.
        const lit = new Map<number, LandingInsight>();
        for (const f of finds) {
          if (f.page) lit.set(f.page, f);
          else if (f.first && f.last) for (let p = f.first; p <= f.last; p++) lit.set(p, f);
        }
        return (
          <li key={l.id} className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-5 pb-10">
            <Marker order={l.order} color={l.color} strength={RING[l.light]} reduce={Boolean(reduce)} />
            <div className="min-w-0 pt-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6">
                <h3 className="text-[21px] font-medium leading-tight tracking-[-0.015em]">
                  <Link to={`/v4/space/${spaceId}/lesson/${l.id}`} className="console-focusable rounded-sm hover:underline hover:decoration-white/30 hover:underline-offset-4">
                    {l.title}
                  </Link>
                </h3>
                <span className="text-[13px] tabular-nums text-quiet">{few ? t('light.few') : t('lessons.readers', { count: l.readers })}</span>
              </div>

              {/* The pages. */}
              <div className="mt-5 grid items-end gap-[3px]" style={{ gridTemplateColumns: `repeat(${l.pages}, minmax(0, 1fr))` }}>
                {Array.from({ length: l.pages }, (_, i) => {
                  const page = i + 1;
                  const f = lit.get(page) ?? null;
                  const color = few ? null : cellColor(l.color, l.help?.[i] ?? 0, f?.attention ?? null);
                  const labelled = f && (f.page === page || f.first === page);
                  const cell = (
                    <motion.span
                      className={cn('block w-full rounded-[3px]', f ? 'h-9' : 'h-6', !color && (few ? 'bg-white/[0.05]' : 'bg-white/[0.06]'))}
                      style={color ?? undefined}
                      initial={reduce ? false : { opacity: 0, scaleY: 0.4 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      transition={{ duration: 0.4, delay: reduce ? 0 : Math.min(0.5, 0.15 + li * 0.04 + i * 0.012), ease: [0.16, 1, 0.3, 1] }}
                    />
                  );
                  return f ? (
                    <Link
                      key={page}
                      to={pageHref(l.id, page)}
                      aria-label={t('lessons.cell', { page, lesson: l.title })}
                      className="console-focusable relative block rounded-[3px] transition-[filter] hover:brightness-110"
                    >
                      {cell}
                      {labelled && <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[12px] font-medium tabular-nums">{page}</span>}
                    </Link>
                  ) : (
                    <span key={page} aria-hidden className="block">
                      {cell}
                    </span>
                  );
                })}
              </div>

              {/* Each finding, as one sentence; it opens in place. */}
              {finds.length > 0 && (
                <ul className="mt-3.5 space-y-1">
                  {finds.map((f) => {
                    const open = openId === f.id;
                    const copy = cardCopy(t, f, l.title);
                    const pageThemes = f.themes ? themes.find((th) => th.lessonId === f.lessonId && th.page === f.page) : undefined;
                    const page = f.page ?? f.first;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : f.id)}
                          className={cn(
                            'console-focusable -mx-2 rounded-lg px-2 py-1 text-left text-[14.5px] leading-relaxed transition-colors hover:bg-white/[0.04]',
                            f.attention === 'act' || open ? 'text-foreground' : 'text-quiet',
                          )}
                        >
                          {copy.summary}
                        </button>
                        <AnimatePresence initial={false}>
                          {open && (
                            <motion.div
                              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                              className="mb-3 mt-2 space-y-5 rounded-xl bg-white/[0.03] p-5"
                            >
                              <p className="max-w-[60ch] text-[14.5px] leading-relaxed text-quiet">{copy.why}</p>
                              {pageThemes && <ThemesPicture themes={pageThemes} />}
                              {f.grid && page && <GridPicture grid={f.grid} page={page} color={l.color} />}
                              <Link to={page ? pageHref(l.id, page) : `/v4/space/${spaceId}/lesson/${l.id}`} className={whitePillSm}>
                                {page ? t('feed.openPage', { page }) : t('lessons.open', { lesson: l.title })}
                                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                              </Link>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A Lesson's marker on the line: a ring in its colour, drawn as far as its light. */
function Marker({ order, color, strength, reduce }: { order: number; color: string; strength: number; reduce: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex h-10 w-10 items-center justify-center">
      <svg aria-hidden width={40} height={40} className="absolute inset-0 -rotate-90">
        <circle cx={20} cy={20} r={r} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={2.5} />
        {strength > 0 && (
          <motion.circle
            cx={20}
            cy={20}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: reduce ? c * (1 - strength / 100) : c }}
            animate={{ strokeDashoffset: c * (1 - strength / 100) }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </svg>
      <span className={cn('relative text-[14px] font-medium tabular-nums', strength > 0 ? 'text-foreground' : 'text-quiet')}>{order}</span>
    </span>
  );
}
