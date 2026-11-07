import { Service, computed, signal } from '@angular/core';
import { VisionModel, type ChatMessage, type QueryOptions } from '@core/llm/language-model';
import { VISION_MODEL } from '@core/webllm/data/llm-models';
import { LlmEngine } from '@core/webllm/llm-engine';
import { toWebLlm } from '@core/webllm/utils/to-web-llm';

/** Phi-3.5 Vision in the browser, loaded only the first time the camera is used. */
@Service()
export class WebLlmVisionModel extends VisionModel {
  // 👇👇👇 WebLLM - Vision engine
  private readonly engine = new LlmEngine('vision');

  override readonly provider = 'WebLLM';
  override readonly label = signal(VISION_MODEL.label).asReadonly();
  override readonly frame = VISION_MODEL.frame;

  override readonly status = this.engine.status.asReadonly();
  override readonly progress = this.engine.progress.asReadonly();
  override readonly progressText = this.engine.progressText.asReadonly();
  override readonly error = this.engine.error.asReadonly();
  /** Nobody chooses the vision model, so it is never replaced under the player. */
  override readonly outdated = computed(() => false);

  override readonly stats = this.engine.stats.asReadonly();
  override readonly gpuBufferBytes = this.engine.maxBufferBytes.asReadonly();

  override load(): Promise<boolean> {
    return this.engine.load(VISION_MODEL.id);
  }

  override query(messages: readonly ChatMessage[], options?: QueryOptions): Promise<string> {
    return this.engine.query(toWebLlm(messages), options);
  }
}
