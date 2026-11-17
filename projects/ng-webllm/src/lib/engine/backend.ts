import type { ChatMessage, FinishReason, Usage } from '../types';

export type GpuSupport = 'supported' | 'no-api' | 'no-adapter';

export interface GenerationRequest {
  readonly messages: readonly ChatMessage[];
  readonly temperature: number;
  readonly maxTokens: number;
  /** A JSON schema as a string: the grammar the answer must follow. */
  readonly jsonSchema?: string;
}

export interface GenerationResult {
  readonly text: string;
  readonly finishReason: FinishReason;
  readonly usage: Usage | undefined;
}

/**
 * What actually runs the model. The library talks to WebLLM only through this,
 * so the testing entry point can swap in a fake and keep everything else real.
 */
export interface LlmBackend {
  support(): Promise<GpuSupport>;
  /** Loads a model, or swaps the loaded one for it. */
  load(modelId: string, onProgress: (progress: number, text: string) => void): Promise<void>;
  unload(): Promise<void>;
  /** Streams one answer. `onText` gets the whole text so far, not the delta. */
  generate(request: GenerationRequest, onText: (text: string) => void): Promise<GenerationResult>;
  /** Stops the generation that is running now; it ends with finishReason 'abort'. */
  interrupt(): void;
  isCached(modelId: string): Promise<boolean>;
  deleteFromCache(modelId: string): Promise<void>;
  gpuBufferBytes(): Promise<number | null>;
}
