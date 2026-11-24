// #3088's helpers: the kit's CLI (`deep-conformance gate …`, packages/conformance/dist/bin.js) run as a child, the
// shipped corpus and this checkout's lockfile read as data, and a tree compared entry by entry (bytes, link targets).
import { spawn } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../../../packages/conformance/src/gate-play.ts';

export { REPO };
export const NODE = process.execPath;
/** The kit's command, `deep-conformance` (the package's bin), as npm run build --workspaces builds it. */
export const KIT_BIN = join(REPO, 'packages/conformance/dist/bin.js');
/** The shipped gate@1 corpus the issue names. */
export const CORPUS = join(REPO, 'packages/conformance/fixtures/gate');
/** The two cases the issue is about. */
export const CASES = ['reporting-vitest-setup', 'reporting-rewrite-on-import'];
/** The three macOS-arm64-only folders both cases listed at the base. */
export const DARWIN = ['node_modules/@rolldown/binding-darwin-arm64', 'node_modules/fsevents', 'node_modules/lightningcss-darwin-arm64'];

type Obj = { [key: string]: any };
export interface Case { id: string; dir: string; setup?: { installs?: string[] } & Obj; [key: string]: unknown }
export interface Manifest { kit: string; cases: Case[] }
export const readManifest = (corpus: string = CORPUS): Manifest => JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8')) as Manifest;

/** This checkout's package-lock.json entries, by path (`node_modules/fsevents`, …). */
export function lockPackages(): Record<string, { os?: string[]; cpu?: string[] } & Obj> {
  return (JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, Obj> }).packages;
}
/** Whether the lockfile marks the package at `path` with `os` or `cpu`. */
export function platformMarked(path: string): boolean {
  const p = lockPackages()[path];
  return Array.isArray(p?.os) || Array.isArray(p?.cpu);
}

/** Every entry under root, path → what it is: a file's bytes, a link's target, or a folder. */
export function tree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = p.slice(root.length + 1);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.set(rel, `link ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.set(rel, 'folder'); walk(p); }
      else out.set(rel, `file ${readFileSync(p).toString('base64')}`);
    }
  };
  walk(root);
  return out;
}
/** The names in a folder, [] when it doesn't exist. */
export function namesIn(dir: string): string[] {
  try { return readdirSync(dir).sort(); } catch { return []; }
}

/** A temp folder of this test's own under /tmp (short, so the kit's worlds' hub sockets fit), removed by `clean`. */
const temps: string[] = [];
export function tempDir(prefix = 'b3088-'): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)));
  temps.push(dir);
  return dir;
}
export function clean(): void { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); }

/** A copy of the shipped corpus whose manifest is `edit`'s result: the cases' folders as shipped. */
export function corpusCopy(edit: (m: Manifest) => Manifest): string {
  const dir = join(tempDir(), 'gate');
  cpSync(CORPUS, dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(edit(readManifest(CORPUS)), null, 2)}\n`);
  return dir;
}

export interface KitRun { code: number | null; signal: string | null; stdout: string; stderr: string; killed: boolean }
/**
 * `deep-conformance gate <args>`, from this checkout, with HOME and TMPDIR a fresh /tmp folder (so the kit's worlds land
 * there and go with it). Waits for the child to close; it is killed (by its PID, which this started) only at the deadline.
 */
export function kit(args: string[], timeoutMs: number): Promise<KitRun> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (key !== 'NODE_OPTIONS' && !key.startsWith('VITEST')) env[key] = value;
  Object.assign(env, { HOME: home, TMPDIR: tmp });
  return new Promise((done) => {
    const child = spawn(NODE, [KIT_BIN, 'gate', ...args], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = `${stderr}${d}`.slice(-20_000); });
    // deadline: a hung kit run fails the test instead of hanging the lane
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr, killed }); });
  });
}
export const shown = (r: KitRun): string => `exit ${r.code}${r.killed ? ' (killed at the deadline)' : ''}; stdout:\n${r.stdout.trim()}\nstderr (tail):\n${r.stderr.trim().slice(-1500)}`;

/** The kit's play lines, `<judgement> <case> <claim|twin>: …`, as `<case> <play>` → judgement. */
export function judgements(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = /^(PASS|FAIL|BLOCKED|INCONCLUSIVE) (\S+) (claim|twin): /.exec(line.trim());
    if (m) out[`${m[2]} ${m[3]}`] = m[1]!;
  }
  return out;
}
