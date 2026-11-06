import { useTranslation } from 'react-i18next';

/** A source-language fallback is useful only when the learner can identify it. */
export function PracticeLanguageNote({ language }: { language?: 'en' | 'de' }) {
  const { t, i18n } = useTranslation('v4Space');
  if (!language || language === (i18n.language || 'en').split('-')[0]) return null;
  return (
    <p className="mb-4 text-[13px] leading-relaxed text-quiet">
      {t('practiceScreen.originalLanguage', { language: t(`practiceScreen.languages.${language}`) })}
    </p>
  );
}
