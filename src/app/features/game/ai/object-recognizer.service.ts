import { Service, computed, inject, signal } from '@angular/core';
import { VISION } from '@core/webllm/web-llm.providers';
import { log } from '@core/logger/logger';
import type { RecognitionPhase } from '@features/game/engine/model/contracts';
import {
  NOTHING,
  SEEN_OBJECT,
  recognitionPrompt,
} from '@features/game/ai/prompts/recognize.prompt';

/**
 * Lets the player show the book an object instead of typing its name.
 * Provided by the game route, so it uses whichever vision model the route binds.
 */
@Service({ autoProvided: false })
export class ObjectRecognizerService {
  private readonly eye = inject(VISION);
  private readonly looking = signal(false);

  readonly progress = this.eye.progress;

  readonly phase = computed<RecognitionPhase>(() => {
    if (this.eye.status() === 'loading') {
      return 'loading';
    }

    return this.looking() ? 'looking' : 'idle';
  });

  /** Starts loading (a ~4 GB download, locally) while the player is still framing the shot. */
  prepare(): void {
    void this.eye.load();
  }

  async recognize(image: string): Promise<string> {
    if (!(await this.eye.load())) {
      throw new Error(this.eye.error()?.message ?? 'The book could not open its eye.');
    }

    this.looking.set(true);

    try {
      // 👇👇👇 Game - Ask the vision model
      const reply = await this.eye.ask(recognitionPrompt(image), {
        schema: SEEN_OBJECT,
        maxTokens: 100,
        purpose: 'name the object in the photo',
      });

      const name = parseObjectName(reply.value.object);
      log.info('eye', `it sees: "${name}"`);

      return name;
    } finally {
      this.looking.set(false);
    }
  }
}

function parseObjectName(object: string): string {
  const name = object
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/, '');

  if (name === '' || name === NOTHING) {
    throw new Error('The book could not make out what you are showing it.');
  }

  return name;
}
