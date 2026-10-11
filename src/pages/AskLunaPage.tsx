/**
 * /ask-luna — the tutor, wearing the student's own Luna.
 * Routed only when VITE_FEATURE_ASK_LUNA=1 (pairs with backend FEATURE_ASK_LUNA).
 */
import { useTranslation } from 'react-i18next';
import { AskLuna } from '@/features/askLuna/AskLuna';
import { apiBrain } from '@/features/askLuna/apiBrain';
import { useLoadout } from '@/features/avatar/useAvatar';

export default function AskLunaPage() {
  const { t } = useTranslation('askLuna');
  const { loadout, mood } = useLoadout();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl font-black text-white">{t('title')}</h1>
        <p className="mt-1 text-sm text-white/60">{t('subtitle')}</p>
      </header>
      <AskLuna brain={apiBrain} loadout={loadout} restingMood={mood} />
    </div>
  );
}
