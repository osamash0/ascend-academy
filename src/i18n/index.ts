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
import enReview from './locales/en/review.json';
import enExam from './locales/en/exam.json';
import enSearch from './locales/en/search.json';
import enMyMaterials from './locales/en/myMaterials.json';
import enGamification from './locales/en/gamification.json';
import enOnboarding from './locales/en/onboarding.json';
import enAvatar from './locales/en/avatar.json';
import enAskLuna from './locales/en/askLuna.json';
import enV4Spaces from './locales/en/v4Spaces.json';
import enV4Reader from './locales/en/v4Reader.json';
import enV4Space from './locales/en/v4Space.json';
import enV4Library from './locales/en/v4Library.json';
import enV4People from './locales/en/v4People.json';
import enV4Settings from './locales/en/v4Settings.json';

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
import deReview from './locales/de/review.json';
import deExam from './locales/de/exam.json';
import deSearch from './locales/de/search.json';
import deMyMaterials from './locales/de/myMaterials.json';
import deGamification from './locales/de/gamification.json';
import deOnboarding from './locales/de/onboarding.json';
import deAvatar from './locales/de/avatar.json';
import deAskLuna from './locales/de/askLuna.json';
import deV4Spaces from './locales/de/v4Spaces.json';
import deV4Reader from './locales/de/v4Reader.json';
import deV4Space from './locales/de/v4Space.json';
import deV4Library from './locales/de/v4Library.json';
import deV4People from './locales/de/v4People.json';
import deV4Settings from './locales/de/v4Settings.json';

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
    review: enReview,
    exam: enExam,
    search: enSearch,
    myMaterials: enMyMaterials,
    gamification: enGamification,
    onboarding: enOnboarding,
    avatar: enAvatar,
    askLuna: enAskLuna,
    v4Spaces: enV4Spaces,
    v4Reader: enV4Reader,
    v4Space: enV4Space,
    v4Library: enV4Library,
    v4People: enV4People,
    v4Settings: enV4Settings,
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
    review: deReview,
    exam: deExam,
    search: deSearch,
    myMaterials: deMyMaterials,
    gamification: deGamification,
    onboarding: deOnboarding,
    avatar: deAvatar,
    askLuna: deAskLuna,
    v4Spaces: deV4Spaces,
    v4Reader: deV4Reader,
    v4Space: deV4Space,
    v4Library: deV4Library,
    v4People: deV4People,
    v4Settings: deV4Settings,
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
    ns: ['common', 'nav', 'landing', 'auth', 'settings', 'dashboard', 'professor', 'upload', 'lecture', 'legal', 'review', 'exam', 'search', 'myMaterials', 'gamification', 'onboarding', 'avatar', 'askLuna', 'v4Spaces', 'v4Reader', 'v4Space', 'v4Library', 'v4People', 'v4Settings'],
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
