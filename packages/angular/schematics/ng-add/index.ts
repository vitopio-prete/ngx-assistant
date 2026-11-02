import type { JsonValue } from '@angular-devkit/core';
import type { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { chain, noop } from '@angular-devkit/schematics';
import {
  addDependency,
  addRootProvider,
  DependencyType,
  ExistingBehavior,
  InstallBehavior,
  updateWorkspace,
} from '@schematics/angular/utility';
import { posix } from 'node:path';
import { copyComponents } from '../ui/index';
import { readManifest } from '../utils/manifest';
import { addTailwindImport } from '../utils/styles';
import { type Application, getApplication, joinPath, stylesOf } from '../utils/workspace';
import type { NgAddSchema } from './schema';

/** A TypeScript string literal in single quotes. */
const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const runtimeCall = /\bprovide\w*Runtime\s*\(/;

/** Builders that read the `define` option. */
const esbuildBuilders = new Set([
  '@angular/build:application',
  '@angular-devkit/build-angular:application',
  '@angular-devkit/build-angular:browser-esbuild',
]);

export default function ngAdd(options: NgAddSchema): Rule {
  return async (tree: Tree) => {
    const app = await getApplication(tree, options.project);
    const { versions } = readManifest();
    const install = options.skipInstall ? InstallBehavior.None : InstallBehavior.Auto;

    return chain([
      addDependency('@ngx-assistant/engine', versions['@ngx-assistant/engine']!, {
        existing: ExistingBehavior.Skip,
        install,
      }),
      addRuntime(app, options),
      defineNodeEnv(app),
      raiseInitialBudget(app),
      options.skipTailwind ? noop() : setUpTailwind(app, versions, install),
      options.components
        ? copyComponents('thread', {
            project: app.name,
            path: options.path,
            overwrite: false,
            skipInstall: options.skipInstall,
          })
        : noop(),
      nextSteps(app, options),
    ]);
  };
}

/**
 * The file that holds the root providers, as addRootProvider finds it: the file main imports the
 * config of bootstrapApplication from (`app.config.ts` in a new app), or main itself.
 */
function providersFile(tree: Tree, app: Application): string | undefined {
  const main = app.build?.options?.['browser'] ?? app.build?.options?.['main'];
  if (typeof main !== 'string' || !tree.exists(main)) return undefined;
  const text = tree.readText(main);
  const config = /bootstrapApplication\(\s*\w+\s*,\s*(\w+)\s*\)/.exec(text)?.[1];
  if (!config) return main;
  const source = new RegExp(
    `import\\s*\\{[^}]*\\b${config}\\b[^}]*\\}\\s*from\\s*['"](\\.[^'"]+)['"]`,
  ).exec(text)?.[1];
  if (!source) return main;
  const file = joinPath(posix.dirname(main), source.replace(/\.ts$/, '') + '.ts');
  return tree.exists(file) ? file : main;
}

function addRuntime(app: Application, options: NgAddSchema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const file = providersFile(tree, app);
    if (file && runtimeCall.test(tree.readText(file))) {
      context.logger.info(`${file} already provides a runtime: left as it is.`);
      return noop();
    }

    if (options.runtime === 'data-stream') {
      return addRootProvider(
        app.name,
        ({ code, external }) =>
          code`${external('provideDataStreamRuntime', '@ngx-assistant/angular')}({ api: ${quote(options.api)} })`,
      );
    }

    if (!file) {
      throw new Error(`Could not find the main file of ${app.name}.`);
    }
    const model = joinPath(posix.dirname(file), 'chat-model.ts');
    if (!tree.exists(model)) tree.create(model, chatModelSource);
    return addRootProvider(
      app.name,
      ({ code, external }) =>
        code`${external('provideLocalRuntime', '@ngx-assistant/angular')}(() => ${external('inject', '@angular/core')}(${external('ChatModel', './chat-model')}))`,
    );
  };
}

const chatModelSource = `import { Injectable } from '@angular/core';
import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult } from '@ngx-assistant/engine';

/**
 * The model the local runtime runs the chat with. Replace the body of run() with a call to your
 * model, and inject() what you need (HttpClient, your own services). Yield partial results to
 * stream the reply.
 */
@Injectable({ providedIn: 'root' })
export class ChatModel implements ChatModelAdapter {
  async *run({ messages }: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
    const last = messages.at(-1);
    const question = last?.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    yield {
      content: [
        {
          type: 'text',
          text: \`You said: "\${question}". Connect a model in chat-model.ts to get real replies.\`,
        },
      ],
    };
  }
}
`;

/**
 * The engine reads process.env.NODE_ENV for its development checks; Angular does not define it.
 * Defines it in the configurations of the build target, as the builder's `define` option.
 */
function defineNodeEnv(app: Application): Rule {
  return (_tree: Tree, context: SchematicContext) => {
    if (!app.build || !esbuildBuilders.has(app.build.builder)) {
      context.logger.warn(
        `The build of ${app.name} does not use the application builder: define ` +
          `process.env.NODE_ENV in your build to turn the development checks of the engine on.`,
      );
      return noop();
    }
    return updateWorkspace((workspace) => {
      const build = workspace.projects.get(app.name)?.targets.get('build');
      if (!build) return;
      const configurations = build.configurations ?? {};
      const names = ['production', 'development'].filter((name) => configurations[name]);
      const targets =
        names.length > 0
          ? names.map((name) => ({ options: configurations[name]!, value: name }))
          : [{ options: (build.options ??= {}), value: 'production' }];
      for (const { options, value } of targets) {
        const define = (options['define'] ?? {}) as Record<string, string>;
        if (!('process.env.NODE_ENV' in define)) {
          options['define'] = { ...define, 'process.env.NODE_ENV': JSON.stringify(value) };
        }
      }
      // assistant-stream parses JSON with a CommonJS package: allow it, the build warns otherwise.
      const buildOptions = (build.options ??= {});
      const allowed = (buildOptions['allowedCommonJsDependencies'] ?? []) as string[];
      if (!allowed.includes('secure-json-parse')) {
        buildOptions['allowedCommonJsDependencies'] = [...allowed, 'secure-json-parse'];
      }
    });
  };
}

/** The initial bundle of an app with every component, the engine and its parser is about 800 kB. */
const initialBudget = { maximumWarning: '1mb', maximumError: '2mb' } as const;

/** A budget size such as 500kB or 1.5MB in bytes, as the builder reads it; NaN for a percentage. */
function budgetBytes(size: unknown): number {
  const match =
    typeof size === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(size) : null;
  if (!match) return Number.NaN;
  const unit = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(match[2] ?? 'b').toLowerCase()]!;
  return Number(match[1]) * unit;
}

/**
 * Raises the limits of the `initial` budgets of the build to 1 MB (warning) and 2 MB (error), so
 * a new app does not warn on its first build. Limits that are already higher, or that are not a
 * size, stay as they are, and no budget is added.
 */
function raiseInitialBudget(app: Application): Rule {
  return updateWorkspace((workspace) => {
    const build = workspace.projects.get(app.name)?.targets.get('build');
    if (!build) return;
    for (const options of [build.options, ...Object.values(build.configurations ?? {})]) {
      const budgets = options?.['budgets'];
      if (!options || !Array.isArray(budgets)) continue;
      let changed = false;
      const next = budgets.map((budget) => {
        if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return budget;
        if (budget['type'] !== 'initial') return budget;
        const raised = { ...budget };
        for (const [key, size] of Object.entries(initialBudget)) {
          if (budgetBytes(raised[key]) < budgetBytes(size)) raised[key] = size;
        }
        changed ||= JSON.stringify(raised) !== JSON.stringify(budget);
        return raised;
      });
      // The workspace writer tracks whole values: replace the array rather than its items.
      if (changed) options['budgets'] = next;
    }
  });
}

const postcssConfigs = ['.postcssrc.json', 'postcss.config.json'];

function setUpTailwind(
  app: Application,
  versions: Readonly<Record<string, string>>,
  install: InstallBehavior,
): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const pkg = tree.readJson('package.json') as Record<string, Record<string, string> | undefined>;
    const current = pkg['dependencies']?.['tailwindcss'] ?? pkg['devDependencies']?.['tailwindcss'];
    // Only a range that starts with a version (4.1.0, ^3.4, ~4.0) tells the major; tags and
    // ranges such as >=3.4 <5 are taken as compatible.
    const major = current ? /^[\^~=v]*(\d+)/.exec(current.trim())?.[1] : undefined;
    if (major !== undefined && Number(major) < 4) {
      context.logger.warn(
        `The app uses Tailwind CSS ${current}: the components need Tailwind CSS v4. ` +
          `Upgrade it (npx @tailwindcss/upgrade) and run ng add again.`,
      );
      return noop();
    }

    configurePostcss(tree, context, app);
    const stylesheet = tailwindStylesheet(tree, app);

    const rules: Rule[] = [];
    if (stylesheet.created) rules.push(addStyle(app, stylesheet.path));
    for (const name of ['tailwindcss', '@tailwindcss/postcss']) {
      rules.push(
        addDependency(name, versions[name]!, {
          type: DependencyType.Dev,
          existing: ExistingBehavior.Skip,
          install,
        }),
      );
    }
    return chain(rules);
  };
}

function configurePostcss(tree: Tree, context: SchematicContext, app: Application): void {
  const config = [app.root, '']
    .flatMap((dir) => postcssConfigs.map((name) => joinPath(dir || '.', name)))
    .find((path) => tree.exists(path));
  if (!config) {
    tree.create(
      '.postcssrc.json',
      JSON.stringify({ plugins: { '@tailwindcss/postcss': {} } }, null, 2) + '\n',
    );
    return;
  }
  let json: { plugins?: Record<string, unknown> | string[] };
  try {
    json = JSON.parse(tree.readText(config));
  } catch {
    context.logger.warn(`Could not read ${config}: add the @tailwindcss/postcss plugin to it.`);
    return;
  }
  const plugins = json.plugins ?? {};
  if (Array.isArray(plugins)) {
    if (!plugins.includes('@tailwindcss/postcss')) {
      context.logger.warn(`Add the @tailwindcss/postcss plugin to ${config}.`);
    }
    return;
  }
  if (!('@tailwindcss/postcss' in plugins)) {
    json.plugins = { ...plugins, '@tailwindcss/postcss': {} };
    tree.overwrite(config, JSON.stringify(json, null, 2) + '\n');
  }
}

/**
 * Imports Tailwind in the global CSS stylesheet. When the global styles are Sass or Less, which
 * Tailwind v4 does not go through, or there are none, creates a CSS stylesheet next to them.
 */
function tailwindStylesheet(tree: Tree, app: Application): { path: string; created: boolean } {
  const styles = stylesOf(app.build);
  const css = styles.find((path) => path.endsWith('.css') && tree.exists(path));
  if (css) {
    const text = tree.readText(css);
    const next = addTailwindImport(text);
    if (next !== text) tree.overwrite(css, next);
    return { path: css, created: false };
  }
  const path = joinPath(app.sourceRoot, styles.length > 0 ? 'tailwind.css' : 'styles.css');
  if (!tree.exists(path)) tree.create(path, `@import 'tailwindcss';\n`);
  else tree.overwrite(path, addTailwindImport(tree.readText(path)));
  return { path, created: true };
}

function addStyle(app: Application, path: string): Rule {
  return updateWorkspace((workspace) => {
    const project = workspace.projects.get(app.name);
    for (const name of ['build', 'test']) {
      const target = project?.targets.get(name);
      // The unit-test builder takes no styles option; Karma's does.
      if (!target || (name === 'test' && !target.builder.endsWith(':karma'))) continue;
      const options = (target.options ??= {});
      const styles = (options['styles'] ?? []) as JsonValue[];
      if (!styles.includes(path)) options['styles'] = [...styles, path];
    }
  });
}

function nextSteps(app: Application, options: NgAddSchema): Rule {
  return (_tree: Tree, context: SchematicContext) => {
    const lines = ['ngx-assistant is set up.'];
    if (options.runtime === 'data-stream') {
      lines.push(`The chat sends its requests to ${options.api}: serve a data stream there.`);
    } else {
      lines.push('Connect your model in chat-model.ts.');
    }
    if (options.components) {
      lines.push(
        `Render the chat: import NxaThread from the index.ts in ${joinPath(app.sourceRoot, options.path)} ` +
          `and add <nxa-thread class="h-dvh" /> to a template.`,
      );
    } else {
      lines.push('Copy the styled components later with ng g @ngx-assistant/angular:thread.');
    }
    context.logger.info(lines.join('\n'));
  };
}
