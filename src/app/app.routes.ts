import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'The Magic Book',
    loadComponent: () => import('./features/main-menu/main-menu').then((m) => m.MainMenu),
  },
  {
    path: 'play',
    loadChildren: () => import('./features/game/game.routes').then((m) => m.gameRoutes),
  },
  { path: '**', redirectTo: '' },
];
