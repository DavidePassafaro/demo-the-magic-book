import { Routes } from '@angular/router';
import { Play } from '@features/game/components/play/play';
import { GameService } from '@features/game/engine/game.service';
import { JudgeService } from '@features/game/ai/judge.service';
import { LevelGeneratorService } from '@features/game/ai/level-generator.service';
import { ObjectRecognizerService } from '@features/game/ai/object-recognizer.service';

/**
 * The game's pages and its own services. The models are not here: the engines
 * are registered once for the whole app (`provideMagicBookModels`), because the
 * main menu already chooses the model.
 */
export const gameRoutes: Routes = [
  {
    path: ':levelId',
    title: 'Playing — The Magic Book',
    component: Play,
    providers: [GameService, JudgeService, LevelGeneratorService, ObjectRecognizerService],
  },
];
