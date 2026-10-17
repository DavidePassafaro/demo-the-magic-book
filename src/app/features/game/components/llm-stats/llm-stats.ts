import { Component, computed, effect, inject, signal } from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import { mergeStats } from '@core/webllm/support/engine-stats';
import { WebLlmService } from '@core/webllm/web-llm.service';

interface StatRow {
  readonly label: string;
  readonly value: string;
}

const MB = 1024 * 1024;

/**
 * Token use and machine figures for the local models. Only numbers that
 * WebLLM or the browser actually measured are shown, never estimates.
 */
@Component({
  selector: 'mb-llm-stats',
  templateUrl: './llm-stats.html',
  styleUrl: './llm-stats.scss',
})
export class LlmStats {
  private readonly llm = inject(WebLlmService);
  private readonly locale = inject(LocaleService);

  protected readonly t = this.locale.t;

  /** Bytes this origin keeps on disk, model weights included. */
  private readonly storageBytes = signal<number | null>(null);

  protected readonly rows = computed<readonly StatRow[]>(() => {
    const t = this.t();
    const stats = mergeStats(this.llm.chat.stats(), this.llm.vision.stats());
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
      { label: t.statsMaxBuffer, value: megabytes(this.llm.chat.maxBufferBytes()) },
      { label: t.statsStorage, value: megabytes(this.storageBytes()) },
    ];
  });

  constructor() {
    // The disk figure changes when a model is downloaded, so it is read again then.
    effect(() => {
      this.llm.chat.status();
      this.llm.vision.status();
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
