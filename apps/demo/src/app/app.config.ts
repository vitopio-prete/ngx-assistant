import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  NXA_REMOTE_THREAD_ITEM,
  provideDataStreamRuntime,
  provideRemoteThreadListRuntime,
  provideRuntimeAdapters,
  provideToolUi,
} from '@ngx-assistant/angular';
import { demoAttachments } from './attachments';
import { threadHistory, threadListAdapter } from './backend-client';
import { EmailApproval, WeatherCard } from './tool-cards';

/**
 * The conversations live on the backend (`/api/threads`): each one runs on its own runtime, which
 * loads and saves its messages there and posts every run to `/api/chat`. Tool calls without a UI of
 * their own show in the tool fallback of the copied components.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRemoteThreadListRuntime({
      adapter: threadListAdapter,
      runtime: () => [
        provideRuntimeAdapters(() => ({ history: threadHistory(inject(NXA_REMOTE_THREAD_ITEM)!) })),
        provideDataStreamRuntime({
          api: '/api/chat',
          // Lets the backend tell a regenerated reply from a new message.
          sendExtraMessageFields: true,
          adapters: { attachments: demoAttachments() },
        }),
      ],
    }),
    provideToolUi({ toolName: 'get_weather', component: WeatherCard }),
    provideToolUi({ toolName: 'send_email', component: EmailApproval }),
  ],
};
