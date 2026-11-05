import type { Locale } from '@core/i18n/model/locale';

export type TileKind = 'grass' | 'path' | 'tree' | 'rock' | 'water';

/**
 * Drives both the palette and the shape of the map. Everything but `indoor` is
 * open country; `indoor` is generated as rooms joined by corridors.
 */
export type Theme = 'village' | 'harbour' | 'winter' | 'indoor';

export const THEMES: readonly Theme[] = ['village', 'harbour', 'winter', 'indoor'];

/** The level id the router uses for a village that does not exist yet. */
export const RANDOM_LEVEL_ID = 'random';

export const WALKABLE_TILES: readonly TileKind[] = ['grass', 'path'];

/** Text the player reads, in every language the level offers. English is required. */
export type LocalizedText = { readonly en: string } & Partial<Record<Locale, string>>;

export function text(value: LocalizedText, locale: Locale): string {
  return value[locale] ?? value.en;
}

export interface NpcConfig {
  readonly id: string;
  readonly name: string;
  /** Free text, fed to the model. Shapes wording only, never the verdict. */
  readonly temper: string;
  readonly problem: LocalizedText;
  /** Never shown to the player. Tells the judge what kind of object should work. */
  readonly solutionHint: string;
}

export interface Level {
  readonly id: string;
  readonly title: LocalizedText;
  readonly theme: Theme;
  /** Fixed seed keeps the map identical between a rehearsal and the talk. */
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly npcs: readonly NpcConfig[];
}

export interface LevelSummary {
  readonly id: string;
  readonly title: LocalizedText;
  readonly file: string;
  /** Set to false in levels/index.json to take a level out of the game. */
  readonly enabled: boolean;
}

function asString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}.${key} must be a non-empty string`);
  }
  return value;
}

function asNumber(source: Record<string, unknown>, key: string, where: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}.${key} must be a number`);
  }
  return value;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Accepts either "text" or { "en": "...", "it": "...", "es": "..." }. */
function asLocalized(source: Record<string, unknown>, key: string, where: string): LocalizedText {
  const value = source[key];

  if (typeof value === 'string') {
    return value.trim() !== ''
      ? { en: value }
      : (() => {
          throw new Error(`${where}.${key} must not be empty`);
        })();
  }

  const record = asRecord(value, `${where}.${key}`);
  const result: Record<string, string> = { en: asString(record, 'en', `${where}.${key}`) };

  for (const [locale, translation] of Object.entries(record)) {
    if (locale === 'en') {
      continue;
    }
    if (typeof translation !== 'string' || translation.trim() === '') {
      throw new Error(`${where}.${key}.${locale} must be a non-empty string`);
    }
    result[locale] = translation;
  }

  return result as LocalizedText;
}

/** Validates a level file loudly, naming the offending field. */
export function parseLevel(raw: unknown): Level {
  const source = asRecord(raw, 'level');
  const npcsRaw = source['npcs'];

  if (!Array.isArray(npcsRaw) || npcsRaw.length === 0) {
    throw new Error('level.npcs must be a non-empty array');
  }

  const npcs = npcsRaw.map((entry, index) => {
    const where = `level.npcs[${index}]`;
    const npc = asRecord(entry, where);
    return {
      id: asString(npc, 'id', where),
      name: asString(npc, 'name', where),
      temper: asString(npc, 'temper', where),
      problem: asLocalized(npc, 'problem', where),
      solutionHint: asString(npc, 'solutionHint', where),
    } satisfies NpcConfig;
  });

  const theme = source['theme'] ?? 'village';

  if (typeof theme !== 'string' || !THEMES.includes(theme as Theme)) {
    throw new Error(`level.theme must be one of: ${THEMES.join(', ')}`);
  }

  return {
    id: asString(source, 'id', 'level'),
    title: asLocalized(source, 'title', 'level'),
    theme: theme as Theme,
    seed: asNumber(source, 'seed', 'level'),
    width: asNumber(source, 'width', 'level'),
    height: asNumber(source, 'height', 'level'),
    npcs,
  };
}

export function parseLevelIndex(raw: unknown): LevelSummary[] {
  if (!Array.isArray(raw)) {
    throw new Error('levels/index.json must be an array');
  }

  return raw.map((entry, index) => {
    const where = `levels[${index}]`;
    const summary = asRecord(entry, where);
    const enabled = summary['enabled'] ?? true;

    if (typeof enabled !== 'boolean') {
      throw new Error(`${where}.enabled must be true or false`);
    }

    return {
      id: asString(summary, 'id', where),
      title: asLocalized(summary, 'title', where),
      file: asString(summary, 'file', where),
      enabled,
    } satisfies LevelSummary;
  });
}
