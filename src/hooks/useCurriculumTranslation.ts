import { useTranslation } from 'react-i18next';

export function useCurriculumTranslation() {
  const { t } = useTranslation(['common']);
  
  return function translateCurriculumTitle(title?: string | null) {
    if (!title) return '';
    const dict = t('common:curriculum', { returnObjects: true, defaultValue: {} }) as Record<string, string>;
    return dict[title] || title;
  };
}
