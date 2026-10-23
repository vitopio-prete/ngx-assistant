# ngx-assistant demo

A minimal chat built on `@ngx-assistant/engine`: an Angular zoneless app with a fake model that
streams its reply word by word.

```bash
pnpm run dev     # from the repository root: builds the engine and serves the demo
pnpm run build   # builds the packages and the demo into dist/demo
pnpm run e2e     # runs the built demo in jsdom: send, streaming, keyboard and stop
```
