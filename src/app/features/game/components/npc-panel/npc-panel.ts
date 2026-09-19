import { Component, inject, input, output } from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import type { NpcProgress } from '@features/game/engine/game.service';
import type { PlacedNpc } from '@features/game/engine/map-generator';

@Component({
  selector: 'mb-npc-panel',
  templateUrl: './npc-panel.html',
  styleUrl: './npc-panel.scss',
})
export class NpcPanel {
  readonly npcs = input.required<readonly PlacedNpc[]>();
  readonly progress = input.required<Record<string, NpcProgress>>();
  readonly talk = output<string>();

  protected readonly t = inject(LocaleService).t;
}
