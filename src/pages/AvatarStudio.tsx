/**
 * /avatar — the Suit Locker for the signed-in student.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SuitLocker } from '@/features/avatar/SuitLocker';
import { FacePicker } from '@/features/avatar/FacePicker';
import { useLoadout } from '@/features/avatar/useAvatar';
import type { Loadout } from '@/features/avatar/types';

export default function AvatarStudio() {
  const { t } = useTranslation('avatar');
  const { loadout, progress, badges, save, ready } = useLoadout();
  const [saving, setSaving] = useState(false);
  const badgeDates = useMemo(() => Object.fromEntries(badges.map((b) => [b.key, b.earnedAt])), [badges]);

  const onSave = async (next: Loadout) => {
    setSaving(true);
    try {
      await save(next);
      toast.success(t('actions.savedToast'));
    } catch (e) {
      console.warn('avatar save failed', e);
      toast.error(t('actions.saveFailed'));
      throw e;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-black text-white">{t('title')}</h1>
        <p className="mt-1 text-sm text-white/60">{t('subtitle')}</p>
      </header>
      {ready && <FacePicker loadout={loadout} />}
      {ready ? (
        // Mounted only once loaded, so the locker's draft starts from what's saved.
        <SuitLocker progress={progress} initial={loadout} onSave={onSave} saving={saving} badgeDates={badgeDates} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(300px,420px)_1fr]">
          <div className="aspect-[8/9] animate-pulse rounded-[32px] bg-white/5" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
