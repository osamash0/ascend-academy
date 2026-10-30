/**
 * Mockup A — the path.
 *
 * Duolingo's signature: Lessons as big round nodes down a winding path, each
 * lit by its own deck colour, flags where pages need you. Luna greets; three
 * rings say how it's going; tap a node and its findings pop in beneath it.
 */
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { MessageCircle } from 'lucide-react';
import { Scene, SURFACES } from '@/features/spaces/components/Scene';
import { SpacesTopBar } from '@/features/spaces/components/SpacesTopBar';
import { useViewer } from '@/features/spaces/data/viewer';
import { Chunky, LEDE, LunaSays, METERS, Ring, findingsFor, landing, lessonColor } from './shared';

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
/* The winding: a gentle left-right drift, like a trail. */
const DRIFT = [0, 56, 96, 56, 0, -56, -96, -56, 0, 56];

export default function MockupPath() {
  const viewer = useViewer();
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string>('l-s-dbs-4');
  const open = landing.questions.filter((q) => !q.answer).length;

  return (
    <Scene surface={SURFACES.course} status="progress" motionKey="mock-path" accent={lessonColor(landing.lessons[3])}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      <div className="relative mx-auto max-w-3xl px-6 pb-40 pt-10">
        <p className="text-[13px] text-white/50">Database Systems</p>
        <h1 className="mt-1 text-[40px] font-medium leading-none tracking-[-0.03em] sm:text-[52px]">How it's landing</h1>
        <LunaSays text={LEDE} className="mt-6" />

        {/* Three rings + the questions badge */}
        <div className="mt-10 grid grid-cols-3 gap-4 sm:gap-8">
          {(['reading', 'landing', 'cleared'] as const).map((k, i) => {
            const m = METERS[k];
            const colors = ['#06b6d4', '#10b981', '#f59e0b'];
            return (
              <div key={k} className="flex flex-col items-center text-center">
                <Ring value={m.value} color={colors[i]}>
                  <span className="text-[22px] font-semibold tabular-nums tracking-[-0.03em]">{m.number}</span>
                </Ring>
                <p className="mt-3 text-[12.5px] leading-snug text-white/55">{m.of}</p>
              </div>
            );
          })}
        </div>

        <button type="button" className="mx-auto mt-8 flex items-center gap-3 rounded-full border border-white/[0.1] bg-white/[0.05] py-2.5 pl-3 pr-5 text-[14px]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
            <MessageCircle aria-hidden className="h-4 w-4" />
          </span>
          <span className="font-medium">{open} questions for you</span>
          <span className="text-white/50">· Åsa, Someone, Chidi</span>
        </button>

        {/* The path */}
        <ol className="relative mt-14">
          {landing.lessons.map((l, i) => {
            const color = lessonColor(l);
            const finds = findingsFor(l.id);
            const flags = finds.filter((f) => f.kind !== 'healthy').length;
            const few = l.light === 'few';
            const act = l.light === 'act';
            const isPicked = picked === l.id;
            return (
              <li key={l.id} className="relative" style={{ minHeight: 120 }}>
                <div className="relative flex flex-col items-center" style={{ transform: `translateX(${DRIFT[i % DRIFT.length]}px)` }}>
                  <motion.button
                    type="button"
                    onClick={() => setPicked(l.id)}
                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : 0.1 + i * 0.06, type: 'spring', stiffness: 260, damping: 18 }}
                    aria-pressed={isPicked}
                    className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full text-[24px] font-semibold tabular-nums"
                    style={
                      few
                        ? { border: '3px dashed rgba(255,255,255,0.22)', color: 'rgba(255,255,255,0.45)' }
                        : {
                            background: `radial-gradient(circle at 35% 30%, ${mix(color, act ? 95 : 55)}, ${mix(color, act ? 70 : 30)})`,
                            color: act ? '#000' : '#fff',
                            boxShadow: `0 10px 0 ${mix(color, act ? 45 : 20)}, 0 0 ${act ? 32 : 0}px ${mix(color, 55)}`,
                            outline: isPicked ? '3px solid white' : 'none',
                            outlineOffset: 5,
                          }
                    }
                  >
                    {l.order}
                    {flags > 0 && (
                      <span className="absolute -right-2 -top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-2 text-[13px] font-bold text-black shadow">
                        {flags}
                      </span>
                    )}
                  </motion.button>
                  <p className="mt-3 text-[15px] font-medium">{l.title}</p>
                  <p className="text-[12px] text-white/50">{few ? 'too few to say yet' : `${l.readers} readers`}</p>
                </div>

                {isPicked && finds.length > 0 && (
                  <div className="mx-auto mt-6 max-w-xl space-y-3 pb-6">
                    {finds.map((f, k) => (
                      <Chunky key={f.id} insight={f} lesson={l} index={k} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </Scene>
  );
}

