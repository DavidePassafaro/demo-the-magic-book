import type {
  AppConfig,
  ChatCompletionMessageParam,
  CompletionUsage,
  WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import type { ChatMessage, FinishReason, Usage } from '../types';
import type { GenerationRequest, GenerationResult, GpuSupport, LlmBackend } from './backend';

export type CacheBackend = 'auto' | 'cache-storage' | 'indexeddb';

type WebLlmModule = typeof import('@mlc-ai/web-llm');

let webLlm: Promise<WebLlmModule> | null = null;

/**
 * WebLLM is several megabytes of JavaScript: it is fetched the first time it is
 * needed, so registering an engine costs the app's first page nothing.
 */
function loadWebLlm(): Promise<WebLlmModule> {
  webLlm ??= import('@mlc-ai/web-llm');
  return webLlm;
}

function indexedDbConfig(module: WebLlmModule): AppConfig {
  return { ...module.prebuiltAppConfig, cacheBackend: 'indexeddb' };
}

interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

/** WebLLM in a Web Worker: the real backend. */
export class WebLlmBackend implements LlmBackend {
  private engine: WebWorkerMLCEngine | null = null;
  /** Switches to IndexedDB when Cache Storage refuses a download. */
  private useIndexedDb: boolean;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly cache: CacheBackend = 'auto',
  ) {
    this.useIndexedDb = cache === 'indexeddb';
  }

  private async appConfig(): Promise<AppConfig> {
    const module = await loadWebLlm();
    return this.useIndexedDb ? indexedDbConfig(module) : module.prebuiltAppConfig;
  }

  async support(): Promise<GpuSupport> {
    const gpu = (globalThis.navigator as Navigator & { gpu?: GpuLike } | undefined)?.gpu;
    if (!gpu) {
      return 'no-api';
    }

    try {
      return (await gpu.requestAdapter()) ? 'supported' : 'no-adapter';
    } catch {
      return 'no-adapter';
    }
  }

  async load(modelId: string, onProgress: (progress: number, text: string) => void): Promise<void> {
    try {
      await this.startOrReload(modelId, onProgress);
    } catch (cause) {
      if (this.cache !== 'auto' || !isCacheStorageError(cause)) {
        throw cause;
      }

      // Cache Storage refuses the download when its quota is full: retry on IndexedDB.
      const { deleteModelAllInfoInCache } = await loadWebLlm();
      await deleteModelAllInfoInCache(modelId, await this.appConfig()).catch(() => undefined);
      this.useIndexedDb = true;
      await this.startOrReload(modelId, onProgress);
    }
  }

  async unload(): Promise<void> {
    await this.engine?.unload();
  }

  async generate(request: GenerationRequest, onText: (text: string) => void): Promise<GenerationResult> {
    const engine = this.engine;
    if (!engine) {
      throw new Error('No model is loaded.');
    }

    const chunks = await engine.chat.completions.create({
      messages: request.messages.map(toWebLlm),
      stream: true,
      stream_options: { include_usage: true },
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.jsonSchema
        ? { response_format: { type: 'json_object' as const, schema: request.jsonSchema } }
        : {}),
    });

    let text = '';
    let finishReason: FinishReason = 'stop';
    let usage: Usage | undefined;

    // Always read to the end: a stream left open keeps WebLLM's lock.
    for await (const chunk of chunks) {
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        onText(text);
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason === 'tool_calls' ? 'stop' : choice.finish_reason;
      }
      if (chunk.usage) {
        usage = fromWebLlmUsage(chunk.usage);
      }
    }

    return { text, finishReason, usage };
  }

  interrupt(): void {
    this.engine?.interruptGenerate();
  }

  async isCached(modelId: string): Promise<boolean> {
    try {
      const module = await loadWebLlm();
      return (
        (await module.hasModelInCache(modelId)) ||
        (await module.hasModelInCache(modelId, indexedDbConfig(module)))
      );
    } catch {
      return false;
    }
  }

  async deleteFromCache(modelId: string): Promise<void> {
    const module = await loadWebLlm();
    await module.deleteModelAllInfoInCache(modelId, module.prebuiltAppConfig).catch(() => undefined);
    await module.deleteModelAllInfoInCache(modelId, indexedDbConfig(module)).catch(() => undefined);
  }

  async gpuBufferBytes(): Promise<number | null> {
    try {
      return (await this.engine?.getMaxStorageBufferBindingSize()) ?? null;
    } catch {
      return null;
    }
  }

  private async startOrReload(
    modelId: string,
    onProgress: (progress: number, text: string) => void,
  ): Promise<void> {
    const initProgressCallback = (report: { progress: number; text: string }) =>
      onProgress(report.progress, report.text);

    const appConfig = await this.appConfig();

    if (this.engine) {
      this.engine.setInitProgressCallback(initProgressCallback);
      this.engine.setAppConfig(appConfig);
      await this.engine.reload(modelId);
      return;
    }

    const { CreateWebWorkerMLCEngine } = await loadWebLlm();
    this.engine = await CreateWebWorkerMLCEngine(this.createWorker(), modelId, {
      appConfig,
      initProgressCallback,
    });
  }
}

function toWebLlm(message: ChatMessage): ChatCompletionMessageParam {
  if (message.role !== 'user' || typeof message.content === 'string') {
    return { role: message.role, content: message.content } as ChatCompletionMessageParam;
  }

  return {
    role: 'user',
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : { type: 'image_url' as const, image_url: { url: part.image_url.url } },
    ),
  };
}

function fromWebLlmUsage(usage: CompletionUsage): Usage {
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    prefillTokensPerSecond: usage.extra.prefill_tokens_per_s,
    decodeTokensPerSecond: usage.extra.decode_tokens_per_s,
    timeToFirstTokenS: usage.extra.time_to_first_token_s,
    latencyS: usage.extra.e2e_latency_s,
  };
}

function isCacheStorageError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    message.includes("Failed to execute 'add' on 'Cache'") ||
    message.includes('QuotaExceededError') ||
    message.includes('ArtifactCache')
  );
}
