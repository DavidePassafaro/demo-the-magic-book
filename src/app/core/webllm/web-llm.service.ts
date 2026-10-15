import { Service, signal } from '@angular/core';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID, VISION_MODEL } from '@core/webllm/data/llm-models';
import { LlmEngine, type QueryOptions } from '@core/webllm/llm-engine';
import { isModelCached } from '@core/webllm/support/model-cache';

const MODEL_PREFERENCE_KEY = 'magic-book.model';

function readStoredModelId(): string {
  try {
    return localStorage.getItem(MODEL_PREFERENCE_KEY) ?? DEFAULT_MODEL_ID;
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

/**
 * The game's two local models, each in its own engine and worker:
 * - `chat`: the model the player picks, which judges wishes and invents villagers;
 * - `vision`: Phi-3.5 Vision, loaded only the first time the camera is used.
 */
@Service()
export class WebLlmService {
  readonly chat = new LlmEngine('engine');
  readonly vision = new LlmEngine('vision');

  /** The model the player chose; it is loaded at the next `loadModel()`. */
  readonly modelId = signal(readStoredModelId());

  selectModel(id: string): void {
    this.modelId.set(id);
    try {
      localStorage.setItem(MODEL_PREFERENCE_KEY, id);
    } catch {
      // Private browsing: the choice will not survive a reload.
    }
  }

  isCached(id: string): Promise<boolean> {
    return isModelCached(id);
  }

  loadModel(): Promise<boolean> {
    return this.chat.load(this.modelId());
  }

  queryModel(
    messages: readonly ChatCompletionMessageParam[],
    options?: QueryOptions,
  ): Promise<string> {
    return this.chat.query(messages, options);
  }

  loadVision(): Promise<boolean> {
    return this.vision.load(VISION_MODEL.id);
  }

  queryVision(
    messages: readonly ChatCompletionMessageParam[],
    options?: QueryOptions,
  ): Promise<string> {
    return this.vision.query(messages, options);
  }
}
