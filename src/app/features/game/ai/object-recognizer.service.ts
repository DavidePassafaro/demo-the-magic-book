import { Service, computed, inject, signal } from '@angular/core';
import { WebLlmService } from '@core/webllm/web-llm.service';
import { log } from '@core/logger/logger';
import type { ObjectRecognizer, RecognitionPhase } from '@features/game/engine/model/contracts';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

/**
 * Field order is load-bearing, exactly as in the judge. The model first writes
 * down what is physically in front of the camera, and only then picks a noun
 * for it — so the name is conditioned on a literal description instead of on
 * what the scene seems to mean. Asked for the name straight away, an open hand
 * came back as "stop".
 */
const OBJECT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    seen: { type: 'string' },
    object: { type: 'string' },
  },
  required: ['seen', 'object'],
});

/** What the eye says when there is nothing it can name. */
const NOTHING = 'nothing';

/**
 * Everything the vision model is told. The name comes back in English whatever
 * the player reads: English is the language these models see best in, and the
 * judge reasons in English anyway, so it is also the word the judge weighs most
 * reliably.
 */
function recognitionRules(): string {
  return [
    'This is a photo from a webcam. Someone is showing something to the camera.',
    'Say what the thing IS, never what it means.',
    '',
    'Rules:',
    '1. "seen" is one short plain sentence saying what is physically in the middle of the',
    '   photo: its shape, material and colour. Describe it. Do not interpret it.',
    '2. "object" is the name of that thing: one or two English words, lowercase, no article.',
    '   Always a concrete noun, the way it would be written on a shopping list — never a verb,',
    '   an adjective, a command, a greeting or a feeling.',
    '3. A gesture is not a word. Name the body part, not the message:',
    '   an open hand is "hand", not "stop", "hello" or "five";',
    '   a raised thumb is "hand", not "yes", "like" or "good";',
    '   a pointing finger is "finger", not "there" or "you".',
    '4. If a hand is holding something, name what it holds: a hand holding a mug is "mug".',
    '   The hand itself is the object only when it holds nothing.',
    '5. Do not read writing out loud: a sheet with a word written on it is "paper",',
    '   a phone showing a picture is "phone".',
    '6. Never name the person, the face, the room or the background.',
    `7. If there is nothing you can name with confidence, "object" is "${NOTHING}".`,
    '8. Answer with JSON only.',
  ].join('\n');
}

/**
 * The photo and the rules in a single user turn. WebLLM allows only one text
 * part per message, and a system turn is exactly what a model's template may
 * not have — so the rules travel with the question instead of before it.
 *
 * @param image A photo, as a `data:image/...` URL.
 */
function recognitionPrompt(image: string): ChatCompletionMessageParam[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: recognitionRules() },
      ],
    },
  ];
}

/** Lets the player show the book an object instead of typing its name. */
@Service()
export class ObjectRecognizerService implements ObjectRecognizer {
  private readonly llm = inject(WebLlmService);
  private readonly looking = signal(false);

  readonly progress = this.llm.visionProgress;

  readonly phase = computed<RecognitionPhase>(() => {
    if (this.llm.visionStatus() === 'loading') {
      return 'loading';
    }
    return this.looking() ? 'looking' : 'idle';
  });

  /** Opening the camera starts the four-gigabyte download; nobody waits on it here. */
  prepare(): void {
    void this.llm.loadVision();
  }

  /**
   * Names the object in one photo, at temperature zero: the same object held up
   * twice should get the same name twice.
   *
   * @param image A photo, as a `data:image/...` URL.
   * @returns The object's name, lowercase, in one or two words.
   * @throws When the eye cannot be opened, the answer is unreadable, or there is
   * nothing in the photo it can name.
   */
  async recognize(image: string): Promise<string> {
    if (!(await this.llm.loadVision())) {
      throw new Error(this.llm.visionError() ?? 'The book could not open its eye.');
    }

    this.looking.set(true);

    try {
      const raw = await this.llm.queryVision(recognitionPrompt(image), {
        schema: OBJECT_SCHEMA,
        // Room for the description as well as the name.
        maxTokens: 100,
        purpose: 'name the object in the photo',
      });
      const { name, seen } = parseObjectName(raw);
      log.info('eye', `it sees: "${name}" — written into the book, not yet conjured`, seen);
      return name;
    } catch (cause) {
      log.warn('eye', 'no name for this photo', cause instanceof Error ? cause.message : cause);
      throw cause;
    } finally {
      this.looking.set(false);
    }
  }
}

/**
 * Reads the name out of the model's answer.
 *
 * @throws When there is no answer to read, or the answer is that there is nothing.
 */
function parseObjectName(raw: string): { name: string; seen: string } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('The book wrote something unreadable.');
  }

  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const value = record['object'];
  const seen = typeof record['seen'] === 'string' ? record['seen'].trim() : '';

  const name =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[.!?,;:]+$/, '')
      : '';

  if (name === '' || name === NOTHING) {
    throw new Error('The book could not make out what you are showing it.');
  }

  return { name, seen };
}
