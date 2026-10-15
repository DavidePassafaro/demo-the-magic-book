import type { ModelOption } from '@core/webllm/model/llm-model';

/**
 * The models offered in the settings bar. The small ones are there on purpose:
 * the same wish judged by a 3B and by a 360M shows how much size matters.
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
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 — 2B',
    approxSizeMb: 1895,
    note: {
      en: 'Google’s, and widely multilingual.',
      it: 'Di Google, addestrato su molte lingue.',
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

/** The vision model: never in the dropdown, loaded only when the camera is first used. */
export const VISION_MODEL = {
  id: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
  label: 'Phi-3.5 Vision',
  approxSizeMb: 3952,
  /**
   * 3:2 on purpose: one image must fit in a 2048-token prefill chunk, and a
   * square photo becomes 16 tiles (2509 tokens) while 3:2 becomes 12 (1921).
   */
  frame: { width: 504, height: 336 },
} as const;

export function findModel(id: string): ModelOption {
  return MODEL_OPTIONS.find((model) => model.id === id) ?? MODEL_OPTIONS[0];
}

export function modelLabel(id: string): string {
  return id === VISION_MODEL.id ? VISION_MODEL.label : findModel(id).label;
}
