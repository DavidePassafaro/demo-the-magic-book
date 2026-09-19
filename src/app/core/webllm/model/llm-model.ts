import type { Locale } from '@core/i18n/model/locale';

/** The shape of a model the game can load, and the states it goes through. */
export interface ModelOption {
  readonly id: string;
  readonly label: string;
  readonly approxSizeMb: number;
  readonly note: Record<Locale, string>;
}

export type EngineStatus = 'idle' | 'checking' | 'unsupported' | 'loading' | 'ready' | 'error';

export type WebGpuSupport = 'supported' | 'no-api' | 'no-adapter';
