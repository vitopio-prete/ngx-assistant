import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GeneratorManifest {
  /** The files to copy, relative to the components folder. */
  readonly files: readonly string[];
  /** The `.ts` files the barrel exports, in order. */
  readonly exports: readonly string[];
  /** The packages the files import, with their ranges. */
  readonly dependencies: Readonly<Record<string, string>>;
}

export interface Manifest {
  readonly versions: Readonly<Record<string, string>>;
  readonly generators: Readonly<Record<string, GeneratorManifest>>;
}

/** The folder written by the build: `manifest.json` and the copies of the components. */
const bundle = join(__dirname, '..', 'ui');

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as Manifest;
}

/** The content of a component file, as it is in the sources of the components. */
export function readComponentFile(file: string): Buffer {
  return readFileSync(join(bundle, 'files', `${file}.template`));
}
