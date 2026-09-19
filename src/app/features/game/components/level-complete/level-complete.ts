import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import type { NpcProgress } from '@features/game/engine/game.service';
import type { PlacedNpc } from '@features/game/engine/map-generator';

@Component({
  selector: 'mb-level-complete',
  templateUrl: './level-complete.html',
  styleUrl: './level-complete.scss',
})
export class LevelComplete {
  readonly title = input.required<string>();
  readonly npcs = input.required<readonly PlacedNpc[]>();
  readonly progress = input.required<Record<string, NpcProgress>>();

  readonly replayLabel = input.required<string>();

  readonly dismissed = output<void>();
  readonly replayed = output<void>();

  private readonly backButton = viewChild<ElementRef<HTMLButtonElement>>('backButton');

  protected readonly t = inject(LocaleService).t;

  constructor() {
    // Focus lands on the way out, so Enter alone returns to the menu.
    afterNextRender(() => this.backButton()?.nativeElement.focus());
  }
}
