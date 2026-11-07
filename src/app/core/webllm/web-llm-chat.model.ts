import { Service, computed, signal } from '@angular/core';
import { LanguageModel, type ChatMessage, type QueryOptions } from '@core/llm/language-model';
import { DEFAULT_MODEL_ID, findModel } from '@core/webllm/data/llm-models';
import { LlmEngine } from '@core/webllm/llm-engine';
import { isModelCached } from '@core/webllm/utils/model-cache';
import { toWebLlm } from '@core/webllm/utils/to-web-llm';

const MODEL_PREFERENCE_KEY = 'magic-book.model';

function readStoredModelId(): string {
  try {
    return localStorage.getItem(MODEL_PREFERENCE_KEY) ?? DEFAULT_MODEL_ID;
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

/**
 * The model the player picked in the settings bar, running in the browser.
 * Beyond the `LanguageModel` contract it keeps that choice, which only the
 * settings bar touches: the game itself never knows which model it is.
 */
@Service()
export class WebLlmChatModel extends LanguageModel {
  // 👇👇👇 WebLLM - Chat engine
  private readonly engine = new LlmEngine('engine');
  private readonly selected = signal(readStoredModelId());

  /** The model the player chose; it is loaded at the next `load()`. */
  readonly modelId = this.selected.asReadonly();

  override readonly provider = 'WebLLM';
  override readonly label = computed(() => findModel(this.modelId()).label);

  override readonly status = this.engine.status.asReadonly();
  override readonly progress = this.engine.progress.asReadonly();
  override readonly progressText = this.engine.progressText.asReadonly();
  override readonly error = this.engine.error.asReadonly();
  override readonly outdated = computed(
    () => this.engine.status() === 'ready' && this.engine.loadedModelId() !== this.modelId(),
  );

  override readonly stats = this.engine.stats.asReadonly();
  override readonly gpuBufferBytes = this.engine.maxBufferBytes.asReadonly();

  override load(): Promise<boolean> {
    return this.engine.load(this.modelId());
  }

  override query(messages: readonly ChatMessage[], options?: QueryOptions): Promise<string> {
    return this.engine.query(toWebLlm(messages), options);
  }

  select(id: string): void {
    this.selected.set(id);
    try {
      localStorage.setItem(MODEL_PREFERENCE_KEY, id);
    } catch {
      // Private browsing: the choice will not survive a reload.
    }
  }

  isCached(id: string): Promise<boolean> {
    return isModelCached(id);
  }
}
