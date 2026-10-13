import { Service, inject } from '@angular/core';
import { LANGUAGE_NAMES, WRITE_IN_LANGUAGE, type Locale } from '@core/i18n/model/locale';
import { LocaleService } from '@core/i18n/locale.service';
import { WebLlmService } from '@core/webllm/web-llm.service';
import { log } from '@core/logger/logger';
import { text, type NpcConfig } from '@features/game/engine/model/level';
import type { Referee, Verdict } from '@features/game/engine/model/contracts';
import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

/** A villager who says nothing is a failed answer, so it is worth asking twice. */
const ATTEMPTS = 2;

/**
 * Field order is load-bearing. Constrained decoding fills these in the order
 * they are declared, so the model reasons first, commits to a verdict second,
 * and only then writes the line the villager speaks — which is therefore
 * conditioned on the verdict instead of drifting away from it.
 */
const VERDICT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    solved: { type: 'boolean' },
    npcReply: { type: 'string' },
  },
  required: ['reasoning', 'solved', 'npcReply'],
});

/**
 * Everything the model is told about the job of judging, and nothing else.
 *
 * The order to speak the player's language lives here, among the rules. It used
 * to be the last line of the user block, where every line reads `KEY: value` —
 * so `npcReply: Scrivi in italiano` looked exactly like the answer being handed
 * to the model, and the smallest ones simply copied it out as the villager's
 * line. An instruction formatted like data is read as data.
 */
function judgeRules(locale: Locale): string {
  const language = LANGUAGE_NAMES[locale];

  return [
    'You are the referee inside a magic book in a fantasy game.',
    'A villager has a problem. The player conjures one object. You decide whether that object solves it.',
    '',
    'Rules:',
    '1. Judge only whether the OBJECT would plausibly solve the PROBLEM in a fairytale world.',
    '2. SOLUTION_HINT says what counts and what does not, and it overrules your own judgement.',
    '   Never accept something it excludes. Accept an object it does not name only when that object',
    '   clearly belongs to one of the kinds it does name. If it belongs to none of them, reject it.',
    '3. An object that would hurt, endanger or frighten the villager does not solve their problem,',
    '   however well it would otherwise work.',
    '4. Reject an object that merely restates the solution ("something that fixes it", "a wish", "a solution").',
    '5. "reasoning" is one short sentence for yourself, in English, naming which kind from',
    '   SOLUTION_HINT the object belongs to, or that it belongs to none. Decide "solved" from it.',
    '   The player never sees it.',
    '6. npcReply is one or two sentences spoken by the villager in first person, in their TEMPER.',
    '   It is never empty: the villager always answers, in their own voice.',
    '7. npcReply must agree with "solved". If "solved" is false the villager is still stuck, so they',
    '   must not thank the player, accept the object as a fix, or say that it works. If "solved" is',
    '   true they must not ask for anything further.',
    '8. The villager never mentions rules, judging, the hint, or the book itself.',
    '9. TEMPER changes the wording only. It must never change the value of "solved".',
    `10. Write npcReply in ${language} even if the word it's an english one. Keep "reasoning" in English.`,
    `    ${WRITE_IN_LANGUAGE[locale]}`,
    '11. Answer with JSON only.',
  ].join('\n');
}

const ENGLISH_OBJECT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { english: { type: 'string' } },
  required: ['english'],
});

function translateObjectPrompt(object: string, locale: Locale): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: [
        `You translate a short noun phrase from ${LANGUAGE_NAMES[locale]} into English. Answer with JSON only.`,
        'Rules:',
        '1. "english" is the plain English name of the object (e.g. "bastone" -> "a stick", "carrello" -> "a cart").',
        '2. If the word is already in English, keep it as is.',
      ].join('\n'),
    },
    { role: 'user', content: `OBJECT: ${object}` },
  ];
}

/**
 * One wish, weighed against one villager's problem. The problem is handed over
 * in English whatever the player reads, because the reasoning is done in
 * English; only the villager's spoken line is asked for in their language.
 *
 * @param npc The villager being spoken to, temper and hidden hint included.
 * @param object The conjured object (in English, so it matches SOLUTION_HINT).
 * @param locale The language the villager must answer in.
 */
function judgePrompt(npc: NpcConfig, object: string, locale: Locale): ChatCompletionMessageParam[] {
  return [
    { role: 'system', content: judgeRules(locale) },
    {
      role: 'user',
      content: [
        `VILLAGER: ${npc.name}`,
        `TEMPER: ${npc.temper}`,
        `PROBLEM: ${text(npc.problem, 'en')}`,
        `SOLUTION_HINT: ${npc.solutionHint}`,
        `OBJECT: ${object}`,
      ].join('\n'),
    },
  ];
}

/** Turns the local model into the game's referee. One call per wish. */
@Service()
export class JudgeService implements Referee {
  private readonly llm = inject(WebLlmService);
  private readonly locale = inject(LocaleService);

  private async toEnglishObject(object: string, locale: Locale): Promise<string> {
    if (locale === 'en') {
      return object;
    }
    try {
      const raw = await this.llm.queryModel(translateObjectPrompt(object, locale), {
        schema: ENGLISH_OBJECT_SCHEMA,
        maxTokens: 40,
        temperature: 0,
        purpose: `translate wish "${object}" → en`,
      });
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
        const en = typeof parsed['english'] === 'string' ? parsed['english'].trim() : '';
        if (en.length > 0) {
          return `${en} (${object})`;
        }
      }
    } catch {
      // Fall back to the original object string if translation fails.
    }
    return object;
  }

  /**
   * Weighs one conjured object against one villager's problem, at temperature
   * zero so that the same wish twice gets the same answer twice. The model sees
   * only this wish — never the ones before it — so each attempt stands alone.
   *
   * @param npc The villager whose problem is at stake.
   * @param object What the player wrote into the book.
   * @returns The verdict, and the line the villager says about it.
   * @throws When two attempts in a row come back unreadable or silent; the
   * dialogue box turns that into "the book's ink ran dry" and offers a retry.
   */
  async judge(npc: NpcConfig, object: string): Promise<Verdict> {
    const locale = this.locale.locale();
    const judgedObject = await this.toEnglishObject(object, locale);
    const messages = judgePrompt(npc, judgedObject, locale);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const raw = await this.llm.queryModel(messages, {
          schema: VERDICT_SCHEMA,
          maxTokens: 220,
          purpose: `judge "${object}" for ${npc.name}`,
        });
        const { verdict, reasoning } = parseVerdict(raw);
        logVerdict(npc, object, verdict, reasoning, attempt);
        return verdict;
      } catch (cause) {
        lastError = cause;
        log.warn(
          'judge',
          `attempt ${attempt} of ${ATTEMPTS} for ${npc.name} gave no usable verdict`,
          cause instanceof Error ? cause.message : cause,
        );
      }
    }

    throw lastError instanceof Error ? lastError : new Error('The book gave no answer.');
  }
}

/**
 * The verdict as the room should see it: the model's private reasoning — which
 * the player never reads — beside the rule it was meant to follow. This is
 * where a wrong answer shows whether the model misread the hint or ignored it.
 */
function logVerdict(
  npc: NpcConfig,
  object: string,
  verdict: Verdict,
  reasoning: string,
  attempt: number,
): void {
  const outcome = verdict.solved ? 'SOLVED' : 'rejected';
  log.group(
    'judge',
    `${npc.name} · "${object}" → ${outcome}`,
    () => {
      console.log(
        '%creasoning (hidden from the player)%c\n' + (reasoning || '(none)'),
        'font-weight:700',
        'color:inherit',
      );
      console.log(
        '%csolution hint it was given%c\n' + npc.solutionHint,
        'font-weight:700',
        'color:inherit',
      );
      console.log('%cthe villager says%c\n' + verdict.npcReply, 'font-weight:700', 'color:inherit');
      console.log('temper', npc.temper);
      if (attempt > 1) {
        console.log(`needed ${attempt} attempts`);
      }
    },
    true,
  );
}

/**
 * Reads the verdict out of whatever the model wrote, which is JSON by
 * construction but occasionally wrapped in a sentence.
 *
 * @throws When there is no object to read, or the villager said nothing.
 */
function parseVerdict(raw: string): { verdict: Verdict; reasoning: string } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('The book wrote something unreadable.');
  }

  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The book wrote something unreadable.');
  }

  const record = parsed as Record<string, unknown>;
  const reply = typeof record['npcReply'] === 'string' ? record['npcReply'].trim() : '';

  // Every line a villager speaks comes from the model, in their own temper.
  // An empty one is a failed answer, not something to paper over.
  if (reply === '') {
    throw new Error('The villager said nothing.');
  }

  const reasoning = typeof record['reasoning'] === 'string' ? record['reasoning'].trim() : '';
  return { verdict: { solved: record['solved'] === true, npcReply: reply }, reasoning };
}
