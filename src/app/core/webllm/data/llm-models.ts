import type { ModelOption } from '@core/webllm/model/llm-model';

/**
 * The models the settings bar offers, the largest first after the default.
 * The small ones are here on purpose: running the same wish through a 360M and
 * through a 3B, one after the other, is the quickest way to show how little a
 * small language model actually understands. Each note is one short line,
 * because it sits under the dropdown and must not push the bar about.
 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 — 3B',
    approxSizeMb: 2264,
    note: {
      en: 'The default, and by far the fairest judge.',
      it: 'Il predefinito, di gran lunga il più equo.',
    },
  },
  {
    id: 'Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC',
    label: 'Ministral 3 — 3B',
    approxSizeMb: 2864,
    note: {
      en: 'The European one, and the biggest download.',
      it: 'Il modello europeo, il download più pesante.',
    },
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 — 1.5B',
    approxSizeMb: 1630,
    note: {
      en: 'Half the size, and much easier to fool.',
      it: 'Metà del peso, molto più facile da ingannare.',
    },
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 — 1B',
    approxSizeMb: 879,
    note: {
      en: 'Tiny, fast, and a terrible referee.',
      it: 'Minuscolo, veloce e un pessimo arbitro.',
    },
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    label: 'SmolLM2 — 360M',
    approxSizeMb: 376,
    note: {
      en: 'A third of a billion. Barely a judge at all.',
      it: 'Un terzo di miliardo. A malapena un arbitro.',
    },
  },
];

export const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;

export function findModel(id: string): ModelOption {
  return MODEL_OPTIONS.find((model) => model.id === id) ?? MODEL_OPTIONS[0];
}
