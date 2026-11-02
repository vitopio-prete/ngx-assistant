export interface NgAddSchema {
  project?: string;
  runtime: 'data-stream' | 'local';
  api: string;
  components: boolean;
  path: string;
  skipTailwind: boolean;
  skipInstall: boolean;
}
