import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A real git, isolated from the caller's location variables and hooks. The hub's
// PATH wrapper never affects these fixture commands.
export const realGit = '/usr/bin/git';
export function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync(realGit, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, encoding: 'utf8' });
}

export interface ProductIndex {
  entries: { repo: string; name: string; path: string; key: string }[];
  placed: { top: string; name: string; path: string; key: string; at: number }[];
}
export const indexAt = (root: string): ProductIndex => JSON.parse(readFileSync(join(root, 'products.json'), 'utf8')) as ProductIndex;

export const productSpec = 'environment:\n  products:\n    - {name: warm, path: target, key: [lock], build: "mkdir -p target; printf warm > target/artifact"}\n';
