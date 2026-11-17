import type { DeepPartial, Schema } from './schema/schema';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImagePart {
  readonly type: 'image_url';
  /** A `data:image/...` URL. */
  readonly image_url: { readonly url: string };
}

export type ContentPart = TextPart | ImagePart;

export type Content = string | readonly ContentPart[];

/** OpenAI-shaped on purpose: it is what WebLLM speaks. */
export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: Content }
  | { readonly role: 'assistant'; readonly content: string };

export type FinishReason = 'stop' | 'length' | 'abort';

/** What WebLLM measured for one generation; never estimated. */
export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly prefillTokensPerSecond: number;
  readonly decodeTokensPerSecond: number;
  readonly timeToFirstTokenS: number;
  readonly latencyS: number;
}

/**
 * Where a request is: waiting its turn, reading the prompt (before the first
 * token), or writing the answer.
 */
export type Phase = 'idle' | 'queued' | 'prefill' | 'streaming';

export type Priority = 'high' | 'normal' | 'low';

/** An answer while the model is still writing it. */
export interface Draft<T> {
  readonly text: string;
  /** Only with a schema: the fields written so far. */
  readonly partial: DeepPartial<T> | undefined;
}

export interface Reply<T> {
  /** The text without a schema, the validated object with one. */
  readonly value: T;
  readonly text: string;
  readonly finishReason: FinishReason;
  readonly usage: Usage | undefined;
}

export interface GenerationOptions {
  /** Defaults to 0: the same question twice gets the same answer twice. */
  readonly temperature?: number;
  readonly maxTokens?: number;
  /**
   * Streamed, the clock starts at the first token. Without streaming there is
   * no first token to wait for: it starts with the request, prefill included.
   */
  readonly timeoutMs?: number;
  /**
   * Defaults to true: the answer arrives token by token, in `draft()` and
   * `onDelta`. False asks WebLLM for the whole answer at once: no draft, and
   * the phase stays 'prefill' until it is done.
   */
  readonly stream?: boolean;
  readonly priority?: Priority;
  readonly signal?: AbortSignal;
  /** A label for the console, when `debug` is on. */
  readonly purpose?: string;
}

export interface AskOptions<T> extends GenerationOptions {
  readonly schema?: Schema<T>;
  /** Extra attempts when the answer is truncated or does not follow the schema. */
  readonly retry?: number;
  readonly onDelta?: (draft: Draft<T>) => void;
}

export interface ModelInfo {
  /** An id of WebLLM's prebuilt config (the -MLC suffix). */
  readonly id: string;
  readonly label: string;
  readonly sizeMb?: number;
  readonly vision?: boolean;
}

export type EngineStatus = 'idle' | 'checking' | 'unsupported' | 'loading' | 'ready' | 'error';

/** Token use and speed for the loaded model, summed over every generation. */
export interface ModelStats {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly prefillSeconds: number;
  readonly decodeSeconds: number;
  readonly lastLatencyS: number | null;
  readonly lastTimeToFirstTokenS: number | null;
}

export const EMPTY_STATS: ModelStats = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  prefillSeconds: 0,
  decodeSeconds: 0,
  lastLatencyS: null,
  lastTimeToFirstTokenS: null,
};

export function addUsage(stats: ModelStats, usage: Usage): ModelStats {
  const seconds = (tokens: number, perSecond: number) => (perSecond > 0 ? tokens / perSecond : 0);

  return {
    calls: stats.calls + 1,
    promptTokens: stats.promptTokens + usage.promptTokens,
    completionTokens: stats.completionTokens + usage.completionTokens,
    prefillSeconds: stats.prefillSeconds + seconds(usage.promptTokens, usage.prefillTokensPerSecond),
    decodeSeconds: stats.decodeSeconds + seconds(usage.completionTokens, usage.decodeTokensPerSecond),
    lastLatencyS: usage.latencyS,
    lastTimeToFirstTokenS: usage.timeToFirstTokenS,
  };
}

/** Text in full, images as a marker: what goes in a log or in a fake's matcher. */
export function contentText(content: Content): string {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');
}
