// Test-side tools for the issue #2495 acceptance tests: a real hub on a root of its own, a fixture git repo, and fake
// `claude` and `codex` executables on PATH (the agents under test and the judge are the boundary we don't own). The
// script, the hub, the evidence store, the eval and the learned layer are all real.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openEvidenceStore } from '@deepbuild/evidence';

const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'config-eval.mjs');
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'main.js');

export const PLAN_ID = 'config-2495';
/** An `ev:` handle as the design names one. */
export const HANDLE = /ev:([0-9a-f]{64})/;

export interface ReportJson { plan: { id: string; tasks: string[]; repeats: number }; runs: unknown[]; after: { outcome: string; reason: string }; held: boolean }
export interface Ran { status: number | null; out: string; input: { plan: ReportJson['plan'] }; kept: ReportJson; hubRoot: string }

/** The agents under test: grade 0.5 on a variant without "osprey" in its CLAUDE.md, 0.8 and a little more with it. */
const FAKE_CLAUDE = `#!/bin/sh
p=$(cat)
n=\${#p}
if grep -q osprey CLAUDE.md 2>/dev/null; then q=$((80 + (n % 4) * 2)); else q=50; fi
echo "quality=0.$q" > answer.txt
echo '{"type":"result","subtype":"success","is_error":false,"result":"Wrote answer.txt: quality=0.'$q'","usage":{"input_tokens":100,"output_tokens":20}}'
`;
/** The judge: scores each unlabeled output by the quality in it. */
const FAKE_CODEX = `#!${process.execPath}
let s = '';
process.stdin.on('data', (d) => { s += d; }).on('end', () => {
  const parts = s.split(/=== Output (.+?) ===\\n/);
  const grades = [];
  for (let i = 1; i < parts.length; i += 2) {
    const m = /quality=([0-9.]+)/.exec(parts[i + 1] ?? '');
    grades.push({ label: parts[i], score: m ? Number(m[1]) : 0 });
  }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ grades }) } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 5 } }));
});
`;

export interface World { box: string; home: string; bin: string; hubRoot: string; repo: string; commit: string; hub: ChildProcess; stop(): Promise<void> }

/** A hub of its own (its address in the home's config, as every client reads it), a repo and the fake executables. */
export async function openWorld(): Promise<World> {
  // Short: a socket path must fit in 104 bytes on macOS.
  const box = realpathSync(mkdtempSync('/tmp/d2495-'));
  const [home, bin, hubRoot, repo] = ['home', 'bin', 'hub', 'shop'].map((d) => join(box, d)) as [string, string, string, string];
  for (const d of [join(home, '.deepbuild'), bin, repo]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'config.json'), JSON.stringify({ hub: { address: `unix:${join(hubRoot, 'hub.sock')}` } }));
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
  writeFileSync(join(bin, 'codex'), FAKE_CODEX);
  for (const f of ['claude', 'codex']) chmodSync(join(bin, f), 0o755);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@shop.test', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'cart.js'), 'export const total = () => 0;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  const commit = git('rev-parse', 'HEAD');

  if (!existsSync(CLI)) throw Error(`${CLI} is not built: run npm run build --workspaces first (README)`);
  const env = { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', USER: 'dev', LANG: 'en_US.UTF-8' };
  const hub = spawn(process.execPath, [CLI, 'hub', 'run', '--root', hubRoot], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  hub.stderr!.setEncoding('utf8').on('data', (d: string) => { log += d; });
  await new Promise<void>((ready, fail) => { hub.stdout!.once('data', () => ready()); hub.once('exit', () => fail(Error(`the hub did not start: ${log}`))); });
  const stop = async () => {
    if (hub.exitCode === null && hub.signalCode === null) {
      hub.kill('SIGTERM');
      await new Promise<void>((done) => { const t = setTimeout(() => { hub.kill('SIGKILL'); done(); }, 15_000); hub.once('exit', () => { clearTimeout(t); done(); }); });
    }
    rmSync(box, { recursive: true, force: true });
  };
  return { box, home, bin, hubRoot, repo, commit, hub, stop };
}

/**
 * One eval by `node scripts/config-eval.mjs run <input>`: three past tasks, two repeats a side. The change's CLAUDE.md
 * holds "osprey" (the agents grade it higher) when `better`, and the base's does when not.
 */
export function runEvalScript(w: World, id: string, better: boolean): Ran {
  const files = (osprey: boolean) => ({ 'CLAUDE.md': `# Shop\nAnswer in the ${osprey ? 'osprey' : 'kestrel'} style.\n` });
  const ids = ['t1', 't2', 't3'];
  const input = {
    plan: {
      id, cutoff: 1_000, tasks: ids, fitted: [], repeats: 2, rule: 'paired-mean-one-sided-95',
      variants: { base: { name: 'at 1c4d1f0e2aaa', files: files(!better) }, change: { name: 'working tree', files: files(better) } },
      models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, measures: [{ name: 'grade', better: 'higher' }], budget: { ms: 600_000, plan_share: 1 },
    },
    tasks: ids.map((t, i) => ({ id: t, at: 2_000 + i, repo: w.repo, commit: w.commit, prompt: `Fix the cart total in case ${t}${'!'.repeat(i)}.` })),
  };
  const file = join(w.box, `${id}.input.json`);
  writeFileSync(file, JSON.stringify(input));
  const r = spawnSync(process.execPath, [SCRIPT, 'run', file], {
    cwd: w.repo, encoding: 'utf8', timeout: 280_000,
    env: { HOME: w.home, PATH: `${w.bin}:/usr/bin:/bin`, USER: 'dev', LANG: 'en_US.UTF-8' },
  });
  const evals = join(w.home, '.deepbuild', 'evals');
  const kept = (existsSync(evals) ? readdirSync(evals) : []).filter((f) => f.endsWith('.json') && !f.endsWith('.input.json'))
    .map((f) => JSON.parse(readFileSync(join(evals, f), 'utf8')) as ReportJson).find((k) => k.plan?.id === id);
  return { status: r.status, out: `${r.stdout}${r.stderr}`, input: input as unknown as Ran['input'], kept: kept as ReportJson, hubRoot: w.hubRoot };
}

/** The hub's evidence store as it stands now, read-only. */
export async function storeOf(hubRoot: string) {
  return openEvidenceStore({ root: join(hubRoot, 'evidence'), readOnly: true });
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
