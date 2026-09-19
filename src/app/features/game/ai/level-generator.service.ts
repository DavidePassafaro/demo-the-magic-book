import { Service, computed, inject, signal } from '@angular/core';
import { LANGUAGE_NAMES, LOCALES, WRITE_IN_LANGUAGE, type Locale } from '@core/i18n/model/locale';
import { WebLlmService } from '@core/webllm/web-llm.service';
import {
  RANDOM_LEVEL_ID,
  THEMES,
  type Level,
  type LocalizedText,
  type NpcConfig,
  type Theme,
} from '@features/game/engine/model/level';
import type { InventionPhase, LevelInventor } from '@features/game/engine/model/contracts';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

const VILLAGERS = 3;
const ATTEMPTS_PER_VILLAGER = 2;

/**
 * The village is invented in English and then said again in every other
 * language the game speaks, so that switching language mid-game rewrites the
 * villagers instead of leaving them stranded in the language of their birth.
 */
const TRANSLATED_INTO: readonly Locale[] = LOCALES.map((option) => option.id).filter(
  (id) => id !== 'en',
);

/** Inventing a villager, then saying them again once per other language. */
const STEPS_PER_VILLAGER = 1 + TRANSLATED_INTO.length;

// --------------------------------------------------------- inventing a villager

/**
 * Field order matters here as it does in the judge: the problem is written
 * before the hint, so the hint is invented for that problem rather than the
 * other way round.
 */
const VILLAGER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string' },
    temper: { type: 'string' },
    problem: { type: 'string' },
    solutionHint: { type: 'string' },
  },
  required: ['name', 'temper', 'problem', 'solutionHint'],
});

/**
 * A nudge, not a script: each villager is asked for around one everyday place,
 * so three calls to the same model do not come back as three lamplighters.
 */
const VILLAGER_TOPICS: readonly string[] = [
  'a kitchen',
  'a river',
  'a roof',
  'a forest path',
  'a market stall',
  'a bell tower',
  'a garden',
  'a stable',
  'a library',
  'a bridge',
  'a beehive',
  'a fishing boat',
  'a mine',
  'a bakery',
  'a well',
  'a lighthouse',
  'a school room',
  'a windmill',
];

/**
 * Everything here is English, including the problem the player will read. These
 * models invent far better in English than in anything else, so the village is
 * imagined in English first and said again in the other languages afterwards.
 */
function villagerRules(): string {
  return [
    'You invent villagers for a fantasy puzzle game. Answer with JSON only.',
    '',
    'Rules:',
    '1. "name" is one invented first name. No titles, no surnames.',
    '2. "temper" is one sentence saying how this villager speaks.',
    '3. "problem" is one or two sentences, spoken by the villager in first person.',
    '   It states a practical everyday difficulty that ONE ordinary object would solve. Never a',
    '   quest, never a mystery, never something needing several things at once.',
    '4. "solutionHint" is never shown to the player. Name four or five kinds of',
    '   object that would solve the problem, then two or three kinds that would obviously not,',
    '   and end with the words "Reject everything else."',
    '5. The problem must have an obvious everyday solution. If you cannot name four kinds of',
    '   object that solve it, invent a simpler problem.',
    '6. Write every field in English.',
  ].join('\n');
}

/**
 * One villager, around one topic, unlike the ones already invented.
 *
 * @param topic The everyday place their trouble is about.
 * @param alreadyInvented Names taken by their neighbours, not to be reused.
 */
function villagerPrompt(
  topic: string,
  alreadyInvented: readonly string[],
): ChatCompletionMessageParam[] {
  const taken = alreadyInvented.join(', ');

  return [
    { role: 'system', content: villagerRules() },
    {
      role: 'user',
      content: [
        `TOPIC: the problem is about ${topic}.`,
        taken
          ? `ALREADY INVENTED, do not repeat these names: ${taken}.`
          : 'This is the first villager.',
      ].join('\n'),
    },
  ];
}

// ------------------------------------------------ saying it in another language

/**
 * One sentence in, one sentence out. Translating is the one job a small model
 * does far better than inventing in a language it barely speaks, and keeping it
 * in its own call means a translation that goes wrong costs only itself: the
 * English original is still there for `text()` to fall back on.
 */
const TRANSLATION_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { translation: { type: 'string' } },
  required: ['translation'],
});

/**
 * The villager's own words, said again in another language.
 *
 * @param sentence The English original, exactly as the model wrote it.
 * @param locale The language to say it in.
 */
function translatePrompt(sentence: string, locale: Locale): ChatCompletionMessageParam[] {
  const language = LANGUAGE_NAMES[locale];

  return [
    {
      role: 'system',
      content: [
        `You translate one sentence into ${language}. Answer with JSON only.`,
        '',
        'Rules:',
        `1. "translation" is the same sentence in ${language}. Every word of it.`,
        `   ${WRITE_IN_LANGUAGE[locale]}`,
        '2. The same person is still speaking, in first person, in the same mood.',
        '3. Translate it. Do not answer it, do not add to it, do not explain it.',
        '4. Keep it the same length: one or two sentences.',
      ].join('\n'),
    },
    // Nothing but the sentence: an instruction down here would be one more
    // thing to translate, or to copy out verbatim.
    { role: 'user', content: `SENTENCE: ${sentence}` },
  ];
}

/** Invents a level with the local model, in the shape a level file would have. */
@Service()
export class LevelGeneratorService implements LevelInventor {
  private readonly llm = inject(WebLlmService);

  readonly phase = signal<InventionPhase>('idle');
  readonly done = signal(0);
  readonly total = signal(VILLAGERS);
  readonly error = signal<string | null>(null);

  /** Counted in steps, not villagers, so the bar moves twice per person. */
  private readonly steps = signal(0);
  readonly progress = computed(() => this.steps() / (VILLAGERS * STEPS_PER_VILLAGER));

  /**
   * Writes a whole level from nothing: three villagers, each invented and then
   * translated, dropped into the same object a level file would have parsed to.
   * The engine cannot tell the difference, which is the point.
   *
   * @param title The level's name, already in every language.
   * @returns A level ready for `startLevel()`, map and all.
   * @throws When a villager cannot be invented twice running — without three of
   * them there is no level, so the whole thing fails and offers a retry.
   */
  async invent(title: LocalizedText): Promise<Level> {
    this.phase.set('working');
    this.done.set(0);
    this.steps.set(0);
    this.error.set(null);

    try {
      const seed = Math.floor(Math.random() * 2_000_000_000);
      const theme = THEMES[Math.floor(Math.random() * THEMES.length)] as Theme;
      const topics = [...VILLAGER_TOPICS].sort(() => Math.random() - 0.5).slice(0, VILLAGERS);
      const npcs: NpcConfig[] = [];

      for (const [index, topic] of topics.entries()) {
        const villager = await this.inventVillager(topic, index, npcs);
        npcs.push(await this.translateVillager(villager));
        this.done.set(index + 1);
      }

      this.phase.set('idle');

      return { id: RANDOM_LEVEL_ID, title, theme, seed, width: 24, height: 18, npcs };
    } catch (cause) {
      this.phase.set('failed');
      this.error.set(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  /**
   * One villager, in English, at the only temperature in the game that is not
   * zero: inventing wants variety where judging wants repeatability.
   *
   * @param topic The everyday place their trouble is about.
   * @param index Their position in the village, which becomes their id.
   * @param existing The neighbours already invented, so names are not reused.
   * @throws When both attempts come back unreadable or incomplete.
   */
  private async inventVillager(
    topic: string,
    index: number,
    existing: readonly NpcConfig[],
  ): Promise<NpcConfig> {
    const names = existing.map((npc) => npc.name);
    const messages = villagerPrompt(topic, names);

    let lastError: unknown = null;

    for (let attempt = 0; attempt < ATTEMPTS_PER_VILLAGER; attempt++) {
      try {
        const raw = await this.llm.queryModel(messages, {
          schema: VILLAGER_SCHEMA,
          maxTokens: 420,
          // Inventing wants variety, so this is the one call that is not at zero.
          temperature: 0.7,
        });
        const villager = parseVillager(raw, index);
        this.steps.update((step) => step + 1);
        return villager;
      } catch (cause) {
        lastError = cause;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('The book could not think of another villager.');
  }

  /**
   * Says the villager's problem again in each other language. A translation that
   * fails is simply left out rather than retried: `text()` falls back to the
   * English the judge reads anyway, so one stubborn sentence costs one villager
   * their Italian, not the village its existence.
   *
   * @param npc A villager who so far speaks only English.
   * @returns The same villager, with their problem in every language that worked.
   */
  private async translateVillager(npc: NpcConfig): Promise<NpcConfig> {
    const said: Partial<Record<Locale, string>> = {};

    for (const locale of TRANSLATED_INTO) {
      try {
        const raw = await this.llm.queryModel(translatePrompt(npc.problem.en, locale), {
          schema: TRANSLATION_SCHEMA,
          maxTokens: 260,
          temperature: 0,
        });
        said[locale] = field(parseObject(raw), 'translation');
      } catch {
        // Left in English on purpose: see above.
      }

      this.steps.update((step) => step + 1);
    }

    return { ...npc, problem: { ...said, en: npc.problem.en } };
  }
}

/** @throws When the model left the field out, or filled it with almost nothing. */
function field(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== 'string' || value.trim().length < 3) {
    throw new Error(`The book left "${key}" blank.`);
  }

  return value.trim();
}

/** The models like to wrap their JSON in a sentence, so take what is inside. */
function parseObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('The book wrote something unreadable.');
  }

  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The book wrote something unreadable.');
  }

  return parsed as Record<string, unknown>;
}

/** One villager as the game holds them, with the problem still English-only. */
function parseVillager(raw: string, index: number): NpcConfig {
  const record = parseObject(raw);

  return {
    id: `invented-${index}`,
    name: field(record, 'name'),
    temper: field(record, 'temper'),
    problem: { en: field(record, 'problem') },
    solutionHint: field(record, 'solutionHint'),
  };
}
