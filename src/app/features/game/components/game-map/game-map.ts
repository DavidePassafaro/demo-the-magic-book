import { Component, computed, inject, input, output } from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import type { GameMap } from '@features/game/engine/map-generator';
import type { Facing, NpcProgress } from '@features/game/engine/game.service';

const TILE = 40;
const VIEW_COLS = 15;
const VIEW_ROWS = 11;

@Component({
  selector: 'mb-game-map',
  host: {
    '[attr.data-theme]': 'map().theme',
  },
  templateUrl: './game-map.html',
  styleUrl: './game-map.scss',
})
export class GameMapView {
  readonly map = input.required<GameMap>();
  readonly playerX = input.required<number>();
  readonly playerY = input.required<number>();
  readonly facing = input.required<Facing>();
  readonly progress = input.required<Record<string, NpcProgress>>();

  readonly talk = output<string>();

  private readonly t = inject(LocaleService).t;

  protected readonly tileSize = TILE;
  protected readonly viewWidth = VIEW_COLS * TILE;
  protected readonly viewHeight = VIEW_ROWS * TILE;

  /** Keeps the player pinned to the centre while the world slides underneath. */
  protected readonly worldTransform = computed(() => {
    const x = (VIEW_COLS / 2 - this.playerX() - 0.5) * TILE;
    const y = (VIEW_ROWS / 2 - this.playerY() - 0.5) * TILE;
    return `translate(${x}px, ${y}px)`;
  });

  protected floor(value: number): number {
    return Math.floor(value);
  }

  protected npcLabel(id: string, name: string): string {
    return this.progress()[id]?.solved ? this.t().talkAgain(name) : this.t().talkTo(name);
  }
}
