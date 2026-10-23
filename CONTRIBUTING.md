# Contributing to ngx-assistant

Thanks for helping out! Bug fixes, features, docs and issue triage are all welcome.

## Development setup

This is a pnpm monorepo. You need Node.js 22.22.3+ or 24.15+ and pnpm.

```bash
pnpm install     # installs dependencies and the git hooks (lefthook)
pnpm run dev     # runs the demo app
```

| Command                                     | Purpose                                 |
| ------------------------------------------- | --------------------------------------- |
| `pnpm run build`                            | Build all packages                      |
| `pnpm run test`                             | Unit tests                              |
| `pnpm run lint`                             | Lint                                    |
| `pnpm run typecheck`                        | Type-check the engine sources and tests |
| `pnpm run format` / `pnpm run format:check` | Prettier                                |
| `pnpm run security:check`                   | Audit production dependencies           |

## Making a change

1. Fork the repo and create a `feature/*` (or `fix/*`) branch from `develop`. We use gitflow:
   `develop` is the integration branch, `main` holds releases.
2. Keep the change focused: small PRs are reviewed and merged faster.
3. Add or update tests for the behavior you change.
4. Run `pnpm run lint`, `pnpm run test` and `pnpm run build` before opening the PR against `develop`.
5. Write commit messages and the **PR title** as [Conventional Commits](https://www.conventionalcommits.org/):
   `type(scope): subject`, for example `feat(composer): add nxaComposerInput directive`.
   - Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
   - Scopes: `engine`, `angular`, `composer`, `thread`, `message`, `action-bar`, `branch-picker`,
     `attachments`, `suggestions`, `thread-list`, `adapters`, `ui`, `schematics`, `demo`, `docs`,
     `deps`, `release`, `ci`. The scope is optional.
   - Commits must not credit an AI agent with a `Co-authored-by:` trailer. You are the author of what you submit.
   - commitlint enforces all of this locally (git hook) and in CI.
6. Open the PR. In the description explain **what** changes, **why**, and **how you verified it**.
   For a bug fix, include the steps to reproduce it. Link the issue with `Fixes #123`.

PRs are squash-merged, so the PR title becomes the commit on `develop` and the changelog entry.

## Reporting issues

Open an issue with a clear description and, ideally, a minimal reproduction (StackBlitz or a small repo).
For bugs, include the ngx-assistant, Angular and browser versions.

## Questions

Open a discussion or an issue. Improving this guide is a welcome contribution too.
