import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, type AppLanguage } from "@/lib/locales";
import { appStorage } from "@/lib/storage";
const fallbackLanguage: AppLanguage = "en";

function detectLanguage(): AppLanguage {
  const storedLanguage = appStorage.getLanguage();
  if (storedLanguage === "en" || storedLanguage === "de") {
    return storedLanguage;
  }

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
  if (language === "en" || language === "de") {
    appStorage.setLanguage(language);
  }
  document.documentElement.lang = language;
});

document.documentElement.lang = i18n.language;

export { i18n };
