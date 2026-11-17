import type { AskOptions, ChatMessage, Content } from '../types';
import type { Audience, Message } from './message';

/** How much of the conversation a generation receives. */
export type ContextOption = 'all' | 'none' | 'last-reply' | number;

const REPLY = Symbol('reply');

/** The prompt `reply()` returns: answer the conversation as it stands. */
export interface ReplyPrompt {
  readonly [REPLY]: true;
}

/**
 * What a `generate` sends, built from the value the step receives:
 * - a string is an instruction: the value is appended to it as the user message;
 * - a function returns either the user message, or every message to send.
 */
export type StepPrompt<In> =
  | string
  | ReplyPrompt
  | ((value: In, history: readonly Message<unknown>[]) => string | readonly ChatMessage[]);

export interface GenerateOptions<Out> extends AskOptions<Out> {
  /** How much of the conversation the model receives. Default: the conversation's `memory`. */
  readonly context?: ContextOption;
  /** System prompt for this step; false = none. Default: the conversation's. */
  readonly system?: string | false;
  /** Shows the answer in draft() while it streams. Default: when the next step saves it for the user. */
  readonly draft?: boolean;
}

/**
 * One step of a chain. `In` is the value it receives, `Out` the value it hands
 * to the next step. The two phantom fields only carry the types.
 */
export interface Step<In, Out> {
  readonly kind: 'generate' | 'save' | 'step';
  readonly __in?: (value: In) => void;
  readonly __out?: () => Out;
}

/** @internal */
export interface GenerateStep extends Step<unknown, unknown> {
  readonly kind: 'generate';
  readonly prompt: StepPrompt<unknown>;
  readonly options: GenerateOptions<unknown>;
}

/** @internal */
export interface SaveStep extends Step<unknown, unknown> {
  readonly kind: 'save';
  readonly audience: Audience;
  readonly pick?: (value: unknown) => Content;
}

/** @internal */
export interface FnStep extends Step<unknown, unknown> {
  readonly kind: 'step';
  readonly fn: (value: unknown) => unknown;
}

/** @internal */
export type AnyStep = GenerateStep | SaveStep | FnStep;

/** Calls the model and passes its answer on. Saves nothing. */
export function generate<In, Out = string>(
  prompt: StepPrompt<In>,
  options: GenerateOptions<Out> = {},
): Step<In, Out> {
  return { kind: 'generate', prompt, options } as GenerateStep as Step<In, Out>;
}

function saveFor(audience: Audience) {
  return <In>(pick?: (value: In) => Content): Step<In, In> =>
    ({ kind: 'save', audience, pick }) as SaveStep as Step<In, In>;
}

/**
 * Writes the current value in the conversation, for whom it says, and passes
 * it on unchanged. Calls nothing. The role follows who wrote the value: the
 * model's answers are saved as 'assistant', everything else as 'user'.
 */
export const save = {
  forUser: saveFor('user'),
  forModel: saveFor('model'),
  forBoth: saveFor('both'),
};

/** A step in plain JavaScript. Throw to stop the chain. */
export function step<In, Out>(fn: (value: In) => Out | Promise<Out>): Step<In, Out> {
  return { kind: 'step', fn } as FnStep as Step<In, Out>;
}

const REPLY_PROMPT: ReplyPrompt = { [REPLY]: true };

/** The prompt for "answer the conversation": no extra text, only the history. */
export function reply(): ReplyPrompt {
  return REPLY_PROMPT;
}

export function isReplyPrompt(prompt: StepPrompt<unknown>): prompt is ReplyPrompt {
  return typeof prompt === 'object' && prompt !== null && REPLY in prompt;
}

export type ChainFn<In, Out> = (input: In, options?: { signal?: AbortSignal }) => Promise<Out>;

/** `chain(...)` typed step by step: each step receives what the previous one hands on. */
export interface ChainBuilder {
  <A, B>(s1: Step<A, B>): ChainFn<A, B>;
  <A, B, C>(s1: Step<A, B>, s2: Step<B, C>): ChainFn<A, C>;
  <A, B, C, D>(s1: Step<A, B>, s2: Step<B, C>, s3: Step<C, D>): ChainFn<A, D>;
  <A, B, C, D, E>(s1: Step<A, B>, s2: Step<B, C>, s3: Step<C, D>, s4: Step<D, E>): ChainFn<A, E>;
  <A, B, C, D, E, F>(
    s1: Step<A, B>,
    s2: Step<B, C>,
    s3: Step<C, D>,
    s4: Step<D, E>,
    s5: Step<E, F>,
  ): ChainFn<A, F>;
  <A, B, C, D, E, F, G>(
    s1: Step<A, B>,
    s2: Step<B, C>,
    s3: Step<C, D>,
    s4: Step<D, E>,
    s5: Step<E, F>,
    s6: Step<F, G>,
  ): ChainFn<A, G>;
  <A, B, C, D, E, F, G, H>(
    s1: Step<A, B>,
    s2: Step<B, C>,
    s3: Step<C, D>,
    s4: Step<D, E>,
    s5: Step<E, F>,
    s6: Step<F, G>,
    s7: Step<G, H>,
  ): ChainFn<A, H>;
  <A, B, C, D, E, F, G, H, I>(
    s1: Step<A, B>,
    s2: Step<B, C>,
    s3: Step<C, D>,
    s4: Step<D, E>,
    s5: Step<E, F>,
    s6: Step<F, G>,
    s7: Step<G, H>,
    s8: Step<H, I>,
  ): ChainFn<A, I>;
  (...steps: Step<unknown, unknown>[]): ChainFn<unknown, unknown>;
}

