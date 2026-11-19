import { LlmError } from '../errors';
import { parsePartialJson } from './partial-json';

/** The JSON Schema subset WebLLM's grammar engine understands, and that `s` produces. */
export type JsonSchema =
  | { readonly type: 'string'; readonly description?: string; readonly enum?: readonly string[] }
  | { readonly type: 'number' | 'integer'; readonly description?: string }
  | { readonly type: 'boolean'; readonly description?: string }
  | {
      readonly type: 'array';
      readonly items: JsonSchema;
      readonly minItems?: number;
      readonly maxItems?: number;
      readonly description?: string;
    }
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, JsonSchema>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
      readonly description?: string;
    };

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * One description of an answer, used four ways: the grammar WebLLM enforces,
 * the type the app reads, the check on the finished answer, and the partial
 * object while the answer streams in.
 */
export interface Schema<T> {
  readonly jsonSchema: JsonSchema;
  toJsonSchema(): string;
  /** The finished answer: JSON.parse plus a check. Throws LlmError('invalid-output'). */
  parse(text: string): T;
  /** Checks a value already parsed. Throws LlmError('invalid-output'). */
  validate(value: unknown): T;
  /** The answer so far. Never throws. */
  parsePartial(text: string): DeepPartial<T> | undefined;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

interface Options {
  /**
   * Kept in the JSON schema for people and tools. WebLLM's grammar does not
   * show it to the model: if the model needs it, put it in the prompt.
   */
  readonly description?: string;
}

function invalid(path: string, expected: string, value: unknown): LlmError {
  const shown = JSON.stringify(value);
  return new LlmError(
    'invalid-output',
    `${path || 'the answer'} should be ${expected}, got ${shown === undefined ? 'nothing' : shown}`,
  );
}

// 👇👇👇 ng-webllm - One schema, four uses
function define<T>(jsonSchema: JsonSchema, check: (value: unknown, path: string) => T): Schema<T> & {
  readonly check: (value: unknown, path: string) => T;
} {
  return {
    jsonSchema,
    check,
    toJsonSchema: () => JSON.stringify(jsonSchema),
    validate: (value) => check(value, ''),
    parse(text) {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (cause) {
        throw new LlmError('invalid-output', 'the answer is not valid JSON', { cause });
      }
      return check(value, '');
    },
    parsePartial: (text) => parsePartialJson(text) as DeepPartial<T> | undefined,
  };
}

type Checked<T> = Schema<T> & { readonly check: (value: unknown, path: string) => T };

function checkerOf<T>(schema: Schema<T>): (value: unknown, path: string) => T {
  return (schema as Checked<T>).check ?? ((value) => schema.validate(value));
}

function string(options: Options = {}): Schema<string> {
  return define({ type: 'string', ...options }, (value, path) => {
    if (typeof value !== 'string') {
      throw invalid(path, 'a string', value);
    }
    return value;
  });
}

function number(options: Options = {}): Schema<number> {
  return define({ type: 'number', ...options }, (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw invalid(path, 'a number', value);
    }
    return value;
  });
}

function integer(options: Options = {}): Schema<number> {
  return define({ type: 'integer', ...options }, (value, path) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw invalid(path, 'an integer', value);
    }
    return value;
  });
}

function boolean(options: Options = {}): Schema<boolean> {
  return define({ type: 'boolean', ...options }, (value, path) => {
    if (typeof value !== 'boolean') {
      throw invalid(path, 'true or false', value);
    }
    return value;
  });
}

function enumeration<const V extends readonly string[]>(values: V, options: Options = {}): Schema<V[number]> {
  return define({ type: 'string', enum: values, ...options }, (value, path) => {
    if (typeof value !== 'string' || !values.includes(value)) {
      throw invalid(path, `one of ${values.join(', ')}`, value);
    }
    return value as V[number];
  });
}

function array<T>(
  item: Schema<T>,
  options: Options & { readonly minItems?: number; readonly maxItems?: number } = {},
): Schema<T[]> {
  const checkItem = checkerOf(item);

  return define({ type: 'array', items: item.jsonSchema, ...options }, (value, path) => {
    if (!Array.isArray(value)) {
      throw invalid(path, 'a list', value);
    }
    if (options.minItems !== undefined && value.length < options.minItems) {
      throw invalid(path, `a list of at least ${options.minItems}`, value);
    }
    if (options.maxItems !== undefined && value.length > options.maxItems) {
      throw invalid(path, `a list of at most ${options.maxItems}`, value);
    }
    return value.map((entry, index) => checkItem(entry, `${path}[${index}]`));
  });
}

/**
 * The order of the keys is the order in which the model writes the fields:
 * put the reasoning before the verdict.
 */
function object<const Shape extends Readonly<Record<string, Schema<unknown>>>>(
  shape: Shape,
  options: Options = {},
): Schema<{ -readonly [K in keyof Shape]: Infer<Shape[K]> }> {
  const keys = Object.keys(shape);
  const properties = Object.fromEntries(keys.map((key) => [key, shape[key].jsonSchema]));

  return define(
    { type: 'object', properties, required: keys, additionalProperties: false, ...options },
    (value, path) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalid(path, 'an object', value);
      }

      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = checkerOf(shape[key])(record[key], path ? `${path}.${key}` : key);
      }
      return result as { -readonly [K in keyof Shape]: Infer<Shape[K]> };
    },
  );
}

/** Builders for the schema of an answer. */
export const s = {
  string,
  number,
  integer,
  boolean,
  enum: enumeration,
  array,
  object,
};

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace s {
  /** `s.Infer<typeof verdict>`: the type of a schema's value. */
  type Infer<S> = S extends Schema<infer T> ? T : never;
}
