// Test-side tools for the #1970 acceptance tests: `deep-canvas check` and `deep-canvas apply`, the document check
// and a patch (built once per file with cargo), and `deep mcp` spoken to as an MCP client speaks it, against a real
// hub (`deep hub run`) in a temporary home. Nothing here stands in for the check, the patch, the hub or `deep mcp`:
// every refusal read here is the binary's or the hub's own. Processes are stopped by PID only, never by name or port.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
const parse = (raw: string): JsonValue | undefined => { try { return JSON.parse(raw) as JsonValue; } catch { return undefined; } };

// ---------------------------------------------------------------------------------------------------
// `deep-canvas`: JSON lines in, one JSON line out per line in.

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');

/**
 * Builds the crate's binary of the same name once for the file (light on the shared Mac: no incremental cache, no
 * debug info): `deep-canvas` for the check and the patch, `deep-hook` for the hub, which won't start without it.
 */
export function useBinary(name: 'deep-canvas' | 'deep-hook'): () => string {
  let error = 'not built';
  beforeAll(() => {
    const r = spawnSync('cargo', ['build', '--locked', '-p', name, '--bin', name], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' },
    });
    error = r.error ? `cargo could not run: ${r.error.message}` : r.status === 0 ? '' : `cargo build -p ${name} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n').slice(-4000)}`;
  }, 3_600_000);
  return () => {
    expect(error, `the ${name} binary builds`).toBe('');
    return join(TARGET, 'debug', process.platform === 'win32' ? `${name}.exe` : name);
  };
}

/** One `deep-canvas <command>` run with one input line; its one answer. */
export function canvas(bin: string, command: string, input: JsonObject): JsonObject {
  const r = spawnSync(bin, [command], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`deep-canvas ${command}: ${r.error.message}`);
  expect(r.status, `deep-canvas ${command} exits 0: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `deep-canvas ${command}: one output line per input line`).toBe(1);
  const out = parse(lines[0]!);
  expect(isObject(out), `deep-canvas ${command}: an object per line: ${lines[0]!.slice(0, 1500)}`).toBe(true);
  return out as JsonObject;
}

/** The issues a check's or a patch's answer carries. */
export const issuesOf = (out: JsonObject): JsonObject[] => (Array.isArray(out['issues']) ? out['issues'].filter(isObject) : []);

/** Text that names the kind `kind` (`family.name@major`), not a later major such as `@10`. */
export const namesKind = (v: JsonValue | undefined, kind: string): boolean =>
  new RegExp(`${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`).test(JSON.stringify(v ?? null));
/** A close-name entry that names some kind (`name@major`) rather than a field by spelling. */
const namesSomeKind = (v: JsonValue): boolean => /[a-z0-9_]+(\.[a-z0-9_]+)*@\d+/.test(JSON.stringify(v));

/** What an issue holds besides its fix: an issue's own fields (canvas primitives: Item and kind; the check catalog). */
const NOT_FIX = new Set(['check', 'code', 'severity', 'ids', 'path', 'actual', 'what', 'carried', 'forms', 'step']);

/**
 * The answer refuses `field` on item `id` with `unknown_field`, and that refusal's fix names `kind` ahead of any close
 * name: in the fix (its text, its ops, or any other remediation field the issue carries) or as the first of its close
 * names, with no name by spelling before it. Each failure names the field.
 */
export function kindFirstFailures(out: JsonObject, want: { id: string; field: string; kind: string; where: string }): string[] {
  const at = `items/${want.id}/params/${want.field}`;
  const subject = `field ${want.field} on ${want.where}`;
  const hits = issuesOf(out).filter((i) => i['code'] === 'unknown_field' && i['path'] === at);
  if (!hits.length) return [`${subject}: no unknown_field at ${at}: ${show(issuesOf(out))}`];
  const failures: string[] = [];
  for (const h of hits) {
    const close = Array.isArray(h['close']) ? h['close'] : [];
    const first = close.findIndex((c) => namesKind(c, want.kind));
    const ahead = first > 0 ? close.slice(0, first).filter((c) => !namesSomeKind(c)) : [];
    if (ahead.length) failures.push(`${subject}: unknown_field names close names ${show(ahead)} ahead of ${want.kind}: ${show(close)}`);
    const fix = Object.fromEntries(Object.entries(h).filter(([k]) => !NOT_FIX.has(k) && k !== 'close'));
    if (first < 0 && !namesKind(fix, want.kind)) {
      failures.push(`${subject}: unknown_field's fix names no kind that defines ${want.field}, not ${want.kind}: fix ${show(fix)}, close names ${show(close)}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// A hub and a `deep mcp`, each a child of this test process, in a temporary home.

const owned = new Set<number>();
const made: string[] = [];
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Stops every process this file started, by PID (SIGTERM, then SIGKILL after 5 s), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function useCleanup(): void { afterAll(cleanup, 60_000); }

/** A short temp folder (a socket path must fit in 104 bytes on macOS) with a home in it. */
export function makeHome(): { tmp: string; home: string } {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1970-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  mkdirSync(home);
  return { tmp, home };
}

/** This environment with HOME moved to the test's home and none of the hub's or an agent's settings. */
function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|TMUX|CLAUDE|CODEX)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, LC_ALL: 'C' };
}

/** `deep hub run` in `home`, once it says it is ready. */
export async function startHub(home: string): Promise<void> {
  expect(existsSync(CLI), `the CLI is built at ${CLI} (npm run build --workspaces)`).toBe(true);
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { out = (out + d).slice(-4000); });
  const ready = await new Promise<boolean>((done) => {
    let first = '';
    const timer = setTimeout(() => done(false), 300_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); const line = parse(first.split('\n')[0]!); done(isObject(line) && line['ready'] === true); }
    });
    child.on('exit', () => { clearTimeout(timer); done(false); });
  });
  expect(ready, `BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`).toBe(true);
}

/** A tool call's outcome: `isError`, and its value (structuredContent, else the first text block's JSON). */
export interface Outcome { isError: boolean; protocolError: boolean; value: JsonValue | undefined; reply: JsonObject }

/** A `deep mcp` started by hand from this test process, in `cwd`, under `home`. */
export class Mcp {
  private readonly lines: string[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private err = '';
  private constructor(private readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (raw) => { this.lines.push(raw); for (const w of [...this.wakers]) w(); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('close', () => { for (const w of [...this.wakers]) w(); });
  }
  static start(home: string, cwd: string): Mcp {
    const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    return new Mcp(child);
  }
  notify(method: string, params: JsonObject = {}): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
  request(method: string, params: JsonObject = {}, timeoutMs = 120_000): Promise<JsonObject> {
    const id = `t1970#${++this.ids}`;
    return new Promise((done, fail) => {
      const finish = () => { clearTimeout(timer); this.wakers.delete(check); };
      const timer = setTimeout(() => { finish(); fail(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms: ${this.err}`)); }, timeoutMs);
      const check = () => {
        for (const raw of this.lines) {
          const json = parse(raw);
          if (isObject(json) && json['id'] === id) { finish(); done(json); return; }
        }
        if (this.child.exitCode !== null) { finish(); fail(Error(`deep mcp exited ${this.child.exitCode}: ${this.err}`)); }
      };
      this.wakers.add(check);
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      check();
    });
  }
  async initialize(): Promise<void> {
    const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1970', version: '0' } });
    expect(isObject(reply['result']), `BLOCKED: deep mcp refused initialize: ${show(reply)}`).toBe(true);
    this.notify('notifications/initialized');
  }
  /** The input schema `deep mcp` lists for `tool`. */
  async schemaOf(tool: string): Promise<JsonObject> {
    const reply = await this.request('tools/list');
    const tools = isObject(reply['result']) && Array.isArray(reply['result']['tools']) ? reply['result']['tools'].filter(isObject) : [];
    const found = tools.find((t) => t['name'] === tool);
    expect(found && isObject(found['inputSchema']), `deep mcp lists ${tool} with an input schema: ${show(tools.map((t) => t['name']))}`).toBe(true);
    return found!['inputSchema'] as JsonObject;
  }
  async call(tool: string, args: JsonObject): Promise<Outcome> {
    const reply = await this.request('tools/call', { name: tool, arguments: args });
    if (reply['error'] !== undefined) return { isError: true, protocolError: true, value: reply['error'], reply };
    const result = isObject(reply['result']) ? reply['result'] : {};
    const content = Array.isArray(result['content']) ? result['content'].filter(isObject) : [];
    const text = content.find((c) => c['type'] === 'text')?.['text'];
    const value = result['structuredContent'] ?? (typeof text === 'string' ? parse(text) ?? text : undefined);
    return { isError: result['isError'] === true, protocolError: false, value, reply };
  }
}

// ---------------------------------------------------------------------------------------------------
// Names in a remediation.

/** How many times `name` stands as a word of `text`: not inside a longer name (`doc` in `docs` or `document`) or a contraction. */
export function timesNamed(text: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`(?<![A-Za-z0-9_'’])${escaped}(?![A-Za-z0-9_'’])`, 'g')) ?? []).length;
}

/**
 * Whether `text` singles `name` out among `choices`: names it more often than some other choice. A remediation that
 * only lists the choices, as the merge base's does, names each once and singles none out; one that names the nearest
 * name, alone or ahead of the list, singles it out.
 */
export function singlesOut(text: string, name: string, choices: readonly string[]): boolean {
  const others = choices.filter((c) => c !== name).map((c) => timesNamed(text, c));
  return timesNamed(text, name) > Math.min(...others);
}
