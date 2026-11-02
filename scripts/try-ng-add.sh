#!/usr/bin/env bash
# Installs the packed libraries in a new Angular app, runs ng add and the component generators,
# renders the thread and builds the app. Run it after `pnpm run build`.
#
#   scripts/try-ng-add.sh [folder]   (default: a new temporary folder)
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="${1:-$(mktemp -d)}"
# The CLI of the repo, run from npm: the installed one would find the workspace of the repo.
cli_version="$(node -p "require('$repo/node_modules/@angular/cli/package.json').version")"
mkdir -p "$work"
echo "Working in $work"

# The packages as npm would publish them.
rm -f "$work"/*.tgz
(cd "$repo/packages/engine" && pnpm pack --pack-destination "$work" >/dev/null)
(cd "$repo/dist/angular" && npm pack --pack-destination "$work" >/dev/null)

cd "$work"
rm -rf app
npx --yes "@angular/cli@$cli_version" new app --defaults --style=css --ssr=false --skip-git --package-manager=npm
cd app
npm install --no-audit --no-fund "$work"/ngx-assistant-engine-*.tgz "$work"/ngx-assistant-angular-*.tgz

# The package is already installed, so ng add only runs its schematic.
npx ng add @ngx-assistant/angular --defaults --skip-confirmation
for component in thread-list assistant-modal model-selector approval-card; do
  npx ng generate "@ngx-assistant/angular:$component"
done

# Running ng add again changes nothing.
snapshot() { find src angular.json package.json .postcssrc.json -type f -exec sha1sum {} + | sort; }
before="$(snapshot)"
npx ng add @ngx-assistant/angular --defaults --skip-confirmation
[ "$before" = "$(snapshot)" ] || { echo "A second ng add changed the app"; exit 1; }

# Render the thread, so the build compiles its template.
cat > src/app/app.html <<'HTML'
<nxa-thread class="h-dvh" />
HTML
sed -i "s|^import { Component\(.*\)|import { Component\1\nimport { NxaThread } from './chat';|" src/app/app.ts
sed -i "s|imports: \[|imports: [NxaThread, |" src/app/app.ts
grep -q "from './chat'" src/app/app.ts
grep -q 'NxaThread, ' src/app/app.ts

npx ng build 2>&1 | tee build.log
if grep -q "exceeded maximum budget" build.log; then echo "The build exceeds a budget"; exit 1; fi
grep -q 'bg-nxa-background' dist/app/browser/*.css
echo "The app builds with the copied components."
