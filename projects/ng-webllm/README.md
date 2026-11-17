# ng-webllm

Angular primitives for running small language models in the browser with
[WebLLM](https://github.com/mlc-ai/web-llm): the model's lifecycle as signals,
one queue for every request, answers that follow a typed schema, and two
resources, `completion()` and `conversation()`, that stream into your templates.

Everything runs on the user's GPU, through WebGPU. Nothing is sent to a server.

The full design, with the reasons behind it, is in [`docs/api-spec.md`](../../docs/api-spec.md).

## Install

`ng-webllm` needs Angular 22 and WebLLM as peer dependencies:

```bash
npm install ng-webllm @mlc-ai/web-llm
```

## Setup

The model runs in a Web Worker. The worker file has to live in your app, so the
bundler sees it, and it needs one line:

```ts
// src/app/llm.worker.ts
/// <reference lib="webworker" />
import { startWebLlmWorker } from 'ng-webllm/worker';

startWebLlmWorker();
```

Then register an engine. It downloads nothing: you call `load()` when you decide to.

```ts
// app.config.ts
import { provideWebLlm } from 'ng-webllm';

export const appConfig: ApplicationConfig = {
  providers: [
    provideWebLlm({
      models: [
        { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', sizeMb: 880 },
        { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B', sizeMb: 1630 },
      ],
      defaultModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      worker: () => new Worker(new URL('./llm.worker', import.meta.url), { type: 'module' }),
      rememberSelection: 'my-app.model',
    }),
  ],
};
```

## The engine

`WebLlm` holds one model and exposes its state as signals:

```ts
const llm = inject(WebLlm);

llm.status();     // 'idle' | 'checking' | 'unsupported' | 'loading' | 'ready' | 'error'
llm.progress();   // 0 to 1 while the model downloads and compiles
llm.selected();   // the model the user chose
llm.loaded();     // the model that is actually answering

llm.select('Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
await llm.load(); // resolves false, never throws, when it cannot

const reply = await llm.ask([{ role: 'user', content: 'Name a fruit.' }]);
reply.value;      // the text
```

Every request goes through one queue, with `high`, `normal` and `low` priority.
Requests made while the model loads wait for it.

## Typed answers

Describe the answer with `s`. The same description is the grammar WebLLM
enforces, the TypeScript type, the check on the finished answer, and the
partial object while it streams:

```ts
import { s } from 'ng-webllm';

const verdict = s.object({
  reasoning: s.string(),
  solved: s.boolean(),
  reply: s.string(),
});
type Verdict = s.Infer<typeof verdict>;

const { value } = await llm.ask(messages, { schema: verdict, retry: 1 });
value.solved; // boolean
```

## `completion()`: a question that follows signals

Like `resource()`: when the params change, the previous generation is dropped
from the queue or interrupted.

```ts
readonly word = signal('');

readonly translation = completion({
  params: () => this.word() || undefined,
  messages: (word) => [{ role: 'user', content: `Translate into English: ${word}` }],
  debounce: 300,
});
```

```html
@if (translation.draft(); as draft) {
  <p aria-hidden="true">{{ draft.text }}</p>
} @else {
  <p>{{ translation.value() }}</p>
}
```

## `conversation()`: a history, and the chains that write in it

```ts
readonly chat = conversation({ system: 'You are a friendly villager.' });

await this.chat.send('Good morning!');
this.chat.messages(); // what the user sees
this.chat.draft();    // the answer while it is written
```

Each message says who sees it: the user, the model, or both. A chain composes
steps that call the model (`generate`), run plain code (`step`) and write in the
history (`save`):

```ts
const judge = this.chat.chain(
  save.forUser((wish: string) => wish),
  generate((wish: string) => `Does "${wish}" solve the problem?`, { schema: verdict }),
  save.forUser((answer) => answer.reply),
);

const result = await judge('a ladder');
```

`aside()` asks the model about the conversation without writing in it, and
`fork()` copies the history into a branch that goes its own way. `stop()`
interrupts the chain that is running and drops the ones waiting their turn.

## A second engine

For a second model, say a vision model, register it under a token:

```ts
export const VISION = webLlmToken('vision');

provideWebLlm({ models: [visionModel], defaultModel: visionModel.id, worker }, VISION);

const vision = inject(VISION);
```

Each engine runs in its own worker.

## Errors

Every failure is an `LlmError` with a `code`: `unsupported`, `not-ready`,
`load-failed`, `model-lost`, `aborted`, `timeout`, `truncated`,
`invalid-output` or `engine`. `aborted` never shows up as an error state:
stopping is normal.

## Testing

`ng-webllm/testing` swaps the worker for a backend with programmed replies. The
engine around it is the real one, so the queue, phases, streaming and schemas
behave as in the app:

```ts
import { FakeWebLlm, provideFakeWebLlm } from 'ng-webllm/testing';

TestBed.configureTestingModule({
  providers: [
    provideFakeWebLlm({
      replies: [{ match: 'ladder', reply: { reasoning: '…', solved: true, reply: 'Thank you!' } }],
    }),
  ],
});

const fake = TestBed.inject(FakeWebLlm);
fake.fail('lost');  // the next generation fails as if WebLLM had lost the model
fake.requests();    // every generation asked so far
```

## Development

```bash
ng build ng-webllm
```

```bash
ng test ng-webllm
```
