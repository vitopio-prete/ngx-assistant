import type { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { chain } from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  ExistingBehavior,
  InstallBehavior,
} from '@schematics/angular/utility';
import { readComponentFile, readManifest } from '../utils/manifest';
import { addImportAfterTailwind, hasTailwindImport, relativeImport } from '../utils/styles';
import { findGlobalCss, getApplication, joinPath } from '../utils/workspace';
import type { ComponentsSchema } from './schema';

const barrelHeader = `/*
 * The styled ngx-assistant components. They are part of your app: change them as you like.
 */
`;

/** Adds `export * from './x';` for each file the barrel does not export yet. */
function updateBarrel(current: string | undefined, exports: readonly string[]): string {
  const eol = current?.includes('\r\n') ? '\r\n' : '\n';
  let text = current ?? barrelHeader;
  const missing = exports
    .map((file) => `./${file.replace(/\.ts$/, '')}`)
    .filter((specifier) => !text.includes(`'${specifier}'`) && !text.includes(`"${specifier}"`));
  if (missing.length === 0) return text;
  if (current === undefined) text += eol;
  else if (!text.endsWith('\n')) text += eol;
  return text + missing.map((specifier) => `export * from '${specifier}';${eol}`).join('');
}

/**
 * Copies the files of the generator `name` into `<sourceRoot>/<path>`, adds the packages they
 * import and imports the theme in the global stylesheet. A file that exists and differs is kept,
 * since it holds the user's changes, unless `overwrite` is set.
 */
export function copyComponents(name: string, options: ComponentsSchema): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const app = await getApplication(tree, options.project);
    const generator = readManifest().generators[name];
    if (!generator) throw new Error(`Unknown component: ${name}`);
    const folder = joinPath(app.sourceRoot, options.path);

    const created: string[] = [];
    const kept: string[] = [];
    for (const file of generator.files) {
      const target = joinPath(folder, file);
      const content = readComponentFile(file);
      const existing = tree.read(target);
      if (!existing) {
        tree.create(target, content);
        created.push(target);
      } else if (!existing.equals(content)) {
        if (options.overwrite) {
          tree.overwrite(target, content);
          created.push(target);
        } else {
          kept.push(target);
        }
      }
    }

    const barrel = joinPath(folder, 'index.ts');
    const current = tree.read(barrel)?.toString('utf8');
    const next = updateBarrel(current, generator.exports);
    if (current === undefined) tree.create(barrel, next);
    else if (next !== current) tree.overwrite(barrel, next);

    importTheme(tree, context, app, joinPath(folder, 'styles/nxa-theme.css'));

    if (kept.length > 0) {
      context.logger.warn(
        `These files differ from the ones of this version and were kept as they are ` +
          `(run again with --overwrite to replace them):\n${kept.map((f) => `  ${f}`).join('\n')}`,
      );
    }
    context.logger.info(
      created.length > 0
        ? `Copied the ${name} components into ${folder}. Import them from its index.ts.`
        : `The ${name} components in ${folder} are up to date.`,
    );

    const install = options.skipInstall ? InstallBehavior.None : InstallBehavior.Auto;
    return chain(
      Object.entries(generator.dependencies).map(([pkg, range]) =>
        addDependency(pkg, range, {
          type: DependencyType.Default,
          existing: ExistingBehavior.Skip,
          install,
        }),
      ),
    );
  };
}

function importTheme(
  tree: Tree,
  context: SchematicContext,
  app: Awaited<ReturnType<typeof getApplication>>,
  theme: string,
): void {
  const stylesheet = findGlobalCss(tree, app);
  if (!stylesheet) {
    context.logger.warn(
      `No global CSS stylesheet found: import ${theme} after Tailwind CSS in your global styles.`,
    );
    return;
  }
  const css = tree.readText(stylesheet);
  const next = addImportAfterTailwind(css, relativeImport(stylesheet, theme));
  if (next !== css) tree.overwrite(stylesheet, next);
  if (!hasTailwindImport(css)) {
    context.logger.warn(
      `${stylesheet} does not import Tailwind CSS: the components need Tailwind CSS v4 ` +
        `(run ng add @ngx-assistant/angular to set it up).`,
    );
  }
}

export const thread = (options: ComponentsSchema): Rule => copyComponents('thread', options);
export const threadList = (options: ComponentsSchema): Rule =>
  copyComponents('thread-list', options);
export const assistantModal = (options: ComponentsSchema): Rule =>
  copyComponents('assistant-modal', options);
export const modelSelector = (options: ComponentsSchema): Rule =>
  copyComponents('model-selector', options);
export const approvalCard = (options: ComponentsSchema): Rule =>
  copyComponents('approval-card', options);
