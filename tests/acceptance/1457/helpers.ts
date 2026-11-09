// Test-side tools for #1457 (README). Everything reads the tree, the lints, the built binary or the real app; nothing here
// stands in for a build. Numbers the preflight supplies come from the environment, and a missing one is INCONCLUSIVE.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { REPO } from '../1408/helpers.ts';

export { REPO };
export const TWINS = join(REPO, 'tests/acceptance/1457/twins');
export const SOURCE = 'crates/deep-app/src';
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const twin = (name: string): string => readFileSync(join(TWINS, name), 'utf8').trimEnd();

/** The ways a person or script runs the modes #1457 deletes, and the one module it deletes. */
export const DELETED = /--cursor-demo|--probe-synthetic|--probe-held|--post-forged|mod trusted\b/;
/** Where a mode could still be named: every test, lane, script, crate, package and benchmark, not the docs' history. */
const SCOPE = ['crates', 'scripts', 'packages', 'benchmarks', 'tests', ':!tests/acceptance/1457', ':!*.md', ':!*.txt', ':!*.json'];

/** Lines naming a deleted mode under `root` (a git checkout, or any folder, searched with --no-index). */
export function namesDeleted(root: string, tracked: boolean): string[] {
  const args = ['grep', '-n', '-E', '-e', DELETED.source, ...(tracked ? [] : ['--no-index']), '--', ...SCOPE];
  const ran = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ran.status === 1) return [];
  if (ran.status !== 0) throw Error(`BLOCKED: git grep failed (${ran.status}): ${ran.stderr.slice(0, 400)}`);
  return ran.stdout.split('\n').filter(Boolean);
}

/** A copy of the app's source under a folder that stands for a checkout, plus lanes.mjs, for the lints' `--root`. */
export function copyApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'da1457-'));
  mkdirSync(join(root, 'crates/deep-app'), { recursive: true });
  cpSync(join(REPO, SOURCE), join(root, SOURCE), { recursive: true });
  return root;
}
/** Puts `text` before the closing brace's first statement of `fn <fn>`'s body in `file`; the line it landed on, from 1. */
export function plantIn(root: string, file: string, fn: RegExp, text: string): number {
  const path = join(root, SOURCE, file);
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex((l) => fn.test(l));
  if (start < 0) throw Error(`BLOCKED: ${file} has no line matching ${fn} to plant after`);
  const open = start + lines.slice(start).findIndex((l) => l.trimEnd().endsWith('{'));
  lines.splice(open + 1, 0, ...text.split('\n'));
  writeFileSync(path, lines.join('\n'));
  return open + 2;
}
export interface Ran { code: number | null; out: string }
export function lint(script: string, root: string): Ran {
  const ran = spawnSync(process.execPath, [script, '--root', root], { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  return { code: ran.status, out: `${ran.stdout ?? ''}${ran.stderr ?? ''}` };
}
/** The scripts of the preflight's lint lane that scan the app's source, take `--root` and whose text matches `only`. */
export async function rootLints(only: RegExp = /./): Promise<string[]> {
  const { checks } = await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href) as { checks: { name: string; commands: string[][] }[] };
  const scripts = (checks.find((c) => c.name === 'lint')?.commands ?? []).flatMap((argv) => argv.filter((a) => /^scripts\/.*\.mjs$/.test(a)));
  return scripts.filter((s) => { const t = readFileSync(join(REPO, s), 'utf8'); return t.includes("'--root'") && t.includes(SOURCE) && only.test(t); }).map((s) => join(REPO, s));
}

/** A number the local preflight supplies (a path or a value, in env `name`); INCONCLUSIVE when it didn't. */
export function supplied(name: string): string {
  const v = process.env[name];
  if (!v || (name.startsWith('BASE_BIN') && !existsSync(v))) return inconclusive(`${name} is not supplied by the local preflight (or names no file), so there is no merge-base number to compare with`);
  return v;
}
export const size = (path: string): number => statSync(path).size;
/** AC5: smaller binary, first frame not slower; the message names both numbers. */
export function judgeBudget(o: { bytes: number; baseBytes: number; ms: number; baseMs: number }): string[] {
  const out: string[] = [];
  if (!(o.bytes < o.baseBytes)) out.push(`release binary ${o.bytes} B is not smaller than the merge base's ${o.baseBytes} B`);
  if (o.ms > o.baseMs) out.push(`first frame ${o.ms} ms is slower than the merge base's ${o.baseMs} ms`);
  return out;
}
/** Lints that look at environment reads (AC2), and the render lint (AC3, pinned by #1454). */
export const envLints = (): Promise<string[]> => rootLints(/env::var|std::env|\benv\b/);
export const renderLints = (): Promise<string[]> => rootLints(/Render\s+for|fn\s+render/);
