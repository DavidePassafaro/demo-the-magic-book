/**
 * Reads JSON that is still being written. Strings grow as they arrive; numbers,
 * booleans and null appear only once they are complete; a key appears only
 * once its value has started. Never throws: it returns what it could read.
 */
export function parsePartialJson(text: string): unknown {
  const parser = new PartialParser(text);
  return parser.parse()?.value;
}

interface Parsed {
  readonly value: unknown;
  /** False when the input ended inside this value. */
  readonly complete: boolean;
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

const LITERALS: readonly (readonly [string, unknown])[] = [
  ['true', true],
  ['false', false],
  ['null', null],
];

class PartialParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): Parsed | null {
    this.skipWhitespace();
    return this.value();
  }

  /** Null when nothing usable was read: the input ended before the value took shape. */
  private value(): Parsed | null {
    if (this.atEnd()) {
      return null;
    }

    const char = this.text[this.pos];
    if (char === '{') {
      return this.object();
    }
    if (char === '[') {
      return this.array();
    }
    if (char === '"') {
      return this.string();
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      return this.number();
    }

    return this.literal();
  }

  private object(): Parsed {
    this.pos++;
    const result: Record<string, unknown> = {};

    while (true) {
      this.skipWhitespace();
      if (this.atEnd()) {
        return { value: result, complete: false };
      }

      const char = this.text[this.pos];
      if (char === '}') {
        this.pos++;
        return { value: result, complete: true };
      }
      if (char === ',') {
        this.pos++;
        continue;
      }
      if (char !== '"') {
        return { value: result, complete: false };
      }

      const key = this.string();
      if (!key.complete) {
        return { value: result, complete: false };
      }

      this.skipWhitespace();
      if (this.atEnd() || this.text[this.pos] !== ':') {
        return { value: result, complete: false };
      }
      this.pos++;
      this.skipWhitespace();

      const entry = this.value();
      if (!entry) {
        return { value: result, complete: false };
      }

      result[key.value as string] = entry.value;
      if (!entry.complete) {
        return { value: result, complete: false };
      }
    }
  }

  private array(): Parsed {
    this.pos++;
    const result: unknown[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.atEnd()) {
        return { value: result, complete: false };
      }

      const char = this.text[this.pos];
      if (char === ']') {
        this.pos++;
        return { value: result, complete: true };
      }
      if (char === ',') {
        this.pos++;
        continue;
      }

      const item = this.value();
      if (!item) {
        return { value: result, complete: false };
      }

      result.push(item.value);
      if (!item.complete) {
        return { value: result, complete: false };
      }
    }
  }

  private string(): Parsed {
    this.pos++;
    let result = '';

    while (!this.atEnd()) {
      const char = this.text[this.pos];

      if (char === '"') {
        this.pos++;
        return { value: result, complete: true };
      }

      if (char !== '\\') {
        result += char;
        this.pos++;
        continue;
      }

      // An escape cut in half is left out until the rest of it arrives.
      const code = this.text[this.pos + 1];
      if (code === undefined) {
        break;
      }
      if (code === 'u') {
        const hex = this.text.slice(this.pos + 2, this.pos + 6);
        if (hex.length < 4) {
          break;
        }
        result += String.fromCharCode(parseInt(hex, 16));
        this.pos += 6;
        continue;
      }

      result += ESCAPES[code] ?? code;
      this.pos += 2;
    }

    this.pos = this.text.length;
    return { value: result, complete: false };
  }

  /** A number that touches the end of the input may still grow: it is left out. */
  private number(): Parsed | null {
    const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
    if (!match || this.pos + match[0].length >= this.text.length) {
      this.pos = this.text.length;
      return null;
    }

    this.pos += match[0].length;
    return { value: Number(match[0]), complete: true };
  }

  private literal(): Parsed | null {
    const rest = this.text.slice(this.pos);

    for (const [word, value] of LITERALS) {
      if (rest.startsWith(word)) {
        this.pos += word.length;
        return { value, complete: true };
      }
    }

    this.pos = this.text.length;
    return null;
  }

  private skipWhitespace(): void {
    while (!this.atEnd() && /\s/.test(this.text[this.pos])) {
      this.pos++;
    }
  }

  private atEnd(): boolean {
    return this.pos >= this.text.length;
  }
}
