# @ngx-assistant/engine

Framework-agnostic chat runtime for ngx-assistant: threads, messages, branching, composer,
attachments, tools and adapters.

The runtimes are plain TypeScript classes with `getState()` and `subscribe()`; they have no
dependency on React or Angular. Framework bindings import everything from the package root:

```ts
import { AssistantRuntimeImpl, LocalRuntimeCore } from '@ngx-assistant/engine';
```

## Installation

In an Angular app, `ng add @ngx-assistant/angular` installs the engine at the version the Angular
package expects. On its own:

```bash
npm install @ngx-assistant/engine
```

The package is an ES module only.

## `process.env.NODE_ENV`

The engine reads `process.env.NODE_ENV` to turn on development-only checks (warnings about tool
calls and state that is not JSON). When the application build replaces it, as `define` does in
the Angular CLI, Vite or esbuild, the checks follow the build: on in development, off in
production. With the Angular CLI, `ng add @ngx-assistant/angular` adds the `define`; by hand:

```json
"define": {
  "process.env.NODE_ENV": "\"production\""
}
```

Without the replacement the engine still loads: in a browser, where `process` does not exist, it
runs as in production and the checks stay off. In Node it reads the variable of the process.

## Changelog

See [`CHANGELOG.md`](https://github.com/vitopio-prete/ngx-assistant/blob/main/packages/engine/CHANGELOG.md).
