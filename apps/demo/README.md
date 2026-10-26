# ngx-assistant demo

A chat app built only with the headless primitives of `@ngx-assistant/angular`, on an Angular
zoneless app with a fake model that streams its reply word by word.

- **Conversations:** a sidebar to start, switch, archive, restore and delete them. The list runs on
  `provideExternalStoreRuntime` with a thread list adapter over a small signal store
  (`thread-store.ts`); each conversation is a chat with its own `provideLocalRuntime`, kept alive
  while another one is shown.
- **Thread:** viewport that follows the streaming reply, scroll-to-bottom button, welcome screen
  with suggestions.
- **Messages:** edit a message or regenerate a reply to create branches, and move between them with
  the branch picker; copy a message; a failed reply shows its error.
- **Composer:** Enter to send, Shift+Enter for a new line, Stop during a run; attach images or text
  files with the button, by pasting or by dropping them.

The echo model (`echo-model.ts`) repeats the last message, numbers each regenerated take
(`Echo (2): ...`), names the attached files and fails on purpose when the message contains `/error`.

```bash
pnpm run dev     # from the repository root: builds the packages and serves the demo
pnpm run build   # builds the packages and the demo into dist/demo
pnpm run e2e     # runs the built demo in jsdom: thread, branches, editing, attachments, thread list
```
