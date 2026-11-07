import { Service, inject } from '@angular/core';
import type { Locale } from '@core/i18n/model/locale';
import { LocaleService } from '@core/i18n/locale.service';
import { LanguageModel } from '@core/llm/language-model';
import { log } from '@core/logger/logger';
import type { NpcConfig } from '@features/game/engine/model/level';
import type { Verdict } from '@features/game/engine/model/contracts';
import { VERDICT_SCHEMA, judgePrompt } from '@features/game/ai/prompts/judge.prompt';
import {
  TRANSLATION_SCHEMA,
  wishToEnglishPrompt,
} from '@features/game/ai/prompts/translate.prompt';
import { parseJson, stringField } from '@features/game/ai/parse-json';

/** A villager who says nothing is a failed answer, so it is worth asking twice. */
const ATTEMPTS = 2;

/**
 * Turns the language model into the game's referee: one call per wish.
 * Provided by the game route, so it uses whichever model the route binds.
 */
@Service({ autoProvided: false })
export class JudgeService {
  private readonly llm = inject(LanguageModel);
  private readonly locale = inject(LocaleService);

  /** Temperature zero: the same wish twice gets the same answer twice. */
  async judge(npc: NpcConfig, object: string): Promise<Verdict> {
    const locale = this.locale.locale();
    const messages = judgePrompt(npc, await this.toEnglish(object, locale), locale);

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        // 👇👇👇 Game - Prompt meets model
        const raw = await this.llm.query(messages, {
          schema: VERDICT_SCHEMA,
          maxTokens: 220,
          purpose: `judge "${object}" for ${npc.name}`,
        });

        const verdict = parseVerdict(raw);
        log.info('judge', `${npc.name} · "${object}" → ${verdict.solved ? 'SOLVED' : 'rejected'}`);

        return verdict;
      } catch (cause) {
        lastError = cause;
        log.warn('judge', `attempt ${attempt} of ${ATTEMPTS} gave no usable verdict`, cause);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('The book gave no answer.');
  }

  /** "bastone" becomes "a stick (bastone)"; on failure the wish is judged as typed. */
  private async toEnglish(object: string, locale: Locale): Promise<string> {
    if (locale === 'en') {
      return object;
    }

    try {
      const raw = await this.llm.query(wishToEnglishPrompt(object, locale), {
        schema: TRANSLATION_SCHEMA,
        maxTokens: 40,
        purpose: `translate wish "${object}" → en`,
      });

      const english = stringField(parseJson(raw), 'translation');
      return english ? `${english} (${object})` : object;
    } catch {
      return object;
    }
  }
}

function parseVerdict(raw: string): Verdict {
  const record = parseJson(raw);
  const npcReply = stringField(record, 'npcReply');

  if (npcReply === '') {
    throw new Error('The villager said nothing.');
  }

  return { solved: record['solved'] === true, npcReply };
}
