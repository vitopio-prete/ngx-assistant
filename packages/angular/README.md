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

## Installation

```bash
ng add @ngx-assistant/angular
```

`ng add` sets the library up in an application of the workspace (`--project` picks one):

- adds `@ngx-assistant/engine`;
- provides a runtime in `app.config.ts` (or in `main.ts` when the app has no config). It asks
  which: `data-stream` provides `provideDataStreamRuntime({ api })`, with `--api` (default
  `/api/chat`); `local` creates `chat-model.ts`, a chat model that answers with a fixed text, to
  replace with a call to your model, and provides `provideLocalRuntime(() => inject(ChatModel))`.
  An app that already provides a runtime keeps it;
- defines `process.env.NODE_ENV` in the `production` and `development` configurations of the
  build, which turns the development checks of the engine on in development builds;
- raises the `initial` budgets of the build to 1 MB (warning) and 2 MB (error) when they are
  lower: the engine, markdown and the styled components take about 800 kB;
- sets up Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/postcss`, `.postcssrc.json` and
  `@import 'tailwindcss'` in the global stylesheet; a separate `tailwind.css` when the global
  styles are Sass or Less). It leaves Tailwind CSS v3 alone and says so; `--skip-tailwind` leaves
  Tailwind to you;
- asks whether to copy the styled chat components into the app (`--components`, by default into
  `src/app/chat`, `--path` changes it).

Then render the chat in a component:

```ts
import { NxaThread } from './chat';

@Component({
  selector: 'app-root',
  imports: [NxaThread],
  template: `<nxa-thread class="h-dvh" />`,
})
export class App {}
```

The other styled components are copied by their generators: `ng g @ngx-assistant/angular:thread`,
`thread-list`, `assistant-modal`, `model-selector` and `approval-card`. Running `ng add` or a
generator again changes nothing that is already set up, and keeps the files you changed.

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

`provideDataStreamRuntime(options)` sends each run to a streaming backend and keeps the rest of
`provideLocalRuntime`, whose options it also takes. Every run is a JSON `POST` to `api` with the
conversation in the AI SDK message format (`toLanguageModelMessages`), the system prompt, the tools
of the model context as JSON Schema, the run config, the call settings and config of the model
context, and last the fields of `body`, which override the others. The reply is read as
a UI message stream, what `streamText(...).toUIMessageStreamResponse()` sends, or as a data stream:
`protocol` picks one, otherwise the response's protocol header does, otherwise the UI message
stream. `options` can be a factory run once in the injection context.

```ts
providers: [
  provideDataStreamRuntime(() => {
    const auth = inject(AuthService);
    return {
      api: '/api/chat',
      headers: async () => ({ Authorization: `Bearer ${await auth.token()}` }),
      onError: (error) => console.error(error),
    };
  }),
];
```

Tools of the model context with `execute` run in the browser and their results go back to the
backend on the next step. A tool call the browser cannot answer, such as one for a tool without
`execute`, stays open (`requires-action`) until `addToolResult` on its part, which resumes the run.
Cancelling aborts the request and calls `onCancel`; destroying the injector aborts it too, without
`onCancel`. `onError` reports failed requests and streams, never a cancelled run; an `onResponse`
that throws or rejects fails the run without it. Approval requests the backend sends for its own
tools are not supported yet: they are ignored and the call stays open.

`provideRemoteThreadListRuntime(options)` persists the threads through a
`RemoteThreadListAdapter` (`list`, `initialize`, `rename`, `archive`, `unarchive`, `delete`,
`generateTitle`, `fetch`) and runs each thread on its own runtime. `runtime` returns the providers
of that runtime, such as `provideLocalRuntime(...)` or `provideDataStreamRuntime(...)`; they go on a
child injector of the one the list is provided on, created when the list starts the thread and
destroyed when it stops it (delete, a new adapter, the list destroyed), which aborts the thread's
running request. A thread the user switches away from keeps its runtime, and a run in it goes on.
`runtime` is called in the injection context of the list's injector. A new thread is created on the
backend with `initialize` before its first run, which then carries its remote id, and gets a title
from `generateTitle` once its first message settles. `InMemoryThreadListAdapter` keeps the threads
in memory.

```ts
providers: [
  provideRemoteThreadListRuntime(() => {
    const route = inject(ChatRoute);
    return {
      adapter: inject(ThreadsAdapter),
      runtime: () => provideDataStreamRuntime({ api: '/api/chat' }),
      threadId: route.threadId, // a Signal<string | undefined>
      onThreadIdChange: (threadId) => route.navigate(threadId),
    };
  }),
];
```

Model context registered on the list runtime, tools and instructions included, reaches the request
of every thread: the thread injector holds the list's adapters as `NXA_RUNTIME_ADAPTERS`, which the
local, data stream, external store and assistant transport runtimes read. It also holds the thread's
list item as `NXA_REMOTE_THREAD_ITEM`, so a runtime factory can build adapters for that thread; the
adapter's `unstable_Provider` and `unstable_useAdapters` are ignored. With `threadId`, the list
shows the thread with that remote id, or a new thread for `undefined`, and `onThreadIdChange`
reports the switches the user makes, not those made through `threadId`. A failed list load is
retried when the browser comes back online or the page becomes visible.

`provideRuntimeAdapters(adapters)` hands history, attachment and feedback adapters to the runtime
providers of its injector and of those below it, over the adapters of an outer
`provideRuntimeAdapters`; a runtime's own adapters apply over both. `adapters` can be a factory run
in the injection context, so among the `runtime` providers of a remote thread list it builds the
adapters of each thread. The local and data stream runtimes load and append their messages through
the history adapter. The external store and assistant transport runtimes keep their messages in a
store: they take the feedback adapter when the store brings none, never the attachment adapter, and
copy each settled turn to a history adapter that has `unstable_copy`, naming the messages that are
new or changed, unless the store sets `unstable_persistsHistory` or runs its own thread list. Tool
interactions recorded on their messages go into that copy, unless the store records them itself
(`unstable_onRecordToolInteraction`). Within one injector the last `provideRuntimeAdapters` wins.

```ts
provideRemoteThreadListRuntime({
  adapter: inject(ThreadsAdapter),
  runtime: () => [
    provideRuntimeAdapters(() => ({
      history: inject(HistoryStore).adapterFor(inject(NXA_REMOTE_THREAD_ITEM)!),
    })),
    provideAssistantTransportRuntime({ api: '/api/agent', initialState, converter }),
  ],
});
```

`provideAssistantTransportRuntime(options)` (experimental) drives an agent on your server, written
in any language. The browser sends commands, `add-message`, `add-tool-result` or your own, together
with the current agent state, as a JSON `POST` to `api`; the server streams the new state back in
the `data-stream` protocol (the default) or the `assistant-transport` protocol over SSE, and
`converter` turns the state into the messages and run state of the thread. One request runs at a
time: commands sent meanwhile go out together in the next one. The body also carries the system
prompt, the tools of the model context as JSON Schema, its call settings and config, `threadId`,
`parentId` and the fields of `body`; `prepareSendCommandsRequest` can rewrite it. `options` can be a
factory run once in the injection context (once per thread inside a remote thread list).

```ts
providers: [
  provideAssistantTransportRuntime({
    api: '/api/agent',
    protocol: 'assistant-transport',
    initialState: { messages: [] } as AgentState,
    converter: (state, { pendingCommands, isSending }) => ({
      messages: toThreadMessages(state, pendingCommands),
      isRunning: isSending,
    }),
  }),
];
```

`converter` also receives the commands not yet confirmed by the server and the status of the
frontend tools. A user message still pending is marked `isOptimistic`; it keeps the id its command
carries, so a backend that stores that id replaces it in place. Tools of the model context with
`execute` run in the browser when the server calls them, and their results go back as
`add-tool-result` commands, like the results given through `addToolResult`. Cancelling aborts the
request and calls `onCancel` with the commands it drops; `onError` gets the commands of a failed
run, and `updateState` on both lets you show it. Destroying the injector aborts the request without
any callback, even when `onError` settles later. With `resumeApi`, `thread.resumeRun(...)` reconnects to a run in progress: with
`resumeStateApi` the server first returns `{ runId, state }`, the state the run started from. A
response with the `Nxa-Replay-Content-Length` header replays that many bytes with the thread
loading, before the live ones.

Every request carries the thread's remote id as `threadId`. Threads live in memory by default; to
persist them, return `provideAssistantTransportRuntime(...)` as the `runtime` of
`provideRemoteThreadListRuntime`, where it becomes the runtime of each thread, and add
`provideRuntimeAdapters` with a history adapter to keep a copy of its settled turns.

In components, `injectAssistantTransportState(selector?)` reads the agent state of the thread the
runtime shows as a `Signal`, and `injectAssistantTransportSendCommand()` returns a function that
sends a command. Declare custom commands and the state type with module augmentation:

```ts
declare module '@ngx-assistant/engine' {
  namespace Assistant {
    interface Commands {
      restart: { type: 'restart-session' };
    }
    interface ExternalState {
      agent: AgentState;
    }
  }
}

readonly todos = injectAssistantTransportState((state) => state.todos);
private readonly sendCommand = injectAssistantTransportSendCommand();
```

Until the first thread starts, a moment after the runtime is created, the state signal holds the
selection of `initialState` and sending a command throws. Inside a remote thread list, which does not
know that state, the signal holds `undefined` meanwhile and the selector is not called. Server-side
tool approvals are not supported: answer a tool call from the browser with `addToolResult`.

## Scopes

Each runtime lives in a scope of the injector tree, and `inject*()` returns the nearest one:

| Function                   | Token                     | Provided by                                                |
| -------------------------- | ------------------------- | ---------------------------------------------------------- |
| `injectAssistant()`        | `NXA_ASSISTANT`           | a runtime provider, `provideAssistantScope(() => runtime)` |
| `injectThread()`           | `NXA_THREAD`              | a runtime provider                                         |
| `injectComposer()`         | `NXA_COMPOSER`            | the runtime (thread composer) or a message                 |
| `injectMessage()`          | `NXA_MESSAGE`             | `provideMessageScope(() => message)`                       |
| `injectMessageUi()`        | `NXA_MESSAGE_UI`          | `provideMessageScope(() => message)`                       |
| `injectPart()`             | `NXA_PART`                | `providePartScope(() => part)`                             |
| `injectAttachment()`       | `NXA_ATTACHMENT`          | `provideAttachmentScope(() => attachment)`                 |
| `injectThreadList()`       | `NXA_THREAD_LIST`         | a runtime provider                                         |
| `injectThreadListItem()`   | `NXA_THREAD_LIST_ITEM`    | `provideThreadListItemScope(() => item)`                   |
| `injectThreadListItemUi()` | `NXA_THREAD_LIST_ITEM_UI` | `provideThreadListItemScope(() => item)`                   |
| `injectSuggestion()`       | `NXA_SUGGESTION`          | `provideSuggestionScope(() => suggestion)`                 |
| `injectToolCall()`         | `NXA_TOOL_CALL`           | `providePartScope(() => part)`, for a `tool-call` part     |

Inside a message scope `injectComposer()` returns the message's edit composer; the thread composer
stays reachable as `injectThread().composer`. `injectMessageUi()` holds the view state of the message
that the runtime does not keep, as writable signals: `isHovering`, `isFocusWithin` and `isCopied`;
`injectThreadListItemUi()` does the same for a thread list item, with `isRenaming`. A missing scope throws, unless you pass
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
| `message.copied`, `speak`, `reload`, `branchSwitched`           | `message`, `thread`, `threads`, `*`             |
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
- `message.copied`, `message.speak`, `message.reload` and `message.branchSwitched` are reported by
  the action bar and branch picker buttons (a successful copy, a click on speak, regenerate,
  previous or next), with `{ threadId, messageId }`. Calling the runtime directly does not report
  them. A nested runtime provider has its own.
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
| `*nxaComposerIf`             | Renders while the composer meets every condition given (`editing`, `dictation`), the `else` template otherwise.     |

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
| `[nxaMessageRoot]` | Sets `data-nxa-message-id`, used by the thread viewport, and tracks the hover and the keyboard focus.     |
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
so that `@switch` narrows the part type. A `tool-call` part whose tool has a registered UI is
rendered by that component instead of the template (see [Tool UIs](#tool-uis)).

`*nxaMessageIf` conditions, each checked only when given: `user`, `assistant`, `system`, `last`,
`copied`, `speaking`, `hasAttachments`, `hasContent` (`true` or `false`); `hasBranches` and
`lastOrHover` (`true`: the last message, or one under the pointer or holding the keyboard focus);
`submittedFeedback` (`'positive'`, `'negative'` or `null`). With no condition it always renders.
The hover, focus and copied state belong to the message scope, so a nested
`provideMessageScope(...)` starts with its own.

`nxaMessageRoot` counts as keyboard focus a focus inside the message that the browser marks as
`:focus-visible` (a Tab, not a click on a button), and sets `data-nxa-focus-within` meanwhile. Since
`*nxaMessageIf` removes what it does not render, `lastOrHover` content is reachable from the
keyboard only through something else focusable in the message; for actions, prefer
`nxaActionBarRoot autohide`, which keeps them in the tab order.

## Message part primitives

Headless directives for the content of a part: its text revealed as it streams, an indicator while
it runs, and the grouping of consecutive reasoning parts.

```ts
import {
  NxaMessagePartByIndex,
  NxaMessagePartInProgress,
  NxaMessagePartText,
  NxaReasoningGroup,
} from '@ngx-assistant/angular';
```

```html
<ng-container *nxaMessageParts="let part">
  @if (part().type === 'text') {
  <p nxaMessagePartText></p>
  <span *nxaMessagePartInProgress aria-hidden="true">●</span>
  } @else if (part().type === 'reasoning') {
  <div *nxaReasoningGroup="let group">
    <button type="button" [attr.aria-expanded]="group.open()" (click)="group.toggle()">
      Reasoning
    </button>
    @if (group.open()) { @for (index of group.indices(); track index) {
    <p *nxaMessagePartByIndex="index" nxaMessagePartText></p>
    } }
  </div>
  }
</ng-container>
```

| Directive or function       | Behavior                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `[nxaMessagePartText]`      | Writes the text of a `text` or `reasoning` part as its text content, with `data-nxa-status`. |
| `*nxaMessagePartInProgress` | Renders while the part runs.                                                                 |
| `*nxaReasoningGroup`        | On the first of a run of consecutive reasoning parts, renders once for the run.              |
| `*nxaMessagePartByIndex`    | Renders in the scope of the part at an index of the message; nothing while there is none.    |
| `injectSmoothText(smooth?)` | The revealed text and its status as a `Signal`, for text rendered another way (markdown).    |
| `injectScrollLock(el, ms)`  | A function that holds the scroll of the nearest scrollable ancestor while a height animates. |

`nxaMessagePartText` reveals a streaming text a few characters per frame (`smooth`, on by default):
`smooth="false"` shows the text as it is, and an object tunes the reveal (`drainMs`, default 250;
`maxCharIntervalMs`, default 5; `maxCharsPerFrame`; `minCommitMs`, the shortest time between two
updates of the shown text). Under `prefers-reduced-motion: reduce` the text always shows as it is.
A text that is no longer a continuation of the shown one starts the reveal again, and a part that
ends before anything was shown appears at once. `data-nxa-status` is `running` until the text is
shown in full, then the status of the part.

`*nxaReasoningGroup` gives `let group`: `startIndex`, `endIndex`, `indices`, `streaming` (the model
is still writing one of the parts) and `open` as signals, with `setOpen(open)` and `toggle()`. The
group is open while the model reasons and closes once it moves on, until the user opens or closes
it; then it keeps the user's choice. Every change of `open` first locks the scroll of the nearest
scrollable ancestor for `lockMs` milliseconds (`*nxaReasoningGroup="let group; lockMs: 300"`,
default 200), the length of a collapse animation, so that the thread does not jump.

## Action bar and branch picker

Headless directives for the actions of a message and the navigation between its branches. They go
inside a message scope, such as a row of `*nxaMessages`.

```ts
import {
  NxaActionBarCopy,
  NxaActionBarEdit,
  NxaActionBarExportMarkdown,
  NxaActionBarFeedbackNegative,
  NxaActionBarFeedbackPositive,
  NxaActionBarReload,
  NxaActionBarRoot,
  NxaActionBarSpeak,
  NxaActionBarStopSpeaking,
  NxaBranchPickerCount,
  NxaBranchPickerNext,
  NxaBranchPickerNumber,
  NxaBranchPickerPrevious,
  NxaBranchPickerRoot,
  NxaComposerIf,
} from '@ngx-assistant/angular';
```

```html
<article *nxaMessages="let message" nxaMessageRoot>
  <form *nxaComposerIf="{ editing: true }; else view" nxaComposerRoot>
    <textarea nxaComposerInput aria-label="Edit message"></textarea>
    <button nxaComposerCancel>Cancel</button>
    <button nxaComposerSend>Save</button>
  </form>
  <ng-template #view>...</ng-template>

  <div nxaActionBarRoot autohide="not-last" autohideFloat="single-branch">
    <button nxaActionBarCopy>Copy</button>
    <button nxaActionBarEdit>Edit</button>
    <button nxaActionBarReload>Regenerate</button>
    <button nxaActionBarFeedbackPositive aria-label="Helpful">👍</button>
    <button nxaActionBarFeedbackNegative aria-label="Not helpful">👎</button>
    <button *nxaMessageIf="{ speaking: false }; else stop" nxaActionBarSpeak>Read aloud</button>
    <ng-template #stop><button nxaActionBarStopSpeaking>Stop</button></ng-template>
    <button nxaActionBarExportMarkdown>Export</button>
  </div>
  <div nxaBranchPickerRoot hideWhenSingleBranch>
    <button nxaBranchPickerPrevious aria-label="Previous">‹</button>
    <span nxaBranchPickerNumber></span> / <span nxaBranchPickerCount></span>
    <button nxaBranchPickerNext aria-label="Next">›</button>
  </div>
</article>
```

| Directive                              | Behavior                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `[nxaActionBarRoot]`                   | Hides (`data-nxa-autohidden`, `hidden`) and floats (`data-nxa-floating`) by `autohide`, `autohideFloat` and `hideWhenRunning`. |
| `button[nxaActionBarCopy]`             | Copies the message text, or the edit draft while editing. Sets `data-nxa-copied` and the message's `copied`.                   |
| `button[nxaActionBarEdit]`             | Starts editing the message. Disabled while editing, or when the thread is disabled or cannot edit.                             |
| `button[nxaActionBarReload]`           | Regenerates an assistant message as a new branch. Disabled during a run and for other messages.                                |
| `button[nxaActionBarFeedbackPositive]` | Submits positive feedback. `aria-pressed` and `data-nxa-submitted` while the message's feedback is positive.                   |
| `button[nxaActionBarFeedbackNegative]` | Submits negative feedback, with the same attributes for negative feedback.                                                     |
| `button[nxaActionBarSpeak]`            | Reads the message aloud. Disabled without a speech adapter, while an assistant message runs, or without text.                  |
| `button[nxaActionBarStopSpeaking]`     | Stops reading the message aloud. Disabled while the message is not the one being read.                                         |
| `button[nxaActionBarExportMarkdown]`   | Downloads the message text as markdown, or hands it to `exportMarkdown`. Disabled like copy.                                   |
| `[nxaBranchPickerRoot]`                | With `hideWhenSingleBranch`, carries `hidden` while the message has one branch.                                                |
| `button[nxaBranchPickerPrevious]`      | Shows the previous branch. Disabled on the first one, and during a run unless the runtime allows switching.                    |
| `button[nxaBranchPickerNext]`          | Shows the next branch, with the same rules.                                                                                    |
| `[nxaBranchPickerNumber]`              | Writes the 1-based number of the branch shown.                                                                                 |
| `[nxaBranchPickerCount]`               | Writes the number of branches.                                                                                                 |

`nxaActionBarRoot` options: `autohide` is `'never'` (default), `'always'` (out of sight unless the
pointer is over the message or the keyboard focus is inside it, as tracked by `nxaMessageRoot`) or
`'not-last'` (the same, except on the last message); `autohideFloat` is `'never'` (default),
`'always'` or `'single-branch'`, and floats a bar that the hover or the focus shows;
`hideWhenRunning` hides the bar while the thread runs. Its status (`'hidden'`, `'autohidden'`,
`'floating'` or `'normal'`) is readable through `#bar="nxaActionBarRoot"` as `bar.status()`.

An auto-hidden bar carries `data-nxa-autohidden` and no `hidden`, so that its buttons stay in the
tab order: tabbing into one puts the focus inside the message, which shows the bar. Hide it with a
rule that keeps it focusable, for example:

```css
[nxaActionBarRoot][data-nxa-autohidden] {
  opacity: 0;
}
```

Without such a rule an auto-hidden bar stays visible. `hideWhenRunning` uses `hidden`. The roots
stay in the DOM when hidden; to remove them, wrap them in `*nxaMessageIf`. A `display` rule in your
styles overrides `hidden`, so style the shown state with `:not([hidden])`.

`nxaActionBarCopy` options: `copiedDuration` (default `3000` ms) and `copyToClipboard`, a function
that writes the text (default `navigator.clipboard.writeText`). The write happens inside the click,
so browsers that require a user gesture accept it. A failed write, or one that completes after the
button is gone, leaves the message as it was. The copy is disabled while an assistant message is
still running or the message has no text. The copied state belongs to the message, so copy buttons
of the same message share it.

The feedback buttons call the runtime's `FeedbackAdapter` (`adapters.feedback`); without one the
feedback is still recorded on the assistant message, so the buttons stay enabled. Speech needs a
`SpeechSynthesisAdapter` (`adapters.speech`, for example `new WebSpeechSynthesisAdapter()`);
reading another message stops the current one. `*nxaMessageIf="{ speaking: true }"` and
`{ submittedFeedback: 'positive' }` follow the same state.

`nxaActionBarExportMarkdown` options: `filename` (default `message-<timestamp>.md`) and
`exportMarkdown`, a function that receives the text instead of the download, for example to save
it elsewhere. A failed export is reported with `console.error`.

Every button takes `disabled` on top of its own state, and a capture-phase listener can veto its
click with `event.preventDefault()`.

## Attachment primitives

Headless directives for the attachments of a composer or a message, and for adding files.

```ts
import {
  NxaAttachmentRemove,
  NxaAttachmentRoot,
  NxaAttachmentThumb,
  NxaComposerAddAttachment,
  NxaComposerAttachmentDropzone,
  NxaComposerAttachments,
  NxaMessageAttachments,
} from '@ngx-assistant/angular';
```

```html
<div nxaComposerAttachmentDropzone>
  <form nxaComposerRoot>
    <div *nxaComposerAttachments="let attachment" nxaAttachmentRoot>
      <span nxaAttachmentThumb #thumb="nxaAttachmentThumb">{{ thumb.label() }}</span>
      {{ attachment().name }}
      <button nxaAttachmentRemove aria-label="Remove attachment">×</button>
    </div>
    <button nxaComposerAddAttachment aria-label="Add attachment">+</button>
    <textarea nxaComposerInput></textarea>
  </form>
</div>

<article *nxaMessages="let message">
  <div *nxaMessageAttachments="let attachment" nxaAttachmentRoot>{{ attachment().name }}</div>
</article>
```

| Directive                          | Behavior                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `*nxaComposerAttachments`          | One row per attachment of the nearest composer (thread or edit), each an attachment scope.                          |
| `*nxaMessageAttachments`           | One row per attachment of the nearest user message, each an attachment scope.                                       |
| `[nxaAttachmentRoot]`              | Sets `data-nxa-attachment-type`, `data-nxa-attachment-status` and `data-nxa-attachment-source`.                     |
| `[nxaAttachmentThumb]`             | Exported as `nxaAttachmentThumb`, with `label()`: the file extension (`.png`) or the type (`getAttachmentLabel()`). |
| `button[nxaAttachmentRemove]`      | Removes the attachment from its composer. Disabled for the attachments of a message.                                |
| `button[nxaComposerAddAttachment]` | Opens a file picker and adds the chosen files to the composer.                                                      |
| `[nxaComposerAttachmentDropzone]`  | Adds dropped files to the composer; sets `data-nxa-dragging` while files are dragged over it.                       |

Both lists give `let attachment` as a `Signal` of the attachment state, plus `index`, `count`,
`first` and `last`, and inside a row `injectAttachment()` is the row's attachment. A row follows
its attachment by id: removing or moving another attachment keeps the row and the state of the
components in it. Attachments with the same id are bound to their position.

`nxaComposerAddAttachment` takes `multiple` (default `true`) and `disabled`; the picker accepts the
composer's `attachmentAccept`. It is disabled while the thread is disabled or the composer is not
editing, and the chosen files go to the thread that opened the picker: if the main thread changes,
even back to the same thread, or the button is destroyed or disabled first, nothing is added. A file the composer rejects does not stop the
others; listen to `composer.attachmentAddError` with `injectNxaEvent()` to show it. The dropzone
takes `disabled`, and it claims every file drag, even when disabled or when the runtime has no
attachment adapter, so a dropped file never opens in the tab. The buttons can be vetoed like the
composer buttons.

## Error primitives

```ts
import { NxaErrorRoot, NxaMessageError } from '@ngx-assistant/angular';
```

```html
<article *nxaMessages="let message">
  <div *nxaMessageError="let error" nxaErrorRoot>{{ error() }}</div>
</article>
```

`*nxaMessageError` renders while the nearest message ended with an error (status `incomplete`,
reason `error`), and goes away when the message runs again. `let error` is a `Signal` of the error:
a string error as is, the `message` of an error object, any other value as is, or
`'An error occurred'` when the runtime gave none (`getMessageErrorText(message)` computes the same).
`[nxaErrorRoot]` adds `role="alert"`, unless the element sets its own `role`.

## Thread list primitives

Headless directives for the list of threads: switching, creating, renaming, archiving and deleting
them.

```ts
import {
  NxaThreadListItemArchive,
  NxaThreadListItemDelete,
  NxaThreadListItemIf,
  NxaThreadListItemRename,
  NxaThreadListItemRenameInput,
  NxaThreadListItemRoot,
  NxaThreadListItems,
  NxaThreadListItemTitle,
  NxaThreadListItemTrigger,
  NxaThreadListItemUnarchive,
  NxaThreadListLoadMore,
  NxaThreadListNew,
  NxaThreadListRoot,
} from '@ngx-assistant/angular';
```

```html
<nav nxaThreadListRoot>
  <button nxaThreadListNew>New chat</button>
  <div *nxaThreadListItems="let thread" nxaThreadListItemRoot>
    <input
      *nxaThreadListItemIf="{ renaming: true }; else trigger"
      nxaThreadListItemRenameInput
      aria-label="Rename thread"
    />
    <ng-template #trigger>
      <button nxaThreadListItemTrigger>
        <span nxaThreadListItemTitle fallback="New chat"></span>
      </button>
    </ng-template>
    <button nxaThreadListItemRename>Rename</button>
    <button nxaThreadListItemArchive>Archive</button>
    <button nxaThreadListItemDelete>Delete</button>
  </div>
  <button nxaThreadListLoadMore>Load more</button>

  <div *nxaThreadListItems="let thread; archived: true" nxaThreadListItemRoot>
    <span nxaThreadListItemTitle></span>
    <button nxaThreadListItemUnarchive>Restore</button>
  </div>
</nav>
```

| Directive                             | Behavior                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `[nxaThreadListRoot]`                 | Collects the item triggers inside it for the arrow keys.                                                                        |
| `button[nxaThreadListNew]`            | Switches to a new thread; `data-active` and `aria-current` while the new thread is the main one.                                |
| `button[nxaThreadListLoadMore]`       | Loads more threads; disabled while there are none or a load is in flight.                                                       |
| `*nxaThreadListItems`                 | One row per thread, or per archived thread with `archived: true`, each a thread list item scope.                                |
| `[nxaThreadListItemRoot]`             | `data-active` and `aria-current` on the main thread; ArrowDown and ArrowUp on its trigger move to the next or previous trigger. |
| `button[nxaThreadListItemTrigger]`    | Switches to the row's thread; `data-active` and `aria-current` while it is the main one.                                        |
| `[nxaThreadListItemTitle]`            | The thread title as text, or `fallback` while it has none. Exported as `nxaThreadListItemTitle`, with `title()`.                |
| `button[nxaThreadListItemArchive]`    | Archives the row's thread.                                                                                                      |
| `button[nxaThreadListItemUnarchive]`  | Restores the row's archived thread; disabled while the thread list cannot restore threads.                                      |
| `button[nxaThreadListItemDelete]`     | Deletes the row's thread.                                                                                                       |
| `button[nxaThreadListItemRename]`     | Starts editing the row's title (`injectThreadListItemUi().isRenaming`); the root carries `data-nxa-renaming` meanwhile.         |
| `input[nxaThreadListItemRenameInput]` | Edits the title: starts with it, focused and selected; Enter or blur renames, Escape cancels.                                   |
| `*nxaThreadListItemIf`                | Renders while the row meets every condition given (`renaming`, `main`, `archived`), and `else` otherwise.                       |

The list gives `let thread` as a `Signal` of the thread list item state, plus `index`, `count`,
`first` and `last`. A row follows its thread by id: archiving, deleting or adding another thread
keeps the row and the state of the components in it. The arrow keys follow the document order,
skip disabled triggers, do not wrap and leave keys with a modifier alone; a `keydown` listener on the trigger can veto
the move. A failed action is reported with `console.error`. The runtime decides which threads
exist: `provideRemoteThreadListRuntime` lists those of its adapter, `provideExternalStoreRuntime`
those of its `adapters.threadList`, while `provideLocalRuntime` keeps a single thread and lists none.

The rename input confirms the value without the spaces at its ends; a blank value or the current
title only ends the editing. Enter and Escape are ignored during an IME composition, and a
capture-phase `keydown` listener can veto them. After Enter or Escape the focus returns to the row's
trigger, unless the user has moved it elsewhere meanwhile. A rename the runtime rejects keeps the
input open, with what was typed, and is reported with `console.error`. An input left in the DOM
outside `*nxaThreadListItemIf` starts afresh, with the current title, each time editing starts. Editing ends by setting `isRenaming` to `false`, so a menu can start and
end it through `injectThreadListItemUi()` as well.

## Suggestion primitives

```ts
import {
  NxaSuggestionDescription,
  NxaSuggestions,
  NxaSuggestionTitle,
  NxaSuggestionTrigger,
  provideSuggestions,
} from '@ngx-assistant/angular';
```

```html
<button *nxaSuggestions="let suggestion" nxaSuggestionTrigger send>
  <span nxaSuggestionTitle></span>
  <span nxaSuggestionDescription></span>
</button>
```

`*nxaSuggestions` renders the suggestions of the nearest thread, which come from the runtime (an
external store's `suggestions`, or a suggestion adapter); a suggestion without a title shows its
prompt. `provideSuggestions([...])` replaces them with a fixed list, or a `Signal` of one: a string
is a prompt that is also the title, an object gives `title`, `label` and `prompt`. Rows are keyed
by content, so a suggestion keeps its row when another one goes away. Provided suggestions belong
to the runtime of their injector: a runtime provided further down shows its own thread's
suggestions.

`nxaSuggestionTrigger` takes `send` and `clearComposer` (default `true`). With `send`, the prompt
is appended as a user message with the composer's run config and the composer is cleared; while a
run is in flight the message is queued if the runtime queues (the draft is kept), and otherwise
the button is disabled, as it is while sending is disabled or a voice session does not take typed
text. Without `send`, the prompt replaces the composer text, or is added after it with
`clearComposer` off. The button is disabled while the thread is disabled, takes `disabled`, and
can be vetoed like the composer buttons.

## Tool UIs

Register the component that renders the calls of a tool, and a fallback for the others:

```ts
import { injectToolCall, provideToolUi } from '@ngx-assistant/angular';

@Component({
  selector: 'app-weather-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tool.result(); as result) {
      {{ tool.args().city }}: {{ result }}
    } @else {
      Checking {{ tool.args().city }}...
    }
  `,
})
export class WeatherCard {
  readonly tool = injectToolCall<{ city: string }, string>();
}
```

```ts
providers: [
  provideLocalRuntime(model),
  provideToolUi({ toolName: 'get_weather', component: WeatherCard }),
  provideToolUi({ fallback: ToolCallCard }),
];
```

`*nxaMessageParts` renders a `tool-call` part with the UI of its tool, else with the fallback, else
with its own template. `provideToolUi(...)` goes in the `providers` of the application, a route or
a component. A tool name is looked up from the nearest level of the injector tree up to the root
before any fallback is used, and within a level the first declaration wins. Each runtime provider
also has a registry for UIs registered at runtime, which `injectToolUiRegistry().register(name,
component)` reaches: it returns the function that removes the registration, and a runtime
registration comes before the UIs declared at its level. A nested runtime provider still sees the
UIs of the outer ones. A change of UI creates the row again with the new component, or with the
template once no UI is left.

`injectToolCall()` works in a registered UI and in the template of `*nxaMessageParts` alike. It
gives `part`, `args`, `result`, `status` and `approval` as signals, and the actions `addResult`
(complete the call, for a tool that waits on the user), `resume` (answer an `interrupt`) and
`respondToApproval`, which rejects when the runtime refuses the answer.

## Tool approval primitives

Headless controls for a tool call gated by an approval request (`approval` on the part). A call
that waits on an `interrupt` or on a result from the user is answered with `injectToolCall()`
instead (`resume`, `addResult`): these controls stay disabled for it.

```ts
import {
  NxaToolApprovalApprove,
  NxaToolApprovalDeny,
  NxaToolApprovalOption,
  NxaToolApprovalRoot,
  NxaToolApprovalText,
} from '@ngx-assistant/angular';
```

<!-- prettier-ignore -->
```html
<div nxaToolApprovalRoot #approval="nxaToolApprovalRoot">
  @let state = approval.state;
  @if (state.pending()) {
    <p>{{ state.approval()?.prompt }}</p>
    @for (option of state.options(); track option.id) {
      <button [nxaToolApprovalOption]="option">{{ option.label ?? option.id }}</button>
    } @empty {
      <button nxaToolApprovalApprove>Allow</button>
      <button nxaToolApprovalDeny>Deny</button>
    }
    @if (state.acceptsText()) {
      <textarea nxaToolApprovalText></textarea>
    }
  } @else if (state.receipt(); as receipt) {
    <p>{{ receipt.outcome }}</p>
  }
</div>
```

| Directive                                                                        | Behavior                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `[nxaToolApprovalRoot]`                                                          | Holds the request of the nearest tool call and the state of its controls (`state`).  |
| `button[nxaToolApprovalApprove]`, `button[nxaToolApprovalDeny]`                  | Allow or deny a decision, with the typed draft as a note when there is one.          |
| `button[nxaToolApprovalOption]`                                                  | Answers with an option, or opens its confirmation step when the option asks for one. |
| `button[nxaToolApprovalConfirm]`, `button[nxaToolApprovalConfirmCancel]`         | Confirm the option waiting for it, or go back.                                       |
| `textarea[nxaToolApprovalText]`                                                  | The typed answer of a question, or the note of a decision.                           |
| `button[nxaToolApprovalSubmitText]`                                              | Sends the typed draft as the answer to a question that takes one.                    |
| `button[nxaToolApprovalDismiss]`                                                 | Dismisses a question that declares itself `dismissible`, without the typed draft.    |
| `*nxaToolApprovalQuestions`                                                      | One row per question of a `display: "questions"` request.                            |
| `button[nxaToolApprovalQuestionOption]`, `textarea[nxaToolApprovalQuestionText]` | Answer the question of their row; a single-choice question keeps one option.         |
| `button[nxaToolApprovalSubmitAnswers]`                                           | Sends every answer, once each question has one.                                      |

`state` (also `injectToolApproval()`) gives the request as `approval`, and `outcome`, `pending`,
`receipt` (its `outcome`, whether it was `answered` or decided, `automatic`, the chosen `option`,
the `notes` and the questionnaire `answers`), `display`, `isQuestion`, `dismissible`,
`acceptsText`, `canSubmitText`, `options` (allowing kinds first, then custom kinds, then refusing
ones), `questions`, `questionsComplete`, `draft`, `confirming`, `submitting`, `error`, `canAnswer`
and `locked`, plus the methods behind the controls. An option of a custom kind is an answer, so it
approves; a known kind lets the runtime derive the decision. A decision can always be denied; a
question is not allowed or denied, and is refused only with a dismissal it declares.

The root host carries `data-nxa-approval` (`pending`, `approved`, `denied`, `cancelled` or
`expired`), `data-nxa-display`, `data-nxa-submitting` and `aria-busy` while an answer is on its
way, `data-nxa-error` and `data-nxa-confirming`. A request is pending while its call requires
action: an open request whose run was cancelled shows no state and takes no answer. Once an answer
is sent the controls stay locked until the request settles. A refused answer unlocks them and sets
`error`; a refusal that arrives after another request took over is dropped. The draft, the chosen
options, the confirmation step and the error belong to the pending request: they start afresh when
another request arrives. The controls are also disabled when the thread cannot answer tool calls or
a voice session holds it.

## Model context

What the model gets on every run of a runtime: tools, instructions and config. Each helper runs in
an injection context (a component, a directive, a service), registers on the nearest runtime and is
removed when its injector is destroyed. Registered on a thread list, it reaches every thread.

```ts
import {
  injectAssistantContext,
  injectAssistantInstructions,
  injectAssistantTool,
  injectModelContext,
} from '@ngx-assistant/angular';

@Component({/* ... */})
export class WeatherPanel {
  readonly city = signal('Rome');

  constructor() {
    injectAssistantTool({
      toolName: 'get_weather',
      description: 'Get the weather of a city.',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      execute: async ({ city }) => fetchWeather(city as string),
      render: WeatherCard,
    });
    injectAssistantInstructions('Answer in Italian.');
    injectAssistantContext({ getContext: () => `The user is looking at ${this.city()}.` });
  }
}
```

`injectAssistantTool(tool)` adds a tool. With `execute` it runs in the browser and its result goes
back to the model; without it, the call waits for the UI to answer it with `addResult`. `render` is
registered as the UI of the tool on the tool UI registry of that runtime, so it applies wherever the
runtime's messages render, and never reaches the model. `injectAssistantInstructions(text)` adds to the system prompt, and
takes `{ instruction, disabled }`. `injectAssistantContext({ getContext })` adds to the system
prompt the text that `getContext` returns on every send.

The three helpers also take a function that reads signals, such as `() => ({ ...tool, description:
description() })`: the runtime always gets the latest value and is notified (`modelContextUpdate`)
when it changes. `injectModelContext()` gives the `modelName` and the sorted `toolNames` of the
model context of the nearest thread as a signal.

`provideDataStreamRuntime(...)` sends the system prompt, the tools as JSON Schema and the config
(`modelName` and the like) in the request body, and so does `provideAssistantTransportRuntime(...)`.
A local runtime hands the model context to its chat model.

## Model picker primitives

Headless model picker: behavior, ARIA and `data-*` state, no styles and no positioning. The chosen
model goes in the model context of the nearest runtime as `config.modelName`, and the chosen effort
as `config.reasoningEffort` when the model supports it.

```ts
import {
  NxaModelPicker,
  NxaModelPickerContent,
  NxaModelPickerEffort,
  NxaModelPickerEffortItem,
  NxaModelPickerItem,
  NxaModelPickerSearch,
  NxaModelPickerTrigger,
  type ModelOption,
} from '@ngx-assistant/angular';

readonly models: ModelOption[] = [
  { id: 'small', name: 'Small', keywords: ['fast'] },
  { id: 'large', name: 'Large', efforts: true },
];
```

<!-- prettier-ignore -->
```html
<div nxaModelPicker #picker="nxaModelPicker" [models]="models" [(value)]="model">
  <button nxaModelPickerTrigger>{{ picker.selectedModel()?.name ?? 'Select model' }}</button>
  <div nxaModelPickerContent>
    <input nxaModelPickerSearch placeholder="Search models" />
    <div nxaModelPickerList aria-label="Models">
      @for (option of picker.filteredModels(); track option.id) {
        <div [nxaModelPickerItem]="option">{{ option.name }}</div>
      }
    </div>
    @if (picker.filteredModels().length === 0) {
      <p>No models</p>
    }
    <div nxaModelPickerEffort aria-label="Reasoning effort">
      @for (level of picker.efforts() ?? []; track level.id) {
        <button [nxaModelPickerEffortItem]="level.id">{{ level.name }}</button>
      }
    </div>
  </div>
</div>
```

| Directive                          | Behavior                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `[nxaModelPicker]`                 | Holds `models`, the two-way `value`, `effort` and `open`, and writes the choice to the context. |
| `button[nxaModelPickerTrigger]`    | Select-only combobox: toggles on click, opens with the arrows, drives the open list.            |
| `[nxaModelPickerContent]`          | What opens: `hidden` while closed; holds the list, the search and the effort levels.            |
| `[nxaModelPickerList]`             | `role="listbox"` with the options only.                                                         |
| `[nxaModelPickerItem]`             | `role="option"` for a model: a click picks it and closes; the pointer highlights it.            |
| `input[nxaModelPickerSearch]`      | Filters `filteredModels()` by id, name and keywords; takes the focus when the content opens.    |
| `[nxaModelPickerEffort]`           | `role="radiogroup"` of the effort levels, `hidden` when the chosen model has none.              |
| `button[nxaModelPickerEffortItem]` | `role="radio"` for a level: a click chooses it; the arrows move between levels.                 |

Without `value`, the first model that is not disabled is chosen. A model can carry an `icon` (an
image URL) for the parts that show it; the picker only passes it along. `efforts: true` gives the low, medium and high levels;
the chosen effort stays across model switches and `activeEffort()` is the one that applies to the
chosen model. Through `#picker="nxaModelPicker"` (or `injectModelPicker()` in a custom part):
`selectedModel()`, `efforts()`, `activeEffort()`, `filteredModels()`, `highlightedId()`, `query`,
and the methods `select`, `setEffort`, `show`, `close` and `toggle`.

Open, the trigger and the search take ArrowDown, ArrowUp, Home and End to move over the enabled
options (`aria-activedescendant`, `data-highlighted`) and Enter to pick; Space also picks on the
trigger. Escape closes with the focus back on the trigger and does not reach the elements around the
picker (a dialog keeps it for when the picker is closed). Keys are ignored while an IME composes.
Tab moves through the content as usual: the picker closes when the focus or a pointer down lands
outside it. A pointer down on a part of the content that takes no focus keeps the focus where it
is. Opening, through `show()` or the `open` binding, starts on the chosen model; closing clears the
search. Options carry `aria-selected`,
`data-selected`, and `aria-disabled` with `data-disabled` for a model that cannot be picked; the
root, the trigger and the content carry `data-state="open|closed"`, the levels
`data-state="checked|unchecked"` and `aria-checked`. Without a runtime the picker only keeps the
state.

## Build and test

```bash
pnpm ng build @ngx-assistant/angular   # output in dist/angular
pnpm ng test @ngx-assistant/angular
pnpm run build:schematics              # the schematics, in dist/angular/schematics
pnpm run test:schematics               # their tests, on a workspace in memory
scripts/try-ng-add.sh                  # ng add in a new app with the packed libraries, then ng build
```

The schematics live in `schematics/` and are compiled on their own (CommonJS, as the Angular CLI
loads them). Their build bundles the styled components of `packages/ui/src/lib`;
`schematics/ui/components.json` says which entry files each generator starts from, and the build
adds every file they import.
