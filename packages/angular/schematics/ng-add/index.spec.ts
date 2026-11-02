import type { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, createRunner } from '../testing/workspace';

const root = 'projects/app';
const config = `${root}/src/app/app.config.ts`;
const styles = `${root}/src/styles.css`;

interface BuildTarget {
  builder: string;
  options: Record<string, unknown>;
  configurations: Record<string, Record<string, unknown>>;
}

const buildOf = (tree: UnitTestTree, project = 'app'): BuildTarget =>
  JSON.parse(tree.readText('angular.json')).projects[project].architect.build;

const packageJson = (tree: UnitTestTree) =>
  JSON.parse(tree.readText('package.json')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

describe('ng add', () => {
  let runner: SchematicTestRunner;
  let app: UnitTestTree;

  beforeEach(async () => {
    runner = createRunner();
    app = await createApp(runner);
  });

  const ngAdd = (options: Record<string, unknown> = {}, tree = app) =>
    runner.runSchematic('ng-add', { project: 'app', ...options }, tree);

  it('adds the engine at the range the library expects', async () => {
    const tree = await ngAdd();
    expect(packageJson(tree).dependencies['@ngx-assistant/engine']).toBe('0.0.0');
  });

  it('keeps an engine version the app already has', async () => {
    const pkg = packageJson(app);
    pkg.dependencies['@ngx-assistant/engine'] = '^0.1.0';
    app.overwrite('package.json', JSON.stringify(pkg));
    const tree = await ngAdd();
    expect(packageJson(tree).dependencies['@ngx-assistant/engine']).toBe('^0.1.0');
  });

  it('provides the data stream runtime with the given api by default', async () => {
    const tree = await ngAdd({ api: "/api/it's" });
    const text = tree.readText(config);
    expect(text).toContain("import { provideDataStreamRuntime } from '@ngx-assistant/angular';");
    expect(text).toContain("provideDataStreamRuntime({ api: '/api/it\\'s' })");
    expect(tree.exists(`${root}/src/app/chat-model.ts`)).toBe(false);
  });

  it('creates a chat model and provides the local runtime with it', async () => {
    const tree = await ngAdd({ runtime: 'local' });
    const text = tree.readText(config);
    expect(text).toContain('provideLocalRuntime(() => inject(ChatModel))');
    expect(text).toMatch(/import \{[^}]*\binject\b[^}]*\} from '@angular\/core'/);
    expect(text).toContain("import { ChatModel } from './chat-model';");
    const model = tree.readText(`${root}/src/app/chat-model.ts`);
    expect(model).toContain('export class ChatModel implements ChatModelAdapter');
  });

  it('provides the runtime in main.ts when the app has no app config', async () => {
    app.delete(config);
    app.overwrite(
      `${root}/src/main.ts`,
      `import { bootstrapApplication } from '@angular/platform-browser';\nimport { App } from './app/app';\n\nbootstrapApplication(App, { providers: [] });\n`,
    );
    const tree = await ngAdd({ runtime: 'local' });
    const main = tree.readText(`${root}/src/main.ts`);
    expect(main).toContain('provideLocalRuntime(() => inject(ChatModel))');
    expect(main).toContain("from './chat-model'");
    expect(tree.exists(`${root}/src/chat-model.ts`)).toBe(true);
  });

  it('finds an app config that is not in app/, and does not provide twice', async () => {
    app.create(`${root}/src/config/app.config.ts`, app.readText(config));
    app.delete(config);
    app.overwrite(
      `${root}/src/main.ts`,
      app.readText(`${root}/src/main.ts`).replace('./app/app.config', './config/app.config'),
    );
    const once = await ngAdd({ runtime: 'local' });
    const twice = await ngAdd({ runtime: 'local' }, once);
    const text = twice.readText(`${root}/src/config/app.config.ts`);
    expect(text.match(/provideLocalRuntime\(/g)).toHaveLength(1);
    expect(text).toContain("from './chat-model'");
    expect(twice.exists(`${root}/src/config/chat-model.ts`)).toBe(true);
  });

  it('leaves a runtime the app already provides', async () => {
    const once = await ngAdd();
    const twice = await ngAdd({ runtime: 'local' }, once);
    expect(twice.readText(config)).toBe(once.readText(config));
    expect(twice.exists(`${root}/src/app/chat-model.ts`)).toBe(false);
  });

  it('defines process.env.NODE_ENV in the build configurations', async () => {
    const build = buildOf(await ngAdd());
    expect(build.configurations['production']!['define']).toEqual({
      'process.env.NODE_ENV': '"production"',
    });
    expect(build.configurations['development']!['define']).toEqual({
      'process.env.NODE_ENV': '"development"',
    });
    expect(build.options['allowedCommonJsDependencies']).toEqual(['secure-json-parse']);
  });

  it('keeps the defines the app already has', async () => {
    const workspace = JSON.parse(app.readText('angular.json'));
    workspace.projects.app.architect.build.configurations.production.define = {
      'process.env.NODE_ENV': '"staging"',
      API: '"x"',
    };
    app.overwrite('angular.json', JSON.stringify(workspace));
    const build = buildOf(await ngAdd());
    expect(build.configurations['production']!['define']).toEqual({
      'process.env.NODE_ENV': '"staging"',
      API: '"x"',
    });
  });

  it('raises the initial budget of a new app', async () => {
    const budgets = buildOf(await ngAdd()).configurations['production']!['budgets'];
    expect(budgets).toEqual([
      { type: 'initial', maximumWarning: '1mb', maximumError: '2mb' },
      { type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB' },
    ]);
  });

  it('keeps budgets that are already higher or not a size', async () => {
    const workspace = JSON.parse(app.readText('angular.json'));
    workspace.projects.app.architect.build.configurations.production.budgets = [
      { type: 'initial', maximumWarning: '1.5MB', maximumError: '10%', baseline: '700kB' },
    ];
    app.overwrite('angular.json', JSON.stringify(workspace));
    const budgets = buildOf(await ngAdd()).configurations['production']!['budgets'];
    expect(budgets).toEqual([
      { type: 'initial', maximumWarning: '1.5MB', maximumError: '10%', baseline: '700kB' },
    ]);
  });

  it('adds no budget to a build without one', async () => {
    const workspace = JSON.parse(app.readText('angular.json'));
    delete workspace.projects.app.architect.build.configurations.production.budgets;
    app.overwrite('angular.json', JSON.stringify(workspace));
    const build = buildOf(await ngAdd());
    expect(build.configurations['production']!['budgets']).toBeUndefined();
  });

  it('sets up Tailwind CSS v4', async () => {
    const tree = await ngAdd({ components: false });
    expect(packageJson(tree).devDependencies).toMatchObject({
      tailwindcss: expect.stringMatching(/^\^4\./),
      '@tailwindcss/postcss': expect.stringMatching(/^\^4\./),
    });
    expect(JSON.parse(tree.readText('.postcssrc.json'))).toEqual({
      plugins: { '@tailwindcss/postcss': {} },
    });
    expect(tree.readText(styles).startsWith("@import 'tailwindcss';\n")).toBe(true);
  });

  it('adds the plugin to a PostCSS config the app already has', async () => {
    app.create('.postcssrc.json', JSON.stringify({ plugins: { autoprefixer: {} } }));
    const tree = await ngAdd({ components: false });
    expect(JSON.parse(tree.readText('.postcssrc.json'))).toEqual({
      plugins: { autoprefixer: {}, '@tailwindcss/postcss': {} },
    });
  });

  it('leaves Tailwind CSS v3 alone and says why', async () => {
    const pkg = packageJson(app);
    pkg.devDependencies['tailwindcss'] = '^3.4.0';
    app.overwrite('package.json', JSON.stringify(pkg));
    const logs: string[] = [];
    runner.logger.subscribe((entry) => logs.push(entry.message));
    const tree = await ngAdd({ components: false });
    expect(packageJson(tree).devDependencies['tailwindcss']).toBe('^3.4.0');
    expect(tree.exists('.postcssrc.json')).toBe(false);
    expect(tree.readText(styles)).not.toContain('tailwindcss');
    expect(logs.join('\n')).toContain('need Tailwind CSS v4');
  });

  it('adds a CSS stylesheet next to Sass global styles', async () => {
    const scss = await createApp(createRunner(), { style: 'scss' });
    const tree = await ngAdd({}, scss);
    const css = `${root}/src/tailwind.css`;
    expect(tree.readText(css)).toBe(
      "@import 'tailwindcss';\n@import './app/chat/styles/nxa-theme.css';\n",
    );
    expect(buildOf(tree).options['styles']).toEqual([`${root}/src/styles.scss`, css]);
    expect(tree.readText(`${root}/src/styles.scss`)).not.toContain('tailwindcss');
  });

  it('leaves the unit-test target alone, which takes no styles', async () => {
    const scss = await createApp(createRunner(), { style: 'scss', skipTests: false });
    const tree = await ngAdd({}, scss);
    const test = JSON.parse(tree.readText('angular.json')).projects.app.architect.test;
    expect(test.builder).toBe('@angular/build:unit-test');
    expect(test.options?.styles).toBeUndefined();
  });

  it('adds the stylesheet to a Karma test target', async () => {
    const workspace = JSON.parse(app.readText('angular.json'));
    workspace.projects.app.architect.build.options.styles = [];
    workspace.projects.app.architect.test = { builder: '@angular/build:karma', options: {} };
    app.overwrite('angular.json', JSON.stringify(workspace));
    const tree = await ngAdd({ components: false });
    const test = JSON.parse(tree.readText('angular.json')).projects.app.architect.test;
    expect(test.options.styles).toEqual([styles]);
  });

  it('keeps partial Tailwind CSS imports', async () => {
    const css =
      '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n';
    app.overwrite(styles, css);
    const tree = await ngAdd();
    expect(tree.readText(styles)).toBe(css + "@import './app/chat/styles/nxa-theme.css';\n");
  });

  it('reads a range that does not start with a version as compatible', async () => {
    const pkg = packageJson(app);
    pkg.devDependencies['tailwindcss'] = '>=3.4 <5';
    app.overwrite('package.json', JSON.stringify(pkg));
    const tree = await ngAdd({ components: false });
    expect(tree.readText(styles)).toContain("@import 'tailwindcss';");
    expect(packageJson(tree).devDependencies['tailwindcss']).toBe('>=3.4 <5');
  });

  it('keeps the line endings of a CRLF stylesheet', async () => {
    app.overwrite(styles, 'body {\r\n  margin: 0;\r\n}\r\n');
    const tree = await ngAdd();
    expect(tree.readText(styles)).toBe(
      "@import 'tailwindcss';\r\n@import './app/chat/styles/nxa-theme.css';\r\nbody {\r\n  margin: 0;\r\n}\r\n",
    );
  });

  it('skips Tailwind CSS with --skip-tailwind', async () => {
    const tree = await ngAdd({ skipTailwind: true, components: false });
    expect(packageJson(tree).devDependencies['tailwindcss']).toBeUndefined();
    expect(tree.exists('.postcssrc.json')).toBe(false);
  });

  it('copies the thread components by default', async () => {
    const tree = await ngAdd();
    expect(tree.exists(`${root}/src/app/chat/thread/thread.ts`)).toBe(true);
    expect(tree.readText(styles)).toBe(
      "@import 'tailwindcss';\n@import './app/chat/styles/nxa-theme.css';\n" +
        '/* You can add global styles to this file, and also import other style files */\n',
    );
    expect(packageJson(tree).dependencies).toMatchObject({
      'markdown-it': expect.any(String),
      '@angular/cdk': expect.any(String),
    });
  });

  it('copies them to --path', async () => {
    const tree = await ngAdd({ path: 'app/assistant' });
    expect(tree.exists(`${root}/src/app/assistant/thread/thread.ts`)).toBe(true);
    expect(tree.readText(styles)).toContain("@import './app/assistant/styles/nxa-theme.css';");
  });

  it('does not copy them with --components=false', async () => {
    const tree = await ngAdd({ components: false });
    expect(tree.files.some((file) => file.includes('/chat/'))).toBe(false);
    expect(packageJson(tree).dependencies['markdown-it']).toBeUndefined();
  });

  it('changes nothing when it runs again', async () => {
    const once = await ngAdd();
    const snapshot = new Map(once.files.map((file) => [file, once.read(file)!.toString('base64')]));
    const twice = await ngAdd({}, once);
    expect(twice.files.sort()).toEqual([...snapshot.keys()].sort());
    for (const file of twice.files) {
      expect(twice.read(file)!.toString('base64'), file).toBe(snapshot.get(file));
    }
  });

  it('installs the packages once, or not at all with --skip-install', async () => {
    await ngAdd();
    expect(runner.tasks.filter((task) => task.name === 'node-package')).toHaveLength(1);
    const other = createRunner();
    await other.runSchematic('ng-add', { project: 'app', skipInstall: true }, app);
    expect(other.tasks).toHaveLength(0);
  });

  it('sets up the application chosen with --project', async () => {
    const two = await createApp(runner, { name: 'admin', tree: app });
    await expect(runner.runSchematic('ng-add', {}, two)).rejects.toThrow(/--project/);
    const tree = await ngAdd({ project: 'admin' }, two);
    expect(tree.readText('projects/admin/src/app/app.config.ts')).toContain(
      'provideDataStreamRuntime',
    );
    expect(tree.readText(config)).not.toContain('provideDataStreamRuntime');
  });
});
