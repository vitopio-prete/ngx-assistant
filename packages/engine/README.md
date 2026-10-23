# @ngx-assistant/engine

Framework-agnostic chat runtime for ngx-assistant: threads, messages, branching, composer,
attachments, tools and adapters.

The runtimes are plain TypeScript classes with `getState()` and `subscribe()`; they have no
dependency on React or Angular. Framework bindings import everything from the package root:

```ts
import { AssistantRuntimeImpl, LocalRuntimeCore } from '@ngx-assistant/engine';
```

## `process.env.NODE_ENV`

The engine reads `process.env.NODE_ENV` to enable development-only checks, and expects the
application build to replace it. With the Angular CLI, add a `define` to the application's
build options:

```json
"define": {
  "process.env.NODE_ENV": "\"production\""
}
```

Without the replacement, loading the engine in a browser throws `ReferenceError: process is not
defined`. Bundlers that already replace it (Vite, esbuild with `platform: "browser"`) and Node
need nothing.
