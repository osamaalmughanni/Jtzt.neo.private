import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, type AppLanguage } from "@/lib/locales";

const LANGUAGE_STORAGE_KEY = "jtzt.language";
const fallbackLanguage: AppLanguage = "en";

function detectLanguage(): AppLanguage {
  const browserLanguage = window.navigator.language.toLowerCase();
  if (browserLanguage.startsWith("de")) {
    return "de";
  }

  return fallbackLanguage;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: fallbackLanguage,
  interpolation: {
    escapeValue: false
  }
});

void i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
document.documentElement.lang = i18n.language;

export { i18n };
