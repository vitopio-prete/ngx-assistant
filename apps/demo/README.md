# ngx-assistant demo

A chat app built with the styled components of `@ngx-assistant/angular`, on an Angular zoneless app
that talks to a streaming backend over HTTP.

- **Conversations:** a sidebar to start, search, switch, rename, archive, restore and delete them,
  on `provideRemoteThreadListRuntime` with an adapter over `/api/threads`. The backend names each
  conversation after its first message. Each conversation runs on its own
  `provideDataStreamRuntime`, which posts every run to `/api/chat` and reads the reply as a UI
  message stream; its messages, branches included, are loaded from and saved to the backend through
  a history adapter given with `provideRuntimeAdapters`. Everything is still there after a reload.
- **Thread:** viewport that follows the streaming reply, scroll-to-bottom button, welcome screen
  with suggestions, markdown replies, reasoning.
- **Messages:** edit a message or regenerate a reply to create branches, and move between them with
  the branch picker; copy a message; a failed request or a stream that fails halfway shows its
  error.
- **Tools:** `provideToolUi` renders each tool call with its own component. `get_weather` runs on
  the backend, which streams the call and its result. `send_email` has no `execute` on the backend:
  the run stops until the user approves or denies it in the browser, and the answer goes back to
  the backend as the tool result. Any other tool shows in the tool fallback.
- **Model selector:** the model and its reasoning effort, picked in the header, go in the model
  context of the thread list, so every run of every conversation asks for them.
- **Composer:** Enter to send, Shift+Enter for a new line, Stop during a run, which aborts the
  request; attach images or text files with the button, by pasting or by dropping them.
- **Layouts and theme:** the header switches between the full page and a widget, where the same
  conversations open in the assistant modal, and between the light and the dark theme.

## How it was set up

The components in `src/app/chat/` were copied by the schematics, as in any app (here with
`--project demo`):

```bash
ng add @ngx-assistant/angular
ng generate @ngx-assistant/angular:thread-list
ng generate @ngx-assistant/angular:assistant-modal
ng generate @ngx-assistant/angular:model-selector
```

`ng add` set up Tailwind and the theme in `src/styles.css`, raised the `initial` budget of the
build in `angular.json` and copied the thread. It left the runtimes in `src/app/app.config.ts` as
they were. Two changes are for this repository: the packages the components need are in the
`package.json` of the demo, with the Tailwind PostCSS config next to it, and Tailwind looks for
classes in `src/` only (`source('./')`), not in the whole repository.

The demo uses the copied files as they are and changes them only through inputs and providers, so
they stay the same as the components of `packages/ui`. `pnpm run check:demo-ui` (part of
`pnpm test`) fails when a copy differs, is missing or is no longer copied by any generator.
`pnpm run sync:demo-ui` copies the changed and missing files again; a file that is no longer copied
has to be deleted, and a new one exported from `src/app/chat/index.ts`, by hand.

## The backend

The demo is a static site, so its backend runs in the page: `installFakeBackend()` (`src/backend/`)
answers the `fetch` calls to `/api/` as a server would, and keeps the conversations in
`localStorage`. The app does not know: it uses plain `fetch`, and the replies are the same UI
message streams that AI SDK's `streamText(...).toUIMessageStreamResponse()` sends.

Its model is deterministic. It repeats the last message, numbers each regenerated take
(`Echo (2): ...`) and names the attached files; the Shout model answers in capitals, and a
reasoning effort adds a reasoning part. `weather in <city>` calls `get_weather`,
`send an email to <address>` calls `send_email`, `/error` fails the request and `/error-stream`
fails the reply halfway.

To use a real backend, remove `installFakeBackend()` from `src/main.ts` and serve `/api/chat` and
`/api/threads` (see `src/app/backend-client.ts` for what the thread routes take and return).

```bash
pnpm run dev     # from the repository root: builds the packages and serves the demo
pnpm run build   # builds the packages and the demo into dist/demo
pnpm run e2e     # runs the built demo in jsdom and checks its flows and the requests they make
```
