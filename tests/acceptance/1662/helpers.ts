// Test-side tools for #1662 (README): cargo's own feature tree of the workspace, release builds of the deep-app binary
// two ways (alone, and with the workspace's feature resolution) copied aside and byte-searched for the plant's symbols,
// and the merge base's manifests as the wrong program of the tree test. Nothing here stands in for cargo or a binary:
// every reading comes from cargo's output or the bytes it linked.
//
// Safety: builds go to this checkout's own target/ (warm; README, How to run), copies to target/acceptance-1662; a
// process is stopped only by the PID it was started with; no network beyond cargo's (--locked), no model.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** Each criterion's ID: `#1662.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1662.0b9026c1';
export const AC2 = '#1662.2fa0bd8c';
export const AC3 = '#1662.9ac71651';
/** The strings the issue names; a release deep-app may hold none of them, however it was built. */
export const SYMBOLS = ['ROW_PLANT', 'RowPlant', 'plant_row'] as const;
/** The merge base this suite was written on, pinned: its manifests turn `plant-row` on from deep-replica's [dependencies]. */
export const BASE = 'c950fe1467688d3f94a10ed6deca8d145f92484e';
/** The issue's command, with `--locked` so cargo changes no lock file. */
export const TREE_ARGS = ['tree', '--locked', '--workspace', '-e', 'normal,build,features', '-i', 'deep-app'] as const;
/** A warm release build of deep-app under this machine's load is minutes; a cold one (gpui) far more, so this is generous. */
export const BUILD_MS = 60 * 60_000;
const OWN = join(REPO, 'target', 'acceptance-1662');
const CARGO = [join(homedir(), '.cargo/bin/cargo')].find(existsSync) ?? 'cargo';

export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export function run(cmd: string, args: readonly string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    // The environment is passed as is: a changed CARGO_* variable would change cargo's fingerprints and rebuild cold.
    const child = spawn(cmd, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? BUILD_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}
/** Home paths out of what a failure message carries (AGENTS.md: no personal data in evidence). */
export const redact = (text: string): string => text.replaceAll(homedir(), '~');
const tail = (r: Ran): string => redact(r.stderr.slice(-1500));

/** The message a judgement throws, or null when it holds: a wrong program's test expects it to throw. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
  try { await judge(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

// ---- AC1: cargo's feature tree, inverted at deep-app, over the edges a build follows (no dev-dependencies).
/** `cargo tree --locked --workspace -e normal,build,features -i deep-app` in `cwd` (this checkout, or the base's manifests). */
export async function featureTree(cwd = REPO): Promise<string> {
  const args = cwd === REPO ? [...TREE_ARGS] : [...TREE_ARGS, '--offline'];
  const r = await run(CARGO, args, { cwd, timeoutMs: 10 * 60_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: cargo ${args.join(' ')} didn't finish; this is not a pass`);
  if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed (exit ${r.code}): ${tail(r)}`);
  if (!/^deep-app v\S+/m.test(r.stdout)) throw Error(`BLOCKED: cargo tree printed no deep-app root: ${redact(r.stdout.slice(0, 400))}`);
  return r.stdout;
}
/** Every `deep-app feature "<name>"` line of the tree, with the line under it (who turns the feature on). */
export function featuresOf(tree: string): { feature: string; line: string; by: string }[] {
  const lines = tree.split('\n');
  const found: { feature: string; line: string; by: string }[] = [];
  lines.forEach((line, i) => {
    const m = /deep-app feature "([^"]+)"/.exec(line);
    if (m) found.push({ feature: m[1]!, line: line.trim(), by: (lines[i + 1] ?? '').trim() });
  });
  return found;
}
/** AC1's judge: no feature of deep-app in the tree is a `plant-*` feature. */
export function judgeTree(tree: string): void {
  const plants = featuresOf(redact(tree)).filter((f) => f.feature.startsWith('plant-'));
  if (plants.length) {
    throw Error(`the workspace's feature tree turns on deep-app's ${plants.map((p) => `"${p.feature}"`).join(', ')}: ${plants.map((p) => `${p.line}  <- ${p.by}`).join('; ')}`);
  }
}
/**
 * The pinned merge base's manifests (the wrong program of AC1): Cargo.toml, Cargo.lock, rust-toolchain.toml, .cargo,
 * crates/ and vendor/ taken from BASE with `git archive` into target/acceptance-1662/base, enough for `cargo tree
 * --offline` to resolve the workspace as the base did. Nothing in it is compiled.
 */
export function baseManifests(): string {
  const src = join(OWN, 'base', BASE.slice(0, 12));
  if (existsSync(join(src, 'Cargo.lock'))) return src;
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo', 'crates', 'vendor'], { maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', src], { input: tar, maxBuffer: 512 * 1024 * 1024 });
  return src;
}

// ---- AC2: the release deep-app binary, built two ways (and a third, planted, as the wrong program).
/** How the deep-app binary is built: alone, with the workspace's feature resolution, or planted (the wrong program). */
export type Build = 'alone' | 'workspace' | 'planted';
export const BUILD_ARGS: Record<Build, readonly string[]> = {
  alone: ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app'],
  // `--workspace` selects every member, so cargo resolves features over all of them (resolver 2), and `--bin deep-app`
  // then builds that one target: the app as `cargo build --workspace` or `npm run build` would link it.
  workspace: ['build', '--locked', '--release', '--workspace', '--bin', 'deep-app'],
  planted: ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'plant-row'],
};
const PRODUCT = join(REPO, 'target', 'release', 'deep-app');
// Every build writes target/release/deep-app, so they run one at a time and each result is copied aside first.
let queue: Promise<unknown> = Promise.resolve();
const built = new Map<Build, Promise<string>>();
/** The release deep-app built `how`, copied to target/acceptance-1662/<how>/deep-app; that copy's path. */
export function releaseApp(how: Build): Promise<string> {
  if (!built.has(how)) {
    const job = queue.then(async () => {
      const args = BUILD_ARGS[how];
      const r = await run(CARGO, args);
      if (r.timedOut) throw Error(`INCONCLUSIVE: cargo ${args.join(' ')} didn't finish in ${BUILD_MS / 60_000} minutes; this is not a pass`);
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed (exit ${r.code}): ${tail(r)}`);
      if (!existsSync(PRODUCT)) throw Error(`BLOCKED: cargo ${args.join(' ')} left no binary at ${redact(PRODUCT)}`);
      const dir = join(OWN, how);
      mkdirSync(dir, { recursive: true });
      const copy = join(dir, 'deep-app');
      copyFileSync(PRODUCT, copy);
      return copy;
    });
    queue = job.catch(() => undefined);
    built.set(how, job);
  }
  return built.get(how)!;
}
/** Which of the three strings the binary's bytes hold, by a search of the whole file (`nm` is the hand check). */
export function heldBy(binary: string): string[] {
  const bytes = readFileSync(binary);
  return SYMBOLS.filter((s) => bytes.includes(Buffer.from(s)));
}
/** AC2's judge: the binary exists and holds none of `ROW_PLANT`, `RowPlant`, `plant_row`. */
export function judgeSymbols(binary: string, name: string): void {
  if (!existsSync(binary)) throw Error(`BLOCKED: no release binary at ${redact(binary)} for ${name}`);
  const held = heldBy(binary);
  if (held.length) throw Error(`the release deep-app ${name} holds ${held.join(' and ')} (byte search of ${redact(binary)}, ${readFileSync(binary).length} bytes)`);
}
