import { Component, computed, inject, signal } from '@angular/core';
import { MODEL_OPTIONS, findModel } from '@core/webllm/data/llm-models';
import { LOCALES, type Locale } from '@core/i18n/model/locale';
import { LocaleService } from '@core/i18n/locale.service';
import { WebLlmChatModel } from '@core/webllm/web-llm-chat.model';

/**
 * The two controls that used to be a settings page. Both take effect at once:
 * the language redraws the text, and the model restarts whatever is being
 * played, since the mind that was answering has changed.
 */
@Component({
  selector: 'mb-settings-bar',
  templateUrl: './settings-bar.html',
  styleUrl: './settings-bar.scss',
})
export class SettingsBar {
  private readonly model = inject(WebLlmChatModel);
  private readonly locale = inject(LocaleService);

  protected readonly t = this.locale.t;
  protected readonly locales = LOCALES;
  protected readonly models = MODEL_OPTIONS;
  protected readonly currentLocale = this.locale.locale;
  protected readonly currentModel = this.model.modelId;
  protected readonly cached = signal<Record<string, boolean>>({});

  /** What this model is good and bad at, in the player's language. */
  protected readonly note = computed(
    () => findModel(this.currentModel()).note[this.currentLocale()],
  );

  constructor() {
    for (const model of MODEL_OPTIONS) {
      this.model.isCached(model.id).then((isCached) => {
        this.cached.update((current) => ({ ...current, [model.id]: isCached }));
      });
    }
  }

  protected selectLocale(id: Locale): void {
    this.locale.setLocale(id);
  }

  protected selectModel(event: Event): void {
    this.model.select((event.target as HTMLSelectElement).value);
  }

  protected modelLabel(id: string, label: string, sizeMb: number): string {
    const state = this.cached()[id] ? this.t().alreadyDownloaded : this.t().needsDownload;
    return `${label} · ${sizeMb} MB · ${state}`;
  }
}
