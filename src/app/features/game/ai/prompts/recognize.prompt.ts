import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

/**
 * Describe first, then name: asked for the name straight away, the model
 * interpreted the scene (an open hand came back as "stop").
 */
export const OBJECT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    seen: { type: 'string' },
    object: { type: 'string' },
  },
  required: ['seen', 'object'],
});

/** What the model answers when there is nothing it can name. */
export const NOTHING = 'nothing';

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
 * Image and rules in a single user turn: WebLLM allows one text part per
 * message, and the vision model's template has no system turn.
 */
export function recognitionPrompt(image: string): ChatCompletionMessageParam[] {
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
