import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import type { ChatMessage } from '@core/llm/language-model';

/** The game's messages, in WebLLM's own types. The shapes already match: this only copies. */
export function toWebLlm(messages: readonly ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    if (message.role !== 'user' || typeof message.content === 'string') {
      return { role: message.role, content: message.content } as ChatCompletionMessageParam;
    }
    return {
      role: 'user',
      content: message.content.map((part) =>
        part.type === 'text'
          ? { type: 'text', text: part.text }
          : { type: 'image_url', image_url: { url: part.image_url.url } },
      ),
    };
  });
}
