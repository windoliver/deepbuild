// `deep land` and `deep work --once` (#1331): landing in turn, over the running hub, from your own terminal. `deep land
// judge` judges each open pull request that links an issue on its merge with the default branch's head and lands
// nothing; `deep land` runs one round of landings; `deep work --issues <n,...> --once` makes one pass of a run over a
// fixed set. Each prints one line of JSON.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

const LAND = 'Usage: deep land [judge] --repo <checkout> [--json]   judge each open PR on its merge with main, or land the PASSes in turn';
const WORK = 'Usage: deep work --repo <checkout> --issues <n,...> --once [--json]   one pass of a run over a fixed set of issues';

const flag = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
async function send(method: string, params: Record<string, unknown>): Promise<number> {
  try {
    const reply = await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), method, params);
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(reply.result)}\n`);
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
  const repo = flag(args, '--repo');
  const issues = (flag(args, '--issues') ?? '').split(',').filter(Boolean).map(Number);
  if (!repo || !args.includes('--once') || !issues.length || issues.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
    process.stderr.write(`${WORK}\n`);
    return 2;
  }
  return send('work.once', { repo: resolve(repo), issues });
}
