import { Service, signal } from '@angular/core';
import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  type ChatCompletionMessageParam,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID } from '@core/webllm/data/llm-models';
import type { EngineStatus, WebGpuSupport } from '@core/webllm/model/llm-model';

const MODEL_PREFERENCE_KEY = 'magic-book.model';
const GENERATION_TIMEOUT_MS = 20_000;

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

/**
 * WebLLM needs WebGPU. Detecting it up front lets the game say so politely
 * instead of throwing a wall of WebAssembly errors at the player.
 */
async function detectWebGpu(): Promise<WebGpuSupport> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;

  if (!gpu) {
    return 'no-api';
  }

  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? 'supported' : 'no-adapter';
  } catch {
    return 'no-adapter';
  }
}

function readStoredModelId(): string {
  try {
    return localStorage.getItem(MODEL_PREFERENCE_KEY) ?? DEFAULT_MODEL_ID;
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

/**
 * Owns the WebLLM engine: which model is chosen, how far its download has got,
 * and the single call through which anything is ever asked of it.
 */
@Service()
export class WebLlmService {
  readonly support = signal<WebGpuSupport | null>(null);

  readonly modelId = signal(readStoredModelId());
  readonly loadedModelId = signal<string | null>(null);

  readonly status = signal<EngineStatus>('idle');
  readonly progress = signal(0);
  readonly progressText = signal('');
  readonly error = signal<string | null>(null);

  private engine: WebWorkerMLCEngine | null = null;

  /**
   * Remembers which model the player wants; nothing is downloaded here. The
   * choice becomes real at the next `loadModel()` and survives a reload.
   *
   * @param id One of the ids in `MODEL_OPTIONS`.
   */
  selectModel(id: string): void {
    this.modelId.set(id);
    try {
      localStorage.setItem(MODEL_PREFERENCE_KEY, id);
    } catch {
      // Private browsing: the choice simply will not survive a reload.
    }
  }

  /**
   * Whether the browser already holds this model's weights.
   *
   * @param id The model to ask about.
   * @returns False when the question itself fails: an unknown cache is an empty one.
   */
  isCached(id: string): Promise<boolean> {
    return hasModelInCache(id).catch(() => false);
  }

  /**
   * Loads the selected model if it is not already in memory, reloading the
   * engine when a different one is. What happens on the way is published as
   * signals — `status`, `progress`, `progressText`, `error` — not returned.
   *
   * @returns True when the model can answer; false when WebGPU is missing or
   * the download failed, which `status` then tells apart.
   */
  async loadModel(): Promise<boolean> {
    const wanted = this.modelId();

    if (this.engine && this.loadedModelId() === wanted) {
      this.status.set('ready');
      return true;
    }

    this.status.set('checking');
    const support = await detectWebGpu();
    this.support.set(support);

    if (support !== 'supported') {
      this.status.set('unsupported');
      return false;
    }

    this.status.set('loading');
    this.progress.set(0);
    this.progressText.set('');
    this.error.set(null);

    try {
      if (this.engine) {
        await this.engine.reload(wanted);
      } else {
        const worker = new Worker(new URL('./llm.worker', import.meta.url), {
          type: 'module',
        });
        this.engine = await CreateWebWorkerMLCEngine(worker, wanted, {
          initProgressCallback: (report) => {
            this.progress.set(report.progress);
            this.progressText.set(report.text);
          },
        });
      }

      this.loadedModelId.set(wanted);
      this.progress.set(1);
      this.progressText.set('');
      this.status.set('ready');
      return true;
    } catch (cause) {
      this.loadedModelId.set(null);
      this.error.set(cause instanceof Error ? cause.message : String(cause));
      this.status.set('error');
      return false;
    }
  }

  /**
   * One constrained question, and the only way anything is ever asked of the
   * model. The reply is forced into the given JSON schema.
   *
   * @param messages A system prompt and one question: nothing here keeps a history.
   * @param options.schema JSON schema the answer is decoded against, token by token.
   * @param options.maxTokens Ceiling on the answer, 200 by default.
   * @param options.temperature Zero unless variety is wanted.
   * @returns What the model wrote, JSON by construction but still worth parsing
   * defensively.
   * @throws When no model is loaded, or the answer takes more than twenty
   * seconds — at which point the generation is interrupted rather than awaited.
   */
  async queryModel(
    messages: readonly ChatCompletionMessageParam[],
    options: { schema?: string; maxTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const engine = this.engine;

    if (!engine || this.status() !== 'ready') {
      throw new Error('The book is not open yet.');
    }

    const request = engine.chat.completions.create({
      messages: [...messages],
      stream: false,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 200,
      ...(options.schema
        ? { response_format: { type: 'json_object' as const, schema: options.schema } }
        : {}),
    });

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        engine.interruptGenerate();
        reject(new Error('The book took too long to answer.'));
      }, GENERATION_TIMEOUT_MS);
    });

    try {
      const reply = await Promise.race([request, timeout]);
      return reply.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
