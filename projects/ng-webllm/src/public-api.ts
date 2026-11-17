/*
 * Public API Surface of ng-webllm
 */

export { provideWebLlm, webLlmToken, type WebLlmToken, type WebLlmConfig } from './lib/engine/provide';
export { WebLlm, type EngineConfig } from './lib/engine/web-llm';
export type { LlmBackend, GenerationRequest, GenerationResult, GpuSupport } from './lib/engine/backend';

export { completion, type CompletionOptions, type CompletionRef } from './lib/completion';
export {
  conversation,
  type AddOptions,
  type AsideOptions,
  type ConversationOptions,
  type ConversationRef,
  type ForkOptions,
  type SendOptions,
} from './lib/conversation/conversation';
export {
  generate,
  reply,
  save,
  step,
  type ChainBuilder,
  type ChainFn,
  type ContextOption,
  type GenerateOptions,
  type ReplyPrompt,
  type Step,
  type StepPrompt,
} from './lib/conversation/chain';
export type { Audience, Message } from './lib/conversation/message';

export { s, type DeepPartial, type Infer, type JsonSchema, type Schema } from './lib/schema/schema';
export { parsePartialJson } from './lib/schema/partial-json';

export { LlmError, type LlmErrorCode } from './lib/errors';
export {
  EMPTY_STATS,
  type AskOptions,
  type ChatMessage,
  type Content,
  type ContentPart,
  type Draft,
  type EngineStatus,
  type FinishReason,
  type GenerationOptions,
  type ImagePart,
  type ModelInfo,
  type ModelStats,
  type Phase,
  type Priority,
  type Reply,
  type TextPart,
  type Usage,
} from './lib/types';
