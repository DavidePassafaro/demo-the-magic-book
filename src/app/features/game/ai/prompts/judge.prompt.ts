import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { LANGUAGE_NAMES, WRITE_IN_LANGUAGE, type Locale } from '@core/i18n/model/locale';
import { text, type NpcConfig } from '@features/game/engine/model/level';

/**
 * Field order matters: constrained decoding fills fields in order, so the model
 * reasons first, then decides, then speaks in line with its decision.
 */
// 👇👇👇 Prompt - Schema (field order matters)
export const VERDICT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    solved: { type: 'boolean' },
    npcReply: { type: 'string' },
  },
  required: ['reasoning', 'solved', 'npcReply'],
});

/**
 * The language instruction belongs here, among the rules: placed in the
 * `KEY: value` user block, small models copied it out as the villager's line.
 */
// 👇👇👇 Prompt - System rules
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

/**
 * One wish against one villager's problem. Everything is in English, where the
 * model reasons best; only the villager's reply is in the player's language.
 */
// 👇👇👇 Prompt - User message
export function judgePrompt(
  npc: NpcConfig,
  object: string,
  locale: Locale,
): ChatCompletionMessageParam[] {
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
