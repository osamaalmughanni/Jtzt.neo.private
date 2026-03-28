import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, type AppLanguage } from "@/lib/locales";
import { appStorage, LANGUAGE_KEY } from "@/lib/storage";
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

function normalizeLanguage(language: string) {
  return language.toLowerCase().startsWith("de") ? "de" : "en";
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
  const normalizedLanguage = normalizeLanguage(language);
  if (normalizedLanguage === "en" || normalizedLanguage === "de") {
    appStorage.setLanguage(normalizedLanguage);
  }
  document.documentElement.lang = normalizedLanguage;
});

document.documentElement.lang = normalizeLanguage(i18n.language);

window.addEventListener("storage", (event) => {
  if (event.storageArea !== localStorage || event.key !== LANGUAGE_KEY) {
    return;
  }

  const nextLanguage = appStorage.getLanguage();
  if (nextLanguage === "en" || nextLanguage === "de") {
    void i18n.changeLanguage(nextLanguage);
  }
});

export { i18n };
