import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { installFakeBackend } from './backend/fake-backend';

// The demo is a static site: its backend runs in the page. Drop this line to use a real one.
installFakeBackend();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
