import { Service, computed, signal } from '@angular/core';
import { EN_STRINGS } from '@core/i18n/data/en';
import { IT_STRINGS } from '@core/i18n/data/it';
import type { Locale, UiStrings } from '@core/i18n/model/locale';

const STRINGS: Record<Locale, UiStrings> = { en: EN_STRINGS, it: IT_STRINGS };

const LOCALE_KEY = 'magic-book.locale';

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    return stored === 'it' || stored === 'en' ? stored : 'en';
  } catch {
    return 'en';
  }
}

/** Runtime language switching: the whole game re-reads its strings from a signal. */
@Service()
export class LocaleService {
  readonly locale = signal<Locale>(readStoredLocale());
  readonly t = computed(() => STRINGS[this.locale()]);

  /**
   * One string in every language at once, for text that has to outlive the
   * language it was written in — a generated level keeps its title after the
   * player switches, where `t()` would only ever give the language of the day.
   */
  inEveryLanguage(pick: (strings: UiStrings) => string): Record<Locale, string> {
    return { en: pick(STRINGS.en), it: pick(STRINGS.it) };
  }

  setLocale(locale: Locale): void {
    this.locale.set(locale);
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Private browsing: the choice simply will not survive a reload.
    }
    document.documentElement.lang = locale;
  }
}
