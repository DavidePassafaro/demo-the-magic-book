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

/** `loading` is the first time only: the eye is a separate, larger model. */
export type RecognitionPhase = 'idle' | 'loading' | 'looking';

/** Names what the player holds up to the camera, so it can be written into the book. */
export interface ObjectRecognizer {
  readonly phase: Signal<RecognitionPhase>;
  /** How far the eye has loaded, 0 to 1, while `phase` is `loading`. */
  readonly progress: Signal<number>;

  /**
   * Starts waking the eye without waiting for it, so that the download runs
   * while the player is still framing the object rather than after.
   */
  prepare(): void;

  /**
   * @param image A photo, as a `data:image/...` URL.
   * @returns The object's name, in one or two words.
   * @throws When there is nothing in the photo the eye can name.
   */
  recognize(image: string): Promise<string>;
}

export const OBJECT_RECOGNIZER = new InjectionToken<ObjectRecognizer>('ObjectRecognizer');
