/**
 * The Suit Locker — where a student dresses Luna.
 *
 * Kept deliberately quiet: one stage, one line from Luna, one hint about
 * what's next, and the gear itself. Every earned piece remembers how it was
 * earned ("with your first 7-day streak"), so the outfit reads as a scrapbook
 * of the student's learning rather than an inventory.
 *
 * Presentational only: progress in, loadout out. The /avatar page wires it to
 * Supabase; the dev lab wires it to sliders.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Dices, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { rankForXp } from '@/lib/rank';
import { DEFAULT_LOADOUT, itemById, itemsForSlot } from './catalog';
import { LunaAvatar } from './LunaAvatar';
import { itemName, unlockHint, unlockMemory } from './copy';
import { deriveMood } from './mood';
import { randomLoadout, sameLoadout, sanitizeLoadout } from './loadout';
import { isUnlocked, nextUnlocks, unlockStatus, type UnlockStatus } from './unlocks';
import { SLOTS, type AvatarItem, type AvatarProgress, type Loadout, type Mood, type Slot } from './types';

const RARITY_RING: Record<AvatarItem['rarity'], string> = {
  common: 'border-white/10',
  rare: 'border-sky-400/40',
  epic: 'border-violet-400/50',
  legendary: 'border-amber-300/60',
};

const MOODS: Mood[] = ['curious', 'bright', 'blazing', 'waiting', 'focused', 'thinking', 'celebrating'];

export interface SuitLockerProps {
  progress: AvatarProgress;
  initial?: Loadout;
  onSave?: (loadout: Loadout) => void | Promise<void>;
  saving?: boolean;
  /** Earned-at dates per badge key, so a memory can say *when*. */
  badgeDates?: Record<string, string | null | undefined>;
  /** Dev lab only: lets you flip through Luna's moods. */
  showMoodPreview?: boolean;
}

export function SuitLocker({ progress, initial = DEFAULT_LOADOUT, onSave, saving, badgeDates = {}, showMoodPreview }: SuitLockerProps) {
  const { t, i18n } = useTranslation('avatar');
  const [draft, setDraft] = useState<Loadout>(initial);
  const [saved, setSaved] = useState<Loadout>(initial);
  const [slot, setSlot] = useState<Slot>('suit');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [moodOverride, setMoodOverride] = useState<Mood | null>(null);
  // Try-on: a locked item can be previewed on the stage, never equipped or saved.
  const [tryOn, setTryOn] = useState<AvatarItem | null>(null);

  // Never show (or save) gear the student hasn't earned, whatever the draft holds.
  const loadout = useMemo(() => sanitizeLoadout(draft, progress), [draft, progress]);
  const mood = moodOverride ?? deriveMood(progress);
  const tier = rankForXp(progress.xp);
  const next = useMemo(() => nextUnlocks(progress, 1)[0], [progress]);
  const dirty = !sameLoadout(loadout, saved);
  const focused = itemById(focusId);
  const staged = tryOn ? { ...loadout, [tryOn.slot]: tryOn.id } : loadout;

  const name = (id: string) => itemName(t, id);
  const hint = (item: AvatarItem, st: UnlockStatus) => unlockHint(t, item, st);
  const memory = (item: AvatarItem) => unlockMemory(t, item, i18n.language, badgeDates);

  const equip = (item: AvatarItem) => {
    setFocusId(item.id);
    if (isUnlocked(item, progress)) {
      setTryOn(null);
      setDraft((l) => ({ ...l, [item.slot]: item.id }));
    } else {
      setTryOn((cur) => (cur?.id === item.id ? null : item));
    }
  };

  const save = async () => {
    await onSave?.(loadout);
    setSaved(loadout);
    setMoodOverride('celebrating');
    window.setTimeout(() => setMoodOverride(null), 2400);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(300px,420px)_1fr]">
      {/* ── Stage ─────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[420px] self-start lg:sticky lg:top-6 lg:max-w-none">
        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0816] shadow-2xl">
          <motion.div
            key={`${staged.backdrop}-${staged.aura}-${staged.suit}`}
            initial={{ opacity: 0.5, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <LunaAvatar loadout={staged} mood={tryOn ? 'curious' : mood} size={420} className="h-auto w-full" title={t('stage.alt')} />
          </motion.div>

          <span
            className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-xs font-bold text-white backdrop-blur"
            style={{ boxShadow: tier.glow ? `0 0 14px ${tier.glow}` : undefined }}
          >
            {tier.name}
          </span>
          {tryOn && (
            <span className="absolute right-4 top-4 rounded-full bg-amber-300 px-3 py-1 text-xs font-bold text-[#2D2445]">
              {t('stage.tryOn')}
            </span>
          )}

          {/* Luna's line — first person, warm, one sentence */}
          <div className="absolute inset-x-4 bottom-4">
            <AnimatePresence mode="wait">
              <motion.p
                key={tryOn ? 'try' : mood}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="relative w-fit max-w-full rounded-2xl rounded-bl-md bg-white/95 px-4 py-2.5 text-sm font-medium text-[#2D2445] shadow-lg"
              >
                {tryOn ? t('voice.tryOn') : t(`voice.${mood}`)}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {showMoodPreview && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMoodOverride(moodOverride === m ? null : m)}
                className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', moodOverride === m ? 'border-primary bg-primary/20 text-white' : 'border-white/10 text-white/55')}
              >
                {t(`mood.${m}`)}
              </button>
            ))}
          </div>
        )}

        {/* The story of whatever you last touched */}
        <div className="mt-4 min-h-[44px]">
          <AnimatePresence mode="wait">
            {focused && (
              <motion.div key={focused.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-sm font-semibold text-white">{name(focused.id)}</p>
                <p className="text-sm text-white/60">
                  {isUnlocked(focused, progress) ? memory(focused) : hint(focused, unlockStatus(focused.unlock, progress))}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setTryOn(null); setDraft(randomLoadout(progress)); }}
            aria-label={t('actions.surprise')}
            title={t('actions.surprise')}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 text-white/70 transition hover:rotate-12 hover:bg-white/5 hover:text-white"
          >
            <Dices className="h-5 w-5" />
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-secondary text-sm font-bold text-white shadow-glow-primary transition active:scale-[0.98] disabled:from-white/10 disabled:to-white/10 disabled:text-white/50 disabled:shadow-none"
          >
            {saving ? t('actions.saving') : dirty ? t('actions.save') : (<><Check className="h-4 w-4" /> {t('actions.saved')}</>)}
          </button>
        </div>
      </section>

      {/* ── Locker ────────────────────────────────────────────── */}
      <section className="min-w-0">
        {next && (
          <button
            type="button"
            onClick={() => { setSlot(next.item.slot); setFocusId(next.item.id); }}
            className="mb-6 flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:bg-white/[0.05]"
          >
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl opacity-70 grayscale">
              <LunaAvatar loadout={{ ...loadout, [next.item.slot]: next.item.id }} variant="head" size={56} animated={false} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200/80">{t('next.title')}</p>
              <p className="truncate text-sm font-semibold text-white">{name(next.item.id)} <span className="font-normal text-white/55">· {hint(next.item, next.status)}</span></p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-200" initial={{ width: 0 }} animate={{ width: `${Math.round(next.status.pct * 100)}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
              </div>
            </div>
          </button>
        )}

        <div className="mb-4 flex gap-1 overflow-x-auto pb-1" role="tablist">
          {SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={slot === s}
              onClick={() => setSlot(s)}
              className={cn('shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold transition', slot === s ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white')}
            >
              {t(`slots.${s}`)}
            </button>
          ))}
        </div>

        <motion.div key={slot} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {itemsForSlot(slot).map((item) => {
            const st = unlockStatus(item.unlock, progress);
            const on = loadout[slot] === item.id;
            const fullBody = slot === 'suit' || slot === 'patch' || slot === 'aura';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => equip(item)}
                aria-pressed={on}
                aria-disabled={!st.unlocked}
                className={cn(
                  'group relative overflow-hidden rounded-2xl border bg-white/[0.03] text-left transition',
                  RARITY_RING[item.rarity],
                  on && 'ring-2 ring-primary ring-offset-2 ring-offset-[#0b0816]',
                  tryOn?.id === item.id && 'ring-2 ring-amber-300 ring-offset-2 ring-offset-[#0b0816]',
                  st.unlocked ? 'hover:-translate-y-0.5' : 'cursor-help',
                )}
              >
                <div className={cn('aspect-square w-full overflow-hidden', !st.unlocked && 'opacity-35 grayscale')}>
                  <LunaAvatar loadout={{ ...loadout, [slot]: item.id }} variant={fullBody ? 'full' : 'head'} size={200} animated={on} className="h-full w-full" />
                </div>
                {!st.unlocked && (
                  <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 backdrop-blur">
                    <Lock className="h-3.5 w-3.5 text-white/80" />
                  </span>
                )}
                <p className="truncate px-3 py-2.5 text-sm font-semibold text-white">{name(item.id)}</p>
              </button>
            );
          })}
        </motion.div>
      </section>
    </div>
  );
}
