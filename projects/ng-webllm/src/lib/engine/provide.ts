import {
  DestroyRef,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import { WebLlm, type EngineConfig } from './web-llm';
import { WebLlmBackend, type CacheBackend } from './web-llm-backend';

export interface WebLlmConfig extends EngineConfig {
  /**
   * Creates the worker. It has to live in the app's code, so the bundler sees it:
   * `() => new Worker(new URL('./llm.worker', import.meta.url), { type: 'module' })`.
   */
  readonly worker: () => Worker;
  /** 'auto' tries Cache Storage and falls back on IndexedDB when its quota is full. */
  readonly cache?: CacheBackend;
}

/** The token of a second engine (say, a vision model) next to the default one. */
export type WebLlmToken = InjectionToken<WebLlm>;

/** `inject(token)` then returns that engine, typed as WebLlm. */
export function webLlmToken(description: string): WebLlmToken {
  return new InjectionToken<WebLlm>(`WebLlm ${description}`);
}

/**
 * Registers an engine. It downloads nothing: the app calls `load()` when it
 * decides to. Without a token it is the default engine, `inject(WebLlm)`.
 */
export function provideWebLlm(config: WebLlmConfig, token?: WebLlmToken): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: token ?? WebLlm,
      useFactory: () => {
        const backend = new WebLlmBackend(config.worker, config.cache);
        inject(DestroyRef).onDestroy(() => void backend.unload());

        return new WebLlm(config, backend);
      },
    },
  ]);
}
