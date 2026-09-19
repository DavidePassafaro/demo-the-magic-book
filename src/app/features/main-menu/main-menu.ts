import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsBar } from '@shared/settings-bar/settings-bar';
import { LocaleService } from '@core/i18n/locale.service';
import { LevelService } from '@features/game/engine/level.service';
import { RANDOM_LEVEL_ID, text, type LevelSummary } from '@features/game/engine/model/level';

@Component({
  selector: 'mb-main-menu',
  imports: [RouterLink, SettingsBar],
  templateUrl: './main-menu.html',
  styleUrl: './main-menu.scss',
})
export class MainMenu {
  private readonly levelService = inject(LevelService);
  private readonly locale = inject(LocaleService);

  protected readonly t = this.locale.t;
  protected readonly randomId = RANDOM_LEVEL_ID;
  protected readonly levels = signal<readonly LevelSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly titles = computed(() =>
    (this.levels() ?? []).map((level) => ({
      id: level.id,
      title: text(level.title, this.locale.locale()),
    })),
  );

  constructor() {
    this.levelService
      .listLevels()
      .then((levels) => this.levels.set(levels))
      .catch((cause: unknown) =>
        this.error.set(cause instanceof Error ? cause.message : 'The level index is unreadable.'),
      );
  }
}
