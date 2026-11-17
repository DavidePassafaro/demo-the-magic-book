import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeWebLlm, provideFakeWebLlm, type FakeReply } from 'ng-webllm/testing';
import { WebLlm } from '../engine/web-llm';
import { s } from '../schema/schema';
import { contentText, type ChatMessage } from '../types';
import { generate, reply, save, step } from './chain';
import { conversation, type ConversationOptions } from './conversation';

const lastUser = (messages: readonly ChatMessage[]) =>
  contentText([...messages].reverse().find((message) => message.role === 'user')?.content ?? '');

async function setup<T = string>(
  options: Partial<ConversationOptions<T>> = {},
  replies: FakeReply[] = [{ reply: (messages) => `echo: ${lastUser(messages)}` }],
  tokenDelayMs = 0,
) {
  TestBed.configureTestingModule({ providers: [provideFakeWebLlm({ replies, tokenDelayMs })] });
  await TestBed.inject(WebLlm).load();

  const chat = conversation<T>({
    system: 'You are a villager.',
    injector: TestBed.inject(Injector),
    ...options,
  });
  return { chat, fake: TestBed.inject(FakeWebLlm) };
}

const texts = (messages: readonly { content: unknown }[]) => messages.map((m) => m.content);

describe('conversation', () => {
  it('send writes the message and the answer, for both', async () => {
    const { chat, fake } = await setup();

    const answer = await chat.send('hello');

    expect(answer.content).toBe('echo: hello');
    expect(texts(chat.messages())).toEqual(['hello', 'echo: hello']);
    expect(texts(chat.context())).toEqual(['hello', 'echo: hello']);
    expect(chat.lastReply()?.content).toBe('echo: hello');
    expect(fake.requests()[0].messages[0]).toEqual({ role: 'system', content: 'You are a villager.' });
  });

  it('sends the whole history with memory all', async () => {
    const { chat, fake } = await setup();

    await chat.send('one');
    await chat.send('two');

    expect(fake.requests()[1].messages.map((m) => m.content)).toEqual([
      'You are a villager.',
      'one',
      'echo: one',
      'two',
    ]);
  });

  it('sends only the system prompt and the new message with memory none', async () => {
    const { chat, fake } = await setup({ memory: 'none' });

    await chat.send('one');
    await chat.send('two');

    expect(fake.requests()[1].messages.map((m) => m.content)).toEqual(['You are a villager.', 'two']);
    expect(texts(chat.messages())).toEqual(['one', 'echo: one', 'two', 'echo: two']);
  });

  it('add writes for whom it says, and calls nothing', async () => {
    const { chat, fake } = await setup();

    chat.add('The player gave you a torch.', { audience: 'model' });
    chat.add('The book has run out of ink.', { role: 'assistant', audience: 'user' });

    expect(texts(chat.messages())).toEqual(['The book has run out of ink.']);
    expect(texts(chat.context())).toEqual(['The player gave you a torch.']);
    expect(fake.requests().length).toBe(0);
  });

  it('aside uses the conversation and never writes in it', async () => {
    const { chat, fake } = await setup();
    await chat.send('hello');

    const answer = await chat.aside('Translate your last answer into Italian.');

    expect(answer.value).toBe('echo: Translate your last answer into Italian.');
    expect(chat.messages().length).toBe(2);
    expect(fake.requests()[1].messages.map((m) => m.content)).toEqual([
      'You are a villager.',
      'hello',
      'echo: hello',
      'Translate your last answer into Italian.',
    ]);
  });

  it('a chain saves exactly where it says: translation at the edges', async () => {
    const { chat, fake } = await setup({}, [
      { match: /^To English/, reply: 'My fishing line broke' },
      { match: /^To Italian/, reply: 'Ecco, prova del nastro!' },
      { reply: 'Here, try some tape!' },
    ]);

    const talk = chat.chain(
      save.forUser<string>(),
      generate('To English:', { context: 'none' }),
      save.forModel(),
      generate(reply()),
      save.forModel(),
      generate('To Italian:', { context: 'none' }),
      save.forUser(),
    );

    const result = await talk('Mi si è rotta la lenza');

    expect(result).toBe('Ecco, prova del nastro!');
    expect(texts(chat.messages())).toEqual(['Mi si è rotta la lenza', 'Ecco, prova del nastro!']);
    expect(texts(chat.context())).toEqual(['My fishing line broke', 'Here, try some tape!']);
    expect(chat.messages().map((m) => m.role)).toEqual(['user', 'assistant']);

    // The model answered the English question, and never saw the Italian.
    const turn = fake.requests()[1].messages.map((m) => m.content);
    expect(turn).toEqual(['You are a villager.', 'My fishing line broke']);
  });

  it('a chain passes typed values from a schema to the next step', async () => {
    const verdict = s.object({ reasoning: s.string(), solved: s.boolean(), npcReply: s.string() });
    const { chat } = await setup({}, [
      { reply: { reasoning: 'a torch blows out', solved: false, npcReply: 'It went out!' } },
    ]);

    const judge = chat.chain(
      save.forUser((item: string) => `*gives ${item}*`),
      generate((item: string) => `Judge: ${item}`, { schema: verdict, context: 'none' }),
      save.forUser((v) => v.npcReply),
    );

    const result = await judge('a torch');

    expect(result.solved).toBe(false);
    expect(texts(chat.messages())).toEqual(['*gives a torch*', 'It went out!']);
    expect(chat.messages()[1].value).toEqual(result);
  });

  it('a JavaScript step can stop the chain', async () => {
    const { chat } = await setup();

    const guarded = chat.chain(
      step((text: string) => {
        if (text.includes('dragon')) {
          throw new Error('off topic');
        }
        return text;
      }),
      save.forBoth(),
    );

    await expect(guarded('a dragon')).rejects.toThrow('off topic');
    expect(chat.messages().length).toBe(0);
    expect(chat.status()).toBe('error');
  });

  it('runs sends one after the other', async () => {
    const { chat } = await setup({}, undefined, 1);

    await Promise.all([chat.send('one'), chat.send('two')]);

    expect(texts(chat.messages())).toEqual(['one', 'echo: one', 'two', 'echo: two']);
  });

  it('shows the answer in draft while it streams, then clears it', async () => {
    const { chat } = await setup({}, [{ reply: 'a b c d' }], 2);

    const drafts: string[] = [];
    const sending = chat.send('hi');
    const timer = setInterval(() => {
      const draft = chat.draft();
      if (draft) {
        drafts.push(draft.text);
      }
    }, 1);

    await sending;
    clearInterval(timer);

    expect(drafts.length).toBeGreaterThan(0);
    expect(chat.draft()).toBeNull();
    expect(chat.isLoading()).toBe(false);
  });

  it('stop interrupts and can keep the partial answer', async () => {
    const { chat } = await setup({}, [{ reply: 'one two three four five six seven' }], 5);

    const sending = chat.send('talk');
    while (!chat.draft()?.text) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    chat.stop({ keepPartial: true });

    await expect(sending).rejects.toMatchObject({ code: 'aborted' });
    const last = chat.messages().at(-1);
    expect(last?.status).toBe('interrupted');
    expect(chat.status()).not.toBe('error');
  });

  it('regenerate replaces the last answer', async () => {
    let count = 0;
    const { chat } = await setup({}, [{ reply: () => `answer ${++count}` }]);

    await chat.send('hi');
    await chat.regenerate();

    expect(texts(chat.messages())).toEqual(['hi', 'answer 2']);
  });

  it('fork copies the history and then goes its own way', async () => {
    const { chat } = await setup();
    await chat.send('hello');

    const branch = chat.fork();
    await branch.send('what if?');

    expect(texts(chat.messages())).toEqual(['hello', 'echo: hello']);
    expect(texts(branch.messages())).toEqual(['hello', 'echo: hello', 'what if?', 'echo: what if?']);
  });
});
