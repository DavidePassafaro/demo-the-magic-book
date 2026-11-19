import type { ChatMessage } from '@core/llm/language-model';

/** The problem is written before the hint, so the hint is invented for that problem. */
export const VILLAGER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string' },
    temper: { type: 'string' },
    problem: { type: 'string' },
    solutionHint: { type: 'string' },
  },
  required: ['name', 'temper', 'problem', 'solutionHint'],
});

/** One topic per villager, so three calls do not return three lamplighters. */
export const VILLAGER_TOPICS: readonly string[] = [
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

/** In English: small models invent far better in English, then we translate. */
function villagerRules(): string {
  return [
    'You invent villagers for a fantasy puzzle game. Answer with JSON only.',
    '',
    'Rules:',
    '1. "name" is one invented first name. No titles, no surnames.',
    '2. "temper" is one sentence about this villager\'s tone of voice, such as "gruff and short".',
    '   Only how they sound: no actions, gestures or laughter.',
    '3. "problem" is one or two sentences, spoken by the villager in first person.',
    '   It states a practical everyday difficulty that ONE ordinary object would solve. Never a',
    '   quest, never a mystery, never something needing several things at once.',
    '4. "solutionHint" is never shown to the player. Name four or five kinds of',
    '   object that would solve the problem, then two or three kinds that would obviously not,',
    '   and end with the words "Reject everything else."',
    '   Example: "Anything that carries books: a basket, a backpack, a cart, a box, a crate. A hammer or a rope does not work. Reject everything else."',
    '5. The problem must have an obvious everyday solution. If you cannot name four kinds of',
    '   object that solve it, invent a simpler problem.',
    '6. Write every field in English.',
  ].join('\n');
}

export function villagerPrompt(topic: string, alreadyInvented: readonly string[]): ChatMessage[] {
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
