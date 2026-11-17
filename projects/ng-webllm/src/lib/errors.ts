export type LlmErrorCode =
  /** The browser has no WebGPU. */
  | 'unsupported'
  /** No model is loaded, and none is loading. */
  | 'not-ready'
  | 'load-failed'
  /** Stopped on purpose: stop(), new params, an AbortSignal. Never shown as an error state. */
  | 'aborted'
  | 'timeout'
  /** The answer hit maxTokens and was cut off. */
  | 'truncated'
  /** The answer does not follow the schema. */
  | 'invalid-output'
  /** Anything the engine reported: errors from the worker arrive as plain strings. */
  | 'engine';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/** Wraps whatever was thrown, so every failure leaving the library is an LlmError. */
export function toLlmError(cause: unknown): LlmError {
  if (cause instanceof LlmError) {
    return cause;
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  return new LlmError('engine', message, { cause });
}

export function isAborted(cause: unknown): boolean {
  return cause instanceof LlmError && cause.code === 'aborted';
}
