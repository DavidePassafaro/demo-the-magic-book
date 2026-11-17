import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * Starts the WebLLM engine inside a Web Worker. The worker file must live in the
 * app, so the bundler sees it; this is all it needs:
 *
 * ```ts
 * /// <reference lib="webworker" />
 * import { startWebLlmWorker } from 'ng-webllm/worker';
 *
 * startWebLlmWorker();
 * ```
 */
export function startWebLlmWorker(): void {
  const handler = new WebWorkerMLCEngineHandler();
  self.onmessage = (event: MessageEvent): void => handler.onmessage(event);
}
