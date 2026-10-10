/**
 * DEV-only playground for the Luna avatar system (/avatar-lab).
 *
 * Fake progress via sliders, so every unlock rule, mood and piece of art can
 * be checked without a seeded account. Not routed in production builds.
 */
import { useMemo, useState } from 'react';
import { SuitLocker } from '@/features/avatar/SuitLocker';
import type { AvatarProgress } from '@/features/avatar/types';

const ALL_BADGES = [
  'First Steps', 'Bookworm', 'Graduate', 'Scholar', 'Course Conqueror', 'First Quiz Completed', 'Perfect Score',
  'Sharpshooter', 'On Fire', 'Unstoppable', 'Quick Thinker', 'Inquisitive', 'Voice Heard',
];

export default function AvatarLab() {
  const [xp, setXp] = useState(1240);
  const [streak, setStreak] = useState(4);
  const [badges, setBadges] = useState<string[]>(['First Steps', 'First Quiz Completed', 'On Fire']);

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

        <SuitLocker progress={progress} showMoodPreview onSave={(l) => console.info('[avatar-lab] save', l)} />
      </div>
    </div>
  );
}
