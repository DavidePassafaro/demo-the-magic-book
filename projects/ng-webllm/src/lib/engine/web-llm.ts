import { computed, signal, untracked, type Signal, type WritableSignal } from '@angular/core';
import { LlmError } from '../errors';
import {
  EMPTY_STATS,
  addUsage,
  contentText,
  type AskOptions,
  type ChatMessage,
  type EngineStatus,
  type GenerationOptions,
  type ModelInfo,
  type ModelStats,
  type Phase,
  type Reply,
} from '../types';
import type { LlmBackend } from './backend';
import { Scheduler } from './scheduler';

export interface EngineConfig {
  readonly models: readonly ModelInfo[];
  readonly defaultModel: string;
  /** localStorage key where the chosen model is remembered. Absent: it is not. */
  readonly rememberSelection?: string;
  /** Defaults for every request, overridable per call. */
  readonly defaults?: Partial<Pick<AskOptions<unknown>, 'temperature' | 'maxTokens' | 'timeoutMs' | 'retry'>>;
  /** Logs every generation in the console, collapsed: prompt, answer, speed. */
  readonly debug?: boolean;
}

/** @internal What the library's own primitives pass on top of the public options. */
export interface RequestOptions<T> extends AskOptions<T> {
  readonly onPhase?: (phase: Phase) => void;
}

const DEFAULTS = { temperature: 0, maxTokens: 256, timeoutMs: 20_000, retry: 0 };

/** Statuses in which a request may wait in the queue: a model is, or will soon be, there. */
const ACCEPTING: readonly EngineStatus[] = ['checking', 'loading', 'ready'];

/**
 * One model in the browser: its lifecycle as signals, and the queue every
 * request goes through. Provided with `provideWebLlm`.
 */
export class WebLlm {
  private readonly scheduler: Scheduler;
  private readonly defaults: typeof DEFAULTS;
  private loading: Promise<boolean> | null = null;

  private readonly _status = signal<EngineStatus>('idle');
  private readonly _progress = signal(0);
  private readonly _progressText = signal('');
  private readonly _error = signal<LlmError | undefined>(undefined);
  private readonly _selected: WritableSignal<ModelInfo>;
  private readonly _loaded = signal<ModelInfo | null>(null);
  private readonly _stats = signal<ModelStats>(EMPTY_STATS);
  private readonly _gpuBufferBytes = signal<number | null>(null);

  readonly status = this._status.asReadonly();
  readonly isReady = computed(() => this._status() === 'ready');
  /** 0 to 1 while the model downloads and compiles. */
  readonly progress = this._progress.asReadonly();
  /** WebLLM's own words about what it is doing while it loads. */
  readonly progressText = this._progressText.asReadonly();
  readonly error = this._error.asReadonly();

  readonly models: readonly ModelInfo[];
  /** The model the user chose; it is loaded by the next `load()`. */
  readonly selected: Signal<ModelInfo>;
  /** The model that is actually answering. */
  readonly loaded = this._loaded.asReadonly();
  /** True when the chosen model is not the one answering. */
  readonly outdated = computed(
    () => this.isReady() && this._loaded()?.id !== this.selected().id,
  );

  /** What WebLLM measured for the loaded model, summed over every generation. */
  readonly stats = this._stats.asReadonly();
  /** The largest GPU buffer the model may bind, in bytes. */
  readonly gpuBufferBytes = this._gpuBufferBytes.asReadonly();

  /** Requests waiting, plus the one running. */
  readonly pending: Signal<number>;
  readonly isBusy = computed(() => this.pending() > 0);

  constructor(
    private readonly config: EngineConfig,
    private readonly backend: LlmBackend,
  ) {
    this.scheduler = new Scheduler(backend);
    this.pending = this.scheduler.pending.asReadonly();
    this.defaults = { ...DEFAULTS, ...config.defaults };

    this.models = config.models.some((model) => model.id === config.defaultModel)
      ? config.models
      : [{ id: config.defaultModel, label: config.defaultModel }, ...config.models];

    this._selected = signal(this.find(this.readRemembered() ?? config.defaultModel));
    this.selected = this._selected.asReadonly();
  }

  select(id: string): void {
    this._selected.set(this.find(id));

    const key = this.config.rememberSelection;
    if (key) {
      try {
        localStorage.setItem(key, id);
      } catch {
        // Private browsing: the choice will not survive a reload.
      }
    }
  }

  /**
   * Loads the chosen model (or `id`), or swaps the loaded one for it. Resolves
   * false, never throws, when it cannot. Concurrent calls run one after another.
   */
  async load(id?: string): Promise<boolean> {
    while (this.loading) {
      await this.loading;
    }

    const model = this.find(id ?? untracked(this.selected).id);
    if (this._status() === 'ready' && this._loaded()?.id === model.id) {
      return true;
    }

    const loading = this.performLoad(model);
    this.loading = loading;
    try {
      return await loading;
    } finally {
      if (this.loading === loading) {
        this.loading = null;
      }
    }
  }

  async unload(): Promise<void> {
    this.scheduler.pause();
    this.scheduler.failAll(new LlmError('not-ready', 'The model was unloaded.'));

    await this.backend.unload();
    this._loaded.set(null);
    this._status.set('idle');
  }

  isCached(id: string): Promise<boolean> {
    return this.backend.isCached(id);
  }

  deleteFromCache(id: string): Promise<void> {
    return this.backend.deleteFromCache(id);
  }

  /** One question, one answer, no state. */
  ask<T = string>(messages: readonly ChatMessage[], options: AskOptions<T> = {}): Promise<Reply<T>> {
    return this.request(messages, options);
  }

  /** @internal */
  async request<T>(messages: readonly ChatMessage[], options: RequestOptions<T>): Promise<Reply<T>> {
    if (!ACCEPTING.includes(this._status())) {
      throw new LlmError('not-ready', 'No model is loaded: call load() first.');
    }

    const schema = options.schema;
    const attempts = 1 + (options.retry ?? this.defaults.retry);
    let lastError: LlmError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = performance.now();
      const result = await this.scheduler
        .enqueue({
          priority: options.priority ?? 'normal',
          timeoutMs: options.timeoutMs ?? this.defaults.timeoutMs,
          signal: options.signal,
          onPhase: options.onPhase,
          run: ({ backend, streaming }) =>
            backend.generate(
              {
                messages,
                temperature: options.temperature ?? this.defaults.temperature,
                maxTokens: options.maxTokens ?? this.defaults.maxTokens,
                jsonSchema: schema?.toJsonSchema(),
              },
              (text) => {
                streaming();
                options.onDelta?.({ text, partial: schema?.parsePartial(text) });
              },
            ),
        })
        .catch((cause: unknown) => {
          if (isModelLost(cause)) {
            this.lose(cause);
          }
          throw cause;
        });

      const usage = result.usage;
      if (usage) {
        this._stats.update((stats) => addUsage(stats, usage));
      }
      if (this.config.debug) {
        logGeneration(options, messages, result.text, performance.now() - started);
      }

      if (result.finishReason === 'abort') {
        throw new LlmError('aborted', 'The generation was interrupted.');
      }
      if (result.finishReason === 'length') {
        lastError = new LlmError('truncated', 'The answer hit maxTokens and was cut off.');
        continue;
      }

      try {
        const value = (schema ? schema.parse(result.text) : result.text) as T;
        return { value, text: result.text, finishReason: result.finishReason, usage };
      } catch (cause) {
        lastError = cause instanceof LlmError ? cause : new LlmError('invalid-output', String(cause));
      }
    }

    throw lastError ?? new LlmError('engine', 'The model gave no answer.');
  }

  /** @internal Whether a request made now would wait for a model instead of failing. */
  acceptsRequests(): boolean {
    return ACCEPTING.includes(this._status());
  }

  private async performLoad(model: ModelInfo): Promise<boolean> {
    this.scheduler.pause();
    this._error.set(undefined);

    this._status.set('checking');
    if ((await this.backend.support()) !== 'supported') {
      const error = new LlmError('unsupported', 'This browser has no WebGPU.');
      this._error.set(error);
      this._status.set('unsupported');
      this.scheduler.failAll(error);
      return false;
    }

    this._status.set('loading');
    this._progress.set(0);
    this._progressText.set('');

    try {
      await this.backend.load(model.id, (progress, text) => {
        this._progress.set(progress);
        this._progressText.set(text);
      });
    } catch (cause) {
      const error = new LlmError('load-failed', `${model.label} could not be loaded.`, { cause });
      this._error.set(error);
      this._loaded.set(null);
      this._status.set('error');
      this.scheduler.failAll(error);
      return false;
    }

    this._loaded.set(model);
    this._stats.set(EMPTY_STATS);
    this._progress.set(1);
    this._progressText.set('');
    this._status.set('ready');
    this.scheduler.resume();

    void this.backend.gpuBufferBytes().then((bytes) => this._gpuBufferBytes.set(bytes));
    return true;
  }

  /**
   * WebLLM unloads the model after some internal errors, and every request
   * after that fails. Saying so lets the app call load() again.
   */
  private lose(cause: unknown): void {
    const error = new LlmError('load-failed', 'The model stopped working: load it again.', { cause });

    this.scheduler.pause();
    this._error.set(error);
    this._loaded.set(null);
    this._status.set('error');
    this.scheduler.failAll(error);
  }

  private find(id: string): ModelInfo {
    const model = this.models.find((candidate) => candidate.id === id);
    if (!model) {
      throw new Error(`Unknown model "${id}": add it to the models of provideWebLlm.`);
    }
    return model;
  }

  private readRemembered(): string | null {
    const key = this.config.rememberSelection;
    if (!key) {
      return null;
    }

    try {
      const id = localStorage.getItem(key);
      return id && this.models.some((model) => model.id === id) ? id : null;
    } catch {
      return null;
    }
  }
}

function logGeneration(
  options: GenerationOptions,
  messages: readonly ChatMessage[],
  answer: string,
  elapsedMs: number,
): void {
  console.groupCollapsed(`[ng-webllm] ${options.purpose ?? 'generation'} · ${Math.round(elapsedMs)} ms`);
  for (const message of messages) {
    console.log(`%c${message.role}%c\n${contentText(message.content)}`, 'font-weight:700', '');
  }
  console.log(`%canswer%c\n${answer || '(empty)'}`, 'font-weight:700', '');
  console.groupEnd();
}

/** Errors after which WebLLM no longer has a usable model. */
function isModelLost(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ModelNotLoaded|BindingError|deleted object|Device was lost|GPUDevice/i.test(message);
}
