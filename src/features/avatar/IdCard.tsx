/**
 * The Learnstation ID — your card in the app.
 *
 * Two faces, one card:
 *  - with Luna, a *Crew ID* from the Space Academy (starfield, Luna's portrait);
 *  - with your own photo, a *Learner Licence* laid out like a driving licence:
 *    numbered fields, a ghost image, a hologram that moves as you tilt it, a
 *    signature line — except the "licence class" is your rank and the
 *    "endorsements" are your badges.
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
  if (parts.length <= 1) return { surname: parts[0] ?? '—', given: '—' };
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
  const fmt = (d: Date | null) => (d ? d.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
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
          licence ? 'bg-[#EEF1EC] text-[#1B2430] ring-black/10' : 'bg-black text-white ring-white/15',
        )}
        role="img"
        aria-label={licence ? t('card.licence') : t('card.crew')}
      >
        {licence ? (
          <>
            {/* guilloche: fine security waves, like a real licence */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.35]" viewBox="0 0 320 202" preserveAspectRatio="none" aria-hidden>
              {Array.from({ length: 18 }, (_, i) => (
                <path key={i} d={`M0 ${20 + i * 10} C80 ${4 + i * 10} 160 ${36 + i * 10} 320 ${16 + i * 10}`} stroke="#7BA7A0" strokeWidth="0.5" fill="none" />
              ))}
              <circle cx="250" cy="120" r="70" fill="none" stroke="#C9B37E" strokeWidth="0.6" strokeDasharray="1 2" />
              <circle cx="250" cy="120" r="55" fill="none" stroke="#C9B37E" strokeWidth="0.6" strokeDasharray="1 2" />
            </svg>

            {/* header */}
            <div className="relative flex items-center gap-2 px-4 pt-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#1E3A8A] text-[10px] font-black text-white ring-2 ring-[#E5C07B]">LS</span>
              <div className="leading-none">
                <p className="text-[8px] font-bold uppercase tracking-[0.25em] opacity-60">Learnstation</p>
                <p className="text-[13px] font-black uppercase tracking-wide">{t('card.licence')}</p>
              </div>
            </div>

            {/* ghost image: a faded copy of the photo, as on a real licence */}
            <img src={data.photoUrl!} alt="" aria-hidden className="absolute right-4 top-3 h-[20%] rounded-sm object-cover opacity-25 grayscale" />

            <div className="relative mt-2 flex gap-3 px-4">
              {/* photo, passport-style, with the signature (field 7) beneath it */}
              <div className="w-[30%] shrink-0">
                <img src={data.photoUrl!} alt="" className="aspect-[4/5] w-full rounded-md object-cover ring-1 ring-black/15 [filter:saturate(0.85)_contrast(1.05)]" />
                <p className="mt-1 text-[6px] font-semibold uppercase tracking-wider opacity-60">7.</p>
                <p className="-mt-1 truncate text-[13px] leading-tight text-[#1E3A8A]" style={{ fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' }}>
                  {data.name}
                </p>
                <div className="h-px bg-black/25" />
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-2 content-start gap-x-3 gap-y-1.5">
                <Field n="1" label={t('card.surname')} value={surname.toUpperCase()} className="col-span-2" />
                <Field n="2" label={t('card.given')} value={given} className="col-span-2" />
                <Field n="4a" label={t('card.issued')} value={fmt(data.memberSince)} />
                <Field n="4b" label={t('card.valid')} value={t('card.forever')} />
                <Field
                  n="4c"
                  label={t('card.institution')}
                  value={
                    <span className="inline-flex items-center gap-1">
                      {where}
                      {data.verified && <BadgeCheck className="h-3 w-3 text-emerald-600" aria-label={t('card.verified')} />}
                    </span>
                  }
                  className="col-span-2"
                />
                <Field n="5" label={t('card.number')} value={<span className="font-mono tracking-wider">{no}</span>} />
                <Field
                  n="9"
                  label={t('card.class')}
                  value={
                    <span>
                      {data.rank} <span className="font-semibold opacity-60">· Lv {data.level}</span>
                    </span>
                  }
                />
                <Field n="12" label={t('card.endorsements')} value={data.badges.slice(0, 3).join(' · ') || '—'} className="col-span-2" />
              </div>
            </div>

            {/* hologram that follows the tilt */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 mix-blend-color-dodge"
              style={{
                backgroundImage: 'radial-gradient(circle at var(--x,50%) var(--y,50%), rgba(255,255,255,0.0) 0%, rgba(167,243,208,0.35) 18%, rgba(191,219,254,0.35) 32%, rgba(253,230,138,0.3) 46%, rgba(255,255,255,0) 60%)',
                backgroundSize: '220% 220%',
                backgroundPosition: reduce ? '50% 50%' : sheen,
                opacity: 0.55,
              }}
            />
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
