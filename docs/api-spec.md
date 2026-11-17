# ng-webllm — spec dell'API (bozza v1)

> `ng-webllm`: libreria Angular (v22+) per usare modelli WebLLM nel browser, senza server.
> Stato: prototipo in `projects/ng-webllm` (testato con il fake, non ancora provato con un modello vero né usato dalla demo).

## 0. Principi

1. **Local-first, e basta.** Un solo backend: WebLLM in un Web Worker. Nessun fallback cloud, nessun protocollo client/server. Chi vuole cloud + tool + UI generativa usa hashbrown.
2. **Primitive, non wrapper di `resource()`.** Le ref pubbliche *implementano* l'interfaccia `Resource<T>` di Angular (quindi `@if (ref.hasValue())`, `ref.status()`, `ref.snapshot()` funzionano come con qualsiasi resource), ma sono costruite su `signal`/`computed`/`effect`. Così controlliamo noi la semantica di coda, interruzione e streaming, che `resource()` non conosce.
3. **Ogni API nasce da una cicatrice.** Se una funzione non risolve un problema incontrato con la demo, non entra nella v1.
4. **Il modello genera una cosa alla volta.** Lo scheduler lo rende esplicito invece di nasconderlo.

## 0.1 Come si usa: il flusso

**1. Registri l'engine.** Non scarica niente: crea solo il servizio `WebLlm` in stato `idle`.

```ts
// app.config.ts
providers: [provideWebLlm({ models: MODELS, defaultModel: LLAMA_1B, worker: () => new Worker(...) })]
```

**2. Carichi il modello, in modo esplicito.** Sono centinaia di MB o qualche GB, quindi lo decide l'app: un pulsante, la pagina di caricamento, la scelta del modello. Non esiste un caricamento automatico.

```ts
await inject(WebLlm).load();   // status: checking → loading → ready
```

**3. Crei le resource.** Si possono creare in qualsiasi momento, anche prima del caricamento, purché in un injection context (come `resource()`: tipicamente un campo di un componente o di un servizio). Prendono l'engine con `inject(WebLlm)`, oppure quello passato in `engine`.

Cosa succede se il modello non è ancora pronto:

| Stato dell'engine | `completion` | `conversation.send` / `aside` | `llm.ask` |
|---|---|---|---|
| `idle`, `error`, `unsupported` | `status: 'idle'`, aspetta | rifiuta con `not-ready` | rifiuta con `not-ready` |
| `checking`, `loading` | `status: 'idle'`, aspetta | va in coda (`phase: 'queued'`) | va in coda |
| `ready` | parte da sola | parte | parte |

`completion` tratta lo stato dell'engine come se fosse uno dei suoi parametri: quando l'engine diventa `ready` parte, e quando cambia il modello caricato rifà la domanda. Le chiamate imperative invece falliscono subito se nessuno sta caricando il modello: altrimenti resterebbero in coda all'infinito.

**4. Nel template**, di solito, il gioco resta dietro un `@defer (when llm.isReady())`. Così i componenti che creano le resource vengono caricati, e creati, solo quando il modello è pronto, e non si arriva mai al caso "non pronto".

```
provideWebLlm ──► llm.load() ──► llm.isReady() ──► @defer carica il componente
                                                   └─► completion / conversation / ask
```

## 1. Struttura del pacchetto

```
projects/ng-webllm/
  src/lib/
    engine/       provideWebLlm, WebLlm, token per più engine
    scheduler/    coda per engine (interna, stato pubblico)
    schema/       builder `s`, Infer, parse, parsePartial
    ask/          chiamata singola imperativa
    completion/   completion() — reattiva
    conversation/ conversation() — storico + aside
    errors/       LlmError
  worker/         entry point secondario: ng-webllm/worker
```

Il worker deve restare un file dell'app (il bundler deve vederlo in `new URL(...)`), ma diventa una riga:

```ts
// src/app/llm.worker.ts
/// <reference lib="webworker" />
import { startWebLlmWorker } from 'ng-webllm/worker';

startWebLlmWorker();
```

## 2. Engine

### 2.1 Provider

```ts
export interface WebLlmConfig {
  /** Modelli selezionabili. `id` è un id di prebuiltAppConfig (suffisso -MLC). */
  readonly models: readonly ModelInfo[];
  readonly defaultModel: string;
  /** Crea il worker: deve stare nel codice dell'app per essere bundlato. */
  readonly worker: () => Worker;
  /** 'auto' prova Cache Storage e ripiega su IndexedDB se la quota è piena. Default 'auto'. */
  readonly cache?: 'auto' | 'cache-storage' | 'indexeddb';
  /** Chiave localStorage dove ricordare il modello scelto. Assente = non si ricorda. */
  readonly rememberSelection?: string;
  /** Default per ogni richiesta, sovrascrivibili per chiamata. */
  readonly defaults?: Partial<GenerationOptions>;
}

export interface ModelInfo {
  readonly id: string;
  readonly label: string;
  readonly sizeMb?: number;
  readonly vision?: boolean;
}

export function provideWebLlm(config: WebLlmConfig, token?: WebLlmToken): EnvironmentProviders;
```

Più engine (la demo ne usa due: chat e visione) = più token:

```ts
export const VISION = webLlmToken('vision');

providers: [
  provideWebLlm({ models: CHAT_MODELS, defaultModel: LLAMA_1B, worker }),
  provideWebLlm({ models: VISION_MODELS, defaultModel: PHI_VISION, worker }, VISION),
]

const chatLlm = inject(WebLlm);    // engine di default
const visionLlm = inject(VISION);  // webLlmToken() crea un InjectionToken<WebLlm>
```

Ogni engine ha il suo worker e la sua coda. Due modelli caricati occupano due volte la memoria GPU: va detto nella doc.

### 2.2 `WebLlm`

È l'attuale `LlmEngine` + `WebLlmChatModel`, ripulito.

```ts
export type EngineStatus = 'idle' | 'checking' | 'unsupported' | 'loading' | 'ready' | 'error';

export abstract class WebLlm {
  // stato del modello
  readonly status: Signal<EngineStatus>;
  readonly isReady: Signal<boolean>;
  readonly progress: Signal<number>;         // 0..1
  readonly progressText: Signal<string>;
  readonly error: Signal<LlmError | undefined>;

  // scelta del modello
  readonly models: readonly ModelInfo[];
  readonly selected: Signal<ModelInfo>;      // scelto dall'utente
  readonly loaded: Signal<ModelInfo | null>; // quello che risponde davvero
  readonly outdated: Signal<boolean>;        // selected !== loaded

  // misure (solo valori riportati da WebLLM, mai stime)
  readonly stats: Signal<ModelStats>;
  readonly gpuBufferBytes: Signal<number | null>;

  // coda
  readonly pending: Signal<number>;          // richieste in coda + quella in corso
  readonly isBusy: Signal<boolean>;

  select(id: string): void;
  /** Carica `selected()` (o `id`). Risolve false, non lancia, se non può. */
  load(id?: string): Promise<boolean>;
  unload(): Promise<void>;
  isCached(id: string): Promise<boolean>;
  deleteFromCache(id: string): Promise<void>;

  /** Chiamata singola, vedi §4. */
  ask<T = string>(messages: readonly ChatMessage[], options?: AskOptions<T>): Promise<Reply<T>>;
}
```

`WebLlm` non è una `Resource`: non ha un "valore", ha un ciclo di vita. Il template resta quello del talk:

```html
@if (llm.status() === 'loading') {
  <app-loading-page [progress]="llm.progress()" />
}
@defer (when llm.isReady()) {
  <app-magic-book />
} @placeholder {
  <app-book-cover />
}
```

### 2.3 Cambiare modello

Le resource **non vanno ricreate**. Tengono un riferimento a `WebLlm`, che resta lo stesso: cambia solo il modello caricato nel worker (`engine.reload(id)`).

Cosa succede quando chiami `llm.load(altroId)`:

1. Lo scheduler interrompe la richiesta in corso e la **rimette in testa alla coda**. Non fallisce: verrà rifatta dal nuovo modello.
2. L'engine passa a `loading`. Le richieste in coda aspettano, e quelle nuove si accodano.
3. A modello pronto la coda riparte:
   - `completion` rifà comunque la domanda, perché il modello caricato è uno dei suoi parametri (§0.1). Il valore vecchio resta visibile fino alla nuova risposta;
   - `conversation` tiene lo storico. Il nuovo modello lo riceve tutto al primo `send` (la KV cache del vecchio non serve più: WebLLM la svuota da sé);
   - `ask` in coda riceve la risposta dal nuovo modello.
4. Se il caricamento fallisce, le richieste in coda falliscono con `load-failed`, e le `completion` tornano `idle`.

`outdated()` resta, per chi vuole reagire al cambio in altro modo (la demo oggi ricomincia il livello).

## 3. Scheduler

Interno, ma il suo stato è visibile (`pending`, `phase`).

- **Una coda per engine.** Esegue una richiesta alla volta. WebLLM serializza già da sé (un lock per modello), ma noi dobbiamo sapere *quale* richiesta è in corso: `interruptGenerate()` ferma solo quella che sta girando.
- **Tre priorità:** `high` > `normal` > `low`, FIFO a parità di priorità. Default: `normal`. `aside` usa `high`.
- **Annullare:**
  - una richiesta in coda viene tolta, senza toccare l'engine;
  - una richiesta in corso viene fermata con `interruptGenerate()`.
- **Timeout per richiesta** (default 20 s): il tempo parte dal **primo token**, non dall'inizio. WebLLM non può interrompere il prefill, e la prima richiesta dopo il caricamento compila anche shader e grammatiche (nella prova con Llama 1B oltre 30 s): un timeout lì butterebbe via solo quel lavoro. Allo scadere annulla con errore `timeout`.
- **Modello perso.** Dopo alcuni errori interni (`ModelNotLoadedError`, `BindingError` del matcher della grammatica) WebLLM scarica il modello. L'engine passa in `status: 'error'`, `loaded()` torna `null` e un nuovo `load()` lo ricarica.
- **Streaming sempre attivo**, internamente, con `stream_options.include_usage`. Serve a `draft()`/`partial()` e a sapere quando arriva il primo token. L'iteratore va sempre consumato o chiuso: se no WebLLM tiene il lock.

Fasi di una richiesta (`Phase`):

```ts
export type Phase = 'idle' | 'queued' | 'prefill' | 'streaming';
//                        in coda     prima del 1° token   token in arrivo
```

## 4. Chiamata singola: `ask`

Imperativa, senza stato. È quella che usa il giudice del gioco.

```ts
export interface GenerationOptions {
  readonly temperature?: number;   // default 0
  readonly maxTokens?: number;     // default 256
  readonly timeoutMs?: number;     // default 20_000
  readonly priority?: 'high' | 'normal' | 'low';
  readonly signal?: AbortSignal;
  /** Etichetta per i log in console. */
  readonly purpose?: string;
}

export interface AskOptions<T> extends GenerationOptions {
  readonly schema?: Schema<T>;
  /** Tentativi in più se l'output è troncato o non rispetta lo schema. Default 0. */
  readonly retry?: number;
  /** Chiamata a ogni token: testo grezzo e, con schema, l'oggetto parziale. */
  readonly onDelta?: (draft: Draft<T>) => void;
}

export interface Reply<T> {
  readonly value: T;               // string senza schema, oggetto validato con schema
  readonly text: string;           // output grezzo
  readonly finishReason: 'stop' | 'length' | 'abort';
  readonly usage: Usage;
}
```

Esempio, il giudice:

```ts
const verdict = s.object({
  reasoning: s.string(),
  solved: s.boolean(),
  npcReply: s.string(),
});

const reply = await llm.ask(judgePrompt(npc, item), {
  schema: verdict,
  maxTokens: 220,
  retry: 2,
  purpose: `judge "${item}"`,
});

reply.value.solved;   // boolean, tipizzato
```

Il ciclo di retry manuale e "The book has run out of ink" restano nell'app: `retry` copre solo i casi `truncated`/`invalid-output`, poi lancia `LlmError`.

## 5. Schema: `s`

Un builder minimo. L'ordine delle proprietà è l'ordine in cui il modello le genera, e la libreria lo garantisce.

```ts
s.object({ ... })                 // l'ordine delle chiavi = ordine di generazione
s.string({ description? })
s.number() / s.integer()
s.boolean()
s.enum(['a', 'b'] as const)
s.array(item, { minItems?, maxItems? })

type Verdict = s.Infer<typeof verdict>;
// { reasoning: string; solved: boolean; npcReply: string }

verdict.toJsonSchema();           // string per response_format
verdict.parse(text);              // T, oppure lancia LlmError('invalid-output')
verdict.parsePartial(text);       // DeepPartial<T>: tollera JSON non chiuso
```

Scelte:
- **Niente Zod come dipendenza.** Convertire uno *Standard JSON Schema* (`~standard`), come fa hashbrown, con un `s.from(...)` è un'idea per dopo: nel prototipo non c'è. Per lo stesso motivo `s.string` non ha `maxLength`: non ho verificato quali keyword accetta la grammatica di WebLLM.
- **Le `description` non le vede il modello.** La grammatica JSON di WebLLM vincola i token, non legge le descrizioni. Le teniamo solo per la doc. Un helper `s.describe(schema)` che le stampi nel prompt è un'idea per dopo. Va detto nel talk: è un'idea sbagliata frequente.
- **`parsePartial`** (v1) serve a far apparire `npcReply` parola per parola mentre il modello scrive. Basta un parser che tollera stringhe, array e oggetti lasciati aperti. Un campo compare in `partial` appena il modello ha iniziato a scriverlo: le stringhe crescono, numeri e booleani compaiono solo quando sono completi.

## 6. `completion()` — reattiva

Una generazione che segue dei parametri a signal, come `resource()`, ma consapevole della coda.

```ts
export function completion<P, T = string>(options: {
  /** undefined = nessuna richiesta (status 'idle'). */
  params: () => P | undefined;
  messages: (params: P) => readonly ChatMessage[];
  schema?: Schema<T>;
  /** Attesa prima di partire dopo un cambio di params. Default 0. */
  debounce?: number;
  /** Tiene il valore precedente mentre genera il nuovo. Default true. */
  keepPrevious?: boolean;
  engine?: WebLlm;                 // default inject(WebLlm)
} & AskOptions<T>): CompletionRef<T>;

export interface CompletionRef<T> extends Resource<T | undefined> {
  readonly phase: Signal<Phase>;
  readonly draft: Signal<Draft<T> | null>;    // testo e oggetto parziale mentre scrive
  readonly finishReason: Signal<FinishReason | undefined>;
  readonly usage: Signal<Usage | undefined>;
  reload(): boolean;
  stop(): void;
}

export interface Draft<T> {
  readonly text: string;
  readonly partial: DeepPartial<T> | undefined;   // solo con schema
}
```

Semantica:
- `status` segue `ResourceStatus`:
  - `idle` se `params()` è `undefined`;
  - `loading` per una richiesta nuova;
  - `reloading` dopo `reload()`;
  - `resolved` al termine;
  - `error` se la generazione fallisce.
- Se `params` cambia, la richiesta precedente viene tolta dalla coda o interrotta. È il punto forte per il talk: la cancellazione è gratis.
- Va creata in un injection context. Alla distruzione si annulla da sola (`DestroyRef`).

Esempio, la traduzione mentre si scrive nel libro:

```ts
readonly wish = signal('');

readonly english = completion({
  params: () => this.wish().trim() || undefined,
  messages: (wish) => wishToEnglishPrompt(wish, this.locale()),
  schema: s.object({ translation: s.string() }),
  debounce: 400,
  maxTokens: 40,
});
```

```html
@if (english.hasValue()) {
  <small>{{ english.value().translation }}</small>
}
```

## 7. `conversation()` — storico + operazioni a lato

```ts
export function conversation<T = string>(options: {
  system: string | (() => string);
  messages?: readonly ChatMessage[];
  /** Con schema, ogni risposta dell'assistente ha anche `value: T`. */
  schema?: Schema<T>;
  /** Cosa ricorda il modello a ogni `send`. Default 'all'. Vedi §7.2. */
  memory?: 'all' | 'none' | number;
  engine?: WebLlm;
} & GenerationOptions): ConversationRef<T>;

export interface Message<T = string> {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly ContentPart[];
  readonly value?: T;                                   // solo assistente con schema
  readonly status: 'complete' | 'interrupted';
  /** Chi vede il messaggio. Default 'both'. Vedi §7.3. */
  readonly audience?: Audience;
}

export type Audience = 'both' | 'model' | 'user';

export interface ConversationRef<T> extends Resource<readonly Message<T>[]> {
  readonly messages: Signal<readonly Message<T>[]>;  // = value(): ciò che vede l'utente
  readonly context: Signal<readonly Message<T>[]>;   // ciò che vede il modello
  readonly draft: Signal<Draft<T> | null>;           // risposta in arrivo
  readonly phase: Signal<Phase>;
  readonly lastReply: Signal<Message<T> | undefined>;
  readonly finishReason: Signal<FinishReason | undefined>;
  readonly usage: Signal<Usage | undefined>;         // dell'ultimo turno

  send(content: string | readonly ContentPart[], options?: SendOptions<T>): Promise<Message<T>>;
  stop(options?: { keepPartial?: boolean }): void;
  regenerate(): Promise<Message<T>>;
  reset(messages?: readonly Message<T>[]): void;

  /** Aggiunge un messaggio senza far rispondere il modello. */
  add(content: string | readonly ContentPart[], options?: AddOptions): Message<T>;
  aside<R = string>(prompt: AsidePrompt, options?: AsideOptions<R>): Promise<Reply<R>>;
  fork(options?: ForkOptions): ConversationRef<T>;
  /** Solo per le conversazioni create fuori da un injection context (es. con fork). */
  destroy(): void;
}

export interface AddOptions {
  role?: 'user' | 'assistant';   // default 'user'
  audience?: Audience;           // default 'both'
}

export interface SendOptions<T> extends GenerationOptions {
  /**
   * Chi vede il messaggio dell'utente. Default 'both'. Non accetta 'user':
   * far rispondere il modello a un messaggio che non riceve non ha senso.
   */
  audience?: Exclude<Audience, 'user'>;
  /** Sovrascrive lo schema della conversazione per questo turno. */
  schema?: Schema<T>;
}
```

Semantica di `send`:
- Il messaggio utente entra subito nello storico.
- La risposta resta in `draft()` finché non è completa, poi passa nello storico. Lo storico non contiene mai mezze risposte.
- Un `send` mentre un altro è in corso va in coda, e l'ordine è garantito.
- `stop()`:
  - con `keepPartial: false` (default) scarta la bozza;
  - con `true` la salva con `status: 'interrupted'`.
- `regenerate()` toglie l'ultima risposta e la rigenera. Non tiene versioni alternative: vedi §10.
- `isLoading()` è vero con `phase` uguale a `queued`, `prefill` o `streaming`.

### 7.1 `aside` — fuori dallo storico

Usa la conversazione come contesto e non la modifica mai: non cambia `value()`, `context()`, `draft()` né `phase()`. È l'idea originale: "chiedi una traduzione dopo un messaggio, ma senza salvarla".

```ts
export type AsidePrompt =
  | string                                                           // aggiunto come messaggio utente
  | ((history: readonly Message[]) => readonly ChatMessage[]);       // prompt costruito da zero

export interface AsideOptions<R> extends AskOptions<R> {
  /** Quanta conversazione riceve il modello. Default 'all'. */
  context?: 'all' | 'last-reply' | 'none' | number;
  /** System prompt per questa chiamata; false = nessuno. Default: quello della conversazione. */
  system?: string | false;
}
```

`priority` di default è `high`: un aside passa davanti ai `send` in coda, ma non interrompe quello in corso.

```ts
// traduci l'ultima risposta, senza salvarla
const it = await chat.aside('Translate your last answer into Italian.', {
  context: 'last-reply',
});

// giudizio strutturato sul dialogo, che il personaggio non "sente"
const verdict = await chat.aside(
  (history) => judgePrompt(npc, item, history),
  { schema: verdictSchema, retry: 2 },
);
```

Versione reattiva, senza API nuove: si compongono le primitive con i signal.

```ts
readonly chat = conversation({ system: SYSTEM });

readonly italian = completion({
  params: () => this.chat.lastReply()?.content,
  messages: (text) => translatePrompt(text, 'it'),
});
```

Per concatenare più operazioni e decidere quando salvare, ci sono le catene (§7.5).

### 7.2 `memory` — quanto ricorda il modello

`memory` decide **cosa riceve il modello** a ogni `send`. Non decide cosa vede l'utente: `messages()` contiene sempre tutto lo storico.

| `memory` | Il modello riceve | Uso |
|---|---|---|
| `'all'` (default) | system + tutto `context()` + nuovo messaggio | chat normale |
| `number` (N) | system + gli ultimi N turni + nuovo messaggio | chat lunghe su modelli con poco contesto |
| `'none'` | system + nuovo messaggio | **NPC del gioco**: il dialogo si vede, ma ogni tentativo è giudicato da solo |

Con `'none'` ogni `send` è di fatto un `ask`, ma la conversazione tiene lo stato da mostrare (`messages()`, `draft()`, `phase()`). È la lezione "una chiamata, un compito" applicata a una UI di chat.

Costo: con `'all'` WebLLM riusa la KV cache tra un turno e l'altro (§9). Con un numero, il riuso si perde ogni volta che la finestra scorre. Con `'none'` il riuso non serve, perché il prompt è sempre corto.

### 7.3 Chi vede cosa: `audience`

Ogni messaggio ha un `audience`. I due signal pubblici sono due `computed` sullo stesso array:

```ts
messages = computed(() => all().filter((m) => m.audience !== 'model'));   // utente
context  = computed(() => all().filter((m) => m.audience !== 'user'));    // modello
```

#### I tre metodi

Ogni metodo fa una cosa sola:

- **`add`** scrive nello storico. Non chiama il modello.
- **`send`** scrive nello storico e chiama il modello. La risposta entra nello storico.
- **`aside`** chiama il modello. Non scrive nello storico, mai.

#### Chi vede un messaggio

`audience` è una proprietà dei messaggi **scritti nello storico**, quindi esiste solo su `add` e `send`. `aside` non ha `audience`, perché non scrive niente.

| `audience` | L'utente lo vede (`messages()`) | Il modello lo riceve (`context()`) |
|---|---|---|
| `'both'` (default) | ✅ | ✅ |
| `'model'` | ❌ | ✅ |
| `'user'` | ✅ | ❌ |

Su `send`, `audience` vale per il messaggio inviato. La risposta del modello è sempre `'both'`. `send` non accetta `'user'`: il modello risponderebbe a un messaggio che non riceve.

#### Esempi

```ts
// un turno normale
chat.send('Can you help me?');

// un evento del gioco che il personaggio deve sapere, senza mostrarlo e senza farlo rispondere
chat.add('The player gave you a torch.', { audience: 'model' });

// un avviso nella chat che il modello non riceverà mai
chat.add('The book has run out of ink.', { role: 'assistant', audience: 'user' });

// una domanda a lato, che non lascia tracce
const verdict = await chat.aside((history) => judgePrompt(npc, item, history), { schema });
```

Per **mostrare** il risultato di un `aside` lo si scrive con `add`: due operazioni, ognuna esplicita.

```ts
// l'utente vede la traduzione, il modello continua a ragionare in inglese
const it = await chat.aside('Translate your last answer into Italian.', { context: 'last-reply' });
chat.add(it.text, { role: 'assistant', audience: 'user' });
```

**Perché `aside` non scrive mai nello storico.** I modelli piccoli si lasciano guidare da quello che hanno appena letto. Se il modello ricordasse l'aside "traduci in italiano", la risposta successiva tenderebbe a essere in italiano. Dopo un giudizio in JSON, il personaggio tenderebbe a rispondere come un elenco o a citare il ragionamento del giudice. L'isolamento ha un costo: il `send` successivo rifà il prefill (§9).

### 7.5 Catene: `generate` e `save`

Una catena è una sequenza di passi, definita una volta e richiamabile come una funzione. Ci sono due tipi di passo principali:

- **`generate(prompt, options?)`** chiama il modello e trasforma il valore corrente. **Non salva niente.**
- **`save.forUser()` / `save.forModel()` / `save.forBoth()`** scrivono il valore corrente nello storico, con `audience` `'user'`, `'model'` o `'both'`. **Non chiamano il modello.**

Un messaggio viene salvato esattamente dove c'è un `save`, e da nessun'altra parte.

```ts
// la traduzione ai bordi
readonly talk = this.chat.chain(
  save.forUser(),                                // il giocatore vede ciò che ha scritto
  generate(toEnglish, { context: 'none' }),      // → inglese, non salvato
  save.forModel(),                               // il modello riceve la domanda in inglese
  generate(reply()),                             // il turno vero
  save.forModel(),                               // il modello ricorda la sua risposta
  generate(toItalian, { context: 'none' }),      // → italiano, non salvato
  save.forUser(),                                // il giocatore vede la risposta in italiano
);

await this.talk('Mi si è rotta la lenza');
```

```ts
// il giudice: con lo schema il passo successivo riceve l'oggetto
readonly judge = this.chat.chain(
  save.forUser((item: string) => `*gives ${item}*`),
  generate((item) => judgePrompt(npc, item), { schema: verdict, context: 'none', retry: 2 }),
  save.forUser((v) => v.npcReply),
);

const result = await this.judge('a torch');   // Verdict, tipizzato
```

#### I passi

```ts
/** Il prompt di un generate: dal valore corrente e dallo storico, i messaggi da mandare. */
export type StepPrompt<In> =
  | string                                                      // istruzione fissa: il valore diventa il messaggio utente
  | ((value: In, history: readonly Message[]) => string | readonly ChatMessage[]);

export function generate<In, Out = string>(
  prompt: StepPrompt<In>,
  options?: AskOptions<Out> & {
    /** Quanta conversazione riceve il modello. Default: `memory` della conversazione. */
    context?: 'all' | 'none' | 'last-reply' | number;
    /** System prompt per questo passo; false = nessuno. Default: quello della conversazione. */
    system?: string | false;
    /** Mostra lo streaming in draft(). Default: true se il passo dopo salva per l'utente. */
    draft?: boolean;
  },
): Step<In, Out>;

export const save: {
  forUser<In>(pick?: (value: In) => string): Step<In, In>;
  forModel<In>(pick?: (value: In) => string): Step<In, In>;
  forBoth<In>(pick?: (value: In) => string): Step<In, In>;
};

/** Il prompt pronto per "rispondi alla conversazione": nessun testo in più, solo lo storico. */
export function reply(): StepPrompt<unknown>;

/** Un passo in JavaScript: controlli, trasformazioni. Per fermare la catena si lancia un errore. */
export function step<In, Out>(fn: (value: In) => Out | Promise<Out>): Step<In, Out>;
```

Regole:
- **Il ruolo è automatico.** Un valore che arriva da un `generate` viene salvato come `assistant`, tutti gli altri come `user`. "Ruolo user" e "visibile all'utente" restano due cose diverse.
- **Il valore passa da un passo all'altro.** `save` lo lascia invariato. `pick` sceglie solo cosa scrivere. La catena restituisce l'ultimo valore.
- **`reply()` e lo storico.** Con `reply()` il modello riceve system + storico (secondo `context`) e risponde all'ultimo messaggio salvato per il modello.
- **Streaming.** `draft()` mostra un `generate` mentre scrive solo se il passo successivo lo salva per l'utente, a meno di `draft` esplicito.
- **Errori.** Se un passo fallisce, la catena si ferma e la Promise viene rifiutata. I `save` già fatti restano. Per poter tornare indietro, si lavora su un `fork()`.
- **Coda.** Una catena occupa la conversazione dall'inizio alla fine: un `send` o un'altra catena lanciati nel frattempo aspettano. Ogni `generate` passa comunque dallo scheduler dell'engine.

#### `add`, `send` e `aside` sono scorciatoie

| Metodo | Equivale a |
|---|---|
| `add(x)` | `chain(save.forBoth())` |
| `add(x, { audience: 'model' })` | `chain(save.forModel())` |
| `send(x)` | `chain(save.forBoth(), generate(reply()), save.forBoth())` |
| `aside(prompt)` | `chain(generate(prompt))` |

Restano per i casi semplici. Chi vuole il controllo scrive la catena. Nel talk: *ogni conversazione è una catena di `generate` e `save`*.

### 7.4 `fork` — una conversazione nuova dallo stesso punto

```ts
export interface ForkOptions {
  /** Default: quello della conversazione di partenza. */
  system?: string | (() => string);
  memory?: 'all' | 'none' | number;
  /** Fino a quale messaggio copiare. Default: tutto lo storico. */
  at?: string;   // id di un Message
}

const branch = chat.fork();
await branch.send('And what if the river were frozen?');
// chat non cambia; branch ha il suo storico, il suo draft, la sua phase
```

- Copia lo storico (`messages`, `context` e gli `audience`) nello stato in cui è al momento della chiamata. Da lì le due conversazioni sono indipendenti.
- Condivide l'engine e la coda della conversazione di partenza.
- Si può chiamare ovunque, anche in un click handler: usa l'injector della conversazione di partenza. Viene distrutta insieme a lei, oppure prima con `destroy()`.
- Riuso della cache: se l'ultima richiesta all'engine era della conversazione di partenza, il primo `send` del fork la estende, e WebLLM riusa la cache.

Usi: provare una risposta alternativa senza perdere quella attuale ("e se..."), confrontare due modelli o due system prompt sullo stesso storico, e nel talk mostrare un ramo dal vivo. Il branching vero, cioè più versioni della stessa risposta navigabili, resta fuori dalla v1.

## 8. Errori

```ts
export class LlmError extends Error {
  readonly code:
    | 'unsupported'      // niente WebGPU
    | 'not-ready'        // modello non caricato
    | 'load-failed'
    | 'aborted'          // stop(), cambio di params, signal
    | 'timeout'
    | 'truncated'        // finish_reason 'length'
    | 'invalid-output'   // non rispetta lo schema
    | 'engine';          // errore dal worker (arriva come stringa: lo avvolgiamo)
}
```

`retry` riprova solo su `truncated` e `invalid-output`. `aborted` non finisce mai in `error()` di una ref, perché annullare è normale.

## 9. Vincoli di WebLLM da conoscere (e dire nel talk)

Verificati sul sorgente di `src/engine.ts` di WebLLM:

- **Riuso della KV cache tra un turno e l'altro.** WebLLM confronta la conversazione della richiesta con quella precedente: se la nuova la estende, riusa la cache e fa il prefill solo del nuovo messaggio. Quindi:
  - un `aside` o una `completion` in mezzo a due `send` rompe il riuso, e il `send` successivo rifà il prefill di tutto lo storico;
  - `memory: N` lo rompe ogni volta che la finestra scorre;
  - una risposta `length` o `abort` forza sempre il reset.

  Con modelli piccoli e storici brevi il costo è basso, ma va misurato. Idea futura: lo scheduler raggruppa le richieste della stessa conversazione.
- **`interruptGenerate()` vale solo per la richiesta in corso.** Se viene chiamato quando l'engine è fermo, non ha effetto. Per questo lo scheduler deve sapere chi sta girando.
- **Lock per modello.** Due engine con modelli diversi (chat e visione) generano in parallelo: è la GPU a pagare.
- **Uno stream non consumato tiene il lock.** Lo scheduler chiude sempre l'iteratore.

## 10. Fuori dalla v1 (di proposito)

- **Tool calling.** Su WebLLM è fragile: anche hashbrown non usa la modalità tool nativa. Ne parliamo nel talk, non lo implementiamo.
- **Branching e versioni delle risposte rigenerate.** In v1 c'è solo `fork()`, che copia lo storico in una conversazione indipendente. Più versioni della stessa risposta, navigabili, restano per la v2.
- **Persistenza dello storico.** È dell'app: `value()` e `reset(messages)` bastano.
- **"Traduci ai bordi" come opzione** (`edges: { in, out }`). In v1 è una ricetta di 5 righe con `aside`/`completion`. Se nel gioco diventa scomoda, ne facciamo un'API.

## 11. Come la usa la demo

| Oggi | Con ng-webllm |
|---|---|
| `LlmEngine` + `WebLlmChatModel` + `LanguageModel` | `provideWebLlm` + `WebLlm` |
| `llm.worker.ts` (3 righe) | `startWebLlmWorker()` da `ng-webllm/worker` |
| `JudgeService`: loop di retry + `parseJson` | `llm.ask(..., { schema: verdict, retry: 2 })` |
| Dialogo con l'NPC (stato a mano nel componente) | una `conversation({ memory: 'none', schema: verdict })` per NPC: `messages()` per il fumetto, `draft().partial.npcReply` in streaming, `add(..., { audience: 'user' })` per "The book has run out of ink" |
| `toEnglish` (chiamata imperativa) | `completion` reattiva sull'input del libro, visibile mentre si scrive |
| `LevelGeneratorService` | `llm.ask` con `temperature: 0.7` e argomenti scelti in JS |
| Seconda demo (chat) | `conversation` + `aside` + `draft()` in streaming + `phase()` 'queued' |

Il contratto `LanguageModel` della demo serve a poter sostituire il modello. Con la libreria quel ruolo passa al token `WebLlm`, e per i test c'è `provideFakeWebLlm()` (§11.1): l'astrazione `LanguageModel` nella demo si può togliere.

### 11.1 Test: `provideFakeWebLlm`

Entry point secondario `ng-webllm/testing`. Sostituisce l'engine con uno finto, senza worker né GPU, che risponde con risposte programmate. Coda, fasi, streaming e schema funzionano come quelli veri, quindi si testano le resource e non solo i servizi.

```ts
TestBed.configureTestingModule({
  providers: [
    provideFakeWebLlm({
      replies: [
        { match: /torch/, reply: { reasoning: '…', solved: false, npcReply: 'It went out!' } },
        { match: /lantern/, reply: { reasoning: '…', solved: true, npcReply: 'Thank you!' } },
      ],
      tokenDelayMs: 0,   // > 0 per testare draft() e stop()
    }),
  ],
});

const fake = TestBed.inject(FakeWebLlm);
fake.requests();      // le richieste ricevute: messages, opzioni, priorità
fake.fail('garbage'); // la prossima risposta non è JSON ('engine' | 'truncated' | 'garbage')
fake.respond({ match: /dog/, reply: 'Woof' }); // una risposta in più, controllata per prima
fake.failNextLoad();
```

- `reply` può essere una stringa, un oggetto (diventa JSON) o una funzione `(messages) => string | object`.
- Una richiesta senza `match` corrispondente fallisce con un errore che dice quale prompt non era previsto.
- Per testare il flusso del §0.1: `provideFakeWebLlm({ ready: false })` lascia l'engine in `idle` finché il test non chiama `load()`; `unsupported: true` simula un browser senza WebGPU.

## 12. Dalla cicatrice all'API (filo del talk)

| Cicatrice | API |
|---|---|
| Il modello si distrae e rompe il JSON | `schema` + `retry` + `LlmError('invalid-output' / 'truncated')` |
| Decide prima di pensare | `s.object`: l'ordine delle chiavi è garantito |
| Giudice troppo buono | nessuna API: è il prompt. Una slide |
| Ragiona male in italiano | `completion` per tradurre in input, `aside` per tradurre in output |
| Nessuna fantasia | la casualità sta in `params`, calcolati in JS; `temperature` per singola chiamata |
| UI bloccata, attese infinite | Worker + scheduler: `phase`, `stop`, `timeout`, annullamento automatico |
| Download da GB | `WebLlm.progress`, `isCached`, `@defer (when llm.isReady())` |

## Decisioni prese

1. Nome del pacchetto: `ng-webllm`. Prima di pubblicarlo va controllato che sia libero su npm.
2. `parsePartial` è in v1.
3. Gli NPC non hanno storico per il modello: `conversation({ memory: 'none' })` (§7.2).
4. Il fake per i test è in v1: `provideFakeWebLlm` (§11.1).
5. `fork()` è in v1 (§7.4).
6. Ogni messaggio ha un `audience`: `messages()` per l'utente, `context()` per il modello (§7.3). `add` scrive, `send` scrive e chiama il modello, `aside` chiama il modello e non scrive mai. `audience` esiste solo dove si scrive.
7. Cambiare modello non richiede di ricreare le resource (§2.3).
