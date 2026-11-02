import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, createRunner, distDir, uiLibDir } from '../testing/workspace';

const chat = 'projects/app/src/app/chat';
const styles = 'projects/app/src/styles.css';

interface Manifest {
  generators: Record<string, { files: string[]; exports: string[] }>;
}
const manifest = JSON.parse(readFileSync(join(distDir, 'ui/manifest.json'), 'utf8')) as Manifest;

const sourceFiles = readdirSync(uiLibDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(uiLibDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
  .filter((file) => !file.endsWith('.spec.ts') && file !== 'index.ts');

const generatorNames = Object.keys(manifest.generators);

describe('component generators', () => {
  let runner: SchematicTestRunner;
  let app: UnitTestTree;

  beforeEach(async () => {
    runner = createRunner();
    app = await createApp(runner);
    app.overwrite(styles, "@import 'tailwindcss';\n");
  });

  const generate = (name: string, options: Record<string, unknown> = {}, tree = app) =>
    runner.runSchematic(name, { project: 'app', ...options }, tree);

  it('copy every file of the styled components, in some generator', () => {
    const copied = new Set(generatorNames.flatMap((name) => manifest.generators[name]!.files));
    expect(sourceFiles.filter((file) => !copied.has(file))).toEqual([]);
    expect(generatorNames).toEqual([
      'thread',
      'thread-list',
      'assistant-modal',
      'model-selector',
      'approval-card',
    ]);
  });

  it.each(generatorNames)('%s copies its files as they are, without tests', async (name) => {
    const tree = await generate(name);
    const files = tree.files.filter((file) => file.startsWith(`/${chat}/`));
    const expected = manifest.generators[name]!.files.map((file) => `/${chat}/${file}`);
    expect(files.sort()).toEqual([...expected, `/${chat}/index.ts`].sort());
    for (const file of manifest.generators[name]!.files) {
      expect(tree.readText(`${chat}/${file}`), file).toBe(
        readFileSync(join(uiLibDir, file), 'utf8'),
      );
      expect(tree.readText(`${chat}/${file}`)).not.toMatch(/testing\//);
    }
  });

  it.each(generatorNames)('%s exports its components from index.ts', async (name) => {
    const tree = await generate(name);
    const barrel = tree.readText(`${chat}/index.ts`);
    for (const file of manifest.generators[name]!.exports) {
      expect(barrel).toContain(`export * from './${file.replace(/\.ts$/, '')}';`);
    }
    // The barrel only exports what was copied.
    for (const specifier of barrel.matchAll(/from '\.\/([^']+)'/g)) {
      expect(tree.exists(`${chat}/${specifier[1]}.ts`), specifier[1]).toBe(true);
    }
  });

  it('thread copies the menu and the whole thread folder', async () => {
    const tree = await generate('thread');
    expect(tree.exists(`${chat}/menu/menu.ts`)).toBe(true);
    for (const file of sourceFiles.filter((f) => f.startsWith('thread/'))) {
      expect(tree.exists(`${chat}/${file}`), file).toBe(true);
    }
  });

  it('assistant-modal brings the thread and the thread list', async () => {
    const tree = await generate('assistant-modal');
    expect(tree.exists(`${chat}/thread/thread.ts`)).toBe(true);
    expect(tree.exists(`${chat}/thread-list/thread-list.ts`)).toBe(true);
  });

  it('adds the packages the components import', async () => {
    const tree = await generate('thread');
    const { dependencies } = JSON.parse(tree.readText('package.json'));
    expect(dependencies['markdown-it']).toMatch(/^\^15\./);
    expect(dependencies['@angular/cdk']).toMatch(/^\^22\./);
    const card = await generate('approval-card', {}, await createApp(createRunner()));
    expect(JSON.parse(card.readText('package.json')).dependencies['markdown-it']).toBeUndefined();
  });

  it('imports the theme right after Tailwind CSS, once', async () => {
    app.overwrite(styles, "@import 'tailwindcss' source('../');\nbody { margin: 0; }\n");
    const once = await generate('thread');
    const twice = await generate('thread-list', {}, once);
    expect(twice.readText(styles)).toBe(
      "@import 'tailwindcss' source('../');\n@import './app/chat/styles/nxa-theme.css';\n" +
        'body { margin: 0; }\n',
    );
  });

  it('says so when the stylesheet does not import Tailwind CSS', async () => {
    app.overwrite(styles, 'body { margin: 0; }\n');
    const logs: string[] = [];
    runner.logger.subscribe((entry) => logs.push(entry.message));
    const tree = await generate('thread');
    expect(tree.readText(styles)).toBe(
      "@import './app/chat/styles/nxa-theme.css';\nbody { margin: 0; }\n",
    );
    expect(logs.join('\n')).toContain('does not import Tailwind CSS');
  });

  it('extends the barrel of an earlier generator', async () => {
    const thread = await generate('thread');
    const barrel = thread.readText(`${chat}/index.ts`);
    const both = await generate('thread-list', {}, thread);
    const next = both.readText(`${chat}/index.ts`);
    expect(next.startsWith(barrel)).toBe(true);
    expect(next).toContain("export * from './thread-list/thread-list';");
    expect(next.match(/'\.\/icons'/g)).toHaveLength(1);
  });

  it('keeps a file the user changed, and says so', async () => {
    const tree = await generate('thread');
    tree.overwrite(`${chat}/thread/composer.ts`, '// mine\n');
    tree.overwrite(`${chat}/index.ts`, "export * from './thread/thread';\n");
    const logs: string[] = [];
    runner.logger.subscribe((entry) => logs.push(entry.message));
    const again = await generate('thread', {}, tree);
    expect(again.readText(`${chat}/thread/composer.ts`)).toBe('// mine\n');
    expect(logs.join('\n')).toContain(`${chat}/thread/composer.ts`);
    // Exports the user removed come back, the rest is left alone.
    expect(
      again.readText(`${chat}/index.ts`).startsWith("export * from './thread/thread';\n"),
    ).toBe(true);
  });

  it('replaces it with --overwrite', async () => {
    const tree = await generate('thread');
    tree.overwrite(`${chat}/thread/composer.ts`, '// mine\n');
    const again = await generate('thread', { overwrite: true }, tree);
    expect(again.readText(`${chat}/thread/composer.ts`)).toBe(
      readFileSync(join(uiLibDir, 'thread/composer.ts'), 'utf8'),
    );
  });

  it('copies to --path', async () => {
    const tree = await generate('thread', { path: 'chat' });
    expect(tree.exists('projects/app/src/chat/thread/thread.ts')).toBe(true);
    expect(tree.readText(styles)).toContain("@import './chat/styles/nxa-theme.css';");
  });

  it('recognizes a theme import written another way', async () => {
    app.overwrite(
      styles,
      "@import 'tailwindcss';\n@import url('app/chat/styles/nxa-theme.css');\n",
    );
    const tree = await generate('thread');
    expect(tree.readText(styles)).toBe(
      "@import 'tailwindcss';\n@import url('app/chat/styles/nxa-theme.css');\n",
    );
  });

  it('accepts a --path with a trailing slash', async () => {
    const tree = await generate('thread', { path: 'app/chat/' });
    expect(tree.exists(`${chat}/thread/thread.ts`)).toBe(true);
    expect(tree.readText(styles)).toContain("@import './app/chat/styles/nxa-theme.css';");
  });

  it('keeps the line endings of a CRLF barrel', async () => {
    app.create(`${chat}/index.ts`, "export * from './icons';\r\n");
    const tree = await generate('model-selector');
    expect(tree.readText(`${chat}/index.ts`)).toBe(
      "export * from './icons';\r\nexport * from './model-selector/model-selector';\r\n",
    );
  });

  it('warns when there is no global CSS stylesheet', async () => {
    const scss = await createApp(createRunner(), { style: 'scss' });
    const logs: string[] = [];
    runner.logger.subscribe((entry) => logs.push(entry.message));
    const tree = await generate('thread', {}, scss);
    expect(tree.exists(`${chat}/thread/thread.ts`)).toBe(true);
    expect(logs.join('\n')).toContain('No global CSS stylesheet');
  });
});
