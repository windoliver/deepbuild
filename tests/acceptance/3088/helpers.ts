// #3088's shared reading: the shipped corpus and lockfile, the kit's CLI as a process, and a tree compared byte for
// byte. The world builder is makeWorld from packages/conformance/src/gate-play.ts, the module the issue names (the
// package's entry doesn't export it), so the lanes find the package this suite runs through that import.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO } from '../../../packages/conformance/src/gate-play.ts';

export { REPO };
export const CORPUS = join(REPO, 'packages/conformance/fixtures/gate');
/** The kit's CLI, `deep-conformance` (packages/conformance's bin), as `npm run build --workspaces` builds it. */
export const KIT_BIN = join(REPO, 'packages/conformance/dist/bin.js');
/** The two cases the issue names. */
export const CASES = ['reporting-vitest-setup', 'reporting-rewrite-on-import'] as const;
/** The three macOS-arm64-only folders the issue names. */
export const DARWIN = ['node_modules/@rolldown/binding-darwin-arm64', 'node_modules/fsevents', 'node_modules/lightningcss-darwin-arm64'] as const;

export type Outcome = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE' | 'pending';
export interface Play { commits: string[]; expected: Outcome | Outcome[]; names?: string[] }
export interface Case { id: string; dir: string; covers: string[]; setup?: { installs?: string[] } & Record<string, unknown>; claim: Play; twin: Play }
export interface Manifest { kit: string; cases: Case[] }

export const readManifest = (corpus = CORPUS): Manifest => JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8')) as Manifest;
export function caseOf(m: Manifest, id: string): Case {
  const c = m.cases.find((x) => x.id === id);
  if (!c) throw Error(`the shipped corpus has no case ${id}; it has ${m.cases.map((x) => x.id).join(', ')}`);
  return c;
}

/** The lockfile's packages that it marks with `os` or `cpu`, by their path (`node_modules/...`). */
export function platformMarked(): Map<string, { os?: string[]; cpu?: string[] }> {
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, { os?: string[]; cpu?: string[] }> };
  return new Map(Object.entries(lock.packages).filter(([path, p]) => path && (p.os !== undefined || p.cpu !== undefined)));
}

/** A fresh folder under /tmp (short, so a hub's socket path fits macOS's limit), its real path. */
export const tempDir = (prefix: string): string => realpathSync(mkdtempSync(join('/tmp', prefix)));
export const remove = (dir: string): void => { rmSync(dir, { recursive: true, force: true }); };

export interface Ran { code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean; ms: number }
/**
 * `deep-conformance gate <args>`, as a process, with TMPDIR a folder of its own (the kit's worlds go there) that's
 * removed after. On a timeout only this process is stopped, by its PID.
 */
export async function kit(args: string[], timeoutMs: number): Promise<Ran> {
  if (!existsSync(KIT_BIN)) throw Error(`the kit's entry ${relative(REPO, KIT_BIN)} must exist (npm run build --workspaces builds it)`);
  const tmp = tempDir('b3088-k-');
  const started = Date.now();
  try {
    return await new Promise<Ran>((done) => {
      const child = spawn(process.execPath, [KIT_BIN, 'gate', ...args], { cwd: REPO, env: { ...process.env, TMPDIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
      child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = `${stderr}${d}`.slice(-20_000); });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
      child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr, timedOut, ms: Date.now() - started }); });
    });
  } finally {
    remove(tmp);
  }
}
export const shown = (r: Ran): string => `exit ${r.code}${r.timedOut ? ' (stopped at the timeout)' : ''} after ${Math.round(r.ms / 1000)} s; stdout ${JSON.stringify(r.stdout.slice(-3000))}; stderr ${JSON.stringify(r.stderr.slice(-1000))}`;

/** Every entry under root, path → what it is: a file's SHA-256, a link's target, or a folder; a missing root is empty. */
export function tree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const rel = relative(root, p);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.set(rel, `link ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.set(rel, 'folder'); walk(p); }
      else out.set(rel, `file ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out;
}

/** What `f` threw, as text with any child's stderr, or '' when it returned; and what it returned. */
export function caught<T>(f: () => T): { value?: T; error: string } {
  try { return { value: f(), error: '' }; } catch (e) { const x = e as { message?: string; stderr?: Buffer | string }; return { error: `${x.message ?? String(e)} ${x.stderr ? String(x.stderr) : ''}`.trim() }; }
}
