import { Service, computed, inject, signal } from '@angular/core';
import { LocaleService } from '@core/i18n/locale.service';
import { log } from '@core/logger/logger';
import { REFEREE } from '@features/game/engine/model/contracts';
import {
  generateMap,
  isWalkable,
  npcAt,
  tileAt,
  type GameMap,
  type PlacedNpc,
} from '@features/game/engine/map-generator';
import type { Level, NpcConfig } from '@features/game/engine/model/level';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface NpcProgress {
  readonly solved: boolean;
  readonly object: string | null;
  /** What the villager said when it was solved, kept for return visits. */
  readonly reply: string | null;
}

export interface Attempt {
  readonly object: string;
  readonly reply: string;
  readonly solved: boolean;
}

const STEPS: Record<Facing, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Everything that is true about the level currently being played. Provided by
 * the game route rather than the application, so it resolves the referee from
 * the same injector the route sets up.
 */
@Service({ autoProvided: false })
export class GameService {
  private readonly referee = inject(REFEREE);
  private readonly locale = inject(LocaleService);

  readonly level = signal<Level | null>(null);
  readonly map = signal<GameMap | null>(null);
  readonly playerX = signal(0);
  readonly playerY = signal(0);
  readonly facing = signal<Facing>('down');
  readonly progress = signal<Record<string, NpcProgress>>({});

  readonly activeNpcId = signal<string | null>(null);
  /** Who the player has just walked away from, so they are not re-greeted instantly. */
  private readonly dismissed = signal<string | null>(null);
  /** Only the most recent wish is kept: the box shows one exchange at a time. */
  readonly lastAttempt = signal<Attempt | null>(null);
  readonly thinking = signal(false);
  readonly encounterError = signal<string | null>(null);

  readonly activeNpc = computed<NpcConfig | null>(() => {
    const id = this.activeNpcId();
    return this.map()?.npcs.find((npc) => npc.config.id === id)?.config ?? null;
  });

  /** The villager the player is standing in front of, if any. */
  readonly facingNpc = computed<PlacedNpc | null>(() => {
    const map = this.map();
    if (!map) {
      return null;
    }
    const step = STEPS[this.facing()];
    return npcAt(map, this.playerX() + step.dx, this.playerY() + step.dy);
  });

  readonly solvedCount = computed(
    () => Object.values(this.progress()).filter((entry) => entry.solved).length,
  );

  readonly allSolved = computed(() => {
    const map = this.map();
    return map !== null && map.npcs.length > 0 && this.solvedCount() === map.npcs.length;
  });

  /** A short description of the player's surroundings, for the live region. */
  readonly surroundings = computed(() => {
    const map = this.map();
    const strings = this.locale.t();

    if (!map) {
      return '';
    }

    const here = strings.tiles[tileAt(map, this.playerX(), this.playerY())] ?? '';
    const ahead = this.facingNpc();

    if (ahead) {
      return strings.facingSomeone(here, ahead.config.name);
    }

    const nearest = [...map.npcs]
      .map((npc) => ({
        npc,
        distance: Math.abs(npc.x - this.playerX()) + Math.abs(npc.y - this.playerY()),
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    return nearest
      ? strings.nearestVillager(here, nearest.npc.config.name, nearest.distance)
      : here;
  });

  startLevel(level: Level): void {
    const map = generateMap(level);
    log.group('game', `level "${level.title.en}" · ${level.npcs.length} villagers`, () => {
      console.log({
        id: level.id,
        theme: level.theme,
        seed: level.seed,
        size: `${level.width}×${level.height}`,
      });
      console.table(
        map.npcs.map((npc) => ({
          name: npc.config.name,
          x: npc.x,
          y: npc.y,
          hint: npc.config.solutionHint,
        })),
      );
    });
    this.level.set(level);
    this.map.set(map);
    this.playerX.set(map.spawn.x);
    this.playerY.set(map.spawn.y);
    this.facing.set('down');
    this.progress.set(
      Object.fromEntries(
        map.npcs.map((npc) => [
          npc.config.id,
          { solved: false, object: null, reply: null } satisfies NpcProgress,
        ]),
      ),
    );
    this.closeEncounter();
  }

  /**
   * Takes a step, and starts a conversation simply by coming face to face with
   * someone — no key to press. Walking off ends it, and the villager you just
   * left does not greet you again until you have turned away from them.
   */
  move(direction: Facing): void {
    const map = this.map();
    if (!map) {
      return;
    }

    this.facing.set(direction);
    const step = STEPS[direction];
    const nextX = this.playerX() + step.dx;
    const nextY = this.playerY() + step.dy;

    if (isWalkable(map, nextX, nextY)) {
      this.playerX.set(nextX);
      this.playerY.set(nextY);
    }

    const ahead = this.facingNpc();

    if (!ahead) {
      this.dismissed.set(null);
      return;
    }

    if (ahead.config.id !== this.dismissed()) {
      this.openEncounter(ahead.config.id);
    }
  }

  /** Whoever stands one step in the given direction, if anyone. */
  npcInDirection(direction: Facing): PlacedNpc | null {
    const map = this.map();
    if (!map) {
      return null;
    }
    const step = STEPS[direction];
    return npcAt(map, this.playerX() + step.dx, this.playerY() + step.dy);
  }

  /** Re-opens the dialogue with whoever the player is facing. */
  interact(): void {
    const ahead = this.facingNpc();
    if (ahead) {
      this.openEncounter(ahead.config.id);
    }
  }

  openEncounter(npcId: string): void {
    if (this.activeNpcId() !== npcId) {
      const name = this.map()?.npcs.find((npc) => npc.config.id === npcId)?.config.name;
      log.info('game', `talking to ${name ?? npcId}`);
    }
    this.activeNpcId.set(npcId);
    this.dismissed.set(null);
    this.lastAttempt.set(null);
    this.encounterError.set(null);
  }

  closeEncounter(): void {
    this.dismissed.set(this.activeNpcId());
    this.activeNpcId.set(null);
    this.lastAttempt.set(null);
    this.encounterError.set(null);
    this.thinking.set(false);
  }

  progressFor(npcId: string): NpcProgress {
    return this.progress()[npcId] ?? { solved: false, object: null, reply: null };
  }

  /**
   * Conjures an object and asks the judge about it. The model sees only this
   * wish, never the previous ones, so every attempt is weighed on its own.
   * A villager who has already been helped is not asked again.
   */
  async wish(object: string): Promise<void> {
    const npc = this.activeNpc();
    const trimmed = object.trim();

    if (!npc || trimmed === '' || this.thinking() || this.progressFor(npc.id).solved) {
      return;
    }

    this.thinking.set(true);
    this.encounterError.set(null);

    try {
      const verdict = await this.referee.judge(npc, trimmed);

      this.lastAttempt.set({ object: trimmed, reply: verdict.npcReply, solved: verdict.solved });

      if (verdict.solved) {
        this.progress.update((current) => ({
          ...current,
          [npc.id]: { solved: true, object: trimmed, reply: verdict.npcReply },
        }));
        const total = this.map()?.npcs.length ?? 0;
        log.info(
          'game',
          `${npc.name} helped with "${trimmed}" · ${this.solvedCount()} of ${total}`,
        );
        if (this.allSolved()) {
          log.info('game', 'every villager helped: level complete');
        }
      }
    } catch (cause) {
      log.error('game', `no verdict for "${trimmed}" (${npc.name})`, cause);
      this.encounterError.set(cause instanceof Error ? cause.message : this.locale.t().inkRanDry);
    } finally {
      this.thinking.set(false);
    }
  }
}
