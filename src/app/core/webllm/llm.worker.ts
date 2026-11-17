/// <reference lib="webworker" />
import { startWebLlmWorker } from 'ng-webllm/worker';

/** Inference runs here, off the main thread. */
// 👇👇👇 WebLLM - Worker
startWebLlmWorker();
