import type { ChatCompletion, ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { elapsed, log, type LogSource } from '@core/logger/logger';

/** Text in full, images reduced to a line: nobody wants to scroll a base64 photo. */
function readable(message: ChatCompletionMessageParam): string {
  const content = message.content;
  if (typeof content === 'string' || content == null) {
    return content ?? '';
  }
  return (content as readonly { type: string; text?: string }[])
    .map((part) => (part.type === 'image_url' ? '[image]' : (part.text ?? '')))
    .join('\n\n');
}

/** One collapsed console group per call: the prompt, the answer and the speed. */
export function logCompletion(
  source: LogSource,
  purpose: string,
  started: number,
  messages: readonly ChatCompletionMessageParam[],
  reply: ChatCompletion,
): void {
  const answer = reply.choices[0]?.message?.content ?? '';
  const usage = reply.usage;
  const stats = usage
    ? ` · ${usage.prompt_tokens}→${usage.completion_tokens} tok · ${Math.round(usage.extra.decode_tokens_per_s)} tok/s`
    : '';

  log.group(source, `${purpose} · ${elapsed(started)}${stats}`, () => {
    for (const message of messages) {
      console.log(`%c${message.role}%c\n${readable(message)}`, 'font-weight:700', '');
    }
    console.log(`%canswer%c\n${answer || '(empty)'}`, 'font-weight:700', '');
  });

  if (reply.choices[0]?.finish_reason === 'length') {
    log.warn(source, `${purpose}: the answer hit max_tokens and was cut off`);
  }
}
