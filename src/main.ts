import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { announceLogs } from './app/core/logger/logger';

announceLogs();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
