/** A string field, trimmed; empty when missing. */
export function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === 'string' ? value.trim() : '';
}

/** A string field that must be there: a small model sometimes leaves one nearly blank. */
export function requiredField(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key);

  if (value.length < 3) {
    throw new Error(`The book left "${key}" blank.`);
  }

  return value;
}
