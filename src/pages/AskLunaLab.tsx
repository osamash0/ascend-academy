/**
 * DEV-only playground for Ask Luna (/ask-luna-lab).
 *
 * Runs the real chat, protocol and widgets against the scripted brain, with a
 * dressed-up Luna, so the tutor experience can be judged before the backend
 * endpoint exists. Not routed in production builds.
 */
import { useTranslation } from 'react-i18next';
import { AskLuna } from '@/features/askLuna/AskLuna';
import { scriptedBrain } from '@/features/askLuna/scriptedBrain';

// A typical student's Luna: mostly default, one earned piece of gear.
const DEMO_LOADOUT = { gear: 'gear-headphones' };

export default function AskLunaLab() {
  const { t } = useTranslation('askLuna');
  return (
    <div className="min-h-screen bg-black px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">Dev lab · scripted brain · not in production</p>
        <h1 className="mt-1 text-3xl font-black">{t('title')}</h1>
        <p className="mb-8 mt-1 text-sm text-white/60">{t('subtitle')}</p>
        <AskLuna brain={scriptedBrain} loadout={DEMO_LOADOUT} />
      </div>
    </div>
  );
}
