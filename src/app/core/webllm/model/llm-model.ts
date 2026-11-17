import type { Locale } from '@core/i18n/model/locale';

/** The shape of a model WebLLM can load. */
export interface ModelOption {
  readonly id: string;
  readonly label: string;
  readonly approxSizeMb: number;
  readonly note: Record<Locale, string>;
}
