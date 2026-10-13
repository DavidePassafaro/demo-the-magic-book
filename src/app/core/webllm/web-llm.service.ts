import { Service, signal } from '@angular/core';
import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
  prebuiltAppConfig,
  type AppConfig,
  type ChatCompletionMessageParam,
  type InitProgressReport,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import { DEFAULT_MODEL_ID, VISION_MODEL, findModel } from '@core/webllm/data/llm-models';
import type { EngineStatus, WebGpuSupport } from '@core/webllm/model/llm-model';
import { elapsed, log, type LogSource } from '@core/logger/logger';

const MODEL_PREFERENCE_KEY = 'magic-book.model';
const GENERATION_TIMEOUT_MS = 20_000;

interface AdapterLike {
  readonly info?: { vendor?: string; architecture?: string; description?: string };
  readonly features?: { has(name: string): boolean };
  readonly limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
}

interface GpuLike {
  requestAdapter(): Promise<AdapterLike | null>;
}

/**
 * WebLLM needs WebGPU. Detecting it up front lets the game say so politely
 * instead of throwing a wall of WebAssembly errors at the player. What the GPU
 * turns out to be is logged once: when a model refuses to load, the first
 * question is always which card, and how big a buffer it allows.
 */
/** The card does not change during a session: describe it once. */
let gpuDescribed = false;

async function detectWebGpu(): Promise<WebGpuSupport> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;

  if (!gpu) {
    log.warn('engine', 'WebGPU is not available in this browser');
    return 'no-api';
  }

  try {
    const adapter = await gpu.requestAdapter();

    if (!adapter) {
      log.warn('engine', 'WebGPU is present but offered no adapter');
      return 'no-adapter';
    }

    if (!gpuDescribed) {
      gpuDescribed = true;
      log.group('engine', `WebGPU ready · ${adapter.info?.vendor || 'unknown vendor'}`, () => {
        const mb = (bytes?: number) => (bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : 'n/a');
        console.table({
          vendor: adapter.info?.vendor || 'n/a',
          architecture: adapter.info?.architecture || 'n/a',
          description: adapter.info?.description || 'n/a',
          'shader-f16': adapter.features?.has('shader-f16') ?? 'n/a',
          maxBufferSize: mb(adapter.limits?.maxBufferSize),
          maxStorageBufferBindingSize: mb(adapter.limits?.maxStorageBufferBindingSize),
        });
      });
    }
    return 'supported';
  } catch (cause) {
    log.error('engine', 'WebGPU adapter request failed', cause);
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

/** How any question is asked, of either engine. */
export interface QueryOptions {
  readonly schema?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** What the call is for, in a few words — only for the console. */
  readonly purpose?: string;
}

/** Which engine a request went to, for the console. */
interface Asked {
  readonly source: LogSource;
  readonly model: string;
}

/**
 * The messages as the console should show them: text in full, images reduced
 * to a line — a base64 photo is thousands of characters nobody wants to scroll.
 */
function readable(messages: readonly ChatCompletionMessageParam[]): Record<string, string>[] {
  return messages.map((message) => {
    const content = message.content;

    if (typeof content === 'string' || content == null) {
      return { role: message.role, content: content ?? '' };
    }

    const parts = (
      content as readonly { type: string; text?: string; image_url?: { url: string } }[]
    ).map((part) =>
      part.type === 'image_url'
        ? `[image, ${Math.round(((part.image_url?.url.length ?? 0) * 0.75) / 1024)} KB]`
        : (part.text ?? ''),
    );
    return { role: message.role, content: parts.join('\n\n') };
  });
}

/**
 * A fresh worker with an engine of its own inside, reporting its download as it
 * goes. Each engine gets its own thread, so the two models never queue behind
 * each other and neither ever blocks the page.
 */
function startEngine(
  modelId: string,
  onProgress: (report: InitProgressReport) => void,
  appConfig?: AppConfig,
): Promise<WebWorkerMLCEngine> {
  const worker = new Worker(new URL('./llm.worker', import.meta.url), { type: 'module' });
  return CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback: onProgress,
    ...(appConfig ? { appConfig } : {}),
  });
}

function isCacheAddError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    message.includes("Failed to execute 'add' on 'Cache'") ||
    message.includes('QuotaExceededError') ||
    message.includes('ArtifactCache')
  );
}

/**
 * One constrained request, raced against the clock. Past the limit the
 * generation is interrupted rather than awaited — which only works because the
 * engine lives in a worker, leaving this thread free to fire the timer.
 */
async function ask(
  engine: WebWorkerMLCEngine,
  messages: readonly ChatCompletionMessageParam[],
  options: QueryOptions,
  asked: Asked,
): Promise<string> {
  const started = performance.now();
  const temperature = options.temperature ?? 0;
  const maxTokens = options.maxTokens ?? 200;
  const what = options.purpose ?? 'a question';

  const request = engine.chat.completions.create({
    messages: [...messages],
    stream: false,
    temperature,
    max_tokens: maxTokens,
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
    const answer = reply.choices[0]?.message?.content ?? '';
    const finish = reply.choices[0]?.finish_reason;
    const usage = reply.usage;
    const speed = usage?.extra ? ` · ${Math.round(usage.extra.decode_tokens_per_s)} tok/s` : '';
    const tokens = usage ? ` · ${usage.prompt_tokens}→${usage.completion_tokens} tok` : '';

    log.group(
      asked.source,
      `${what} · ${asked.model} · ${elapsed(started)}${tokens}${speed}`,
      () => {
        console.log('request', {
          temperature,
          max_tokens: maxTokens,
          schema: options.schema ? JSON.parse(options.schema) : 'none',
        });
        console.log('messages');
        for (const message of readable(messages)) {
          console.log(
            `%c${message['role']}%c\n${message['content']}`,
            'font-weight:700',
            'color:inherit',
          );
        }
        console.log('%canswer%c\n' + (answer || '(empty)'), 'font-weight:700', 'color:inherit');
        if (usage) {
          console.table({
            'prompt tokens': usage.prompt_tokens,
            'answer tokens': usage.completion_tokens,
            'time to first token': `${usage.extra.time_to_first_token_s.toFixed(2)} s`,
            'prefill speed': `${Math.round(usage.extra.prefill_tokens_per_s)} tok/s`,
            'decode speed': `${Math.round(usage.extra.decode_tokens_per_s)} tok/s`,
            'end to end': `${usage.extra.e2e_latency_s.toFixed(2)} s`,
            'finish reason': finish ?? 'n/a',
          });
        }
      },
    );

    if (finish === 'length') {
      log.warn(asked.source, `${what}: the answer hit max_tokens (${maxTokens}) and was cut off`);
    }

    return answer;
  } catch (cause) {
    const error = asError(cause);
    log.error(
      asked.source,
      `${what} failed after ${elapsed(started)} · ${asked.model}`,
      error.message,
      {
        messages: readable(messages),
      },
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Narrates one model load: where it comes from, a line at each quarter of the
 * way, how long it took. A cached model skips straight to the end, and the
 * difference between the two timings is the whole argument for pre-warming the
 * cache before a talk.
 */
function narrateLoad(source: LogSource, modelId: string, label: string, sizeMb: number) {
  const started = performance.now();
  let quarter = 0;

  void hasModelInCache(modelId)
    .catch(() => false)
    .then((cached) =>
      log.info(
        source,
        `loading ${label} · ${sizeMb} MB · ${cached ? 'from the browser cache' : 'downloading'}`,
        modelId,
      ),
    );

  return {
    progress(report: InitProgressReport): void {
      const reached = Math.floor(report.progress * 4);
      if (reached > quarter && reached < 4) {
        quarter = reached;
        log.info(source, `${label} ${reached * 25}% · ${elapsed(started)}`, report.text);
      }
    },
    done(): void {
      log.info(source, `${label} ready in ${elapsed(started)}`);
    },
    failed(cause: unknown): void {
      log.error(source, `${label} failed to load after ${elapsed(started)}`, cause);
    },
  };
}

/**
 * A failure inside the worker comes back as its text, not as an Error: the
 * proxy posts `err.toString()` across the thread and rejects with that string.
 * Every caller checks `instanceof Error`, so without this the real reason is
 * silently swapped for a generic line — the player reads "the ink ran dry" and
 * the actual cause never reaches the screen.
 */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Owns the WebLLM engines: which model is chosen, how far each download has
 * got, and the only calls through which anything is ever asked of a model.
 * There are two engines — the one the player picks, which judges and invents,
 * and the vision model, which wakes only when the camera is first used.
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
  private activeLoad: Promise<boolean> | null = null;
  private appConfig: AppConfig = { ...prebuiltAppConfig };
  /** Where the current load's progress is narrated; replaced on every load. */
  private onReloadProgress: (report: InitProgressReport) => void = () => undefined;

  /** The vision engine, on its own track: nothing here is touched by `modelId`. */
  readonly visionStatus = signal<EngineStatus>('idle');
  readonly visionProgress = signal(0);
  readonly visionError = signal<string | null>(null);

  private visionEngine: WebWorkerMLCEngine | null = null;
  /** A second click while the eye is still opening waits for the same load. */
  private visionLoading: Promise<boolean> | null = null;

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
  async isCached(id: string): Promise<boolean> {
    try {
      if (await hasModelInCache(id, this.appConfig)) {
        return true;
      }
      if (this.appConfig.cacheBackend !== 'indexeddb') {
        return await hasModelInCache(id, { ...prebuiltAppConfig, cacheBackend: 'indexeddb' });
      }
      return false;
    } catch {
      return false;
    }
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
    if (this.activeLoad) {
      await this.activeLoad;
    }
    const wanted = this.modelId();
    if (this.engine && this.loadedModelId() === wanted) {
      this.status.set('ready');
      return true;
    }

    const loadPromise = this.performLoadModel(wanted);
    this.activeLoad = loadPromise;
    try {
      const ok = await loadPromise;
      // If the user picked yet another model while this one was loading, switch to it now.
      if (ok && this.modelId() !== wanted) {
        this.activeLoad = null;
        return await this.loadModel();
      }
      return ok;
    } finally {
      if (this.activeLoad === loadPromise) {
        this.activeLoad = null;
      }
    }
  }

  private async performLoadModel(wanted: string): Promise<boolean> {
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

    const option = findModel(wanted);
    const narration = narrateLoad('engine', wanted, option.label, option.approxSizeMb);
    const previous = this.loadedModelId();
    if (previous) {
      log.info('engine', `swapping ${findModel(previous).label} out for ${option.label}`);
    }

    // The first engine keeps the callback it was born with and reports every
    // later reload through it, so the narration is swapped in here, per load.
    this.onReloadProgress = narration.progress;

    const loadIntoEngine = async (config: AppConfig): Promise<void> => {
      if (this.engine) {
        this.engine.setAppConfig(config);
        await this.engine.reload(wanted);
      } else {
        this.engine = await startEngine(
          wanted,
          (report) => {
            this.progress.set(report.progress);
            this.progressText.set(report.text);
            this.onReloadProgress(report);
          },
          config,
        );
      }
    };

    try {
      try {
        await loadIntoEngine(this.appConfig);
      } catch (firstCause) {
        if (!isCacheAddError(firstCause)) {
          throw firstCause;
        }

        // Browser Cache Storage threw "Failed to execute 'add' on 'Cache': Request failed"
        // (typically storage quota exhaustion when multiple models accumulate, or a corrupted partial entry).
        log.warn(
          'engine',
          'Cache Storage failed during model download; clearing partial/previous cache and retrying with IndexedDB fallback',
          firstCause,
        );

        await deleteModelAllInfoInCache(wanted, this.appConfig).catch(() => undefined);
        if (previous && previous !== wanted) {
          await deleteModelAllInfoInCache(previous, this.appConfig).catch(() => undefined);
        }

        this.appConfig = { ...prebuiltAppConfig, cacheBackend: 'indexeddb' };
        this.progress.set(0);
        await loadIntoEngine(this.appConfig);
      }

      narration.done();
      this.loadedModelId.set(wanted);
      this.progress.set(1);
      this.progressText.set('');
      this.status.set('ready');
      return true;
    } catch (cause) {
      narration.failed(cause);
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
    options: QueryOptions = {},
  ): Promise<string> {
    if (!this.engine || this.status() !== 'ready') {
      throw new Error('The book is not open yet.');
    }

    const model = findModel(this.loadedModelId() ?? this.modelId()).label;
    return ask(this.engine, messages, options, { source: 'engine', model });
  }

  /**
   * Wakes the vision model, once. It is some four gigabytes and most players
   * never use the camera, so it is never loaded up front — only on the first
   * request, and in an engine of its own so the judging model stays put.
   *
   * @returns True when the vision model can answer; false when it could not be
   * loaded, with the reason in `visionError`.
   */
  loadVision(): Promise<boolean> {
    if (this.visionEngine) {
      return Promise.resolve(true);
    }

    this.visionLoading ??= this.startVision();
    return this.visionLoading;
  }

  /**
   * One question with a picture in it, asked of the vision model. The same
   * constraints and the same twenty-second limit as `queryModel`.
   *
   * @param messages A single user turn holding the image and one text part:
   * WebLLM allows no more than one text part per message.
   * @throws When the vision model is not loaded, or the answer takes too long.
   */
  async queryVision(
    messages: readonly ChatCompletionMessageParam[],
    options: QueryOptions = {},
  ): Promise<string> {
    if (!this.visionEngine) {
      throw new Error('The book has not opened its eye yet.');
    }

    return ask(this.visionEngine, messages, options, {
      source: 'vision',
      model: VISION_MODEL.label,
    });
  }

  private async startVision(): Promise<boolean> {
    this.visionStatus.set('loading');
    this.visionProgress.set(0);
    this.visionError.set(null);

    const narration = narrateLoad(
      'vision',
      VISION_MODEL.id,
      VISION_MODEL.label,
      VISION_MODEL.approxSizeMb,
    );
    log.info('vision', 'a second engine, in its own worker, beside the judging model');

    try {
      this.visionEngine = await startEngine(VISION_MODEL.id, (report) => {
        this.visionProgress.set(report.progress);
        narration.progress(report);
      });
      narration.done();
      this.visionProgress.set(1);
      this.visionStatus.set('ready');
      return true;
    } catch (cause) {
      narration.failed(cause);
      this.visionError.set(cause instanceof Error ? cause.message : String(cause));
      this.visionStatus.set('error');
      // Let the next attempt try again from the start.
      this.visionLoading = null;
      return false;
    }
  }
}
