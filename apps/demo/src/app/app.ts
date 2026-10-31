import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  NXA_REMOTE_THREAD_ITEM,
  provideDataStreamRuntime,
  provideRemoteThreadListRuntime,
  provideRuntimeAdapters,
  provideToolUi,
} from '@ngx-assistant/angular';
import { demoAttachments } from './attachments';
import { threadHistory, threadListAdapter } from './backend-client';
import { Chat } from './chat';
import { ModelPicker } from './model-picker';
import { ThreadSidebar } from './thread-sidebar';
import { EmailApproval, ToolFallback, WeatherCard } from './tool-cards';

/**
 * The demo shell. The conversations live on the backend (`/api/threads`): each one runs on its
 * own runtime, which loads and saves its messages there and posts every run to `/api/chat`. The
 * chat shows the current conversation; the model picked in the header applies to all of them.
 */
@Component({
  selector: 'nxa-demo-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chat, ModelPicker, ThreadSidebar],
  providers: [
    provideRemoteThreadListRuntime({
      adapter: threadListAdapter,
      runtime: () => [
        provideRuntimeAdapters(() => ({ history: threadHistory(inject(NXA_REMOTE_THREAD_ITEM)!) })),
        provideDataStreamRuntime({
          api: '/api/chat',
          // Lets the backend tell a regenerated reply from a new message.
          sendExtraMessageFields: true,
          // Each reply counts its UI message stream steps (`start` and every `start-step`); an
          // answered tool call only resumes the run while the count stays under this limit.
          maxSteps: 10,
          adapters: { attachments: demoAttachments() },
        }),
      ],
    }),
    provideToolUi({ toolName: 'get_weather', component: WeatherCard }),
    provideToolUi({ toolName: 'send_email', component: EmailApproval }),
    provideToolUi({ fallback: ToolFallback }),
  ],
  template: `
    <aside class="sidebar">
      <h1>ngx-assistant</h1>
      <nxa-demo-thread-sidebar />
    </aside>
    <main class="main">
      <header class="header">
        <nxa-demo-model-picker />
        <span class="backend-note">Backend simulated in the browser</span>
      </header>
      <nxa-demo-chat />
    </main>
  `,
})
export class App {}
