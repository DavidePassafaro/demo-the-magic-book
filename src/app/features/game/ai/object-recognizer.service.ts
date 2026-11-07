import { Service, computed, inject, signal } from '@angular/core';
import { VisionModel } from '@core/llm/language-model';
import { log } from '@core/logger/logger';
import type { RecognitionPhase } from '@features/game/engine/model/contracts';
import {
  NOTHING,
  OBJECT_SCHEMA,
  recognitionPrompt,
} from '@features/game/ai/prompts/recognize.prompt';
import { parseJson, stringField } from '@features/game/ai/parse-json';

/**
 * Lets the player show the book an object instead of typing its name.
 * Provided by the game route, so it uses whichever vision model the route binds.
 */
@Service({ autoProvided: false })
export class ObjectRecognizerService {
  private readonly eye = inject(VisionModel);
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
      throw new Error(this.eye.error() ?? 'The book could not open its eye.');
    }

    this.looking.set(true);

    try {
      // 👇👇👇 Game - Ask the vision model
      const raw = await this.eye.query(recognitionPrompt(image), {
        schema: OBJECT_SCHEMA,
        maxTokens: 100,
        purpose: 'name the object in the photo',
      });

      const name = parseObjectName(raw);
      log.info('eye', `it sees: "${name}"`);

      return name;
    } finally {
      this.looking.set(false);
    }
  }
}

function parseObjectName(raw: string): string {
  const name = stringField(parseJson(raw), 'object')
    .toLowerCase()
    .replace(/[.!?,;:]+$/, '');

  if (name === '' || name === NOTHING) {
    throw new Error('The book could not make out what you are showing it.');
  }

  return name;
}
