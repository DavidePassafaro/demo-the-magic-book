import type { Content } from '../types';

/** Who sees a message: the user (`messages()`), the model (`context()`), or both. */
export type Audience = 'both' | 'model' | 'user';

export interface Message<T = string> {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: Content;
  /** For the model's answers generated with a schema: the parsed value. */
  readonly value?: T;
  readonly status: 'complete' | 'interrupted';
  readonly audience: Audience;
}

let nextId = 0;

export function messageId(): string {
  nextId += 1;
  return `m${nextId}`;
}
