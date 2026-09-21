import { Routes } from '@angular/router';
import { Play } from '@features/game/components/play/play';
import { LEVEL_INVENTOR, OBJECT_RECOGNIZER, REFEREE } from '@features/game/engine/model/contracts';
import { GameService } from '@features/game/engine/game.service';
import { JudgeService } from '@features/game/ai/judge.service';
import { LevelGeneratorService } from '@features/game/ai/level-generator.service';
import { ObjectRecognizerService } from '@features/game/ai/object-recognizer.service';

/**
 * The game's composition root. It is the only file that names both a contract
 * and the class behind it, and it lives inside the lazy chunk so that opening the
 * menu never downloads a language model runtime.
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
