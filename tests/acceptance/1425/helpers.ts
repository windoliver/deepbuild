// Test-side tools for #1425 (README). Every reading comes from the real program: cargo builds of the panel host and the
// suite's Rust test binary, the host's own element trees, the lint script run as the lint lane runs it, and the pinned
// toolkit's own component inventory. A process is stopped only by the PID it was started with; nothing leaves the
// machine but cargo's own fetches (--locked); no model is called.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = join(REPO, 'tests/acceptance/1425');

/** Each criterion's ID: `#1425.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed. */
export const AC1 = '#1425.3d839088';
export const AC2 = '#1425.782e7a69';
export const AC3 = '#1425.229fbfbb';
export const AC4 = '#1425.24afae64';
export const AC5 = '#1425.30ab78a9';
export const AC6 = '#1425.1d938ac0';
export const AC7 = '#1425.711d0cb9';
export const AC8 = '#1425.859baf8e';

/** The surface (README, The surface). */
export const MODULE = '@deepbuild/panel';
export const CATALOG = 'crates/deep-app/panel-catalog.json';
export const LINT = 'scripts/panel-catalog.mjs';
export const GUIDE = ['docs/extension-guide.md', 'docs/extension-guide'];
export const SAMPLE = 'docs/extension-guide/plugin/panel';
/** The 12 panels in crates/deep-app/panels at the base. */
export const PANELS = [
  '338-canvas', '338-cap20', '338-drop-folded', '338-hide-newest', '338-home', '338-line',
  '338-list-superseded', '338-needs-you', '338-sidebar', '338-tab', 'claude-code', 'codex',
] as const;
/** Every panel AC1 names, by the name its base tree is kept under, and its folder. */
export const TREES: [string, string][] = [...PANELS.map((p): [string, string] => [p, `crates/deep-app/panels/${p}`]), ['sample', SAMPLE]];

/**
 * Where a panel is loaded from: the panel's own folder, but the guide's sample from a copy of its scripts, since
 * gpui-shell writes its typings (gpui-kit.d.ts, jsconfig.json) beside a panel it loads, and those mustn't land in the
 * guide's folders that AC4 reads.
 */
export function loadable(dir: string): string {
  if (dir !== SAMPLE) return dir;
  const copy = mkdtempSync(join(tmpdir(), 'deep-1425-sample-'));
  for (const file of packageScripts(dir)) {
    const to = join(copy, relative(dir, file));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(REPO, file), to);
  }
  return copy;
}

export const BUILD_MS = 60 * 60_000;
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');

export interface Ran { code: number | null; stdout: string; stderr: string }
const show = (r: Ran): string => `exit ${String(r.code)}\n--- stdout\n${r.stdout.slice(-6000)}\n--- stderr\n${r.stderr.slice(-6000)}`;
export { show };

export function cargo(args: string[], env: NodeJS.ProcessEnv = {}): Ran {
  const r = spawnSync('cargo', args, { cwd: REPO, env: { ...CARGO_ENV, ...env }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: BUILD_MS });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}

/** The panel host as the base builds it, `deep-panel-host`; a build that fails is BLOCKED. */
export function buildHost(): string {
  const r = cargo(['build', '--locked', '-p', 'deep-panel-host', '--bin', 'deep-panel-host']);
  if (r.code !== 0) throw Error(`BLOCKED: the panel host didn't build\n${show(r)}`);
  return join(TARGET, 'debug', 'deep-panel-host');
}

/**
 * One panel in the host's `serve` mode, as the app runs an agent-built panel (crates/deep-panel-host): its `ready`
 * line, then `invalidations` invalidations, each answered with the panel's element tree (`tree`, gpui-shell's text of
 * the snapshot) and the script's time (`scriptNs`). The host gets HOME and nothing else of this environment, as the app
 * starts it.
 */
export function serve(host: string, dir: string, invalidations = 1): Promise<{ trees: string[]; scriptNs: number[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(host, ['serve', '--panel', isAbsolute(dir) ? dir : join(REPO, dir)], { cwd: REPO, env: { HOME: process.env.HOME ?? '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let ready = false;
    const trees: string[] = [];
    const scriptNs: number[] = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`${dir}: the host answered nothing for 120 s\n${stderr}`)); }, 120_000);
    const done = (error?: Error) => {
      clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null) child.kill('SIGKILL');
      if (error) reject(error); else resolve({ trees, scriptNs });
    };
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => { if (trees.length < invalidations) done(Error(`${dir}: the host exited ${String(code)} after ${trees.length} trees\n${stderr}`)); });
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let message: { ready?: boolean; tree?: string; scriptNs?: number; error?: string };
        try { message = JSON.parse(line); } catch { return done(Error(`${dir}: the host wrote ${line}`)); }
        if (!ready) {
          if (message.ready !== true) return done(Error(`${dir}: the host said ${line}\n${stderr}`));
          ready = true;
        } else if (typeof message.tree === 'string') {
          trees.push(message.tree);
          scriptNs.push(Number(message.scriptNs));
        } else {
          return done(Error(`${dir}: an invalidation answered ${line}\n${stderr}`));
        }
        if (trees.length === invalidations) return done();
        child.stdin.write('{"cmd":"invalidate"}\n');
      }
    });
  });
}

/** Every import a script makes, with its line: static, re-exported, side-effect, dynamic and require. */
export function imports(source: string): { specifier: string; line: number }[] {
  // Comments out, lines kept.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1');
  const found: { specifier: string; line: number }[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const m of code.matchAll(pattern)) {
      const specifier = m[2]!;
      const at = m.index! + m[0].lastIndexOf(specifier);
      found.push({ specifier, line: code.slice(0, at).split('\n').length });
    }
  }
  return found;
}

/** A panel package's scripts: main.js and every file it imports by a relative path, near or far. */
export function packageScripts(dir: string): string[] {
  const seen = new Set<string>();
  const open = [join(REPO, dir, 'main.js')];
  while (open.length) {
    const file = open.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const { specifier } of imports(readFileSync(file, 'utf8')))
      if (specifier.startsWith('.')) open.push(join(dirname(file), specifier));
  }
  return [...seen].map((file) => relative(REPO, file));
}

/** The guide's files as a checkout holds them: tracked, or untracked and not ignored, that exist on disk. */
export function guideFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...GUIDE], { cwd: REPO, encoding: 'utf8' });
  return [...new Set(listed.split('\0').filter(Boolean))].filter((file) => existsSync(join(REPO, file))).sort();
}

export interface CatalogFile {
  module?: unknown;
  components?: { name?: unknown; props?: unknown; example?: unknown }[];
  not_offered?: { name?: unknown; reason?: unknown }[];
}
export function readCatalog(): CatalogFile {
  const path = join(REPO, CATALOG);
  if (!existsSync(path)) throw Error(`no catalog at ${CATALOG}`);
  return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
}

/** `node scripts/panel-catalog.mjs` from the repo root, as the lint lane runs it, with `env` added. */
export function lint(env: NodeJS.ProcessEnv = {}): Ran {
  const r = spawnSync(process.execPath, [LINT], { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 1 << 26 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
export const failLines = (r: Ran): string[] => `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /^FAIL\b/.test(l));

/** The lint lane's commands, from scripts/lanes.mjs as the preflight reads them. */
export async function lintLane(): Promise<string[][]> {
  const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
  return checks.find((c) => c.name === 'lint')?.commands ?? [];
}
export async function laneRunsLint(): Promise<boolean> {
  return (await lintLane()).some((c) => [process.execPath, 'node'].includes(c[0]!) && c[1] === LINT);
}

/** The component inventory of the gpui-shell Cargo.lock pins, from cargo's own metadata. */
export function pinnedInventory(): string {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: REPO, env: CARGO_ENV, encoding: 'utf8', maxBuffer: 1 << 29 })) as { packages: { name: string; manifest_path: string }[] };
  const shell = metadata.packages.find((p) => p.name === 'gpui-shell');
  if (!shell) throw Error('BLOCKED: cargo metadata lists no gpui-shell');
  return join(dirname(shell.manifest_path), 'component-inventory.json');
}

interface Inventory { items: { classification?: string; registration?: { exports?: string[]; related?: { exports?: string[] }[] } }[] }
/** What the toolkit exports as components: every item not classed infrastructure, its exports and its parts'. */
export function toolkitComponents(path: string): string[] {
  const inventory = JSON.parse(readFileSync(path, 'utf8')) as Inventory;
  const names = new Set<string>();
  for (const item of inventory.items) {
    if (item.classification === 'infrastructure') continue;
    for (const name of item.registration?.exports ?? []) names.add(name);
    for (const part of item.registration?.related ?? []) for (const name of part.exports ?? []) names.add(name);
  }
  return [...names].sort();
}

/** The suite's Rust half (app/panels.rs), built and run by cargo; each libtest line read back by name. */
export function rustSuite(filters: string[], env: NodeJS.ProcessEnv = {}): { results: Map<string, { ok: boolean; message: string }>; output: string } {
  const r = cargo(['test', '--locked', '-p', 'deep-replica', '--test', 'acceptance_1425', '--', ...filters], env);
  const results = new Map<string, { ok: boolean; message: string }>();
  for (const m of r.stdout.matchAll(/^test (.+) \.\.\. (ok|FAILED)$/gm)) {
    const name = m[1]!;
    const block = r.stdout.split(`---- ${name} ----\n`)[1]?.split(/\n\n(?=test |---- |test result)/)[0] ?? '';
    results.set(name, { ok: m[2] === 'ok', message: block });
  }
  return { results, output: show(r) };
}
