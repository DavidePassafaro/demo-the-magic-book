import { Service, computed, inject, signal } from '@angular/core';
import { WebLlmService } from '@core/webllm/web-llm.service';
import { log } from '@core/logger/logger';
import type { ObjectRecognizer, RecognitionPhase } from '@features/game/engine/model/contracts';
import {
  NOTHING,
  OBJECT_SCHEMA,
  recognitionPrompt,
} from '@features/game/ai/prompts/recognize.prompt';
import { parseJson, stringField } from '@features/game/ai/parse-json';

/** Lets the player show the book an object instead of typing its name. */
@Service()
export class ObjectRecognizerService implements ObjectRecognizer {
  private readonly llm = inject(WebLlmService);
  private readonly looking = signal(false);

  readonly progress = this.llm.vision.progress;

  readonly phase = computed<RecognitionPhase>(() => {
    if (this.llm.vision.status() === 'loading') {
      return 'loading';
    }
    return this.looking() ? 'looking' : 'idle';
  });

  /** Starts the ~4 GB download while the player is still framing the shot. */
  prepare(): void {
    void this.llm.loadVision();
  }

  async recognize(image: string): Promise<string> {
    if (!(await this.llm.loadVision())) {
      throw new Error(this.llm.vision.error() ?? 'The book could not open its eye.');
    }

    this.looking.set(true);
    try {
      // 👇👇👇 Game - Ask the vision model
      const raw = await this.llm.queryVision(recognitionPrompt(image), {
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
