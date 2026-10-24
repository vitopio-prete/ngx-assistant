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

`provideExternalStoreRuntime(adapter)` keeps the messages in your own store: the runtime reads
them from the adapter and calls `onNew`, `onEdit`, `onReload`, `onCancel`… for you to update the
store. `adapter` can be an adapter, a `Signal` of one, or a factory returning either, run once in
the injection context. Return a `computed` from the factory to keep the runtime in sync with your
signals: each new adapter is handed to the runtime by an effect, at the next change detection. A
plain adapter is read once, even if the factory read signals to build it.

```ts
providers: [
  provideExternalStoreRuntime(() => {
    const store = inject(ChatStore);
    return computed(() => ({
      messages: store.messages(),
      isRunning: store.isRunning(),
      onNew: (message) => store.send(message),
    }));
  }),
];
```

Destroying the injector fences the thread's in-flight work, such as an attachment upload still
pending, and ends voice, dictation and speech. It does not call `onCancel`: a run in your store goes
on until you stop it.

## Scopes

Each runtime lives in a scope of the injector tree, and `inject*()` returns the nearest one:

| Function             | Token            | Provided by                                                |
| -------------------- | ---------------- | ---------------------------------------------------------- |
| `injectAssistant()`  | `NXA_ASSISTANT`  | a runtime provider, `provideAssistantScope(() => runtime)` |
| `injectThread()`     | `NXA_THREAD`     | a runtime provider                                         |
| `injectComposer()`   | `NXA_COMPOSER`   | the runtime (thread composer) or a message                 |
| `injectMessage()`    | `NXA_MESSAGE`    | `provideMessageScope(() => message)`                       |
| `injectMessageUi()`  | `NXA_MESSAGE_UI` | `provideMessageScope(() => message)`                       |
| `injectPart()`       | `NXA_PART`       | `providePartScope(() => part)`                             |
| `injectAttachment()` | `NXA_ATTACHMENT` | `provideAttachmentScope(() => attachment)`                 |

Inside a message scope `injectComposer()` returns the message's edit composer; the thread composer
stays reachable as `injectThread().composer`. `injectMessageUi()` holds the view state of the message
that the runtime does not keep, as writable signals: `isHovering` and `isCopied`. A missing scope throws, unless you pass
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

## Events

`injectNxaEvent(selector, callback, options?)` calls `callback` whenever an event fires, until the
injector is destroyed or the returned ref's `destroy()` is called.

```ts
injectNxaEvent('thread.runEnd', ({ threadId }) => this.saved.set(threadId));
injectNxaEvent({ scope: 'thread', event: 'message.error' }, ({ messageId }) =>
  this.toast(messageId),
);
```

| Event                                                           | Heard in                                        |
| --------------------------------------------------------------- | ----------------------------------------------- |
| `thread.runStart`, `runEnd`, `initialize`, `modelContextUpdate` | `thread`, `threads`, `*`                        |
| `thread.historyWriteError`, `toolApprovalAnswered`              | `thread`, `threads`, `*`                        |
| `composer.send`, `attachmentAdd`, `attachmentAddError`          | `composer`, `message`, `thread`, `threads`, `*` |
| `message.error`                                                 | `message`, `thread`, `threads`, `*`             |
| `threads.selectionChanged`                                      | `threads`, `*`                                  |

A plain event name is heard in the nearest scope of its source: `'composer.attachmentAdd'` inside
a message scope hears that message's edit composer. `{ scope, event }` widens it: `'thread'` hears
the thread composer and the edit composer of every message, `'threads'` and `'*'` the whole
assistant. There, the main thread reports every event, and the threads a thread list keeps running
in the background report the run, initialization and model context events. A missing scope throws.

Callbacks run on a microtask, after the runtime has notified, so they read the updated state and
can write signals. Errors, thrown or rejected, go to Angular's `ErrorHandler`.

- `composer.send` reports the composers' own sends, including the send that ends an edit (whose
  `messageId` is the edited message, not the one that replaces it), but not `thread.append(...)`.
- `thread.initialize` also reaches a subscription that starts on, or follows the selection to, a
  thread that is already initialized, once.

## Composer primitives

Headless directives for the composer: they bring behavior and state attributes, no styles.
They work on the nearest composer, so the same markup is the thread composer at the top level and
a message's edit composer inside a message scope.

```ts
import {
  NxaComposerCancel,
  NxaComposerInput,
  NxaComposerRoot,
  NxaComposerSend,
} from '@ngx-assistant/angular';
```

```html
<form nxaComposerRoot>
  <textarea nxaComposerInput aria-label="Message" [autoFocus]="true"></textarea>
  <button nxaComposerSend>Send</button>
  <button nxaComposerCancel>Stop</button>
</form>
```

| Directive                    | Behavior                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `[nxaComposerRoot]`          | Submitting sends the composer; a primary mousedown on blank space focuses the input. Sets `data-nxa-composer-type`. |
| `textarea[nxaComposerInput]` | Bound to the composer text. Enter sends, Escape cancels, pasted files become attachments. Disabled with the thread. |
| `button[nxaComposerSend]`    | Sends. Disabled while the composer cannot send, or during a run when the runtime does not queue.                    |
| `button[nxaComposerCancel]`  | Stops the run of a thread composer, ends the edit of an edit composer. Disabled while there is nothing to cancel.   |

`nxaComposerInput` options:

- `submitMode`: `'enter'` (default; Shift+Enter inserts a newline), `'ctrlEnter'` (Ctrl/Cmd+Enter
  sends, Enter inserts a newline) or `'none'`. An Enter that cannot send inserts a newline, and keys
  that belong to an IME composition never send. With the `queue` capability, Ctrl/Cmd+Shift+Enter
  sends the draft ahead of the queue.
- `cancelOnEscape` (default `true`), `addAttachmentOnPaste` (default `true`).
- `autoFocus`: takes the focus when the input appears. With it, `focusOnRunStart`,
  `focusOnThreadSwitched` and `focusOnScrollToBottom` (all default `true`) bring the focus back when
  the thread composer starts a run, unless the focus is elsewhere on the page, when the thread list
  switches threads and when the surrounding thread viewport is scrolled to the bottom.
- `disabled` adds to the composer state; `nxaComposerSend` and `nxaComposerCancel` take it too.

The primitives listen on their own element, before the listeners of your template on the same
element. To veto one, call `event.preventDefault()` in a capture-phase listener, for example on an
ancestor with `addEventListener('keydown', veto, { capture: true })`. The root always sends on
submit, so Angular forms (`NgForm`, `[formGroup]`), which prevent the default submit, can sit on the
same `<form>`.

Ending an edit from the keyboard, with Escape or a keyboard activation of the cancel button, moves
the focus to the thread composer of the same thread root (`nxaThreadRoot`), unless a handler moved
it elsewhere.

## Thread primitives

Headless directives for the frame of a thread: the root, the scrollable viewport and what sits in
it.

```ts
import {
  NxaScrollToBottom,
  NxaThreadRoot,
  NxaThreadViewport,
  NxaThreadViewportFooter,
} from '@ngx-assistant/angular';
```

```html
<section nxaThreadRoot>
  <div nxaThreadViewport class="viewport">
    <!-- messages -->
    <div nxaThreadViewportFooter class="footer">
      <button nxaScrollToBottom aria-label="Scroll to bottom">↓</button>
      <form nxaComposerRoot>...</form>
    </div>
  </div>
</section>
```

| Directive                   | Behavior                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `[nxaThreadRoot]`           | Sets `data-nxa-thread-root`, which bounds the composer focus rules. An unhandled Escape stops the thread's speech. |
| `[nxaThreadViewport]`       | Keeps the thread pinned to the bottom while the reader is there. Sets `data-nxa-at-bottom` while at the bottom.    |
| `[nxaThreadViewportFooter]` | Adds its height to the viewport's bottom inset, so content under a sticky footer still counts as at the bottom.    |
| `button[nxaScrollToBottom]` | Scrolls the viewport to the bottom. Disabled while it is already there, or outside a viewport.                     |

`nxaThreadViewport` needs a bounded height and `overflow-y: auto`. While the reader sits at the
bottom, growing content (a streaming reply, an image that loads, a footer that grows) keeps it
there; scrolling up stops the follow until the reader returns to the bottom. A wheel, touch,
pointer or scroll key cancels a scroll still in flight, and opening a collapsed disclosure inside
a message (`aria-expanded="false"`, a closed `<details>`) pauses the follow so the opened content
stays in view. When older messages are prepended, the rows the reader is looking at stay in place.
Messages are found by their `data-nxa-message-id` attribute. A viewport nested in another one
takes over the scroll channel for its content.

Options, all default `true`: `autoScroll` (follow growing content), `scrollToBottomOnInitialize`
(scroll down once the thread has messages), `scrollToBottomOnRunStart`,
`scrollToBottomOnThreadSwitch`. The directive provides `NXA_THREAD_VIEWPORT` to its content and is
exported as `nxaThreadViewport`, with `isAtBottom()`, `scrollToBottom(behavior?)`,
`registerContentInset()` and `onScrollToBottom(callback)`.

`nxaScrollToBottom` takes `behavior` (default `'auto'`) and `disabled`, and can be vetoed like the
composer buttons.

## Message primitives

Headless directives for the messages of a thread and their content.

```ts
import {
  NxaMessageIf,
  NxaMessageParts,
  NxaMessageRoot,
  NxaMessages,
  NxaThreadEmpty,
  NxaThreadIf,
} from '@ngx-assistant/angular';
```

```html
<p *nxaThreadEmpty>How can I help?</p>

<article *nxaMessages="let message" nxaMessageRoot [class.mine]="message().role === 'user'">
  <ng-container *nxaMessageParts="let part">
    @let p = part(); @switch (p.type) { @case ('text') {
    <p>{{ p.text }}</p>
    } @case ('tool-call') {
    <app-tool-call />
    } }
  </ng-container>
  <div *nxaMessageIf="{ assistant: true, lastOrHover: true }">...</div>
</article>
```

| Directive          | Behavior                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `*nxaMessages`     | One row per message of the thread, each a message scope. Rows follow the message id.                      |
| `*nxaMessageParts` | One row per content part of the nearest message, each a part scope. Tool calls follow their `toolCallId`. |
| `[nxaMessageRoot]` | Sets `data-nxa-message-id`, used by the thread viewport, and tracks the hover.                            |
| `*nxaMessageIf`    | Renders while the message meets every condition given, the `else` template otherwise.                     |
| `*nxaThreadIf`     | The same for the thread: `empty`, `running`, `disabled`.                                                  |
| `*nxaThreadEmpty`  | Renders while the thread has no messages and is not loading them.                                         |

Both lists give `let x` as a `Signal` of the row's state, plus `index`, `count`, `first` and `last`.
Inside a row of `*nxaMessages`, `injectMessage()` is the row's message and `injectComposer()` its
edit composer; inside a row of `*nxaMessageParts`, `injectPart()` is the row's part, with its
`status`. A row keeps its view, and the state of the components in it, while its message stays in
the thread, wherever it moves; a new message id creates a new row. In a message, a tool call whose
`toolCallId` is unique keeps its row when the parts are reordered, and any other part keeps its row
while the part at its position keeps its type. Read the signal into a variable (`@let p = part()`)
so that `@switch` narrows the part type.

`*nxaMessageIf` conditions, each checked only when given: `user`, `assistant`, `system`, `last`,
`copied`, `speaking`, `hasAttachments`, `hasContent` (`true` or `false`); `hasBranches` and
`lastOrHover` (`true`); `submittedFeedback` (`'positive'`, `'negative'` or `null`). With no
condition it always renders. The hover and copied state belong to the message scope, so a nested
`provideMessageScope(...)` starts with its own.

## Build and test

```bash
pnpm ng build @ngx-assistant/angular   # output in dist/angular
pnpm ng test @ngx-assistant/angular
```
