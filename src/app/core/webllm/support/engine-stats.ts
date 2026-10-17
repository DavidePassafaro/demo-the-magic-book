import type { CompletionUsage } from '@mlc-ai/web-llm';

/**
 * What WebLLM itself measured while answering: every number comes from the
 * `usage` block of a completion, nothing is estimated on our side.
 */
export interface EngineStats {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Seconds spent prefilling and decoding, rebuilt from WebLLM's token rates. */
  readonly prefillSeconds: number;
  readonly decodeSeconds: number;
  readonly lastLatencyS: number | null;
  readonly lastTimeToFirstTokenS: number | null;
}

export const EMPTY_STATS: EngineStats = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  prefillSeconds: 0,
  decodeSeconds: 0,
  lastLatencyS: null,
  lastTimeToFirstTokenS: null,
};

function secondsFor(tokens: number, perSecond: number): number {
  return perSecond > 0 ? tokens / perSecond : 0;
}

export function addUsage(stats: EngineStats, usage: CompletionUsage): EngineStats {
  const { extra } = usage;
  return {
    calls: stats.calls + 1,
    promptTokens: stats.promptTokens + usage.prompt_tokens,
    completionTokens: stats.completionTokens + usage.completion_tokens,
    prefillSeconds:
      stats.prefillSeconds + secondsFor(usage.prompt_tokens, extra.prefill_tokens_per_s),
    decodeSeconds:
      stats.decodeSeconds + secondsFor(usage.completion_tokens, extra.decode_tokens_per_s),
    lastLatencyS: extra.e2e_latency_s,
    lastTimeToFirstTokenS: extra.time_to_first_token_s,
  };
}

/** Two engines' figures as one: the panel shows the game's total use. */
export function mergeStats(a: EngineStats, b: EngineStats): EngineStats {
  const latest = b.calls > 0 ? b : a;
  return {
    calls: a.calls + b.calls,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    prefillSeconds: a.prefillSeconds + b.prefillSeconds,
    decodeSeconds: a.decodeSeconds + b.decodeSeconds,
    lastLatencyS: latest.lastLatencyS,
    lastTimeToFirstTokenS: latest.lastTimeToFirstTokenS,
  };
}
