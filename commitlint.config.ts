import type { UserConfig } from '@commitlint/types';
import { findAiCoAuthorTrailers } from './scripts/commitlint/no-ai-co-author';

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-co-author': (parsed) => {
          const found = findAiCoAuthorTrailers(parsed.raw ?? '');
          return [
            found.length === 0,
            `commit message must not credit an AI agent as Co-authored-by (found: ${found.join(', ')})`,
          ];
        },
      },
    },
  ],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'engine',
        'angular',
        'composer',
        'thread',
        'message',
        'action-bar',
        'branch-picker',
        'attachments',
        'suggestions',
        'thread-list',
        'adapters',
        'ui',
        'schematics',
        'demo',
        'docs',
        'deps',
        'deps-dev',
        'release',
        'ci',
      ],
    ],
    'subject-case': [1, 'always', ['sentence-case', 'lower-case']],
    'body-max-line-length': [0],
    'no-ai-co-author': [2, 'always'],
  },
  ignores: [(commit: string) => commit.startsWith('Merge')],
};

export default config;
