import { s, type ChatMessage } from 'ng-webllm';
import { LANGUAGE_NAMES, WRITE_IN_LANGUAGE, type Locale } from '@core/i18n/model/locale';

export const TRANSLATION = s.object({ translation: s.string() });

/** The player's wish, into English, so it can be matched against SOLUTION_HINT. */
export function wishToEnglishPrompt(object: string, locale: Locale): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        `You translate a short noun phrase from ${LANGUAGE_NAMES[locale]} into English. Answer with JSON only.`,
        'Rules:',
        '1. "translation" is the plain English name of the object (e.g. "bastone" -> "a stick", "carrello" -> "a cart").',
        '2. If the word is already in English, keep it as is.',
      ].join('\n'),
    },
    { role: 'user', content: `OBJECT: ${object}` },
  ];
}

/** A villager's English sentence, said again in another language. */
export function sentencePrompt(sentence: string, locale: Locale): ChatMessage[] {
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
    // Only the sentence: an instruction here would get translated too.
    { role: 'user', content: `SENTENCE: ${sentence}` },
  ];
}
