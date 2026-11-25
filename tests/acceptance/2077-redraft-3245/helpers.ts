// #2077's helpers, reused as they are, with a hub that loads this folder's boundary.mjs (REDRAFT.md).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { CLI, NODE, REPO, childEnv, own, type Hub, type Line } from '../303/helpers.ts';
import type { Fixture } from '../2077/helpers.ts';

export * from '../2077/helpers.ts';
export async function start(w: Fixture): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    NODE_OPTIONS: `--import=${fileURLToPath(new URL('./boundary.mjs', import.meta.url))}`,
    PATH: `${join(w.tmp, 'bin')}:${dirname(NODE)}:/usr/bin:/bin`,
  });
  expect(env.DEEP_HUB_TEST_EVAL, 'the installed-hub removal path: no supplied eval result').toBeUndefined();
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let stderr = '', stdout = '';
  child.stderr!.setEncoding('utf8').on('data', (s: string) => { stderr += s; });
  const exit = new Promise<void>((done) => child.once('exit', () => done()));
  const ready = await Promise.race([
    new Promise<Line>((done) => child.stdout!.setEncoding('utf8').on('data', (s: string) => {
      stdout += s;
      if (stdout.includes('\n')) { try { done(JSON.parse(stdout.split('\n')[0]!)); } catch { done({}); } }
    })), exit.then(() => ({} as Line)),
    new Promise<Line>((done) => setTimeout(() => done({}), 30000)), // deadline: a hub that never prints its ready line is BLOCKED
  ]);
  if (!ready.ready) throw Error(`BLOCKED: installed hub could not start: ${stderr.slice(-2000)}`);
  return { pid: child.pid!, child, exit, socket: String(ready.socket), root: w.root, home: w.home, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => stderr };
}
