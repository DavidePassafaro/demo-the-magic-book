# The Magic Book

A small browser game: villagers have problems, and you have a book that writes any object
into being. Type what you want to conjure, and a language model running **entirely in your
browser** decides whether it solves their problem.

Built with Angular 22 (standalone components, signals, Signal Forms) and
[WebLLM](https://github.com/mlc-ai/web-llm). No server, no API keys, no telemetry &mdash; the
model runs on your GPU through WebGPU.

## Running it

```bash
npm install
npm start
```

Then open http://localhost:4200/.

**Requires WebGPU**, so a recent desktop Chrome or Edge. The first time you enter a level the
chosen model downloads (about 2.3 GB by default) and is cached by the browser; later visits
load in seconds. The game says so plainly on unsupported browsers instead of failing.

## How it plays

Walk the map with the arrow keys. Coming face to face with a villager starts the conversation on
its own &mdash; there is no key to press &mdash; and walking away ends it. Type a few words into
the book to conjure something. Escape, or a click anywhere off the box, also closes it. Letter
keys never move you, so the field is always safe to type in. Attempts are free and unlimited, and only the most recent one stays on screen &mdash; but the
problem itself never leaves it, because that is the riddle you are answering. Once a villager is
helped the field disappears: their problem stays on screen alongside their thanks and the object
that solved it.

The model sees only the current wish &mdash; never the previous ones &mdash; so each attempt is
judged on its own. Every line a villager speaks is written by the model in the moment, including
the one that thanks you: nothing they say is scripted in the level file.

When the last villager in a level has had their say, a closing page lists everything you wrote.
Focus lands on its way out, so Enter alone returns to the menu; the other button plays the level
again, or in rAIndom mode invents a different village.

## Language

The game ships in English and Italian, switchable at any time in Settings. The switch changes
the interface, the villagers' lines, and the language the book answers in. The judge's own
instructions stay in English regardless, because small models follow a rubric noticeably better
that way; only the villager's spoken reply is asked for in the player's language.

## rAIndom mode

The last entry on the menu builds a level that does not exist yet. Once the model is loaded, it
is asked for three villagers, one call at a time: a name, a temper, a problem in your language,
and a hidden solution hint in English. Each call is
constrained to the same JSON shape a level file holds, so an invented village and an authored
one are the same thing by the time the game sees them. The map seed and theme are random too.

This is the one call in the game that does not run at temperature zero &mdash; inventing wants
variety where judging wants repeatability. Each villager gets a random everyday topic to work
around, and the names already invented, so three calls to the same model do not come back as
three lamplighters.

Nothing about it is guaranteed to be good. That is rather the point: it is the quickest way to
show what a small local model can and cannot do.

## Choosing the model

A bar carries two controls: a language switch, which takes effect at once, and a model picker
offering three models, from a 3B default down to a 1B. It sits below the level buttons on the
home page and in the header while you play, so both are reachable without leaving the game.
Changing the model mid-level says so and applies the next time you enter one.

The small model is there on purpose: running the same wish through it shows how quickly a small
language model stops being a reasonable judge.

## Adding a level

Four levels ship with the game, each with its own look: Emberbrook in the woods, the harbour on
a stone quay, the winter road under snow, and Pignola &mdash; CTC 2026, set inside a conference
building, where the villagers are the organisers and a dog. Levels are plain JSON read at runtime
from `public/levels/`, so a new one needs no rebuild &mdash; add a file there and list it in
`public/levels/index.json`.

`theme` picks both the palette and the shape of the map: `village` (woods and ponds), `harbour`
(a stone quay with the sea along one edge), `winter` (snow, tracks and frozen ponds) or `indoor`,
which is one open hall with pillars, aisles and tables rather than open country. It defaults to
`village`.

An index entry can carry `"enabled": false` to take a level out of the game: it disappears from
the menu and refuses to load. `ctc-2026`, written for a specific conference, ships this way so it
can be switched off afterwards by editing one line &mdash; no rebuild, no deploy.

Any text the player reads can be either a plain string or an object of translations. `en` is
required; anything else falls back to it.

```json
{
  "id": "level-04",
  "title": { "en": "The Quiet Marsh", "it": "La palude silenziosa" },
  "theme": "village",
  "seed": 1234,
  "width": 24,
  "height": 18,
  "npcs": [
    {
      "id": "someone",
      "name": "Someone",
      "temper": "How they speak. Wording only — it never changes the verdict.",
      "problem": { "en": "What they need, in their own words.", "it": "Cosa serve loro, a parole loro." },
      "solutionHint": "Never shown to the player. Tells the judge what kind of object works, and what does not."
    }
  ]
}
```

The map is generated from `seed`, so the same seed always produces the same village &mdash;
handy when you want to rehearse a walk. Villagers are only ever placed on tiles the player can
actually reach on foot. Write `solutionHint` carefully: it is the only thing standing between a
fair puzzle and a coin flip.

## Layout

```
src/app/
  core/
    i18n/        model/locale.ts   data/en.ts  data/it.ts   locale.service.ts
    webllm/      model/llm-model.ts   data/llm-models.ts
                 llm.worker.ts  web-llm.service.ts
  shared/        loading-screen/  settings-bar/
  features/
    main-menu/   main-menu.ts + html + scss
    game/
      engine/      the game, which knows nothing about models
        model/     what a level is; the two ports the engine asks for
      ai/          the side that talks to a model
        data/      every prompt the game sends
      components/  play and the four pieces it draws
      game.routes.ts   the game's pages and services, without the models
  app.routes.ts    the only file naming both a port and its implementation
public/levels/   the levels, read at runtime
```

`features/game/ai/data/prompts.ts` is worth opening first: it holds both JSON schemas and
every prompt the game ever sends, so the whole "brain" reads on one screen. Nothing else in the
codebase writes to a model.

Imports go through three aliases &mdash; `@core/*`, `@shared/*` and `@features/*` &mdash; so a
file's first lines say which layer it depends on rather than counting `../`.

Every component is three files that share a name &mdash; `.ts` for the class, `.html` for the
template, `.scss` for its styles &mdash; referenced with `templateUrl` and `styleUrl` relative to
the class. The only exception is the app shell, which has no styles of its own.
