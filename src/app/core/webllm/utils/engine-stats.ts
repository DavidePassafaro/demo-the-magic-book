import type { CompletionUsage } from '@mlc-ai/web-llm';
import type { ModelStats } from '@core/llm/model-stats';

function secondsFor(tokens: number, perSecond: number): number {
  return perSecond > 0 ? tokens / perSecond : 0;
}

/** Folds WebLLM's `usage` block into the running figures; seconds rebuilt from its token rates. */
export function addUsage(stats: ModelStats, usage: CompletionUsage): ModelStats {
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
