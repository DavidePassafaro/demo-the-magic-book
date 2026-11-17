import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
} from '@angular/core';
import {
  LlmError,
  WebLlm,
  type ChatMessage,
  type EngineConfig,
  type GenerationRequest,
  type GenerationResult,
  type GpuSupport,
  type LlmBackend,
  type ModelInfo,
  type WebLlmToken,
} from 'ng-webllm';

type Answer = string | object;

export interface FakeReply {
  /** Which requests it answers: a test on the last user message, or on all the messages. */
  readonly match?: RegExp | string | ((messages: readonly ChatMessage[]) => boolean);
  /** A string, an object (sent as JSON), or a function of the messages. */
  readonly reply: Answer | ((messages: readonly ChatMessage[]) => Answer);
}

export interface FakeRequest extends GenerationRequest {
  /** The reply the fake gave, as text. */
  readonly answer: string;
}

/** What the next generation does instead of answering. */
export type FakeFailure =
  /** Throws, as an error from the worker would. */
  | 'engine'
  /** Stops at maxTokens: finishReason 'length'. */
  | 'truncated'
  /** Answers text that is not JSON. */
  | 'garbage'
  /** Fails the way WebLLM does after it has unloaded the model. */
  | 'lost';

export interface FakeWebLlmConfig extends Partial<EngineConfig> {
  readonly replies?: readonly FakeReply[];
  /** Delay between words. 0 (the default) answers in one chunk. */
  readonly tokenDelayMs?: number;
  /** Delay before the first word, as the model reads the prompt. Default 0. */
  readonly prefillDelayMs?: number;
  /** Loads the model on start. Default true. */
  readonly ready?: boolean;
  /** As if the browser had no WebGPU. */
  readonly unsupported?: boolean;
  /** Provides the fake engine under this token instead of WebLlm. */
  readonly token?: WebLlmToken;
}

const FAKE_MODEL: ModelInfo = { id: 'fake-model-MLC', label: 'Fake model' };

/**
 * A backend with programmed replies: no worker, no GPU. The engine around it
 * is the real one, so queue, phases, streaming and schemas behave as in the app.
 */
export class FakeWebLlm implements LlmBackend {
  private readonly _requests = signal<readonly FakeRequest[]>([]);
  /** Every generation asked so far. */
  readonly requests = this._requests.asReadonly();

  private readonly replies: FakeReply[];
  private readonly failures: FakeFailure[] = [];
  private failLoad = false;
  private interrupted = false;

  constructor(private readonly config: FakeWebLlmConfig = {}) {
    this.replies = [...(config.replies ?? [])];
  }

  /** Adds a reply, checked before the configured ones. */
  respond(reply: FakeReply): void {
    this.replies.unshift(reply);
  }

  /** The next generation fails this way. */
  fail(failure: FakeFailure = 'engine'): void {
    this.failures.push(failure);
  }

  /** The next load() fails. */
  failNextLoad(): void {
    this.failLoad = true;
  }

  async support(): Promise<GpuSupport> {
    return this.config.unsupported ? 'no-api' : 'supported';
  }

  async load(_modelId: string, onProgress: (progress: number, text: string) => void): Promise<void> {
    await Promise.resolve();

    if (this.failLoad) {
      this.failLoad = false;
      throw new Error('The fake model failed to load.');
    }
    onProgress(1, 'Fake model ready');
  }

  async unload(): Promise<void> {
    // Nothing to free.
  }

  async generate(request: GenerationRequest, onText: (text: string) => void): Promise<GenerationResult> {
    this.interrupted = false;
    await new Promise((resolve) => setTimeout(resolve, this.config.prefillDelayMs ?? 0));

    const failure = this.failures.shift();
    if (failure === 'engine') {
      this.record(request, '');
      throw new Error('The fake engine failed.');
    }
    if (failure === 'lost') {
      this.record(request, '');
      // What the real backend turns WebLLM's ModelNotLoadedError into.
      throw new LlmError('model-lost', 'The model stopped working: load it again.');
    }

    const answer = failure === 'garbage' ? 'not json at all' : this.answerFor(request.messages);
    this.record(request, answer);

    const delay = this.config.tokenDelayMs ?? 0;
    const words = delay > 0 ? answer.split(/(?<=\s)/) : [answer];
    let text = '';

    for (const word of words) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (this.interrupted) {
        return { text, finishReason: 'abort', usage: undefined };
      }

      text += word;
      onText(text);
    }

    return { text, finishReason: failure === 'truncated' ? 'length' : 'stop', usage: undefined };
  }

  interrupt(): void {
    this.interrupted = true;
  }

  async isCached(): Promise<boolean> {
    return true;
  }

  async deleteFromCache(): Promise<void> {
    // Nothing is cached.
  }

  async gpuBufferBytes(): Promise<number | null> {
    return null;
  }

  private answerFor(messages: readonly ChatMessage[]): string {
    const reply = this.replies.find((candidate) => matches(candidate, messages));
    if (!reply) {
      const last = lastUserText(messages);
      throw new Error(`FakeWebLlm has no reply for: "${last}"`);
    }

    const answer = typeof reply.reply === 'function' ? reply.reply(messages) : reply.reply;
    return typeof answer === 'string' ? answer : JSON.stringify(answer);
  }

  private record(request: GenerationRequest, answer: string): void {
    this._requests.update((requests) => [...requests, { ...request, answer }]);
  }
}

function lastUserText(messages: readonly ChatMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  if (!last) {
    return '';
  }
  return typeof last.content === 'string'
    ? last.content
    : last.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');
}

function matches(reply: FakeReply, messages: readonly ChatMessage[]): boolean {
  const match = reply.match;
  if (match === undefined) {
    return true;
  }
  if (typeof match === 'function') {
    return match(messages);
  }

  const text = lastUserText(messages);
  return typeof match === 'string' ? text.includes(match) : match.test(text);
}

/**
 * The engine, with a fake backend. Inject `FakeWebLlm` to program replies and
 * read the requests; inject `WebLlm` (or the token) as the app does.
 */
export function provideFakeWebLlm(config: FakeWebLlmConfig = {}): EnvironmentProviders {
  const engineConfig: EngineConfig = {
    models: config.models ?? [FAKE_MODEL],
    defaultModel: config.defaultModel ?? config.models?.[0]?.id ?? FAKE_MODEL.id,
    ...(config.defaults ? { defaults: config.defaults } : {}),
  };
  const token = config.token ?? WebLlm;

  return makeEnvironmentProviders([
    { provide: FakeWebLlm, useFactory: () => new FakeWebLlm(config) },
    { provide: token, useFactory: () => new WebLlm(engineConfig, inject(FakeWebLlm)) },
    provideEnvironmentInitializer(() => {
      if (config.ready !== false) {
        void inject(token).load();
      }
    }),
  ]);
}
