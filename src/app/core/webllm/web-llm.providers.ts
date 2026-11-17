import type { EnvironmentProviders } from '@angular/core';
import { provideWebLlm, webLlmToken } from 'ng-webllm';
import { DEFAULT_MODEL_ID, MODEL_OPTIONS, VISION_MODEL } from '@core/webllm/data/llm-models';

/** The second engine: Phi-3.5 Vision, loaded only the first time the camera is used. */
export const VISION = webLlmToken('vision');

/** Each engine runs in its own worker: two models, two threads. */
function createWorker(): Worker {
  return new Worker(new URL('./llm.worker', import.meta.url), { type: 'module' });
}

/**
 * The two models of the game. Nothing is downloaded here: the game loads the
 * chat model when a level starts, and the vision model when the camera opens.
 */
export function provideMagicBookModels(): EnvironmentProviders[] {
  return [
    // 👇👇👇 WebLLM - Chat engine
    provideWebLlm({
      models: MODEL_OPTIONS.map(({ id, label, approxSizeMb }) => ({
        id,
        label,
        sizeMb: approxSizeMb,
      })),
      defaultModel: DEFAULT_MODEL_ID,
      worker: createWorker,
      rememberSelection: 'magic-book.model',
      defaults: { maxTokens: 200 },
      debug: true,
    }),

    // 👇👇👇 WebLLM - Vision engine
    provideWebLlm(
      {
        models: [
          {
            id: VISION_MODEL.id,
            label: VISION_MODEL.label,
            sizeMb: VISION_MODEL.approxSizeMb,
            vision: true,
          },
        ],
        defaultModel: VISION_MODEL.id,
        worker: createWorker,
        debug: true,
      },
      VISION,
    ),
  ];
}
