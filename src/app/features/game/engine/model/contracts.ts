import { InjectionToken } from '@angular/core';
import type { Signal } from '@angular/core';
import type { Level, LocalizedText, NpcConfig } from '@features/game/engine/model/level';

/**
 * What the game needs from the AI, and nothing more. The engine depends only on
 * these contracts, so prompts and models can change without touching the game.
 */

export interface Verdict {
  readonly solved: boolean;
  readonly npcReply: string;
}

/** Decides whether a conjured object solves a villager's problem. */
export interface Referee {
  /** Throws when it cannot answer at all; the dialogue box then offers a retry. */
  judge(npc: NpcConfig, object: string): Promise<Verdict>;
}

export const REFEREE = new InjectionToken<Referee>('Referee');

export type InventionPhase = 'idle' | 'working' | 'failed';

/** Writes a level that no file contains. */
export interface LevelInventor {
  readonly phase: Signal<InventionPhase>;
  readonly done: Signal<number>;
  readonly total: Signal<number>;
  readonly progress: Signal<number>;
  readonly error: Signal<string | null>;

  invent(title: LocalizedText): Promise<Level>;
}

export const LEVEL_INVENTOR = new InjectionToken<LevelInventor>('LevelInventor');

export type RecognitionPhase = 'idle' | 'loading' | 'looking';

/** Names what the player holds up to the camera, so it can be written into the book. */
export interface ObjectRecognizer {
  readonly phase: Signal<RecognitionPhase>;
  readonly progress: Signal<number>;

  /** Starts loading the vision model early, while the player frames the shot. */
  prepare(): void;

  /** Takes a `data:image/...` URL; throws when there is nothing it can name. */
  recognize(image: string): Promise<string>;
}

export const OBJECT_RECOGNIZER = new InjectionToken<ObjectRecognizer>('ObjectRecognizer');
