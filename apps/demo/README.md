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
- **Model selector:** the model and its reasoning effort, picked in the composer, go in the model
  context of the thread list, so every run of every conversation asks for them, and are kept in
  `localStorage` for the next visit. Each model has an icon; the free models of OpenRouter are
  listed but disabled, with "Sign in to use" under their name, until an OpenRouter account is
  connected. While the chosen model cannot be used, the selector uses the first model that can
  (Showcase), and comes back to the chosen one once it can.
- **Account row:** "Sign in with OpenRouter" at the bottom of the sidebar (in the header of the
  widget layout; on a narrow screen, open the sidebar with Threads), in the footer slot of the
  thread list; once signed in, the account with a menu to
  manage its keys or disconnect. See [Free models on OpenRouter](#free-models-on-openrouter).
- **Real models, for free:** see [Free models on OpenRouter](#free-models-on-openrouter).
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

The simulated models are deterministic.

- **Showcase** (the model of a first visit) answers with replies written in advance, picked from
  the words of the message (`src/backend/showcase.ts`): code (`code`, `example`, `signals`...)
  gets a component in a code block, `table` or `compare` a table of the runtimes,
  `plan a day in <city>` calls `get_weather` and writes a plan from its result, a greeting lists
  what to try, and anything else a reply with headings, lists, a table and a code block. Each reply
  starts with its reasoning, which a higher effort makes longer, and streams a word at a time, so
  the markdown is shown as it arrives. A regenerated take starts differently, and the attached
  files are named at the end.
- **Echo** repeats the last message, numbers each regenerated take (`Echo (2): ...`) and names the
  attached files; a reasoning effort adds a reasoning part.

With both, `weather in <city>` calls `get_weather`, `send an email to <address>` calls
`send_email`, `/error` fails the request and `/error-stream` fails the reply halfway.

## Free models on OpenRouter

The demo can also talk to the free models of [OpenRouter](https://openrouter.ai) (the ones whose id
ends with `:free`), on the visitor's own account: the demo has no key and no server of its own, so
it costs nothing to run.

1. Create an OpenRouter account (free).
2. Pick **Sign in with OpenRouter** at the bottom of the sidebar, then **Continue to OpenRouter**.
   OpenRouter asks you to sign in and approve, then sends you back to the demo, which exchanges the
   code it got for a key (OAuth with PKCE, in the browser). Or paste a key you made on OpenRouter.
3. Pick a model in the composer and write.

Once signed in, the row shows the account with the name of its key (from OpenRouter's
`GET /api/v1/key`), and its menu links to the keys page of OpenRouter or disconnects.

The key is kept in this browser's `localStorage` until **Disconnect**. The client sends it to its
backend in the `Authorization` header (the `headers` option of `provideDataStreamRuntime`), as an
app would to its own server, and the backend calls OpenRouter with it. Here the backend runs in the
page, so the key goes nowhere but OpenRouter; with a backend of your own, it goes to that backend
too. Disconnecting forgets the key here; delete it on OpenRouter to revoke it.

- **The models:** `GET /api/models` reads the models list of OpenRouter once per page and keeps the
  free ones that answer in text, with their names. The list changes often, so it is not in the
  code. Each one gets the logo of its maker, from `public/providers/`.
- **The replies:** `POST /api/chat` sends a model of OpenRouter (`openrouter/<id>`) to its chat
  completions in streaming, and turns the stream into the UI message stream the app reads: the
  reasoning, the text and the tool calls. Stop aborts the request to OpenRouter.
- **Tools:** a model that takes tools gets `get_weather` and `send_email`, as the simulated ones.
  The backend runs `get_weather` and calls the model again with the result, up to 4 calls per
  reply; `send_email` waits for the user, whose answer goes to the model in the next request. A
  tool the backend does not know gets an error as its result. Images go to the models that take
  them.
- **Limits:** free models allow 20 requests a minute, and 50 a day per account (1000 once the
  account has bought 10 credits). A refused request shows OpenRouter's reason, with no retry.
  Conversation titles stay simulated, so they do not count. When OpenRouter refuses a request for
  the daily limit (`free-models-per-day`), the backend says so in the `X-RateLimit-Scope: day` and
  `X-RateLimit-Reset` headers of its 429; the app reads them in the `onResponse` of
  `provideDataStreamRuntime` and, while a model of OpenRouter is chosen, shows a notice above the
  composer (its `nxaComposerNotice` slot) with the time of the reset and a button to use Showcase.
  The end of the limit is kept in `localStorage` until then, or until the account is disconnected
  or another key is used.

The logos are from [Lobe Icons](https://github.com/lobehub/lobe-icons) (MIT, see
`public/providers/LICENSE`), unchanged. Model names and logos are trademarks of their owners, used
only to say which model is which; ngx-assistant is not affiliated with them.

## Using a real backend

To use a real backend, remove `installFakeBackend()` from `src/main.ts` and serve `/api/chat` and
`/api/threads` (see `src/app/backend-client.ts` for what the thread routes take and return), and
`/api/models` for the OpenRouter models (`src/backend/openrouter-models.ts`).

```bash
pnpm run dev     # from the repository root: builds the packages and serves the demo
pnpm run build   # builds the packages and the demo into dist/demo
pnpm run e2e     # runs the built demo in jsdom and checks its flows and the requests they make
```
