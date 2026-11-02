import { normalize, posix } from 'node:path';
import { SchematicsException, type Tree } from '@angular-devkit/schematics';
import { readWorkspace } from '@schematics/angular/utility';

type Workspace = Awaited<ReturnType<typeof readWorkspace>>;
type Project = NonNullable<ReturnType<Workspace['projects']['get']>>;
type Target = NonNullable<ReturnType<Project['targets']['get']>>;

export interface Application {
  readonly name: string;
  readonly root: string;
  readonly sourceRoot: string;
  readonly build: Target | undefined;
}

/** The application named `name`, or the only one of the workspace when `name` is not given. */
export async function getApplication(tree: Tree, name: string | undefined): Promise<Application> {
  const workspace = await readWorkspace(tree);
  const applications = [...workspace.projects].filter(
    ([, project]) => project.extensions['projectType'] === 'application',
  );
  const entry = name
    ? applications.find(([projectName]) => projectName === name)
    : applications.length === 1
      ? applications[0]
      : undefined;
  if (!entry) {
    throw new SchematicsException(
      name
        ? `"${name}" is not an application of this workspace.`
        : applications.length === 0
          ? 'This workspace has no application.'
          : 'This workspace has more than one application: choose one with --project.',
    );
  }
  const [projectName, project] = entry;
  return {
    name: projectName,
    root: project.root,
    sourceRoot: project.sourceRoot ?? posix.join(project.root, 'src'),
    build: project.targets.get('build'),
  };
}

/** Joins workspace paths as POSIX paths, without a leading `./`. */
export function joinPath(...parts: string[]): string {
  return posix.normalize(posix.join(...parts.map((part) => normalize(part).replace(/\\/g, '/'))));
}

/** The style entries of the build target, as paths. */
export function stylesOf(build: Target | undefined): string[] {
  const styles = build?.options?.['styles'];
  if (!Array.isArray(styles)) return [];
  return styles
    .map((entry) =>
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && 'input' in entry && entry.inject !== false
          ? String(entry.input)
          : undefined,
    )
    .filter((path): path is string => !!path);
}

/** The first plain CSS file among the global styles of the application, if there is one. */
export function findGlobalCss(tree: Tree, app: Application): string | undefined {
  return stylesOf(app.build).find((path) => path.endsWith('.css') && tree.exists(path));
}
