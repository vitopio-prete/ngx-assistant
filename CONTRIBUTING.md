# Contributing to ngx-assistant

Thanks for helping out! Bug fixes, features, docs and issue triage are all welcome.

## Development setup

This is a pnpm monorepo. You need Node.js 22.22.3+ or 24.15+ and pnpm.

```bash
pnpm install     # installs dependencies and the git hooks (lefthook)
pnpm run dev     # runs the demo app
```

| Command                                            | Purpose                                                         |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm run build`                                   | Build all packages                                              |
| `pnpm run test`                                    | Unit tests                                                      |
| `pnpm run e2e`                                     | End-to-end check of the demo build (run `pnpm run build` first) |
| `pnpm run check:demo-ui` / `pnpm run sync:demo-ui` | Check / refresh the demo's copies of the styled components      |
| `pnpm run lint`                                    | Lint                                                            |
| `pnpm run typecheck`                               | Type-check the engine sources and tests                         |
| `pnpm run format` / `pnpm run format:check`        | Prettier                                                        |
| `pnpm run security:check`                          | Audit production dependencies                                   |

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

PRs are merged with a merge commit, so every commit of the branch lands in `develop` and, through
release-please, in the changelog of the package it touches. The merge commit carries the PR title
too, so a `feat` or `fix` title adds its own entry: write each message and the title for the
people who use the library.

## Releasing

Versions and changelogs come from the Conventional Commits, through
[release-please](https://github.com/googleapis/release-please). `@ngx-assistant/engine` and
`@ngx-assistant/angular` always share the same version. Before 1.0, `feat` and breaking changes
raise the minor version and `fix` the patch version; `docs`, `refactor`, `test`, `build`, `ci` and
`chore` stay out of the changelog.

1. Create a `release/*` branch from `develop`, then open a PR from it to `main` and merge it.
   release-please picks the version from the commits; a `Release-As: x.y.z` footer in a commit
   forces one.
2. On `main`, the Release workflow opens a release PR with the new versions and the
   `CHANGELOG.md` of each package. Review the changelog there, then merge it: the workflow tags
   the release (`engine-vx.y.z`, `angular-vx.y.z`), creates the GitHub releases, runs the tests
   and the package checks again on the tagged commit and publishes both packages to npm with
   provenance.
3. Merge `main` back into `develop`.

If publishing fails, use "Re-run failed jobs" on that run: a new run of the workflow finds the
release already tagged and does not publish. A rerun skips the versions already on npm.

The release PR is opened with the workflow's own token, so the CI workflows do not run on it; the
publish job runs the same checks before publishing.

`pnpm run check:packages` (after `pnpm run build`) packs both packages as npm would publish them
and checks their files, their `package.json`, publint and are-the-types-wrong.

### Repository setup

The workflow needs, once:

- in the repository settings, Actions → General: "Allow GitHub Actions to create and approve pull
  requests" (release-please opens the release PR);
- an environment named `npm` (Settings → Environments), where the publish job runs; a required
  reviewer there makes every publication wait for an approval;
- npm trusted publishing for both packages: on npmjs.com, in the settings of each package, a
  trusted publisher for this repository, workflow `release.yml` and environment `npm`. npm only
  offers it for a package that exists, so the first release publishes with a short-lived granular
  token saved as the `NPM_TOKEN` secret of the `npm` environment; configure the trusted publishers
  right after it and delete the secret.

The packages declare `publishConfig.provenance`, so `npm publish` only works from the workflow,
not from a local machine.

## Reporting issues

Open an issue with a clear description and, ideally, a minimal reproduction (StackBlitz or a small repo).
For bugs, include the ngx-assistant, Angular and browser versions.

## Questions

Open a discussion or an issue. Improving this guide is a welcome contribution too.
