/**
 * "How people see you" — Luna or your own photo.
 *
 * One honest choice, shown with the real result side by side. Choosing the
 * photo uploads it (processed on-device, see photo.ts); choosing Luna clears
 * the photo and deletes the file. Your Luna keeps her outfit either way —
 * she still guides you in Ask Luna and celebrates with you.
 */
import { useRef, useState } from 'react';
import { Camera, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useGamification } from '@/lib/gamification/GamificationProvider';
import { cn } from '@/lib/utils';
import { isRealPhoto } from './identity';
import { LunaAvatar } from './LunaAvatar';
import { PhotoError, removeProfilePhoto, uploadProfilePhoto } from './photo';
import type { Loadout } from './types';

export function FacePicker({ loadout }: { loadout: Loadout }) {
  const { t } = useTranslation('avatar');
  const { user, profile, refreshProfile } = useAuth();
  const gamification = useGamification();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const photo = isRealPhoto(profile?.avatar_url) ? profile!.avatar_url! : null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    setBusy('upload');
    try {
      await uploadProfilePhoto(user.id, file);
      await refreshProfile();
      // A photo can complete the "Identity Set" badge, as the old Settings upload did.
      gamification.evaluate();
      toast.success(t('face.uploaded'));
    } catch (err) {
      const code = err instanceof PhotoError ? err.code : 'upload';
      toast.error(t(`face.errors.${code}`));
    } finally {
      setBusy(null);
    }
  };

  const useLuna = async () => {
    if (!user || !photo) return;
    setBusy('remove');
    try {
      await removeProfilePhoto(user.id);
      await refreshProfile();
      toast.success(t('face.backToLuna'));
    } catch {
      toast.error(t('face.errors.upload'));
    } finally {
      setBusy(null);
    }
  };

  const option = (active: boolean) =>
    cn(
      'relative flex items-center gap-3 rounded-2xl border p-3 text-left transition',
      active ? 'border-white/40 bg-white/[0.06]' : 'border-white/10 hover:bg-white/[0.04]',
    );

  return (
    <section aria-labelledby="face-title" className="rounded-[24px] border border-white/10 bg-white/[0.02] p-4">
      <p id="face-title" className="text-sm font-semibold text-white">{t('face.title')}</p>
      <p className="mb-3 text-xs text-white/55">{t('face.body')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={useLuna} disabled={!photo || !!busy} aria-pressed={!photo} className={option(!photo)}>
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full">
            <LunaAvatar loadout={{ ...loadout, aura: 'aura-none', companion: 'companion-none' }} variant="head" size={48} animated={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">{t('face.luna')}</span>
            <span className="block text-xs text-white/55">{t('face.lunaHint')}</span>
          </span>
          {busy === 'remove' ? <Loader2 className="h-4 w-4 animate-spin text-white/60" /> : !photo && <Check className="h-4 w-4 text-white" />}
        </button>

        <button type="button" onClick={() => input.current?.click()} disabled={!!busy} aria-pressed={!!photo} className={option(!!photo)}>
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.06]">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <Camera className="h-5 w-5 text-white/60" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">{photo ? t('face.photo') : t('face.upload')}</span>
            <span className="block text-xs text-white/55">{photo ? t('face.replace') : t('face.photoHint')}</span>
          </span>
          {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin text-white/60" /> : photo && <Check className="h-4 w-4 text-white" />}
        </button>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" onChange={onFile} aria-label={t('face.upload')} />
    </section>
  );
}
