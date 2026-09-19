import { InjectionToken } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Level, LocalizedText, NpcConfig } from '@features/game/engine/model/level';

/**
 * What the game asks of whatever is playing referee and author, and nothing
 * more. The engine depends on these two contracts; it never names the classes
 * behind them, so prompts, models and even the whole approach can be replaced
 * without a line of the game changing.
 */

export interface Verdict {
  readonly solved: boolean;
  readonly npcReply: string;
}

/** Decides whether a conjured object solves a villager's problem. */
export interface Referee {
  /**
   * Answers for one wish. Throws when it cannot answer at all; the dialogue
   * box turns that into "the book's ink ran dry" and offers a retry.
   */
  judge(npc: NpcConfig, object: string): Promise<Verdict>;
}

export const REFEREE = new InjectionToken<Referee>('Referee');

export type InventionPhase = 'idle' | 'working' | 'failed';

/** Writes a level that no file contains. */
export interface LevelInventor {
  /** How far along it is, so a loading screen has something honest to show. */
  readonly phase: Signal<InventionPhase>;
  readonly done: Signal<number>;
  readonly total: Signal<number>;
  readonly progress: Signal<number>;
  readonly error: Signal<string | null>;

  invent(title: LocalizedText): Promise<Level>;
}

export const LEVEL_INVENTOR = new InjectionToken<LevelInventor>('LevelInventor');
