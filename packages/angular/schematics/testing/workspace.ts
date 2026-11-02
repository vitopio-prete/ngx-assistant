import { join } from 'node:path';
import type { UnitTestTree } from '@angular-devkit/schematics/testing';
import { SchematicTestRunner } from '@angular-devkit/schematics/testing';

export const distDir = join(__dirname, '../../../../dist/angular/schematics');
export const uiLibDir = join(__dirname, '../../../ui/src/lib');

export function createRunner(): SchematicTestRunner {
  return new SchematicTestRunner('@ngx-assistant/angular', join(distDir, 'collection.json'));
}

export interface AppOptions {
  readonly name?: string;
  readonly style?: 'css' | 'scss';
  readonly skipTests?: boolean;
  readonly tree?: UnitTestTree;
}

/** A workspace with a standalone application, as ng new creates it. */
export async function createApp(
  runner: SchematicTestRunner,
  { name = 'app', style = 'css', skipTests = true, tree }: AppOptions = {},
): Promise<UnitTestTree> {
  const workspace =
    tree ??
    (await runner.runExternalSchematic('@schematics/angular', 'workspace', {
      name: 'workspace',
      newProjectRoot: 'projects',
      version: '22.2.0',
    }));
  return runner.runExternalSchematic(
    '@schematics/angular',
    'application',
    { name, style, standalone: true, skipTests },
    workspace,
  );
}
