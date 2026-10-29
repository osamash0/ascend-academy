/**
 * Mockup B — tiles.
 *
 * Stats first, like a fitness app: four big friendly tiles (reading, landing,
 * cleared, questions), then every Lesson as a cover tile in its own deck
 * colour with a mini page-strip and one word of light. Tap a tile and its
 * findings line up beneath the grid.
 */
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BookOpen, CheckCircle2, MessageCircle, Sun } from 'lucide-react';
import { Scene, SURFACES } from '@/features/spaces/components/Scene';
import { SpacesTopBar } from '@/features/spaces/components/SpacesTopBar';
import { Avatar } from '@/features/spaces/components/Avatar';
import { useViewer } from '@/features/spaces/data/viewer';
import { gradientFor } from '@/components/console/constants';
import { Chunky, METERS, findingsFor, landing, lessonColor } from './shared';

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const LIGHT_WORD = { act: 'needs you', watch: 'worth a look', calm: 'landing', few: 'too few yet' } as const;

export default function MockupTiles() {
  const viewer = useViewer();
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string | null>('l-s-dbs-4');
  const open = landing.questions.filter((q) => !q.answer);
  const pickedLesson = landing.lessons.find((l) => l.id === picked);

  const stats = [
    { icon: BookOpen, number: METERS.reading.number, label: 'read this week', sub: 'of 184 members', color: '#06b6d4' },
    { icon: Sun, number: METERS.landing.number, label: 'of pages landing', sub: '29% want a look', color: '#10b981' },
    { icon: CheckCircle2, number: METERS.cleared.number, label: 'cleared first try', sub: 'checkpoints', color: '#f59e0b' },
  ];

  return (
    <Scene surface={SURFACES.course} status="progress" motionKey="mock-tiles" accent={null}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      <div className="relative mx-auto max-w-5xl px-6 pb-40 pt-10">
        <p className="text-[13px] text-white/50">Database Systems</p>
        <h1 className="mt-1 text-[40px] font-medium leading-none tracking-[-0.03em] sm:text-[52px]">How it's landing</h1>

        {/* Four big tiles */}
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : i * 0.08, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-3xl border p-5"
              style={{ borderColor: mix(s.color, 30), background: `linear-gradient(160deg, ${mix(s.color, 16)}, ${mix(s.color, 3)})` }}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: mix(s.color, 25), color: s.color }}>
                <s.icon aria-hidden className="h-5 w-5" />
              </span>
              <p className="mt-5 text-[36px] font-semibold leading-none tabular-nums tracking-[-0.04em]">{s.number}</p>
              <p className="mt-1.5 text-[14px]">{s.label}</p>
              <p className="text-[12px] text-white/45">{s.sub}</p>
            </motion.div>
          ))}
          <motion.button
            type="button"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.24, duration: 0.45 }}
            className="rounded-3xl border border-white/[0.14] bg-white p-5 text-left text-black"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/10">
              <MessageCircle aria-hidden className="h-5 w-5" />
            </span>
            <p className="mt-5 text-[36px] font-semibold leading-none tabular-nums tracking-[-0.04em]">{open.length}</p>
            <p className="mt-1.5 text-[14px]">questions for you</p>
            <div className="mt-2 flex -space-x-2">
              {open.map((q) =>
                q.asker ? (
                  <span key={q.id} className="rounded-full ring-2 ring-white">
                    <Avatar person={q.asker} size="sm" />
                  </span>
                ) : (
                  <span key={q.id} className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-[11px] ring-2 ring-white">
                    ?
                  </span>
                ),
              )}
            </div>
          </motion.button>
        </div>

        {/* Lesson tiles */}
        <h2 className="mt-14 text-[22px] font-medium tracking-[-0.02em]">Lessons</h2>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {landing.lessons.map((l, i) => {
            const color = lessonColor(l);
            const finds = findingsFor(l.id);
            const flags = finds.filter((f) => f.kind !== 'healthy').length;
            const few = l.light === 'few';
            const hot = finds.flatMap((f) => (f.page ? [f.page] : []));
            const values = l.help ?? Array.from({ length: 12 }, (_, k) => 3 + ((k * 5) % 4));
            const max = Math.max(...values, 1);
            return (
              <motion.button
                key={l.id}
                type="button"
                onClick={() => setPicked(l.id)}
                initial={reduce ? false : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: reduce ? 0 : 0.2 + i * 0.05, duration: 0.4 }}
                aria-pressed={picked === l.id}
                className="group overflow-hidden rounded-3xl border bg-white/[0.03] text-left transition-transform hover:-translate-y-0.5"
                style={{ borderColor: picked === l.id ? 'white' : mix(color, few ? 10 : 30), opacity: few ? 0.6 : 1 }}
              >
                <div className={`relative h-24 bg-gradient-to-br ${gradientFor(l.order)}`}>
                  <span className="absolute left-4 top-3 text-[44px] font-semibold leading-none tracking-[-0.04em] text-white/90">{l.order}</span>
                  {flags > 0 && (
                    <span className="absolute right-3 top-3 flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-2 text-[13px] font-bold text-black">{flags}</span>
                  )}
                </div>
                <div className="p-4">
                  <p className="truncate text-[15px] font-medium">{l.title}</p>
                  <p className="text-[12px] text-white/50">{few ? 'too few to say yet' : `${l.readers} readers`}</p>
                  <div aria-hidden className="mt-3 flex h-6 items-end gap-[2px]">
                    {values.map((v, k) => (
                      <span key={k} className="flex-1 rounded-sm" style={{ height: `${Math.max(10, (v / max) * 100)}%`, background: hot.includes(k + 1) ? color : 'rgba(255,255,255,0.14)' }} />
                    ))}
                  </div>
                  <span className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]" style={{ background: mix(color, few ? 0 : 18), color: few ? 'rgba(255,255,255,0.5)' : color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: few ? 'transparent' : color, border: few ? '1px solid rgba(255,255,255,0.4)' : 'none' }} />
                    {LIGHT_WORD[l.light]}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>

        {pickedLesson && findingsFor(pickedLesson.id).length > 0 && (
          <div className="mt-10">
            <h2 className="text-[22px] font-medium tracking-[-0.02em]">
              {pickedLesson.title} <span className="text-white/45">· what needs you</span>
            </h2>
            <div className="mt-4 space-y-3">
              {findingsFor(pickedLesson.id).map((f, k) => (
                <Chunky key={f.id} insight={f} lesson={pickedLesson} index={k} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Scene>
  );
}
