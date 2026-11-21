// What #2227's three files share: the checkout under test, a command run to its end without blocking the test, git in
// the checkout, and INCONCLUSIVE.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these tests run in: its root, three folders up from this one. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MINUTES = 60_000;

/**
 * A leg this checkout can't run, such as a command that never started or overran its bound, or git that can't name a
 * merge base. It fails the test, so it is never a pass, and it is a plain Error, never an assertion: a wrong program is
 * proved only by a failure at the criterion's own assertion, which this isn't.
 */
export function inconclusive(why: string): never {
  throw new Error(`INCONCLUSIVE: ${why}; this is not a pass`);
}

/**
 * This process's environment for a child, less git's repository variables, npm's own and a parent Vitest's, any of
 * which would point the child at another repository, workspace or run than the checkout's.
 */
export function childEnv(): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|npm_|VITEST)/i.test(key))), NO_COLOR: '1' };
}

export interface Ended { code: number | null; signal: NodeJS.Signals | null; out: string; ms: number }

/**
 * Runs a command in `cwd` to its end, stdout and stderr together, without holding the test's event loop. One still
 * running after `bound` ms is killed by its PID and reads INCONCLUSIVE; one that can't start reads INCONCLUSIVE too.
 */
export async function run(command: string, args: readonly string[], cwd: string, bound: number): Promise<Ended> {
  const started = performance.now();
  const what = `${command === process.execPath ? 'node' : command} ${args.join(' ')} in ${cwd}`;
  let overran = false;
  const ended = await new Promise<Ended | Error>((resolve) => {
    const child = spawn(command, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    const timer = setTimeout(() => { overran = true; child.kill('SIGKILL'); }, bound);
    child.on('error', (error) => { clearTimeout(timer); resolve(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out: Buffer.concat(chunks).toString('utf8'), ms: Math.round(performance.now() - started) });
    });
  });
  if (ended instanceof Error) inconclusive(`${what} could not start: ${ended.message}`);
  if (overran) inconclusive(`${what} was still running after ${Math.round(bound / MINUTES)} minutes`);
  return ended;
}

/** git in the checkout, with the environment above; when it fails, what depends on it is INCONCLUSIVE. */
export function git(args: readonly string[]): string {
  const r = spawnSync('git', args, { cwd: REPO, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) inconclusive(`git ${args.join(' ')} failed: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}`);
  return r.stdout;
}

/**
 * Text a failure message quotes, less every line that reads as a stack frame (`at <path>:<line>:<column>`). The proof
 * lane places a failure by the first frame in its stack, message included, so a quoted frame from the code under test
 * would place this test's own assertion elsewhere.
 */
export const quoted = (text: string): string => text.split('\n').filter((line) => !/^\s*at\s/.test(line)).join('\n');

/**
 * What a failure message quotes of a command's output: each tsc or npm error line with the indented lines that go on
 * from it, or the output's last lines when none names an error.
 */
export function errorLines(out: string, most = 60): string {
  const kept: string[] = [];
  let going = false;
  for (const line of out.split('\n')) {
    if (/\berror TS\d+|^npm (?:error|ERR!)/.test(line)) { going = true; kept.push(line); } else if (going && /^\s+\S/.test(line)) kept.push(line);
    else going = false;
  }
  return quoted((kept.length ? kept : out.trimEnd().split('\n').slice(-20)).slice(0, most).join('\n'));
}
