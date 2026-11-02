import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Chat } from './chat';
import { ModelPicker } from './model-picker';
import { ThreadSidebar } from './thread-sidebar';

/**
 * The demo shell, on the runtimes of the app config. The chat shows the current conversation; the
 * model picked in the header applies to all of them.
 */
@Component({
  selector: 'nxa-demo-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chat, ModelPicker, ThreadSidebar],
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
