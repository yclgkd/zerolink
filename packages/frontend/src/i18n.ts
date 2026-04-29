import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { de, en, es, fr, ja, zh } from './locales';

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh', 'ja', 'de', 'fr', 'es'],
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'zerolink-lang',
      caches: ['localStorage'],
    },
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      ja: { translation: ja },
      de: { translation: de },
      fr: { translation: fr },
      es: { translation: es },
    },
  });

export default i18next;
