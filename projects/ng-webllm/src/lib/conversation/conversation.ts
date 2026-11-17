import {
  DestroyRef,
  Injector,
  assertInInjectionContext,
  computed,
  inject,
  runInInjectionContext,
  signal,
  untracked,
  type Resource,
  type ResourceSnapshot,
  type ResourceStatus,
  type Signal,
} from '@angular/core';
import { LlmError, isAborted, toLlmError } from '../errors';
import { WebLlm } from '../engine/web-llm';
import type { Schema } from '../schema/schema';
import type {
  AskOptions,
  ChatMessage,
  Content,
  ContentPart,
  Draft,
  FinishReason,
  GenerationOptions,
  Phase,
  Reply,
  Usage,
} from '../types';
import { contentText } from '../types';
import {
  generate,
  isReplyPrompt,
  reply,
  save,
  type AnyStep,
  type ChainBuilder,
  type ChainFn,
  type ContextOption,
  type GenerateOptions,
  type GenerateStep,
  type Step,
  type StepPrompt,
} from './chain';
import { messageId, type Audience, type Message } from './message';

export interface ConversationOptions<T> extends GenerationOptions {
  readonly system: string | (() => string);
  readonly messages?: readonly Message<T>[];
  /** With a schema, every answer of `send` also carries `value: T`. */
  readonly schema?: Schema<T>;
  /**
   * What the model receives at every turn: everything ('all', the default), the
   * last N turns, or nothing but the system prompt and the new message ('none').
   */
  readonly memory?: ContextOption;
  /** Default: inject(WebLlm). */
  readonly engine?: WebLlm;
  /** Needed only outside an injection context. */
  readonly injector?: Injector;
}

export interface AddOptions {
  readonly role?: 'user' | 'assistant';
  readonly audience?: Audience;
}

export interface SendOptions<T> extends AskOptions<T> {
  /** Who sees the message sent. The answer is always for both. */
  readonly audience?: Exclude<Audience, 'user'>;
}

export interface AsideOptions<R> extends AskOptions<R> {
  /** How much of the conversation the model receives. Default 'all'. */
  readonly context?: ContextOption;
  /** System prompt for this call; false = none. Default: the conversation's. */
  readonly system?: string | false;
}

export interface ForkOptions {
  readonly system?: string | (() => string);
  readonly memory?: ContextOption;
  /** Copy up to this message (included). Default: all of it. */
  readonly at?: string;
}

export interface ConversationRef<T = string> extends Resource<readonly Message<T>[]> {
  /** What the user sees; the same as value(). */
  readonly messages: Signal<readonly Message<T>[]>;
  /** What the model receives. */
  readonly context: Signal<readonly Message<T>[]>;
  /** The answer being written, when it is meant for the user. */
  readonly draft: Signal<Draft<T> | null>;
  readonly phase: Signal<Phase>;
  readonly lastReply: Signal<Message<T> | undefined>;
  readonly finishReason: Signal<FinishReason | undefined>;
  readonly usage: Signal<Usage | undefined>;

  /** Writes a message. Calls nothing. */
  add(content: Content, options?: AddOptions): Message<T>;
  /** Writes a message, then writes the model's answer. */
  send(content: Content, options?: SendOptions<T>): Promise<Message<T>>;
  /** Asks the model about the conversation. Never writes. */
  aside<R = string>(prompt: StepPrompt<undefined>, options?: AsideOptions<R>): Promise<Reply<R>>;
  /** Defines a chain of generate and save steps, callable like a function. */
  readonly chain: ChainBuilder;

  stop(options?: { keepPartial?: boolean }): void;
  /** Drops the last answer and asks again. */
  regenerate(): Promise<Message<T>>;
  reset(messages?: readonly Message<T>[]): void;
  fork(options?: ForkOptions): ConversationRef<T>;
  destroy(): void;
}

/** A conversation: a history, and the chains that write in it. */
export function conversation<T = string>(options: ConversationOptions<T>): ConversationRef<T> {
  if (!options.injector) {
    assertInInjectionContext(conversation);
  }

  return new ConversationImpl(options, options.injector ?? inject(Injector));
}

class ConversationImpl<T> implements ConversationRef<T> {
  private readonly engine: WebLlm;
  private readonly memory: ContextOption;
  private readonly forks = new Set<ConversationRef<T>>();

  /** Chains run one at a time: this is the tail of the line. */
  private lock: Promise<unknown> = Promise.resolve();
  private active: AbortController | null = null;
  /** How many times stop() was called: a chain queued before the last call is dropped. */
  private stops = 0;
  private destroyed = false;

  private readonly all = signal<readonly Message<T>[]>([]);
  private readonly running = signal(0);
  private readonly _error = signal<LlmError | undefined>(undefined);
  private readonly _draft = signal<Draft<T> | null>(null);
  private readonly _phase = signal<Phase>('idle');
  private readonly _finishReason = signal<FinishReason | undefined>(undefined);
  private readonly _usage = signal<Usage | undefined>(undefined);

  readonly messages = computed(() => this.all().filter((message) => message.audience !== 'model'));
  readonly context = computed(() => this.all().filter((message) => message.audience !== 'user'));
  readonly value = this.messages;
  readonly error = this._error.asReadonly();
  readonly draft = this._draft.asReadonly();
  readonly phase = this._phase.asReadonly();
  readonly finishReason = this._finishReason.asReadonly();
  readonly usage = this._usage.asReadonly();

  readonly lastReply = computed(() =>
    findLast(this.messages(), (message) => message.role === 'assistant'),
  );
  readonly isLoading = computed(() => this.running() > 0);
  readonly status = computed<ResourceStatus>(() => {
    if (this._error()) {
      return 'error';
    }
    if (this.running() > 0) {
      return 'loading';
    }
    return this.all().length > 0 ? 'resolved' : 'idle';
  });
  readonly snapshot = computed(() => {
    const status = this.status();
    const error = this._error();
    return (
      status === 'error' && error ? { status, error } : { status, value: this.messages() }
    ) as ResourceSnapshot<readonly Message<T>[]>;
  });

  readonly chain: ChainBuilder = ((...steps: Step<unknown, unknown>[]): ChainFn<unknown, unknown> =>
    (input, options) =>
      this.exclusive(options?.signal, (signal) =>
        this.runSteps(steps as AnyStep[], input, signal).then((result) => result.value),
      )) as ChainBuilder;

  constructor(
    private readonly options: ConversationOptions<T>,
    private readonly injector: Injector,
  ) {
    this.engine = options.engine ?? injector.get(WebLlm);
    this.memory = options.memory ?? 'all';
    this.all.set(options.messages ?? []);

    injector.get(DestroyRef).onDestroy(() => this.destroy());
  }

  hasValue(this: T extends undefined ? this : never): this is Resource<readonly Message<T>[]>;
  hasValue(): boolean;
  hasValue(): boolean {
    return this.status() !== 'error';
  }

  add(content: Content, options: AddOptions = {}): Message<T> {
    return this.write(content, options.role ?? 'user', options.audience ?? 'both');
  }

  async send(content: Content, options: SendOptions<T> = {}): Promise<Message<T>> {
    const steps: AnyStep[] = [
      save.forBoth() as AnyStep,
      generate(reply(), { schema: this.options.schema, ...options }) as AnyStep,
      save.forBoth() as AnyStep,
    ];
    if (options.audience === 'model') {
      steps[0] = save.forModel() as AnyStep;
    }

    const result = await this.exclusive(options.signal, (signal) =>
      this.runSteps(steps, content, signal),
    );
    return result.saved as Message<T>;
  }

  aside<R = string>(prompt: StepPrompt<undefined>, options: AsideOptions<R> = {}): Promise<Reply<R>> {
    const step = generate(prompt as StepPrompt<unknown>, {
      context: 'all',
      priority: 'high',
      ...options,
    }) as GenerateStep;

    // Not in the line of chains, and not in draft() or phase(): it leaves no trace.
    return this.engine.request(this.buildMessages(step, undefined), {
      ...this.generationDefaults(),
      ...(step.options as AskOptions<R>),
    });
  }

  stop(options: { keepPartial?: boolean } = {}): void {
    const draft = untracked(this._draft);
    // The chains waiting their turn see the count change and never start.
    this.stops += 1;
    this.active?.abort();

    if (options.keepPartial && draft && draft.text) {
      this.all.update((all) => [
        ...all,
        {
          id: messageId(),
          role: 'assistant',
          content: draft.text,
          status: 'interrupted',
          audience: 'both',
        },
      ]);
    }
    this._draft.set(null);
  }

  async regenerate(): Promise<Message<T>> {
    const result = await this.exclusive(undefined, (signal) => {
      const all = untracked(this.all);
      const index = findLastIndex(all, (message) => message.role === 'assistant');
      if (index >= 0) {
        this.all.set(all.slice(0, index));
      }

      const steps: AnyStep[] = [
        generate(reply(), { schema: this.options.schema }) as AnyStep,
        save.forBoth() as AnyStep,
      ];
      return this.runSteps(steps, undefined, signal);
    });

    return result.saved as Message<T>;
  }

  reset(messages: readonly Message<T>[] = []): void {
    this.stop();
    this._error.set(undefined);
    this._finishReason.set(undefined);
    this._usage.set(undefined);
    this.all.set(messages);
  }

  fork(options: ForkOptions = {}): ConversationRef<T> {
    const all = untracked(this.all);
    const end = options.at ? all.findIndex((message) => message.id === options.at) + 1 : all.length;

    const branch = runInInjectionContext(this.injector, () =>
      conversation<T>({
        ...this.options,
        system: options.system ?? this.options.system,
        memory: options.memory ?? this.memory,
        engine: this.engine,
        messages: all.slice(0, end > 0 ? end : all.length),
      }),
    );

    this.forks.add(branch);
    return branch;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    this.stop();
    for (const branch of this.forks) {
      branch.destroy();
    }
    this.forks.clear();
  }

  /** Runs one chain after the other, and keeps the busy state while any is waiting or running. */
  private exclusive<R>(
    external: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<R>,
  ): Promise<R> {
    if (this.destroyed) {
      return Promise.reject(new LlmError('aborted', 'The conversation was destroyed.'));
    }

    this.running.update((count) => count + 1);
    if (untracked(this.running) > 1) {
      this._phase.set('queued');
    }

    const ticket = this.stops;

    const run = this.lock.then(async () => {
      const controller = new AbortController();
      const forward = () => controller.abort();
      external?.addEventListener('abort', forward, { once: true });
      if (external?.aborted || this.stops !== ticket) {
        controller.abort();
      }

      this.active = controller;
      this._error.set(undefined);

      try {
        // Stopped while it waited: the work does not start at all, so it changes nothing.
        if (controller.signal.aborted) {
          throw new LlmError('aborted', 'The chain was stopped before it started.');
        }
        return await work(controller.signal);
      } catch (cause) {
        const error = toLlmError(cause);
        if (!isAborted(error)) {
          this._error.set(error);
        }
        throw error;
      } finally {
        external?.removeEventListener('abort', forward);
        if (this.active === controller) {
          this.active = null;
        }
        this._draft.set(null);
        this._phase.set('idle');
        this.running.update((count) => count - 1);
      }
    });

    this.lock = run.catch(() => undefined);
    return run;
  }

  private async runSteps(
    steps: readonly AnyStep[],
    input: unknown,
    signal: AbortSignal,
  ): Promise<{ value: unknown; saved: Message<T> | undefined }> {
    let value = input;
    let text: string | undefined;
    let fromModel = false;
    let saved: Message<T> | undefined;

    for (const [index, current] of steps.entries()) {
      if (signal.aborted) {
        throw new LlmError('aborted', 'The chain was stopped.');
      }

      switch (current.kind) {
        case 'save': {
          const content = current.pick ? current.pick(value) : toContent(value, text);
          saved = this.write(
            content,
            fromModel ? 'assistant' : 'user',
            current.audience,
            fromModel && typeof value === 'object' ? (value as T) : undefined,
          );
          this._draft.set(null);
          break;
        }

        case 'generate': {
          const showDraft = current.options.draft ?? savesForUser(steps[index + 1]);
          const answer = await this.engine.request(this.buildMessages(current, value), {
            ...this.generationDefaults(),
            ...current.options,
            signal,
            onDelta: (draft) => {
              if (showDraft) {
                this._draft.set(draft as Draft<T>);
              }
              current.options.onDelta?.(draft);
            },
            onPhase: (phase) => this._phase.set(phase),
          });

          value = answer.value;
          text = answer.text;
          fromModel = true;
          this._finishReason.set(answer.finishReason);
          this._usage.set(answer.usage);
          break;
        }

        case 'step':
          value = await current.fn(value);
          break;
      }
    }

    return { value, saved };
  }

  private write(
    content: Content,
    role: 'user' | 'assistant',
    audience: Audience,
    value?: T,
  ): Message<T> {
    const message: Message<T> = {
      id: messageId(),
      role,
      content,
      status: 'complete',
      audience,
      ...(value === undefined ? {} : { value }),
    };

    this.all.update((all) => [...all, message]);
    return message;
  }

  private buildMessages(step: GenerateStep, value: unknown): ChatMessage[] {
    const systemText =
      step.options.system === false ? '' : (step.options.system ?? this.systemText());
    const system: ChatMessage[] = systemText ? [{ role: 'system', content: systemText }] : [];

    const contextOption = step.options.context ?? this.memory;
    const context = untracked(this.context).map(toChatMessage);

    if (isReplyPrompt(step.prompt)) {
      // The last message is the one to answer: memory limits what comes before it.
      const last = context.at(-1);
      const before = context.slice(0, -1);
      return [...system, ...select(before, contextOption), ...(last ? [last] : [])];
    }

    const history = select(context, contextOption);

    if (typeof step.prompt === 'string') {
      return [...system, ...history, { role: 'user', content: withInstruction(step.prompt, value) }];
    }

    const built = step.prompt(value, untracked(this.context));
    if (typeof built === 'string') {
      return [...system, ...history, { role: 'user', content: built }];
    }
    return [...built];
  }

  private systemText(): string {
    const system = this.options.system;
    return typeof system === 'string' ? system : untracked(system);
  }

  private generationDefaults(): GenerationOptions {
    const { temperature, maxTokens, timeoutMs, priority, purpose } = this.options;
    return Object.fromEntries(
      Object.entries({ temperature, maxTokens, timeoutMs, priority, purpose }).filter(
        ([, option]) => option !== undefined,
      ),
    );
  }
}

function savesForUser(next: AnyStep | undefined): boolean {
  return next?.kind === 'save' && next.audience !== 'model';
}

function isContentParts(value: unknown): value is readonly ContentPart[] {
  return Array.isArray(value) && value.every((part) => typeof part === 'object' && 'type' in part);
}

/** What a save writes when it has no pick: the text itself, or the model's raw JSON. */
function toContent(value: unknown, modelText: string | undefined): Content {
  if (typeof value === 'string' || isContentParts(value)) {
    return value;
  }
  return modelText ?? JSON.stringify(value);
}

function withInstruction(instruction: string, value: unknown): Content {
  if (value === undefined || value === '') {
    return instruction;
  }
  if (isContentParts(value)) {
    return [{ type: 'text', text: instruction }, ...value];
  }

  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `${instruction}\n\n${text}`;
}

function toChatMessage(message: Message<unknown>): ChatMessage {
  return message.role === 'user'
    ? { role: 'user', content: message.content }
    : { role: 'assistant', content: contentText(message.content) };
}

/** The part of the history a generation receives. */
function select(history: readonly ChatMessage[], option: ContextOption): ChatMessage[] {
  if (option === 'all') {
    return [...history];
  }
  if (option === 'none') {
    return [];
  }
  if (option === 'last-reply') {
    const last = findLast(history, (message) => message.role === 'assistant');
    return last ? [last] : [];
  }

  // The last N turns: from the N-th user message counting from the end.
  let turns = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    if (history[index].role === 'user') {
      turns += 1;
      if (turns === option) {
        return history.slice(index);
      }
    }
  }
  return [...history];
}

/** Array.prototype.findLast is ES2023: the library targets ES2022. */
function findLastIndex<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let index = list.length - 1; index >= 0; index--) {
    if (test(list[index])) {
      return index;
    }
  }
  return -1;
}

function findLast<T>(list: readonly T[], test: (item: T) => boolean): T | undefined {
  const index = findLastIndex(list, test);
  return index < 0 ? undefined : list[index];
}
