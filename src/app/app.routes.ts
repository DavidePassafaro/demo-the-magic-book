import { Routes } from '@angular/router';
import { LanguageModel, VisionModel } from '@core/llm/language-model';

export const routes: Routes = [
  {
    path: '',
    title: 'The Magic Book',
    loadComponent: () => import('./features/main-menu/main-menu').then((m) => m.MainMenu),
  },
  {
    path: 'play',
    loadChildren: async () => {
      const [{ gameRoutes }, { WebLlmChatModel }, { WebLlmVisionModel }] = await Promise.all([
        import('@features/game/game.routes'),
        import('@core/webllm/web-llm-chat.model'),
        import('@core/webllm/web-llm-vision.model'),
      ]);

      return [
        {
          path: '',
          providers: [
            // 👇👇👇 Game - Contract → model
            { provide: LanguageModel, useExisting: WebLlmChatModel },
            { provide: VisionModel, useExisting: WebLlmVisionModel },
          ],
          children: gameRoutes,
        },
      ];
    },
  },
  { path: '**', redirectTo: '' },
];
