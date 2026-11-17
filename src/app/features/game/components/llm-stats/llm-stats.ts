import { Component, computed, effect, inject, signal } from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import { WebLlm, type ModelStats } from 'ng-webllm';
import { VISION } from '@core/webllm/web-llm.providers';

interface StatRow {
  readonly label: string;
  readonly value: string;
}

const MB = 1024 * 1024;

/**
 * Token use and machine figures for the models. Only numbers that the
 * provider or the browser actually measured are shown, never estimates.
 */
@Component({
  selector: 'mb-llm-stats',
  templateUrl: './llm-stats.html',
  styleUrl: './llm-stats.scss',
})
export class LlmStats {
  private readonly chat = inject(WebLlm);
  private readonly vision = inject(VISION);
  private readonly locale = inject(LocaleService);

  protected readonly t = this.locale.t;
  protected readonly providers = 'WebLLM';

  /** Bytes this origin keeps on disk, model weights included. */
  private readonly storageBytes = signal<number | null>(null);

  protected readonly rows = computed<readonly StatRow[]>(() => {
    const t = this.t();
    const stats = mergeStats(this.chat.stats(), this.vision.stats());
    const number = new Intl.NumberFormat(this.locale.locale());
    const decimal = new Intl.NumberFormat(this.locale.locale(), { maximumFractionDigits: 1 });
    const rate = (tokens: number, seconds: number): string =>
      seconds > 0 ? `${decimal.format(tokens / seconds)} tok/s` : '—';
    const megabytes = (bytes: number | null): string =>
      bytes === null ? '—' : `${number.format(Math.round(bytes / MB))} MB`;

    const latency = stats.lastLatencyS;
    const firstToken = stats.lastTimeToFirstTokenS;

    return [
      { label: t.statsCalls, value: number.format(stats.calls) },
      { label: t.statsPromptTokens, value: number.format(stats.promptTokens) },
      { label: t.statsCompletionTokens, value: number.format(stats.completionTokens) },
      { label: t.statsPrefill, value: rate(stats.promptTokens, stats.prefillSeconds) },
      { label: t.statsDecode, value: rate(stats.completionTokens, stats.decodeSeconds) },
      {
        label: t.statsLastAnswer,
        value:
          latency === null
            ? '—'
            : `${decimal.format(latency)} s` +
              (firstToken === null ? '' : ` · TTFT ${decimal.format(firstToken)} s`),
      },
      { label: t.statsMaxBuffer, value: megabytes(this.chat.gpuBufferBytes()) },
      { label: t.statsStorage, value: megabytes(this.storageBytes()) },
    ];
  });

  constructor() {
    // The disk figure changes when a model is downloaded, so it is read again then.
    effect(() => {
      this.chat.status();
      this.vision.status();
      void this.readStorage();
    });
  }

  private async readStorage(): Promise<void> {
    try {
      const estimate = await navigator.storage?.estimate();
      this.storageBytes.set(estimate?.usage ?? null);
    } catch {
      this.storageBytes.set(null);
    }
  }
}

/** Two models' figures as one: the panel shows the game's total use. */
function mergeStats(a: ModelStats, b: ModelStats): ModelStats {
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
