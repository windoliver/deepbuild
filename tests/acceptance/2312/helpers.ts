// Test-side tools for the #2312 acceptance tests: temp folders, a world (the record, the asks core, the real
// supervisor and project trust), a host whose supervisor is that real supervisor with every start it is asked for
// written down first, a JSON-RPC package built as the guide's reader builds one, a framework Python found on this
// Mac, and a framework-shaped tree for the installs no Mac has. Nothing here stands in for the host or the sandbox:
// the tests reach them only through `@deepbuild/extension-host`'s public entry and the supervisor it is given.
// The host is loaded lazily, as the sibling folders do.
//
// Safety: every folder is under /tmp/dh2312-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; no network;
// and no process is ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { Asks } from '../../../packages/asks/src/index.ts';
import type { ExtensionHost, ProjectTrust } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
export const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';
export const ASKS_ENTRY = '../../../packages/asks/src/index.ts';
/** The guide's JSON-RPC worked example (#351): a `main` in Python that registers a check kind over #348's wire. */
export const JSON_RPC_EXAMPLE = join(REPO, 'docs/extension-guide/json-rpc');
/** What criterion 1 and the issue's Scope name. */
export const APPLE_PYTHON = '/usr/bin/python3';
export const COMMAND_LINE_TOOLS = '/Library/Developer/CommandLineTools';

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
const HOME = realpathSync(mkdtempSync('/tmp/dh2312-home-'));
process.env.HOME = HOME;
export const home = (): string => HOME;

/** Not run is never a pass (AGENTS.md, invariant 2): a missing prerequisite fails its test, saying BLOCKED and why. */
export function blocked(why: string): never {
  throw Error(`BLOCKED: ${why}`);
}
export function needsMac(): void {
  if (process.platform !== 'darwin') blocked(`#2312 is about the macOS sandbox (Seatbelt); this is ${process.platform}`);
}

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2312-${tag}-`));
  made.push(dir);
  return dir;
}

export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;
const asksCore = () => import(new URL(ASKS_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/asks/src/index.ts')>;

// ---- The world: a record, the asks core, the supervisor and project trust.
export interface World {
  /** The ~/.deepbuild the host installs extensions under and snapshots each run's package folder into. */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  trust: ProjectTrust;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
/** `deepHome`: where the host's home goes, for the test that puts package folders inside an interpreter's install. */
export async function openWorld(deepHome?: string): Promise<World> {
  const dir = tempDir('world');
  const at = deepHome ?? join(dir, 'deepbuild');
  mkdirSync(at, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const { openAsks } = await asksCore();
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: Date.now });
  let closed = false;
  const w: World = {
    home: at, record, asks, sup, trust,
    close: async () => {
      if (closed) return;
      closed = true;
      await sup.close();
      await record.close();
    },
  };
  worlds.push(w);
  return w;
}

/** One start the host asked the supervisor for: the run's package folder and what the host asked to let it read. */
export interface AskedStart { folder: string; read: string[] }
/**
 * An extension host on a world. Its supervisor is the world's real one; each `start` the host asks for is written
 * down (its `cwd`, the run's package folder, and its `grant.read`) and then passed on unchanged, so the run starts
 * in the real platform sandbox. `starts` lists the out-of-process `main` starts, in order.
 */
export async function openHost(w: World): Promise<{ h: ExtensionHost; starts: AskedStart[] }> {
  const starts: AskedStart[] = [];
  const supervisor = new Proxy(w.sup, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (key === 'start') {
        return (spec: Parameters<Supervisor['start']>[0]) => {
          if (spec.argv.at(-1) === 'main') starts.push({ folder: spec.cwd, read: [...(spec.grant?.read ?? [])] });
          return target.start(spec);
        };
      }
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({ record: w.record, asks: w.asks, supervisor, trust: w.trust, home: w.home, release: [], now: Date.now });
  hosts.push(h);
  await h.ready();
  return { h, starts };
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

// ---- Paths. A path holds another when it is that path or a folder above it.
export const holds = (path: string, other: string): boolean => other === path || other.startsWith(`${path.replace(/\/$/, '')}/`);

// ---- The package: the guide's JSON-RPC example, its `#!` line pointed at an interpreter.
/** The check kind the example registers and the runs its example.json declares. */
export interface ExampleRun { check: string; runs: { spec: Record<string, unknown>; expect: { outcome: string; testsRun: number } }[] }
/**
 * The guide's JSON-RPC example built into a package in a temp folder, as its reader builds it: copied, its `main`'s
 * first line replaced by `#!<interpreter>`, made executable, and its envelope digest stamped.
 */
export async function jsonRpcPackage(interpreter: string): Promise<{ dir: string; id: string; run: ExampleRun }> {
  expect(existsSync(join(JSON_RPC_EXAMPLE, 'main')), `the guide's JSON-RPC example (#351) is at ${JSON_RPC_EXAMPLE}`).toBe(true);
  const dir = tempDir('pkg');
  cpSync(JSON_RPC_EXAMPLE, dir, { recursive: true });
  const main = join(dir, 'main');
  const lines = readFileSync(main, 'utf8').split('\n');
  expect(lines[0], 'the example\'s main starts with a #! line').toMatch(/^#!/);
  lines[0] = `#!${interpreter}`;
  writeFileSync(main, lines.join('\n'));
  chmodSync(main, 0o755);
  const { packageDigest } = await host();
  const manifest = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; digest?: string };
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, id: manifest.id, run: JSON.parse(readFileSync(join(dir, 'example.json'), 'utf8')) as ExampleRun };
}

// ---- The hub's PATH. The host grants only an interpreter the hub itself would run by a known name (python3).
/** A temp folder holding `python3`, a link to the interpreter. */
export function pathDirFor(interpreter: string): string {
  const dir = tempDir('bin');
  symlinkSync(interpreter, join(dir, 'python3'));
  return dir;
}
/** Runs `body` with the process's PATH (and HOME, when given) set, and puts both back. */
export async function withEnv<T>(env: { PATH: string; HOME?: string }, body: () => Promise<T>): Promise<T> {
  const before = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = env.PATH;
  if (env.HOME !== undefined) process.env.HOME = env.HOME;
  try {
    return await body();
  } finally {
    process.env.PATH = before.PATH;
    process.env.HOME = before.HOME;
  }
}

// ---- A framework Python on this Mac.
export interface FrameworkPython {
  /** `<...>/Python.framework/Versions/<v>`, a real path. */
  root: string;
  /** `<root>/Resources/Python.app/Contents/MacOS/Python`, a real path. */
  binary: string;
}
const SHAPE = /^(\/.+\/Frameworks\/Python\.framework\/Versions\/[^/]+)\/Resources\/Python\.app\/Contents\/MacOS\/Python$/;
/** Where macOS framework Pythons are installed: python.org's, and Homebrew's on Apple silicon and on Intel. */
const FRAMEWORKS = ['/Library/Frameworks', '/opt/homebrew/Frameworks', '/usr/local/Frameworks'];
/**
 * The first framework Python installed here whose `Python.app` binary is a real file of the criterion's shape,
 * outside your home, and runs outside the sandbox. With none, the test is BLOCKED.
 */
export function frameworkPython(): FrameworkPython {
  const seen: string[] = [];
  for (const frameworks of FRAMEWORKS) {
    const versions = join(frameworks, 'Python.framework/Versions');
    if (!existsSync(versions)) continue;
    for (const v of readdirSync(versions).filter((name) => /^\d/.test(name)).sort().reverse()) {
      const candidate = join(versions, v, 'Resources/Python.app/Contents/MacOS/Python');
      if (!existsSync(candidate)) continue;
      const binary = realpathSync(candidate);
      const shape = SHAPE.exec(binary);
      const ran = spawnSync(binary, ['-c', 'import json, sys; print("ok")'], { encoding: 'utf8', timeout: 60_000 });
      seen.push(`${candidate}: ${shape ? `ran ${ran.status ?? ran.signal}` : `is ${binary}`}`);
      if (shape && ran.status === 0 && ran.stdout.trim() === 'ok') return { root: shape[1]!, binary };
    }
  }
  return blocked(`no macOS framework Python (<Frameworks>/Python.framework/Versions/<v>/Resources/Python.app/Contents/MacOS/Python) runs on this machine; looked in ${FRAMEWORKS.join(', ')}${seen.length ? `: ${seen.join('; ')}` : ''}`);
}

// ---- A framework-shaped tree, for the installs no Mac has: one that is your home, one that holds the package.
/**
 * `<temp>/Frameworks/Python.framework/Versions/3.99` with a program at `Resources/Python.app/Contents/MacOS/Python`.
 * The program is a stand-in that runs nothing: these tests read what the host asks for, not what the run does.
 */
export function frameworkTree(): FrameworkPython {
  const root = join(tempDir('tree'), 'Frameworks/Python.framework/Versions/3.99');
  const binary = join(root, 'Resources/Python.app/Contents/MacOS/Python');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, '#!/bin/sh\nexit 0\n');
  chmodSync(binary, 0o755);
  return { root, binary };
}
