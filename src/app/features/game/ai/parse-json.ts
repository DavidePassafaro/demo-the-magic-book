/**
 * Reads the JSON object out of a model's answer. Constrained decoding makes it
 * JSON by construction, but small models sometimes wrap it in a sentence.
 */
export function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('The book wrote something unreadable.');
  }

  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The book wrote something unreadable.');
  }

  return parsed as Record<string, unknown>;
}

/** A string field, trimmed; empty when missing. */
export function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === 'string' ? value.trim() : '';
}

/** A string field that must be there. */
export function requiredField(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key);

  if (value.length < 3) {
    throw new Error(`The book left "${key}" blank.`);
  }

  return value;
}
