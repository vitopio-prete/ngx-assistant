# ngx-assistant

Open-source Angular library for AI chat interfaces: a framework-agnostic chat engine and a
reactive layer built on Angular signals and dependency injection.

## Packages

| Package                  | Path               | What it is                                                     |
| ------------------------ | ------------------ | -------------------------------------------------------------- |
| `@ngx-assistant/engine`  | `packages/engine`  | Framework-agnostic chat runtime. Plain TypeScript, no Angular. |
| `@ngx-assistant/angular` | `packages/angular` | Angular bindings (signals + DI) and headless primitives.       |

## Development

Requires Node `^22.22.3 || ^24.15.0` and pnpm (version pinned in `package.json`).

```bash
pnpm install
pnpm build       # engine (tsc) + Angular library (ng-packagr)
pnpm test        # engine tests (Vitest) + Angular library tests
pnpm typecheck   # engine sources and tests
```

## License

MIT. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
