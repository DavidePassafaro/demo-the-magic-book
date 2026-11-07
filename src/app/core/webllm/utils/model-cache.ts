import { hasModelInCache, prebuiltAppConfig, type AppConfig } from '@mlc-ai/web-llm';

/** The fallback used when Cache Storage refuses a download. */
export const INDEXEDDB_CONFIG: AppConfig = { ...prebuiltAppConfig, cacheBackend: 'indexeddb' };

/** Whether the browser already holds this model, in either cache backend. */
export async function isModelCached(id: string): Promise<boolean> {
  try {
    return (await hasModelInCache(id)) || (await hasModelInCache(id, INDEXEDDB_CONFIG));
  } catch {
    return false;
  }
}

/** Cache Storage fails like this when the quota is full or an entry is corrupted. */
export function isCacheStorageError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    message.includes("Failed to execute 'add' on 'Cache'") ||
    message.includes('QuotaExceededError') ||
    message.includes('ArtifactCache')
  );
}
