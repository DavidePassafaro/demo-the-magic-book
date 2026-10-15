import { Service, computed, inject, signal } from '@angular/core';
import { LOCALES, type Locale } from '@core/i18n/model/locale';
import { WebLlmService } from '@core/webllm/web-llm.service';
import { elapsed, log } from '@core/logger/logger';
import {
  RANDOM_LEVEL_ID,
  THEMES,
  type Level,
  type LocalizedText,
  type NpcConfig,
  type Theme,
} from '@features/game/engine/model/level';
import type { InventionPhase, LevelInventor } from '@features/game/engine/model/contracts';
import {
  VILLAGER_SCHEMA,
  VILLAGER_TOPICS,
  villagerPrompt,
} from '@features/game/ai/prompts/villager.prompt';
import { TRANSLATION_SCHEMA, sentencePrompt } from '@features/game/ai/prompts/translate.prompt';
import { parseJson, requiredField } from '@features/game/ai/parse-json';

const VILLAGERS = 3;
const ATTEMPTS_PER_VILLAGER = 2;

/** Villagers are invented in English, then translated into every other language. */
const TRANSLATED_INTO: readonly Locale[] = LOCALES.map((option) => option.id).filter(
  (id) => id !== 'en',
);
const STEPS_PER_VILLAGER = 1 + TRANSLATED_INTO.length;

/** Invents a level with the local model, in the same shape a level file has. */
@Service()
export class LevelGeneratorService implements LevelInventor {
  private readonly llm = inject(WebLlmService);

  readonly phase = signal<InventionPhase>('idle');
  readonly done = signal(0);
  readonly total = signal(VILLAGERS);
  readonly error = signal<string | null>(null);

  private readonly steps = signal(0);
  readonly progress = computed(() => this.steps() / (VILLAGERS * STEPS_PER_VILLAGER));

  async invent(title: LocalizedText): Promise<Level> {
    this.phase.set('working');
    this.done.set(0);
    this.steps.set(0);
    this.error.set(null);

    const started = performance.now();

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
      log.info('inventor', `village invented in ${elapsed(started)}`);
      return { id: RANDOM_LEVEL_ID, title, theme, seed, width: 24, height: 18, npcs };
    } catch (cause) {
      log.error('inventor', 'the village could not be invented', cause);
      this.phase.set('failed');
      this.error.set(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  private async inventVillager(
    topic: string,
    index: number,
    existing: readonly NpcConfig[],
  ): Promise<NpcConfig> {
    const messages = villagerPrompt(
      topic,
      existing.map((npc) => npc.name),
    );
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_VILLAGER; attempt++) {
      try {
        const raw = await this.llm.queryModel(messages, {
          schema: VILLAGER_SCHEMA,
          maxTokens: 420,
          purpose: `invent villager ${index + 1} of ${VILLAGERS} (${topic})`,
          // The only non-zero temperature in the game: inventing wants variety.
          // 👇👇👇 Game - Creative temperature
          temperature: 0.7,
        });
        const villager = parseVillager(raw, index);
        this.steps.update((step) => step + 1);
        return villager;
      } catch (cause) {
        lastError = cause;
        log.warn('inventor', `villager ${index + 1}, attempt ${attempt} failed`, cause);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('The book could not think of another villager.');
  }

  /** A failed translation is skipped: the villager simply stays in English. */
  private async translateVillager(npc: NpcConfig): Promise<NpcConfig> {
    const said: Partial<Record<Locale, string>> = {};

    for (const locale of TRANSLATED_INTO) {
      try {
        const raw = await this.llm.queryModel(sentencePrompt(npc.problem.en, locale), {
          schema: TRANSLATION_SCHEMA,
          maxTokens: 260,
          purpose: `translate ${npc.name} → ${locale}`,
        });
        said[locale] = requiredField(parseJson(raw), 'translation');
      } catch (cause) {
        log.warn('inventor', `${npc.name} stays in English: ${locale} translation failed`, cause);
      }
      this.steps.update((step) => step + 1);
    }

    return { ...npc, problem: { ...said, en: npc.problem.en } };
  }
}

function parseVillager(raw: string, index: number): NpcConfig {
  const record = parseJson(raw);
  let solutionHint = requiredField(record, 'solutionHint').replace(/[[\]]/g, '');

  // A bare list from a small model: make it clear to the judge that these are valid solutions.
  if (!/\b(accept|anything|solved|work|works)\b/i.test(solutionHint)) {
    solutionHint = `Anything such as: ${solutionHint}`;
  }

  return {
    id: `invented-${index}`,
    name: requiredField(record, 'name'),
    temper: requiredField(record, 'temper'),
    problem: { en: requiredField(record, 'problem') },
    solutionHint,
  };
}
