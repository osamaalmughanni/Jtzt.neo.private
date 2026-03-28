import countries from "i18n-iso-countries";
import enCountries from "i18n-iso-countries/langs/en.json";
import deCountries from "i18n-iso-countries/langs/de.json";
import localeCodes from "locale-codes";
import { getTimeZones } from "@vvo/tzdb";
import { DEFAULT_COMPANY_LOCALE, normalizeCompanyLocale } from "@shared/utils/company-locale";

countries.registerLocale(enCountries);
countries.registerLocale(deCountries);

function resolveLanguage(locale: string) {
  const normalized = normalizeCompanyLocale(locale);
  return normalized.split("-")[0] || "en";
}

function createDisplayNameResolver(displayLocale: string) {
  const locale = normalizeCompanyLocale(displayLocale);
  try {
    return {
      language: new Intl.DisplayNames([locale], { type: "language" }),
      region: new Intl.DisplayNames([locale], { type: "region" }),
    };
  } catch {
    return null;
  }
}

export function buildCountryOptions(displayLocale: string) {
  const language = resolveLanguage(displayLocale);
  const names = countries.getNames(language, { select: "official" });
  return Object.entries(names)
    .map(([code, label]) => ({
      value: code,
      label,
      keywords: [code, label].filter(Boolean) as string[],
    }))
    .sort((left, right) => left.label.localeCompare(right.label, language))
    ;
}

export function buildCurrencyOptions(displayLocale: string) {
  const locale = normalizeCompanyLocale(displayLocale);
  const names = new Intl.DisplayNames([locale], { type: "currency" });
  const supportedCurrencies =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("currency")
      : [
          "EUR",
          "USD",
          "CHF",
          "GBP",
          "JPY",
          "CAD",
          "AUD",
          "NZD",
          "SEK",
          "NOK",
          "DKK",
          "PLN",
          "CZK",
          "HUF",
          "RON",
          "BGN",
          "BRL",
          "MXN",
          "INR",
          "CNY",
        ];
  const prioritized = ["EUR", "USD", "CHF", "GBP", "JPY", "CAD", "AUD", "NZD"];
  const ordered = [
    ...prioritized.filter((currency) => supportedCurrencies.includes(currency)),
    ...supportedCurrencies.filter((currency) => !prioritized.includes(currency)),
  ];

  return ordered.map((currency) => ({
    value: currency,
    label: `${currency} - ${names.of(currency) ?? currency}`,
    keywords: [currency, names.of(currency) ?? currency].filter(Boolean) as string[],
  }));
}

export function buildTimeZoneOptions() {
  const timeZones = getTimeZones({ includeUtc: true });
  const prioritized = new Set(["Europe/Vienna", "Europe/Berlin", "Europe/Zurich", "Europe/Paris", "Europe/Rome", "Europe/London", "Europe/Prague", "Europe/Budapest", "UTC"]);
  const sorted = [
    ...timeZones.filter((zone) => prioritized.has(zone.name)),
    ...timeZones.filter((zone) => !prioritized.has(zone.name)),
  ];

  return sorted.map((zone) => {
    const city = zone.mainCities[0] ?? zone.countryName ?? zone.name.split("/").at(-1) ?? zone.name;
    const label = `${city} (${zone.name})`;
    return {
      value: zone.name,
      label,
      keywords: [
        zone.name,
        zone.countryName,
        zone.continentName,
        zone.abbreviation,
        ...zone.mainCities,
      ].filter(Boolean) as string[],
    };
  });
}

export function buildLocaleOptions(displayLocale: string) {
  const names = createDisplayNameResolver(displayLocale);
  return localeCodes.all
    .map((value) => {
      try {
        const locale = new Intl.Locale(value.tag);
        const languageName = names?.language.of(locale.language) ?? locale.language;
        const regionName = locale.region ? names?.region.of(locale.region) ?? locale.region : null;
        const nativeLabel = value.local?.trim() || value.name;
        const label = regionName ? `${nativeLabel} (${value.tag})` : `${nativeLabel} (${value.tag})`;
        return {
          value: locale.toString(),
          label,
          keywords: [
            locale.toString(),
            value.tag,
            value.name,
            nativeLabel,
            locale.language,
            locale.region,
            languageName,
            regionName,
            value.location,
          ].filter(Boolean) as string[],
        };
      } catch {
        return null;
      }
    })
    .filter((option): option is { value: string; label: string; keywords: string[] } => Boolean(option));
}
