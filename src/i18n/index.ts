import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enLanding from './locales/en/landing.json';
import enAuth from './locales/en/auth.json';
import enSettings from './locales/en/settings.json';
import enDashboard from './locales/en/dashboard.json';
import enProfessor from './locales/en/professor.json';
import enUpload from './locales/en/upload.json';
import enLecture from './locales/en/lecture.json';
import enLegal from './locales/en/legal.json';

import deCommon from './locales/de/common.json';
import deNav from './locales/de/nav.json';
import deLanding from './locales/de/landing.json';
import deAuth from './locales/de/auth.json';
import deSettings from './locales/de/settings.json';
import deDashboard from './locales/de/dashboard.json';
import deProfessor from './locales/de/professor.json';
import deUpload from './locales/de/upload.json';
import deLecture from './locales/de/lecture.json';
import deLegal from './locales/de/legal.json';

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'learnstation.language';

const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    landing: enLanding,
    auth: enAuth,
    settings: enSettings,
    dashboard: enDashboard,
    professor: enProfessor,
    upload: enUpload,
    lecture: enLecture,
    legal: enLegal,
  },
  de: {
    common: deCommon,
    nav: deNav,
    landing: deLanding,
    auth: deAuth,
    settings: deSettings,
    dashboard: deDashboard,
    professor: deProfessor,
    upload: deUpload,
    lecture: deLecture,
    legal: deLegal,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: ['common', 'nav', 'landing', 'auth', 'settings', 'dashboard', 'professor', 'upload', 'lecture', 'legal'],
    defaultNS: 'common',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

const syncHtmlLang = (lng: string) => {
  const normalized = (lng || 'en').split('-')[0];
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalized;
  }
};

syncHtmlLang(i18n.language);
i18n.on('languageChanged', syncHtmlLang);

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function setLanguage(lng: SupportedLanguage) {
  void i18n.changeLanguage(lng);
}

export default i18n;
