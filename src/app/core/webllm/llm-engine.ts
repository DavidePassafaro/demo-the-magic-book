import { signal } from '@angular/core';
import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  prebuiltAppConfig,
  type AppConfig,
  type ChatCompletionMessageParam,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { modelLabel } from '@core/webllm/data/llm-models';
import type { EngineStatus } from '@core/webllm/model/llm-model';
import { detectWebGpu } from '@core/webllm/support/webgpu';
import {
  INDEXEDDB_CONFIG,
  isCacheStorageError,
  isModelCached,
} from '@core/webllm/support/model-cache';
import { logCompletion } from '@core/webllm/support/completion-log';
import { elapsed, log, type LogSource } from '@core/logger/logger';

const GENERATION_TIMEOUT_MS = 20_000;

export interface QueryOptions {
  /** JSON schema the answer is forced into, token by token. */
  readonly schema?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** What the call is for, shown in the console. */
  readonly purpose?: string;
}

/**
 * One WebLLM engine running in its own Web Worker, with its state as signals.
 * The worker keeps inference off the main thread, so the game never freezes.
 */
export class LlmEngine {
  readonly status = signal<EngineStatus>('idle');
  readonly progress = signal(0);
  readonly progressText = signal('');
  readonly error = signal<string | null>(null);
  readonly loadedModelId = signal<string | null>(null);

  private engine: WebWorkerMLCEngine | null = null;
  private loading: Promise<boolean> | null = null;
  private appConfig: AppConfig = prebuiltAppConfig;

  constructor(private readonly source: LogSource) {}

  /** Loads a model, or swaps the current one for it. Concurrent calls are serialized. */
  async load(modelId: string): Promise<boolean> {
    while (this.loading) {
      await this.loading;
    }
    if (this.engine && this.loadedModelId() === modelId) {
      this.status.set('ready');
      return true;
    }

    const loading = this.performLoad(modelId);
    this.loading = loading;
    try {
      return await loading;
    } finally {
      if (this.loading === loading) {
        this.loading = null;
      }
    }
  }

  /** One question, one answer: no chat history is kept between calls. */
  async query(
    messages: readonly ChatCompletionMessageParam[],
    options: QueryOptions = {},
  ): Promise<string> {
    const engine = this.engine;
    if (!engine || this.status() !== 'ready') {
      throw new Error('The book is not open yet.');
    }

    const purpose = options.purpose ?? 'a question';
    const started = performance.now();

    // 👇👇👇 WebLLM - Query
    const request = engine.chat.completions.create({
      messages: [...messages],
      stream: false,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 200,
      // 👇👇👇 WebLLM - Structured output
      ...(options.schema
        ? { response_format: { type: 'json_object' as const, schema: options.schema } }
        : {}),
    });

    // The engine lives in a worker, so this thread is free to stop it when it takes too long.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // 👇👇👇 WebLLM - Interrupt
        engine.interruptGenerate();
        reject(new Error('The book took too long to answer.'));
      }, GENERATION_TIMEOUT_MS);
    });

    try {
      const reply = await Promise.race([request, timeout]);
      logCompletion(this.source, purpose, started, messages, reply);
      return reply.choices[0]?.message?.content ?? '';
    } catch (cause) {
      // Errors from the worker arrive as plain strings.
      const error = cause instanceof Error ? cause : new Error(String(cause));
      log.error(this.source, `${purpose} failed after ${elapsed(started)}`, error.message);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async performLoad(modelId: string): Promise<boolean> {
    this.status.set('checking');
    if ((await detectWebGpu()) !== 'supported') {
      this.status.set('unsupported');
      return false;
    }

    this.status.set('loading');
    this.progress.set(0);
    this.progressText.set('');
    this.error.set(null);

    const label = modelLabel(modelId);
    const started = performance.now();
    const cached = await isModelCached(modelId);
    log.info(
      this.source,
      `loading ${label} ${cached ? 'from the browser cache' : '· downloading'}`,
    );

    try {
      await this.loadWithCacheFallback(modelId);
      log.info(this.source, `${label} ready in ${elapsed(started)}`);
      this.loadedModelId.set(modelId);
      this.progress.set(1);
      this.progressText.set('');
      this.status.set('ready');
      return true;
    } catch (cause) {
      log.error(this.source, `${label} failed to load`, cause);
      this.loadedModelId.set(null);
      this.error.set(cause instanceof Error ? cause.message : String(cause));
      this.status.set('error');
      return false;
    }
  }

  /** When Cache Storage refuses the download (usually a full quota), retry on IndexedDB. */
  private async loadWithCacheFallback(modelId: string): Promise<void> {
    try {
      await this.startOrReload(modelId);
    } catch (cause) {
      if (!isCacheStorageError(cause)) {
        throw cause;
      }
      log.warn(this.source, 'Cache Storage failed: retrying with IndexedDB', cause);

      const previous = this.loadedModelId();
      await deleteModelAllInfoInCache(modelId, this.appConfig).catch(() => undefined);
      if (previous && previous !== modelId) {
        await deleteModelAllInfoInCache(previous, this.appConfig).catch(() => undefined);
      }

      this.appConfig = INDEXEDDB_CONFIG;
      this.progress.set(0);
      await this.startOrReload(modelId);
    }
  }

  private async startOrReload(modelId: string): Promise<void> {
    if (this.engine) {
      this.engine.setAppConfig(this.appConfig);
      // 👇👇👇 WebLLM - Swap model
      await this.engine.reload(modelId);
      return;
    }

    const worker = new Worker(new URL('./llm.worker', import.meta.url), { type: 'module' });

    // 👇👇👇 WebLLM - Load model
    this.engine = await CreateWebWorkerMLCEngine(worker, modelId, {
      appConfig: this.appConfig,
      initProgressCallback: (report) => {
        this.progress.set(report.progress);
        this.progressText.set(report.text);
      },
    });
  }
}
