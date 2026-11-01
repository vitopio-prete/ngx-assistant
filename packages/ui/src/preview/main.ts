import { bootstrapApplication } from '@angular/platform-browser';
import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { PreviewApp } from './preview-app';

bootstrapApplication(PreviewApp, { providers: [provideBrowserGlobalErrorListeners()] }).catch(
  (error: unknown) => console.error(error),
);
