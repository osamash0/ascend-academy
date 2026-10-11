/**
 * The Learnstation ID: your card in the app.
 *
 * Two faces, one card:
 *  - with Luna, a *Crew ID* from the Space Academy (starfield, Luna's portrait);
 *  - with your own photo, a *Learner Licence*: an engraved off-white document
 *    with one clear lead (your surname), a faint ghost portrait, and a small
 *    holographic seal that shifts colour as you tilt it. Your rank is the
 *    licence class, your newest badges ride along as endorsements.
 *
 * Privacy by construction: no birth date, no address, no real id. The card
 * number is a one-way hash of the account id, so a screenshot gives nothing
 * away.
 */
import { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { BadgeCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LunaAvatar } from './LunaAvatar';
import type { Loadout } from './types';

export interface IdCardData {
  userId: string;
  name: string;
  photoUrl: string | null;
  loadout: Partial<Loadout>;
  rank: string;
  level: number;
  institution: string | null;
  verified: boolean;
  memberSince: Date | null;
  /** Most recent badge names, newest first. */
  badges: string[];
}

/** FNV-1a → "LS-4KQ2-9XTM". Stable, not reversible to the account id. */
export function cardNumber(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let h2 = h ^ 0x5bd1e995;
  h2 = Math.imul(h2 ^ (h2 >>> 15), 0x2c1b3c6d);
  const s = ((h >>> 0).toString(36) + (h2 >>> 0).toString(36)).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(8, '7');
  return `LS-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

export function splitName(name: string): { surname: string; given: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { surname: parts[0] ?? '-', given: '-' };
  return { surname: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

function useTilt() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 180, damping: 18 });
  const sy = useSpring(py, { stiffness: 180, damping: 18 });
  const rotateY = useTransform(sx, [0, 1], [-10, 10]);
  const rotateX = useTransform(sy, [0, 1], [8, -8]);
  const sheen = useTransform([sx, sy], ([x, y]) => `${(x as number) * 100}% ${(y as number) * 100}%`);
  const onMove = (e: React.PointerEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const onLeave = () => {
    px.set(0.5);
    py.set(0.5);
  };
  return { ref, reduce, rotateX, rotateY, sheen, onMove, onLeave };
}

function Field({ n, label, value, className }: { n: string; label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 leading-tight', className)}>
      <p className="truncate text-[7px] font-semibold uppercase tracking-wider opacity-60">
        <span className="mr-1 tabular-nums">{n}.</span>
        {label}
      </p>
      <p className="truncate text-[11px] font-bold">{value}</p>
    </div>
  );
}

export function IdCard({ data, className }: { data: IdCardData; className?: string }) {
  const { t, i18n } = useTranslation('avatar');
  const { ref, reduce, rotateX, rotateY, sheen, onMove, onLeave } = useTilt();
  const licence = !!data.photoUrl;
  const { surname, given } = splitName(data.name);
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-');
  const no = cardNumber(data.userId);
  const where = data.institution ?? 'Learnstation';

  return (
    <div style={{ perspective: 900 }} className={cn('w-full max-w-[420px]', className)}>
      <motion.div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={reduce ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className={cn(
          'relative aspect-[1.586] w-full select-none overflow-hidden rounded-[18px] shadow-2xl ring-1',
          licence ? 'bg-gradient-to-br from-zinc-50 to-zinc-200 text-zinc-900 ring-zinc-900/10' : 'bg-black text-white ring-white/15',
        )}
        role="img"
        aria-label={licence ? t('card.licence') : t('card.crew')}
      >
        {licence ? (
          <>
            {/* engraved texture: a fine diagonal hatch, like intaglio printing */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{ backgroundImage: 'repeating-linear-gradient(135deg, #0a0a0a 0 1px, transparent 1px 5px)' }}
            />
            {/* ghost portrait: large, faint, behind the data, a real security feature */}
            <img
              src={data.photoUrl!}
              alt=""
              aria-hidden
              className="pointer-events-none absolute -right-6 top-6 h-[78%] object-cover opacity-[0.07] grayscale [mask-image:linear-gradient(to_left,black,transparent)]"
            />

            <div className="relative flex h-full flex-col p-[6%]">
              {/* masthead */}
              <div className="flex items-baseline justify-between">
                <p className="text-[13px] font-black tracking-tight">Learnstation</p>
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{t('card.licence')}</p>
              </div>

              <div className="mt-[5%] flex min-h-0 flex-1 gap-[5%]">
                <img
                  src={data.photoUrl!}
                  alt=""
                  className="aspect-[4/5] h-full shrink-0 rounded-[10px] object-cover shadow-[0_6px_18px_-8px_rgba(9,9,11,0.45)] ring-1 ring-zinc-900/10 [filter:saturate(0.9)]"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="shrink-0 truncate text-[12px] font-medium leading-tight text-zinc-500">{given !== '-' ? given : '\u00a0'}</p>
                  <p className="shrink-0 truncate text-[22px] font-black uppercase leading-[1.1] tracking-tight">{surname}</p>
                  <p className="mt-1 inline-flex min-w-0 shrink-0 items-center gap-1 text-[11px] font-medium leading-tight text-zinc-600">
                    <span className="truncate">{where}</span>
                    {data.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label={t('card.verified')} />}
                  </p>

                  <div className="mt-auto grid shrink-0 grid-cols-2 gap-x-4">
                    <div>
                      <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{t('card.class')}</p>
                      <p className="text-[15px] font-black leading-tight">{data.rank}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{t('card.level')}</p>
                      <p className="text-[15px] font-black leading-tight tabular-nums">{data.level}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* footer: card number and issue date on one engraved line */}
              <div className="mt-[4%] flex items-end justify-between border-t border-zinc-900/10 pt-2">
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{t('card.number')}</p>
                  <p className="font-mono text-[11px] font-semibold tracking-[0.12em]">{no}</p>
                </div>
              {/* holographic seal: one small foil disc that shifts colour as the card tilts */}
              <motion.div
                aria-hidden
                className="pointer-events-none grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-white/60"
                style={{
                  backgroundImage:
                    'conic-gradient(from 0deg, #a7f3d0, #bfdbfe, #fbcfe8, #fde68a, #a7f3d0)',
                  backgroundSize: '260% 260%',
                  backgroundPosition: reduce ? '50% 50%' : sheen,
                  opacity: 0.85,
                  boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.8), 0 1px 3px rgba(9,9,11,0.15)',
                }}
              >
                <span className="h-5 w-5 rounded-full bg-white/70 [mask-image:radial-gradient(circle_at_70%_35%,transparent_42%,black_44%)]" />
              </motion.div>
                <div className="text-right">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{t('card.issued')}</p>
                  <p className="text-[11px] font-semibold tabular-nums">{fmt(data.memberSince)}</p>
                </div>
              </div>
            </div>

          </>
        ) : (
          <>
            {/* starfield */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 320 202" preserveAspectRatio="none" aria-hidden>
              {Array.from({ length: 40 }, (_, i) => {
                const x = (i * 73) % 320;
                const y = (i * 47) % 202;
                return <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 1 : 0.5} fill="#fff" opacity={i % 3 === 0 ? 0.6 : 0.3} />;
              })}
            </svg>
            <div className="relative flex items-center justify-between px-4 pt-3">
              <div className="leading-none">
                <p className="text-[8px] font-bold uppercase tracking-[0.25em] text-white/50">Learnstation · {t('card.academy')}</p>
                <p className="text-[13px] font-black uppercase tracking-wide">{t('card.crew')}</p>
              </div>
              <span className="font-mono text-[9px] tracking-wider text-white/60">{no}</span>
            </div>
            <div className="relative mt-3 flex gap-4 px-4">
              <div className="w-[34%] shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15">
                <LunaAvatar loadout={{ ...data.loadout, aura: 'aura-none', companion: 'companion-none' }} variant="head" size={140} animated={false} className="h-auto w-full" />
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 text-white">
                <Field n="1" label={t('card.name')} value={data.name} className="col-span-2" />
                <Field n="2" label={t('card.rank')} value={data.rank} />
                <Field n="3" label={t('card.level')} value={data.level} />
                <Field
                  n="4"
                  label={t('card.station')}
                  value={
                    <span className="inline-flex items-center gap-1">
                      {where}
                      {data.verified && <BadgeCheck className="h-3 w-3 text-emerald-400" aria-label={t('card.verified')} />}
                    </span>
                  }
                  className="col-span-2"
                />
                <Field n="5" label={t('card.since')} value={fmt(data.memberSince)} className="col-span-2" />
              </div>
            </div>
            <p className="absolute bottom-2.5 left-4 right-4 truncate text-[9px] text-white/45">{data.badges.slice(0, 3).join(' · ')}</p>
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 mix-blend-screen"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 45%)',
                backgroundSize: '220% 220%',
                backgroundPosition: reduce ? '50% 50%' : sheen,
              }}
            />
          </>
        )}
      </motion.div>
    </div>
  );
}
