// #1879 AC3: the floor's safe-mode behavior is unchanged. The suites that hold it run as they are, each with the
// command its own README gives, unedited and uncopied: #316's (the deep-hook matcher's default fail_closed guard@1
// entries) and #317's (the floor entries, among them the `.deepbuild/` guard, denied with the hub stopped and with the
// hub up in --safe). Each runs in a child vitest with this process's DEEP_*, CLAUDE* and VITEST* settings left out.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { NODE, REPO } from './helpers.ts';

/** The floor's suites, by folder: the issue's "#316's guard entries and the `.deepbuild/` guard". */
export const FLOOR_SUITES = ['tests/acceptance/316', 'tests/acceptance/317'];

function runSuite(root: string): Promise<{ code: number | null; tail: string }> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX|VITEST|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.NO_COLOR = '1';
  return new Promise((resolve) => {
    const child = spawn(NODE, ['node_modules/vitest/vitest.mjs', 'run', '--root', root, '--no-file-parallelism'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(-6000)));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out = (out + d).slice(-6000)));
    child.on('error', (e) => resolve({ code: null, tail: `${out}${e.message}` }));
    child.on('close', (code) => resolve({ code, tail: out }));
  });
}

describe("#1879.db136732 The floor's safe-mode behavior (#316's guard entries and the `.deepbuild/` guard) is unchanged: its suites pass as they are", () => {
  it.each(FLOOR_SUITES)('%s passes as it is', async (root) => {
    const r = await runSuite(root);
    expect(r.code, `${root} didn't pass: exit ${r.code}\n${r.tail.slice(-3000)}`).toBe(0);
  }, 3_600_000);
});
