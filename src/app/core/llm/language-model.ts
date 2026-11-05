import type { Signal } from '@angular/core';
import type { ModelStats } from '@core/llm/model-stats';

/**
 * What the game needs from a language model, and nothing about where it runs.
 * WebLLM in the browser is one implementation; a remote API would be another.
 * Which one the game uses is decided by the providers of the game route alone.
 */

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

/** OpenAI-shaped on purpose: almost every provider speaks this, locally or remotely. */
export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly ContentPart[] }
  | { readonly role: 'assistant'; readonly content: string };

export interface QueryOptions {
  /**
   * JSON schema the answer must follow. Implementations must generate the
   * fields in the order they are declared: the judge relies on it, reasoning
   * before verdict and verdict before the villager's reply.
   */
  readonly schema?: string;
  readonly maxTokens?: number;
  /** Defaults to 0: the same question twice gets the same answer twice. */
  readonly temperature?: number;
  /** What the call is for, shown in the console. */
  readonly purpose?: string;
}

/**
 * A remote model goes straight from `idle` to `ready`; only a local one passes
 * through `checking` and `loading`, or can find the browser `unsupported`.
 */
export type ModelStatus = 'idle' | 'checking' | 'unsupported' | 'loading' | 'ready' | 'error';

export abstract class LanguageModel {
  /** Who runs the model, as the player should read it: "WebLLM", an API name… */
  abstract readonly provider: string;
  /** The model in use, for the loading screen. */
  abstract readonly label: Signal<string>;

  abstract readonly status: Signal<ModelStatus>;
  /** 0 to 1 while loading; stays at 1 when there is nothing to load. */
  abstract readonly progress: Signal<number>;
  /** The provider's own words about what it is doing while it loads. */
  abstract readonly progressText: Signal<string>;
  abstract readonly error: Signal<string | null>;
  /**
   * True when the player chose another model and the one answering is no
   * longer it: the game restarts the level on the new one.
   */
  abstract readonly outdated: Signal<boolean>;

  /** What the provider measured itself; never estimates. */
  abstract readonly stats: Signal<ModelStats>;
  /** The largest GPU buffer the model may bind, in bytes; null when it is not running here. */
  abstract readonly gpuBufferBytes: Signal<number | null>;

  /** Makes the model ready to answer. Resolves false, never throws, when it cannot. */
  abstract load(): Promise<boolean>;

  /** One question, one answer: no history is kept between calls. Throws on failure. */
  abstract query(messages: readonly ChatMessage[], options?: QueryOptions): Promise<string>;
}

/** A model that can also look at a picture. */
export abstract class VisionModel extends LanguageModel {
  /** The photo size this model takes in one look. */
  abstract readonly frame: { readonly width: number; readonly height: number };
}
