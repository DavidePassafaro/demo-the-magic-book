import { Routes } from '@angular/router';
import { LanguageModel, VisionModel } from '@core/llm/language-model';
import { WebLlmChatModel } from '@core/webllm/web-llm-chat.model';
import { WebLlmVisionModel } from '@core/webllm/web-llm-vision.model';
import { Play } from '@features/game/components/play/play';
import { GameService } from '@features/game/engine/game.service';
import { JudgeService } from '@features/game/ai/judge.service';
import { LevelGeneratorService } from '@features/game/ai/level-generator.service';
import { ObjectRecognizerService } from '@features/game/ai/object-recognizer.service';

/**
 * Composition root: the only place that decides which models the game talks to.
 * To run on another provider, local or remote, change the two bindings below.
 * Lazy-loaded, so the menu never downloads the WebLLM runtime.
 */
export const gameRoutes: Routes = [
  {
    path: ':levelId',
    title: 'Playing — The Magic Book',
    component: Play,
    providers: [
      GameService,
      JudgeService,
      LevelGeneratorService,
      ObjectRecognizerService,
      // 👇👇👇 Game - Contract → model
      { provide: LanguageModel, useExisting: WebLlmChatModel },
      { provide: VisionModel, useExisting: WebLlmVisionModel },
    ],
  },
];
