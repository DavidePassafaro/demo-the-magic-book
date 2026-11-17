/** Shapes the game shares with its AI services. */

export interface Verdict {
  readonly solved: boolean;
  readonly npcReply: string;
}

export type InventionPhase = 'idle' | 'working' | 'failed';

export type RecognitionPhase = 'idle' | 'loading' | 'looking';
