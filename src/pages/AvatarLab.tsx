/**
 * DEV-only playground for the Luna avatar system (/avatar-lab).
 *
 * Fake progress via sliders, so every unlock rule, mood and piece of art can
 * be checked without a seeded account. Not routed in production builds.
 */
import { useMemo, useState } from 'react';
import { SuitLocker } from '@/features/avatar/SuitLocker';
import { LunaAvatar } from '@/features/avatar/LunaAvatar';
import { itemsForSlot } from '@/features/avatar/catalog';
import { LunaSpinner } from '@/features/avatar/LunaSpinner';
import { LevelUpModal } from '@/components/LevelUpModal';
import { IdCard, type IdCardData } from '@/features/avatar/IdCard';

// A neutral drawn silhouette standing in for an uploaded photo (no real person).
const SAMPLE_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8dc"/><stop offset="1" stop-color="#90a4ae"/></linearGradient></defs><rect width="80" height="100" fill="url(#g)"/><circle cx="40" cy="38" r="17" fill="#5d4037"/><circle cx="40" cy="41" r="14" fill="#d7a98c"/><path d="M12 100 Q14 66 40 64 Q66 66 68 100 Z" fill="#37474f"/></svg>',
  );

const SAMPLE: IdCardData = {
  userId: 'demo-user-0001',
  name: 'Mira Al-Hassan',
  photoUrl: null,
  loadout: { gear: 'gear-headphones', backdrop: 'backdrop-lunar' },
  rank: 'Scholar',
  level: 13,
  institution: 'Philipps-Universität Marburg',
  verified: true,
  memberSince: new Date('2026-04-14'),
  badges: ['Bookworm', 'On Fire', 'First Quiz Completed'],
};
import type { AvatarProgress } from '@/features/avatar/types';

const ALL_BADGES = [
  'First Steps', 'Bookworm', 'Graduate', 'Scholar', 'Course Conqueror', 'First Quiz Completed', 'Perfect Score',
  'Sharpshooter', 'On Fire', 'Unstoppable', 'Quick Thinker', 'Inquisitive', 'Voice Heard',
];

export default function AvatarLab() {
  const [xp, setXp] = useState(1240);
  const [streak, setStreak] = useState(4);
  const [badges, setBadges] = useState<string[]>(['First Steps', 'First Quiz Completed', 'On Fire']);
  const [levelUp, setLevelUp] = useState(false);

  const progress: AvatarProgress = useMemo(
    () => ({ xp, level: Math.floor(xp / 100) + 1, streak, bestStreak: streak, badges: new Set(badges) }),
    [xp, streak, badges],
  );

  return (
    <div className="min-h-screen bg-black px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-7xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">Dev lab · not in production</p>
        <h1 className="mt-1 text-3xl font-black">Suit Locker</h1>
        <p className="mt-1 text-sm text-white/60">Every piece of gear is earned by learning. Nothing here is for sale.</p>

        <div className="my-6 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_1fr_2fr]">
          <label className="text-sm">
            <span className="font-semibold">XP: {xp.toLocaleString()}</span> <span className="text-white/50">(level {progress.level})</span>
            <input type="range" min={0} max={30000} step={10} value={xp} onChange={(e) => setXp(+e.target.value)} className="mt-2 w-full" />
          </label>
          <label className="text-sm">
            <span className="font-semibold">Streak: {streak} days</span>
            <input type="range" min={0} max={40} value={streak} onChange={(e) => setStreak(+e.target.value)} className="mt-2 w-full" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_BADGES.map((b) => {
              const on = badges.includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBadges((bs) => (on ? bs.filter((x) => x !== b) : [...bs, b]))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-amber-300/60 bg-amber-300/15 text-amber-200' : 'border-white/10 text-white/50'}`}
                >
                  {b}
                </button>
              );
            })}
          </div>
        </div>

        {/* Moments: the loader and the level-up popup, both drawn with your Luna. */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-white/50">Moments</h2>
          <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <LunaSpinner size={32} />
            <LunaSpinner size={64} />
            <LunaSpinner size={96} />
            <button type="button" onClick={() => setLevelUp(true)} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">
              Show level-up
            </button>
          </div>
          <LevelUpModal isOpen={levelUp} onClose={() => setLevelUp(false)} newLevel={14} />
        </section>

        {/* The ID card, both faces. */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-white/50">ID card</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <IdCard data={SAMPLE} />
            <IdCard data={{ ...SAMPLE, photoUrl: SAMPLE_PHOTO }} />
          </div>
        </section>

        {/* Every home look at a glance (the locker below lets you try them on). */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-white/50">Home looks</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {itemsForSlot('outfit').map((item) => (
              <div key={item.id} className="overflow-hidden rounded-xl border border-white/10" title={item.id}>
                <LunaAvatar loadout={{ outfit: item.id, backdrop: 'backdrop-lunar' }} size={180} className="h-auto w-full" />
                <p className="px-2 py-1.5 text-xs text-white/70">{item.id.replace('outfit-', '')}</p>
              </div>
            ))}
          </div>
        </section>

        <SuitLocker progress={progress} showMoodPreview onSave={(l) => console.info('[avatar-lab] save', l)} />
      </div>
    </div>
  );
}
