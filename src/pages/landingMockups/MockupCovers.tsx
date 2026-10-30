/**
 * Mockup C — the decks.
 *
 * Content first: the Lessons as the covers they already are in the Space,
 * each with a light bar under it in its own deck colour and dots where pages
 * need you. Luna and three big figures in the masthead; findings as big
 * friendly rows with the number on the right.
 */
import { motion, useReducedMotion } from 'motion/react';
import { Scene, SURFACES } from '@/features/spaces/components/Scene';
import { SpacesTopBar } from '@/features/spaces/components/SpacesTopBar';
import { Avatar } from '@/features/spaces/components/Avatar';
import { useViewer } from '@/features/spaces/data/viewer';
import { gradientFor } from '@/components/console/constants';
import { Chunky, LEDE, LunaSays, METERS, findingsFor, landing, lessonById, lessonColor } from './shared';

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export default function MockupCovers() {
  const viewer = useViewer();
  const reduce = useReducedMotion();
  const open = landing.questions.filter((q) => !q.answer);
  const top = landing.insights.filter((i) => i.kind !== 'healthy').slice(0, 5);

  return (
    <Scene surface={SURFACES.course} status="progress" motionKey="mock-covers" accent={lessonColor(landing.lessons[3])}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      <div className="relative mx-auto max-w-5xl px-6 pb-40 pt-10">
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <p className="text-[13px] text-white/50">Database Systems</p>
            <h1 className="mt-1 text-[44px] font-medium leading-none tracking-[-0.03em] sm:text-[60px]">How it's landing</h1>
            <div className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
              {[
                { n: METERS.reading.number, w: 'read this week', c: '#06b6d4' },
                { n: METERS.landing.number, w: 'of pages landing', c: '#10b981' },
                { n: METERS.cleared.number, w: 'cleared first try', c: '#f59e0b' },
                { n: `${open.length}`, w: 'questions waiting', c: '#ffffff' },
              ].map((f, i) => (
                <motion.div
                  key={f.w}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reduce ? 0 : i * 0.08, duration: 0.4 }}
                >
                  <p className="text-[34px] font-semibold leading-none tabular-nums tracking-[-0.04em]" style={{ color: f.c }}>
                    {f.n}
                  </p>
                  <p className="mt-1.5 text-[13px] text-white/55">{f.w}</p>
                </motion.div>
              ))}
            </div>
          </div>
          <LunaSays text={LEDE} size={88} />
        </div>

        {/* The decks */}
        <div className="-mx-6 mt-12 overflow-x-auto px-6 pb-4">
          <div className="flex gap-4" style={{ width: 'max-content' }}>
            {landing.lessons.map((l, i) => {
              const color = lessonColor(l);
              const few = l.light === 'few';
              const finds = findingsFor(l.id).filter((f) => f.kind !== 'healthy');
              const strength = l.light === 'act' ? 100 : l.light === 'watch' ? 55 : l.light === 'calm' ? 25 : 0;
              return (
                <motion.div
                  key={l.id}
                  initial={reduce ? false : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: reduce ? 0 : 0.15 + i * 0.05, duration: 0.4 }}
                  className="w-[196px] shrink-0"
                  style={{ opacity: few ? 0.55 : 1 }}
                >
                  <div className={`relative aspect-video overflow-hidden rounded-2xl bg-gradient-to-br ${gradientFor(l.order)} shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_-16px_rgba(0,0,0,0.8)]`}>
                    <span className="absolute left-4 top-2 text-[40px] font-semibold leading-none tracking-[-0.04em] text-white/90">{l.order}</span>
                    <span className="absolute bottom-3 left-4 right-4 truncate text-[14px] font-medium">{l.title}</span>
                  </div>
                  {/* The light bar, with dots where pages need you */}
                  <div className="relative mt-3 h-2 rounded-full bg-white/[0.08]">
                    <div className="h-full rounded-full" style={{ width: few ? 0 : '100%', background: mix(color, strength), boxShadow: l.light === 'act' ? `0 0 14px ${mix(color, 70)}` : undefined }} />
                    {finds.map((f) =>
                      f.page ? (
                        <span
                          key={f.id}
                          title={`page ${f.page}`}
                          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black"
                          style={{ left: `${(f.page / l.pages) * 100}%`, background: f.attention === 'act' ? 'white' : color }}
                        />
                      ) : null,
                    )}
                  </div>
                  <p className="mt-2 text-[12px] text-white/50">
                    {few ? 'too few to say yet' : `${l.readers} readers · ${l.light === 'act' ? 'needs you' : l.light === 'watch' ? 'worth a look' : 'landing'}`}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Questions as a friendly stack */}
        <h2 className="mt-12 text-[22px] font-medium tracking-[-0.02em]">Questions for you</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {open.map((q) => {
            const l = lessonById.get(q.lessonId);
            const color = l ? lessonColor(l) : '#fff';
            return (
              <button key={q.id} type="button" className="flex max-w-md items-center gap-3 rounded-full border border-white/[0.1] bg-white/[0.05] py-2 pl-2 pr-4 text-left transition-colors hover:bg-white/[0.09]">
                {q.asker ? <Avatar person={q.asker} size="md" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.2] text-[12px] text-white/50">?</span>}
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{q.text}</span>
                  <span className="block text-[11.5px]" style={{ color }}>
                    {l?.title} · page {q.page}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Findings as big rows */}
        <h2 className="mt-12 text-[22px] font-medium tracking-[-0.02em]">What needs you</h2>
        <div className="mt-4 space-y-3">
          {top.map((f, k) => {
            const l = lessonById.get(f.lessonId);
            return l ? <Chunky key={f.id} insight={f} lesson={l} index={k} /> : null;
          })}
        </div>
      </div>
    </Scene>
  );
}
