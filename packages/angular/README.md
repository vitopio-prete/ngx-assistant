# @ngx-assistant/angular

Angular bindings (signals + dependency injection) and headless primitives for
[`@ngx-assistant/engine`](../engine).

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { fromRuntime, injectThread, provideLocalRuntime } from '@ngx-assistant/angular';

@Component({
  selector: 'app-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideLocalRuntime(myChatModel)],
  template: `<p>{{ isRunning() ? 'thinking…' : 'idle' }}</p>`,
})
export class Chat {
  private readonly thread = injectThread();
  protected readonly isRunning = fromRuntime(this.thread, (s) => s.isRunning);
}
```

## Runtimes

`provideLocalRuntime(chatModel, options?)` creates a runtime that runs the chat in the browser and
provides it to an injector: a component, a route or the whole app. `chatModel` and `options` can be
factories run in the injection context, so an adapter can `inject()` what it needs; they are read
once, when the runtime is first injected. Destroying the injector aborts the running stream and
ends voice, dictation and speech.

## Scopes

Each runtime lives in a scope of the injector tree, and `inject*()` returns the nearest one:

| Function             | Token            | Provided by                                                        |
| -------------------- | ---------------- | ------------------------------------------------------------------ |
| `injectAssistant()`  | `NXA_ASSISTANT`  | `provideLocalRuntime(...)`, `provideAssistantScope(() => runtime)` |
| `injectThread()`     | `NXA_THREAD`     | `provideLocalRuntime(...)`                                         |
| `injectComposer()`   | `NXA_COMPOSER`   | the runtime (thread composer) or a message                         |
| `injectMessage()`    | `NXA_MESSAGE`    | `provideMessageScope(() => message)`                               |
| `injectPart()`       | `NXA_PART`       | `providePartScope(() => part)`                                     |
| `injectAttachment()` | `NXA_ATTACHMENT` | `provideAttachmentScope(() => attachment)`                         |

Inside a message scope `injectComposer()` returns the message's edit composer; the thread composer
stays reachable as `injectThread().composer`. A missing scope throws, unless you pass
`{ optional: true }` to get `null`. A nested runtime provider isolates its subtree from the outer
scopes.

Key a message scope by id, `provideMessageScope(() => thread.getMessageById(id))`, when the rows
are tracked by `message.id`: a runtime taken by index follows the index, not the message, when the
thread changes.

## Signals

`fromRuntime(runtime, selector?, options?)` turns any runtime into a read-only `Signal`. It
subscribes once, unsubscribes when the injector is destroyed, and wakes consumers only when the
selection changes (`Object.is`, or `options.equal`). The selector can read other signals too.
Outside an injection context, pass `options.injector`. After the injector is destroyed the signal
keeps its last value.

Runtimes notify synchronously, so change them from event handlers, effects or lifecycle hooks, not
inside a `computed` or a template expression, where Angular rejects the resulting signal write
(NG0600).

```bash
pnpm ng build @ngx-assistant/angular   # output in dist/angular
pnpm ng test @ngx-assistant/angular
```
