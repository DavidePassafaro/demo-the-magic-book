import { Component, inject, input, output } from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import type { NpcProgress } from '@features/game/engine/game.service';
import type { PlacedNpc } from '@features/game/engine/map-generator';
import { getNpcAppearance } from '@features/game/engine/pixel-sprites';

@Component({
  selector: 'mb-npc-panel',
  templateUrl: './npc-panel.html',
  styleUrl: './npc-panel.scss',
})
export class NpcPanel {
  readonly npcs = input.required<readonly PlacedNpc[]>();
  readonly progress = input.required<Record<string, NpcProgress>>();
  readonly activeNpcId = input<string | null>(null);
  readonly talk = output<string>();

  protected readonly t = inject(LocaleService).t;

  protected badgeColor(id: string, name: string): string {
    return getNpcAppearance(id, name).tunic;
  }

  protected isDog(id: string, name: string): boolean {
    return Boolean(getNpcAppearance(id, name).isDog);
  }
}
