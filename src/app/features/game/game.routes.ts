import { Routes } from '@angular/router';
import { Play } from '@features/game/components/play/play';
import { LEVEL_INVENTOR, OBJECT_RECOGNIZER, REFEREE } from '@features/game/engine/model/contracts';
import { GameService } from '@features/game/engine/game.service';
import { JudgeService } from '@features/game/ai/judge.service';
import { LevelGeneratorService } from '@features/game/ai/level-generator.service';
import { ObjectRecognizerService } from '@features/game/ai/object-recognizer.service';

/**
 * Composition root: the only place that binds each contract to its AI service.
 * Lazy-loaded, so the menu never downloads the WebLLM runtime.
 */
export const gameRoutes: Routes = [
  {
    path: ':levelId',
    title: 'Playing — The Magic Book',
    component: Play,
    providers: [
      GameService,
      { provide: REFEREE, useExisting: JudgeService },
      { provide: LEVEL_INVENTOR, useExisting: LevelGeneratorService },
      { provide: OBJECT_RECOGNIZER, useExisting: ObjectRecognizerService },
    ],
  },
];
