import { TestBed } from '@angular/core/testing';
import { FakeWebLlm, provideFakeWebLlm } from 'ng-webllm/testing';
import { LlmError } from '../errors';
import { s } from '../schema/schema';
import type { Phase } from '../types';
import { WebLlm } from './web-llm';

const user = (content: string) => [{ role: 'user' as const, content }];

function setup(config: Parameters<typeof provideFakeWebLlm>[0] = {}) {
  TestBed.configureTestingModule({ providers: [provideFakeWebLlm(config)] });
  return { llm: TestBed.inject(WebLlm), fake: TestBed.inject(FakeWebLlm) };
}

describe('WebLlm', () => {
  it('loads the model and becomes ready', async () => {
    const { llm } = setup({ ready: false, replies: [{ reply: 'hi' }] });
    expect(llm.status()).toBe('idle');

    expect(await llm.load()).toBe(true);
    expect(llm.status()).toBe('ready');
    expect(llm.loaded()?.id).toBe('fake-model-MLC');
  });

  it('refuses a request when no model is loaded or loading', async () => {
    const { llm } = setup({ ready: false, replies: [{ reply: 'hi' }] });

    await expect(llm.ask(user('hello'))).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('queues a request while the model loads', async () => {
    const { llm } = setup({ ready: false, replies: [{ reply: 'hi' }] });

    const loading = llm.load();
    const answer = llm.ask(user('hello'));
    await loading;

    expect((await answer).value).toBe('hi');
  });

  it('reports unsupported browsers', async () => {
    const { llm } = setup({ ready: false, unsupported: true });

    expect(await llm.load()).toBe(false);
    expect(llm.status()).toBe('unsupported');
  });

  it('parses a schema and retries a broken answer', async () => {
    const { llm, fake } = setup({ replies: [{ reply: { solved: true } }] });
    await llm.load();
    fake.fail('garbage');

    const reply = await llm.ask(user('judge'), {
      schema: s.object({ solved: s.boolean() }),
      retry: 1,
    });

    expect(reply.value.solved).toBe(true);
    expect(fake.requests().length).toBe(2);
  });

  it('fails with invalid-output when retries run out', async () => {
    const { llm, fake } = setup({ replies: [{ reply: 'x' }] });
    await llm.load();
    fake.fail('garbage');

    const ask = llm.ask(user('judge'), { schema: s.object({ solved: s.boolean() }) });
    await expect(ask).rejects.toMatchObject({ code: 'invalid-output' });
  });

  it('turns a cut-off answer into a truncated error', async () => {
    const { llm, fake } = setup({ replies: [{ reply: 'half' }] });
    await llm.load();
    fake.fail('truncated');

    await expect(llm.ask(user('long'))).rejects.toMatchObject({ code: 'truncated' });
  });

  it('runs high priority requests first', async () => {
    const { llm } = setup({ replies: [{ reply: (m) => String(m.at(-1)?.content) }], tokenDelayMs: 1 });
    await llm.load();

    const order: string[] = [];
    const track = (name: string) =>
      llm.ask(user(name), { priority: name === 'urgent' ? 'high' : 'normal' }).then(() => order.push(name));

    await Promise.all([track('first'), track('second'), track('urgent')]);

    // "first" was already running; "urgent" jumps ahead of "second".
    expect(order).toEqual(['first', 'urgent', 'second']);
  });

  it('drops a queued request when its signal aborts, without running it', async () => {
    const { llm, fake } = setup({ replies: [{ reply: 'ok' }], tokenDelayMs: 1 });
    await llm.load();

    const controller = new AbortController();
    const first = llm.ask(user('first'));
    const second = expect(llm.ask(user('second'), { signal: controller.signal })).rejects.toBeInstanceOf(
      LlmError,
    );
    controller.abort();

    await first;
    await second;
    expect(fake.requests().map((request) => request.messages[0].content)).toEqual(['first']);
  });

  it('interrupts the running request when its signal aborts', async () => {
    const { llm } = setup({ replies: [{ reply: 'one two three four five six' }], tokenDelayMs: 5 });
    await llm.load();

    const controller = new AbortController();
    const ask = llm.ask(user('talk'), { signal: controller.signal });
    setTimeout(() => controller.abort(), 8);

    await expect(ask).rejects.toMatchObject({ code: 'aborted' });
  });

  it('lets go of the abort signal once the request ends', async () => {
    const { llm } = setup({ replies: [{ reply: 'ok' }] });
    await llm.load();

    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    await llm.ask(user('x'), { signal: controller.signal });

    // The listener was added with a signal of its own, aborted to remove it.
    const options = add.mock.calls[0][2] as AddEventListenerOptions;
    expect(options.signal?.aborted).toBe(true);
  });

  it('turns a lost model into an error state, and loads again', async () => {
    const { llm, fake } = setup({ replies: [{ reply: 'ok' }] });
    await llm.load();
    fake.fail('lost');

    await expect(llm.ask(user('x'))).rejects.toMatchObject({ code: 'model-lost' });
    expect(llm.status()).toBe('error');
    expect(llm.error()?.code).toBe('model-lost');
    expect(llm.loaded()).toBeNull();

    expect(await llm.load()).toBe(true);
    expect((await llm.ask(user('x'))).value).toBe('ok');
  });

  it('starts the timeout at the first token, not during prefill', async () => {
    const { llm } = setup({ replies: [{ reply: 'one two' }], prefillDelayMs: 40 });
    await llm.load();

    // A slow prefill does not count: a clock started before it would have fired.
    expect((await llm.ask(user('x'), { timeoutMs: 15 })).value).toBe('one two');
  });

  it('times out an answer that is written too slowly', async () => {
    const { llm } = setup({ replies: [{ reply: 'one two three four' }], tokenDelayMs: 20 });
    await llm.load();

    await expect(llm.ask(user('x'), { timeoutMs: 15 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports the phases of a request', async () => {
    const { llm } = setup({ replies: [{ reply: 'a b' }], tokenDelayMs: 1 });
    await llm.load();

    const phases: Phase[] = [];
    await llm.request(user('x'), { onPhase: (phase) => phases.push(phase) });

    expect(phases).toEqual(['queued', 'prefill', 'streaming', 'idle']);
  });
});
