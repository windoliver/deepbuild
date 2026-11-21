// #1898 AC2: the hub's start, measured with and without the check kits, as a reading on this machine. The hub is the
// real one, `deep hub run` from the built CLI on a fresh temporary home, as `deep hub start` runs it. A preload,
// given to the hub and to each of its threads through NODE_OPTIONS, appends every module a thread loads to a log
// through Node's own loader hooks (module.registerHooks). "With the kits" is the same start with a second preload that
// imports each check kit's package entry in every thread before the hub's own modules: what a start that loaded the
// kits eagerly would hold. "Without" is the hub as built. The start time is from the spawn to the hub's ready line on
// stdout; the module count is the log's lines, every thread's loads together, from the spawn until SETTLE after ready.
// The reading is written to target/acceptance-1898/hub-start.json and annotated on the test. What can fail: the
// hub as built loads no kit module at its start (the issue's "no kit loaded before a check needs it"), and so the
// start with the kits loads more modules than the one without.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { REPO, resolveFrom } from './walk.ts';

const CLI = join(REPO, 'packages/cli/dist/main.js');
const SETTLE = 5_000;
const RUNS = 3;
const blocked = (why: string): never => { throw new Error(`BLOCKED: ${why}`); };

/** The check kits: every check package the hub depends on (`@deepbuild/checks-*`), and conformance's own entry. */
function kits(): string[] {
  const hub = JSON.parse(readFileSync(join(REPO, 'packages/hub/package.json'), 'utf8')) as { dependencies: Record<string, string> };
  const names = [...Object.keys(hub.dependencies).filter((n) => n.startsWith('@deepbuild/checks-')), '@deepbuild/conformance'];
  return names.map((n) => resolveFrom(n, join(REPO, 'packages/hub/dist/index.js'), 'import') ?? blocked(`${n} doesn't resolve from the hub`));
}
/** A module of a check kit: any file of a check package's build, or conformance's index (its small subpaths aren't the kit). */
const KIT = /\/packages\/(checks-[\w-]+\/dist\/|conformance\/dist\/index\.js$)/;

interface Start { kits: boolean; ms: number; modules: number; byThread: Record<string, number>; kitModules: string[]; coreLoaded: boolean }

async function start(withKits: boolean, entries: string[]): Promise<Start> {
  // Short: the hub's socket lives under the home, and macOS caps a socket's path at 104 bytes.
  const home = realpathSync(mkdtempSync('/tmp/d1898-'));
  try {
    mkdirSync(join(home, '.deepbuild'));
    const log = join(home, 'loads.log');
    const loads = join(home, 'loads.mjs');
    writeFileSync(loads, `import { registerHooks } from 'node:module';\nimport { appendFileSync } from 'node:fs';\nimport { threadId } from 'node:worker_threads';\nregisterHooks({ load(url, context, next) { appendFileSync(${JSON.stringify(log)}, threadId + ' ' + url + '\\n'); return next(url, context); } });\n`);
    const preload = [`--import=${pathToFileURL(loads).href}`];
    if (withKits) {
      const kit = join(home, 'kits.mjs');
      writeFileSync(kit, entries.map((e) => `await import(${JSON.stringify(pathToFileURL(e).href)});`).join('\n') + '\n');
      preload.push(`--import=${pathToFileURL(kit).href}`);
    }
    const env = Object.fromEntries(Object.entries({ ...process.env, HOME: home, NODE_OPTIONS: preload.join(' ') }).filter(([k]) => !k.startsWith('VITEST')));
    const began = performance.now();
    const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    hub.stderr.on('data', (c) => { errors += c; });
    const exited = new Promise<void>((done) => hub.once('exit', () => done()));
    try {
      const ms = await new Promise<number>((done, fail) => {
        let out = '';
        hub.stdout.on('data', (c) => { out += c; if (/"ready":true/.test(out)) done(performance.now() - began); });
        hub.once('exit', (code, signal) => fail(new Error(`BLOCKED: the hub exited before it was ready (${code ?? signal}): ${errors.slice(-2000)}`)));
        setTimeout(() => fail(new Error(`BLOCKED: the hub wasn't ready within 120 s: ${errors.slice(-2000)}`)), 120_000);
      });
      await new Promise((done) => setTimeout(done, SETTLE));
      const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      const byThread: Record<string, number> = {};
      for (const l of lines) { const t = l.slice(0, l.indexOf(' ')); byThread[t] = (byThread[t] ?? 0) + 1; }
      const urls = lines.map((l) => l.slice(l.indexOf(' ') + 1));
      return {
        kits: withKits, ms: Math.round(ms), modules: lines.length, byThread,
        kitModules: [...new Set(urls.filter((u) => KIT.test(u)).map((u) => u.replace(/^.*\/packages\//, 'packages/')))],
        coreLoaded: urls.some((u) => u.endsWith('/packages/hub/dist/core.js')) && urls.some((u) => u.endsWith('/packages/hub/dist/kinds.js')),
      };
    } finally {
      if (hub.exitCode === null && hub.signalCode === null) hub.kill('SIGTERM');
      await Promise.race([exited, new Promise((done) => setTimeout(done, 60_000))]);
      if (hub.exitCode === null && hub.signalCode === null) hub.kill('SIGKILL');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

it('#1898.83fded9a the hub\'s start time and loaded-module count are read with and without the kits on this machine, and the hub as built loads no kit at its start', async (ctx) => {
  if (!existsSync(CLI)) blocked('packages/cli/dist/main.js is missing: run npm run build --workspaces');
  const entries = kits();
  const runs: Start[] = [];
  // Interleaved, so a change in the machine's load falls on both sides alike.
  for (let i = 0; i < RUNS; i++) for (const withKits of [false, true]) runs.push(await start(withKits, entries));
  const side = (k: boolean) => runs.filter((r) => r.kits === k);
  for (const r of runs) if (!r.coreLoaded) blocked(`a start${r.kits ? ' with the kits' : ''} never loaded the hub's core and kinds table, so it isn't the hub's start: ${JSON.stringify(r)}`);
  for (const r of side(true)) if (r.kitModules.length === 0) blocked(`the start with the kits loaded no kit module, so it isn't a start with them: ${JSON.stringify(r)}`);

  const reading = {
    issue: 1898, what: 'deep hub run on a fresh home: ms from spawn to the ready line, and modules loaded (all threads) by ready + settle',
    settle_ms: SETTLE, date: new Date().toISOString(), node: process.version,
    machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, cores: cpus().length, memory: totalmem() },
    load: loadavg(), kits: entries.map((e) => e.replace(`${REPO}/`, '')),
    without: { ms: side(false).map((r) => r.ms), median_ms: median(side(false).map((r) => r.ms)), modules: side(false).map((r) => r.modules), threads: side(false)[0]!.byThread },
    with: { ms: side(true).map((r) => r.ms), median_ms: median(side(true).map((r) => r.ms)), modules: side(true).map((r) => r.modules), threads: side(true)[0]!.byThread },
  };
  const out = join(REPO, 'target/acceptance-1898/hub-start.json');
  mkdirSync(join(REPO, 'target/acceptance-1898'), { recursive: true });
  writeFileSync(out, `${JSON.stringify(reading, null, 2)}\n`);
  await ctx.annotate(`reading (${out.replace(`${REPO}/`, '')}): ${JSON.stringify(reading)}`);

  for (const r of side(false))
    expect(r.kitModules, 'check-kit modules the hub as built loaded by its ready line and settle, before any check ran').toEqual([]);
  expect(Math.min(...side(true).map((r) => r.modules)), `modules loaded with the kits exceed those without (reading: ${JSON.stringify({ without: reading.without.modules, with: reading.with.modules })})`)
    .toBeGreaterThan(Math.max(...side(false).map((r) => r.modules)));
}, 1_200_000);
