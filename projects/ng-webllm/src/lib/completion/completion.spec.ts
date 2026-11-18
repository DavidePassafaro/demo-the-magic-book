import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FakeWebLlm, provideFakeWebLlm } from 'ng-webllm/testing';
import { completion } from './completion';
import { WebLlm } from '../engine/web-llm';
import { s } from '../schema/schema';
import { contentText } from '../types';

/** Lets effects run and promises settle. */
async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function setup(ready = true) {
  TestBed.configureTestingModule({
    providers: [
      provideFakeWebLlm({
        ready,
        tokenDelayMs: 1,
        replies: [
          {
            reply: (messages) =>
              JSON.stringify({ translation: `en(${contentText(messages.at(-1)?.content ?? '')})` }),
          },
        ],
      }),
    ],
  });

  const llm = TestBed.inject(WebLlm);
  if (ready) {
    await llm.load();
  }

  const wish = signal('');
  const english = completion({
    params: () => wish() || undefined,
    messages: (text) => [{ role: 'user', content: text }],
    schema: s.object({ translation: s.string() }),
    injector: TestBed.inject(Injector),
  });

  return { llm, wish, english, fake: TestBed.inject(FakeWebLlm) };
}

describe('completion', () => {
  it('is idle without params', async () => {
    const { english, fake } = await setup();
    await settle();

    expect(english.status()).toBe('idle');
    expect(english.hasValue()).toBe(false);
    expect(fake.requests().length).toBe(0);
  });

  it('asks when the params arrive and resolves with a typed value', async () => {
    const { wish, english } = await setup();

    wish.set('bastone');
    await settle(10);

    expect(english.status()).toBe('resolved');
    expect(english.value()?.translation).toBe('en(bastone)');
  });

  it('drops the previous question when the params change', async () => {
    const { wish, english, fake } = await setup();

    wish.set('b');
    TestBed.tick();
    wish.set('ba');
    TestBed.tick();
    wish.set('bastone');
    await settle(10);

    expect(english.value()?.translation).toBe('en(bastone)');
    // "b" may have started; "ba" never reached the model.
    const asked = fake.requests().map((request) => contentText(request.messages[0].content));
    expect(asked).not.toContain('ba');
    expect(asked.at(-1)).toBe('bastone');
  });

  it('waits for the model, then asks on its own', async () => {
    const { llm, wish, english } = await setup(false);

    wish.set('bastone');
    await settle();
    expect(english.status()).toBe('idle');

    await llm.load();
    await settle(10);
    expect(english.value()?.translation).toBe('en(bastone)');
  });
});
