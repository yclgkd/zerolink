import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { de, en, es, fr, ja, ru, zh } from '../../locales';

/**
 * Initialise i18next synchronously with English as the fixed language for tests.
 * Import this module at the top of any test file that renders components
 * using the `t()` hook, to prevent keys from being returned instead of strings.
 */
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    initImmediate: false,
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      ja: { translation: ja },
      de: { translation: de },
      fr: { translation: fr },
      es: { translation: es },
      ru: { translation: ru },
    },
  });
}
