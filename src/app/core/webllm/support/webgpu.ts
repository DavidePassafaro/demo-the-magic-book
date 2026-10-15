import type { WebGpuSupport } from '@core/webllm/model/llm-model';
import { log } from '@core/logger/logger';

interface GpuLike {
  requestAdapter(): Promise<{ info?: { vendor?: string } } | null>;
}

/** WebLLM needs WebGPU: checking first lets the game say so politely. */
export async function detectWebGpu(): Promise<WebGpuSupport> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) {
    log.warn('engine', 'WebGPU is not available in this browser');
    return 'no-api';
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      log.warn('engine', 'WebGPU is present but offered no adapter');
      return 'no-adapter';
    }
    return 'supported';
  } catch (cause) {
    log.error('engine', 'WebGPU adapter request failed', cause);
    return 'no-adapter';
  }
}
