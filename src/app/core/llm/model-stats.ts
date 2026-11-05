/**
 * Token use and speed as the provider measured them: every number comes from
 * the provider's own report of a completion, nothing is estimated on our side.
 */
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

/** Two models' figures as one: the panel shows the game's total use. */
export function mergeStats(a: ModelStats, b: ModelStats): ModelStats {
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
