// Test-side tools for the #1492 acceptance tests: the panel host built and started as the app starts it
// (`deep-panel-host serve --panel DIR`, one JSON object a line on each side), the test panels written from values drawn
// per run, and the idle lane's judge fed readings. Nothing here stands in for the host, the timer or the judge.
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const BENCH = join(REPO, 'benchmarks', 'canvas.mjs');
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Line = { [key: string]: Json };

let built: string | undefined;
/** The release host, as cargo says it built it. A build that fails is BLOCKED, never a pass. */
export function hostBinary(): string {
  if (built) return built;
  const r = spawnSync('cargo', ['build', '--release', '--locked', '-p', 'deep-panel-host', '--message-format=json'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`BLOCKED: cargo build of deep-panel-host failed: ${(r.stderr ?? '').slice(-2000)}`);
  const found = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as { reason?: string; executable?: string; target?: { name: string; kind: string[] } })
    .find((m) => m.reason === 'compiler-artifact' && m.executable && m.target?.name === 'deep-panel-host' && m.target.kind.includes('bin'));
  if (!found?.executable) throw new Error('BLOCKED: cargo built no deep-panel-host binary');
  return (built = found.executable);
}

export interface Drawn { id: string; before: string; after: string; dir: string }

/**
 * A panel with a 1 Hz timer, names drawn per run. Every tick re-renders it; its tree shows `before` until tick
 * `changeAt` (never, with 0) and `after` from then on. The tick count itself is never drawn.
 */
export function writePanel(changeAt: number): Drawn {
  const tag = () => randomBytes(5).toString('hex');
  const id = `dev.deepbuild.idle.${tag()}`, before = `before-${tag()}`, after = `after-${tag()}`;
  const dir = mkdtempSync(join(tmpdir(), 'deep-1492-'));
  writeFileSync(join(dir, 'gpui-shell.json'), JSON.stringify({ id, name: 'Idle', version: '1.0.0', entry: 'main.js' }));
  writeFileSync(join(dir, 'main.js'), `import { View, div } from "@deepbuild/panel";

export default class Idle extends View {
  init(_props, cx) {
    this.ticks = 0;
    cx.timer.every(1000, () => { this.ticks += 1; cx.notify(); });
  }

  render() {
    const changed = ${changeAt} > 0 && this.ticks >= ${changeAt};
    return div().size_full().child(changed ? ${JSON.stringify(after)} : ${JSON.stringify(before)});
  }
}
`);
  return { id, before, after, dir };
}

export interface Host {
  child: ChildProcessByStdio<Writable, Readable, null>;
  /** Every line the host wrote, with the time it arrived. */
  lines: { at: number; line: Line }[];
  send(command: Line, ms?: number): Promise<Line>;
  stop(): void;
}

/** `deep-panel-host serve --panel DIR [--planted NAME]`, waited on until it says `{ready: true}`. */
export async function startHost(dir: string, planted?: string): Promise<Host> {
  const child = spawn(hostBinary(), ['serve', '--panel', dir, ...(planted ? ['--planted', planted] : [])], { cwd: REPO, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: Host['lines'] = [];
  const watchers: (() => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (text) => {
    try { lines.push({ at: Date.now(), line: JSON.parse(text) as Line }); } catch { return; }
    for (const watcher of watchers.splice(0)) watcher();
  });
  const waitFor = (from: number, ms: number): Promise<Line> => new Promise((resolve, reject) => {
    const look = (): boolean => {
      const hit = lines.slice(from).find((l) => !('frame' in l.line));
      if (hit) { resolve(hit.line); return true; }
      return false;
    };
    if (look()) return;
    const timer = setTimeout(() => reject(new Error(`the host said nothing in ${ms} ms; it wrote ${JSON.stringify(lines.slice(from).map((l) => l.line)).slice(0, 600)}`)), ms);
    const again = (): void => { if (look()) clearTimeout(timer); else watchers.push(again); };
    watchers.push(again);
  });
  const host: Host = {
    child, lines,
    send: (command, ms = 30_000) => {
      const from = lines.length;
      child.stdin.write(`${JSON.stringify(command)}\n`);
      return waitFor(from, ms);
    },
    stop: () => { child.kill('SIGTERM'); },
  };
  await waitFor(0, 120_000);
  return host;
}

/** The lines that are frame requests: `{frame: {panel, hash, tree}}`. */
export const frames = (host: Host, since = 0): { at: number; frame: { panel: string; hash: string; tree: string } }[] =>
  host.lines.filter((l) => l.at >= since && typeof l.line['frame'] === 'object' && l.line['frame'] !== null)
    .map((l) => ({ at: l.at, frame: l.line['frame'] as unknown as { panel: string; hash: string; tree: string } }));

export const str = (value: Json | undefined): string => (typeof value === 'string' ? value : '');
export const int = (value: Json | undefined): number => (typeof value === 'number' ? value : Number.NaN);

// ---------------------------------------------------------------------------------------------------
// The idle lane's judge, on readings made up for it on a reference Mac's fingerprint.

export function idleReport(energy: (run: number) => Json): Line {
  const run = (i: number): Line => ({ opened_frames: 1, seconds: 60.01, frames: 0, drawn: [], wakeups: 0, cpu_ms: 6, cpu_fraction: 6 / 60_010, energy: energy(i) as Json });
  return {
    task: 'canvas-idle', fixture: 'benchmarks/canvas/still.json', seconds: 60,
    fingerprint: { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25G241', build: { profile: 'release', toolchain: 'rustc 1.99.1 (58cf8f9c3 2026-10-13)' } },
    runs: [1, 2, 3, 4, 5].map(run),
  };
}

/** `node benchmarks/canvas.mjs judge`, the verdict its last stdout line. */
export function judged(report: Line): Line {
  const r = spawnSync(process.execPath, [BENCH, 'judge'], { cwd: REPO, encoding: 'utf8', timeout: 600_000, input: `${JSON.stringify({ current: report, base: null })}\n` });
  if (r.status !== 0) throw new Error(`canvas.mjs judge exited ${r.status}: ${(r.stderr ?? '').slice(-2000)}`);
  const last = r.stdout.split('\n').filter((l) => l.trim() !== '').at(-1) ?? '';
  return JSON.parse(last) as Line;
}
