/**
 * Shapes the game shares with its AI services. The services themselves no
 * longer hide behind tokens: they are model-agnostic, and the seam that can be
 * swapped is the model they talk to (`LanguageModel`, `VisionModel`).
 */

export interface Verdict {
  readonly solved: boolean;
  readonly npcReply: string;
}

export type InventionPhase = 'idle' | 'working' | 'failed';

export type RecognitionPhase = 'idle' | 'loading' | 'looking';
