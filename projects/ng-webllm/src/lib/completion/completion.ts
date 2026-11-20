import {
  DestroyRef,
  Injector,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type EffectRef,
  type Resource,
  type ResourceSnapshot,
  type ResourceStatus,
  type Signal,
} from '@angular/core';
import { isAborted, toLlmError, type LlmError } from '../errors';
import { WebLlm } from '../engine/web-llm';
import type { AskOptions, ChatMessage, Draft, FinishReason, Phase, Usage } from '../types';

// 👇👇👇 ng-webllm - Params and messages, like a loader
export interface CompletionOptions<P, T> extends AskOptions<T> {
  /** The question depends on these. `undefined`: no question, status 'idle'. */
  readonly params: () => P | undefined;
  /** Builds the messages; not tracked, like a resource loader. */
  readonly messages: (params: P) => readonly ChatMessage[];
  /** Waits this long after params change before asking. Default 0. */
  readonly debounce?: number;
  /** Keeps the previous answer while the next one is generated. Default true. */
  readonly keepPrevious?: boolean;
  /** Default: inject(WebLlm). */
  readonly engine?: WebLlm;
  /** Needed only outside an injection context. */
  readonly injector?: Injector;
}

// 👇👇👇 ng-webllm - The same face as a resource
export interface CompletionRef<T> extends Resource<T | undefined> {
  /** Where the current request is: `queued`, `prefill`, `streaming`, or `idle`. */
  readonly phase: Signal<Phase>;
  /** The answer while the model writes it; `null` when nothing is being written. */
  readonly draft: Signal<Draft<T> | null>;
  /** Why the last answer ended: `stop`, `length` (out of tokens) or `abort`. */
  readonly finishReason: Signal<FinishReason | undefined>;
  /** What WebLLM measured for the last answer: tokens, speed, latency. */
  readonly usage: Signal<Usage | undefined>;

  /**
   * Asks the same question again, with the current params, even if they did not
   * change. A generation still running is interrupted first. While it runs,
   * `status()` is `'reloading'` and `value()` keeps the previous answer.
   *
   * @returns `false` when there is nothing to ask: the params are `undefined`
   * or the model is not loaded yet. `true` otherwise.
   */
  reload(): boolean;

  /**
   * Interrupts the current generation, or drops it from the queue if it has not
   * started. The last complete answer stays in `value()`, and `status()` goes
   * back to `'resolved'` (or `'idle'` if there was none). It is not an error.
   *
   * The completion keeps following its params: the next change asks again.
   */
  stop(): void;

  /**
   * Stops following the params and interrupts the current generation, for good.
   * Called automatically when the injector that created the completion is destroyed.
   */
  destroy(): void;
}

/**
 * A question that follows signals, like `resource()`: when the params change,
 * the previous generation is dropped from the queue or interrupted.
 *
 * @example
 * ```ts
 * readonly text = signal('');
 * readonly summary = completion({
 *   params: () => this.text() || undefined,
 *   messages: (text) => [{ role: 'user', content: `Summarize: ${text}` }],
 *   debounce: 500,
 * });
 * ```
 *
 * Must be called in an injection context, or with `options.injector`.
 */
// 👇👇👇 ng-webllm - A new kind of resource
export function completion<P, T = string>(options: CompletionOptions<P, T>): CompletionRef<T> {
  if (!options.injector) {
    assertInInjectionContext(completion);
  }

  return new CompletionImpl(options, options.injector ?? inject(Injector));
}

class CompletionImpl<P, T> implements CompletionRef<T> {
  private readonly engine: WebLlm;
  private readonly effectRef: EffectRef;
  private current: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly _value = signal<T | undefined>(undefined);
  private readonly _status = signal<ResourceStatus>('idle');
  private readonly _error = signal<LlmError | undefined>(undefined);
  private readonly _phase = signal<Phase>('idle');
  private readonly _draft = signal<Draft<T> | null>(null);
  private readonly _finishReason = signal<FinishReason | undefined>(undefined);
  private readonly _usage = signal<Usage | undefined>(undefined);

  readonly value = this._value.asReadonly();
  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly phase = this._phase.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly finishReason = this._finishReason.asReadonly();
  readonly usage = this._usage.asReadonly();

  readonly isLoading = computed(() => ['loading', 'reloading'].includes(this._status()));
  readonly snapshot = computed(() => {
    const status = this._status();
    const error = this._error();
    return (
      status === 'error' && error ? { status, error } : { status, value: this._value() }
    ) as ResourceSnapshot<T | undefined>;
  });

  private readonly request = computed(() => {
    const params = this.options.params();
    return params === undefined ? undefined : { params };
  });

  constructor(
    private readonly options: CompletionOptions<P, T>,
    injector: Injector,
  ) {
    this.engine = options.engine ?? injector.get(WebLlm);

    // 👇👇👇 ng-webllm - Params tracked, work untracked
    this.effectRef = effect(
      () => {
        const request = this.request();
        const ready = this.engine.isReady();
        // A new model answers differently: ask again.
        this.engine.loaded();

        untracked(() => this.follow(request?.params, ready));
      },
      { injector },
    );

    injector.get(DestroyRef).onDestroy(() => this.destroy());
  }

  hasValue(this: T extends undefined ? this : never): this is Resource<Exclude<T, undefined>>;
  hasValue(): boolean;
  hasValue(): boolean {
    return this._status() !== 'error' && this._value() !== undefined;
  }

  reload(): boolean {
    const request = untracked(this.request);
    if (!request || !this.engine.isReady()) {
      return false;
    }

    this.start(request.params, 'reloading');
    return true;
  }

  stop(): void {
    this.cancel();
    this._phase.set('idle');
    this._draft.set(null);
    this._status.set(this._value() === undefined ? 'idle' : 'resolved');
  }

  destroy(): void {
    this.effectRef.destroy();
    this.cancel();
  }

  private follow(params: P | undefined, ready: boolean): void {
    if (params === undefined) {
      this.cancel();
      this._value.set(undefined);
      this._error.set(undefined);
      this._draft.set(null);
      this._phase.set('idle');
      this._status.set('idle');
      return;
    }

    if (!ready) {
      // The model is not there yet, or is being swapped: wait for it.
      this.cancel();
      if (this.options.keepPrevious === false) {
        this._value.set(undefined);
      }
      this._draft.set(null);
      this._phase.set('idle');
      this._status.set('idle');
      return;
    }

    this.start(params, 'loading');
  }

  private start(params: P, status: 'loading' | 'reloading'): void {
    this.cancel();

    const controller = new AbortController();
    this.current = controller;
    // 👇👇👇 ng-webllm - Late answers are ignored
    const isCurrent = () => this.current === controller;

    this._status.set(status);
    this._error.set(undefined);
    this._draft.set(null);
    if (this.options.keepPrevious === false) {
      this._value.set(undefined);
    }

    const ask = () => {
      const messages = this.options.messages(params);

      this.engine
        .request(messages, {
          ...this.options,
          signal: controller.signal,
          onDelta: (draft) => {
            if (isCurrent()) {
              this._draft.set(draft);
            }
            this.options.onDelta?.(draft);
          },
          onPhase: (phase) => {
            if (isCurrent()) {
              this._phase.set(phase);
            }
          },
        })
        .then((reply) => {
          if (!isCurrent()) {
            return;
          }
          this._value.set(reply.value);
          this._finishReason.set(reply.finishReason);
          this._usage.set(reply.usage);
          this._draft.set(null);
          this._status.set('resolved');
        })
        .catch((cause: unknown) => {
          if (!isCurrent() || isAborted(cause)) {
            return;
          }
          this._error.set(toLlmError(cause));
          this._draft.set(null);
          this._status.set('error');
        });
    };

    const debounce = this.options.debounce ?? 0;
    if (debounce > 0 && status === 'loading') {
      this.timer = setTimeout(ask, debounce);
    } else {
      ask();
    }
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.current?.abort();
    this.current = null;
  }
}
