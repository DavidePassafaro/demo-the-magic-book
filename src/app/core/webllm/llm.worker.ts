/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * Inference runs here so that token sampling never janks the map.
 * The handler does all the work; this file only forwards messages.
 */
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent): void => {
  handler.onmessage(event);
};
