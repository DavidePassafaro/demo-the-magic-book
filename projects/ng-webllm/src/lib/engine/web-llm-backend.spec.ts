import { isModelLost } from './web-llm-backend';

describe('isModelLost', () => {
  it('recognises the errors after which WebLLM has no model, as the worker sends them', () => {
    // From the worker, errors arrive as err.toString(): a plain string.
    expect(isModelLost('ModelNotLoadedError: Model not loaded before trying to complete ChatCompletionRequest.')).toBe(true);
    expect(isModelLost('WorkerEngineModelNotLoadedError: WebWorkerMLCEngine is not loaded with a model.')).toBe(true);
    expect(isModelLost('DeviceLostError: The WebGPU device was lost while loading the model.')).toBe(true);
    expect(isModelLost('BindingError: Cannot pass deleted object as a pointer of type GrammarMatcher*')).toBe(true);
  });

  it('recognises them as Error objects too, named or wrapped', () => {
    const named = new Error('The WebGPU device was lost.');
    named.name = 'DeviceLostError';

    expect(isModelLost(named)).toBe(true);
    expect(isModelLost(new Error('ModelNotLoadedError: Model not loaded.'))).toBe(true);
  });

  it('leaves every other error alone, whatever its words', () => {
    expect(isModelLost('ContextWindowSizeExceededError: Prompt tokens exceed the context window.')).toBe(false);
    expect(isModelLost(new Error('The model was not loaded in time.'))).toBe(false);
    expect(isModelLost('Something about a ModelNotLoadedError in the middle')).toBe(false);
  });
});
