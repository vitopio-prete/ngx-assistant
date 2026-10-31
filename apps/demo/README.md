# ngx-assistant demo

A chat app built only with the headless primitives of `@ngx-assistant/angular`, on an Angular
zoneless app that talks to a streaming backend over HTTP.

- **Conversations:** a sidebar to start, switch, archive, restore and delete them, on
  `provideRemoteThreadListRuntime` with an adapter over `/api/threads`. The backend names each
  conversation after its first message. Each conversation runs on its own
  `provideDataStreamRuntime`, which posts every run to `/api/chat` and reads the reply as a UI
  message stream; its messages, branches included, are loaded from and saved to the backend through
  a history adapter given with `provideRuntimeAdapters`. Everything is still there after a reload.
- **Thread:** viewport that follows the streaming reply, scroll-to-bottom button, welcome screen
  with suggestions.
- **Messages:** edit a message or regenerate a reply to create branches, and move between them with
  the branch picker; copy a message; a failed request or a stream that fails halfway shows its
  error.
- **Tools:** `provideToolUi` renders each tool call with its own component. `get_weather` runs on
  the backend, which streams the call and its result. `send_email` has no `execute` on the backend:
  the run stops until the user approves or denies it in the browser, and the answer goes back to
  the backend as the tool result.
- **Model picker:** the model and its reasoning effort, picked in the header, go in the model
  context of the thread list, so every run of every conversation asks for them.
- **Composer:** Enter to send, Shift+Enter for a new line, Stop during a run, which aborts the
  request; attach images or text files with the button, by pasting or by dropping them.

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
