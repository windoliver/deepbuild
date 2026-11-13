// `deep land` and `deep work` (#1331, #1332): landing in turn and the work run, over the running hub, from your own
// terminal. `deep land judge` judges each open pull request that links an issue on its merge with the default branch's
// head and lands nothing; `deep land` runs one round of landings; `deep work --issues <n,...> --once` makes one pass of
// a run over a fixed set. `deep work "<scope>"` raises a run's one approval, `deep work show` prints each issue's state
// word and what it waits for, and `deep work pause` stops new starts while running turns finish.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

const LAND = 'Usage: deep land [judge] --repo <checkout> [--json]   judge each open PR on its merge with main, or land the PASSes in turn';
const WORK = `Usage: deep work "<scope>" [--repo <checkout>] [--json]   one approval for a run over the issues your words name
       deep work show | pause [--repo <checkout>] [--json]
       deep work --repo <checkout> --issues <n,...> --once [--json]   one pass of a run over a fixed set of issues`;

const flag = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
async function send(method: string, params: Record<string, unknown>, print: (r: Record<string, unknown>) => string = (r) => JSON.stringify(r)): Promise<number> {
  try {
    // The CLI names its own process, so a call from inside an agent's process tree is refused as that session's.
    const reply = await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), method, params, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    process.stdout.write(`${print(reply.result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
}

export async function landCommand(args: readonly string[]): Promise<number> {
  const judge = args[0] === 'judge';
  const rest = judge ? args.slice(1) : args;
  const repo = flag(rest, '--repo');
  if (!repo || rest.some((a, i) => a.startsWith('-') && !['--repo', '--json'].includes(a) && rest[i - 1] !== '--repo')) {
    process.stderr.write(`${LAND}\n`);
    return 2;
  }
  return send(judge ? 'land.judge' : 'land.round', { repo: resolve(repo) });
}

export async function workCommand(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  const words = args[0] !== undefined && !args[0].startsWith('-') ? args[0] : undefined;
  if (words !== undefined) {
    const rest = args.slice(1);
    if (rest.some((a, i) => a !== '--json' && a !== '--repo' && rest[i - 1] !== '--repo')) {
      process.stderr.write(`${WORK}\n`);
      return 2;
    }
    const repo = resolve(flag(rest, '--repo') ?? '.');
    if (words === 'show') return send('work.show', { repo }, json ? undefined : shown);
    if (words === 'pause') return send('work.pause', { repo }, json ? undefined : (r) => `Paused: ${(r.paused as string[]).join(', ') || 'no run was running'}`);
    return send('work.approve', { repo, scope: words }, json ? undefined
      : (r) => `${String(r.ask)} asks you to approve the run; answer it with deep inbox answer ${String(r.ask)} allow`);
  }
  const repo = flag(args, '--repo');
  const issues = (flag(args, '--issues') ?? '').split(',').filter(Boolean).map(Number);
  if (!repo || !args.includes('--once') || !issues.length || issues.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    process.stderr.write(`${WORK}\n`);
    return 2;
  }
  return send('work.once', { repo: resolve(repo), issues });
}

/** `deep work show` as lines: each run, then each issue's state word and what it waits for. */
function shown(r: Record<string, unknown>): string {
  const runs = r.runs as { ask: string; paused: boolean; issues: { issue: number; word: string; waits_on: string | null }[] }[];
  if (!runs.length) return 'No work run yet: start one with deep work "<scope>".';
  return runs.map((run) => [`${run.ask}${run.paused ? ' (paused)' : ''}`, ...run.issues.map((i) => `  #${i.issue}  ${i.word}${i.waits_on ? `  waits on ${i.waits_on}` : ''}`)].join('\n')).join('\n');
}
