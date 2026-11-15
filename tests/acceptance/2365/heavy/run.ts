// The heavy runs' tools: the fixture written by a child, one measured pass in a child of its own (probe/pass.mjs)
// with its resident memory also sampled from outside by `ps` every 10 ms between its start and end lines, a home
// cloned for each run, and the perf lane's own judge (scripts/benchmark.mjs `judgeLimit`, `fingerprint`), which
// says PASS only on a reference Mac in a fit state and is otherwise INCONCLUSIVE (design: Every task carries its own
// budgets; The reference Macs). Nothing here stops a process but the ones it started, by PID.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { NODE, REPO } from '../helpers.ts';

export const MB = 1_000_000;
export const PROBE = fileURLToPath(new URL('../probe/', import.meta.url));
export const TWIN_WHOLE = join(PROBE, 'twin-whole.mjs');
/** Where Claude Code keeps the fixture's transcript under a home: its cwd's folder, as the fixture writes it. */
export const transcriptPath = (home: string, id: string): string => join(home, '.claude', 'projects', '-tmp-dh2365-work-long-session', `${id}.jsonl`);

export interface Meta { seed: number; session: string; turns: number; lines: number; bytes: number; toolBytes: number; toolShare: number; longest: number; last: { uuid: string; text: string } }
export function fixture(cmd: 'write' | 'append', path: string, bytes: number): Meta {
  mkdirSync(dirname(path), { recursive: true });
  const r = spawnSync(NODE, [join(PROBE, 'fixture.mjs'), cmd, path, String(bytes)], { encoding: 'utf8', maxBuffer: 1 << 20, timeout: 1_800_000 });
  if (r.status !== 0) throw Error(`BLOCKED: the fixture didn't ${cmd}: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').at(-1)!) as Meta;
}

/** The built packages the child loads; without them the heavy runs are BLOCKED, never passed. */
export function needBuild(): void {
  const missing = ['adapters', 'asks', 'evidence', 'record', 'archive'].map((p) => join(REPO, 'packages', p, 'dist', 'index.js')).filter((p) => !existsSync(p));
  if (missing.length) throw Error(`BLOCKED: build the packages first (npm run build --workspaces): missing ${missing.join(', ')}`);
}

export interface PassResult {
  ms: number; maxGapMs: number; ticks: number; rssStart: number; peakRss: number; rise: number;
  evidenceBefore: number; evidenceAfter: number; added: number; error: string | null;
  /** The highest RSS `ps` saw between the pass's start and end lines. */
  outsidePeak: number;
  load: { start: number; end: number };
}
const ps = (pid: number): Promise<number> => new Promise((resolve) => {
  execFile('ps', ['-o', 'rss=', '-p', String(pid)], (err, out) => resolve(err ? 0 : Number(out.trim()) * 1024 || 0));
});
/** One pass in a child of its own (probe/pass.mjs). */
export async function measuredPass(home: string, mode: 'pass' | 'session', now: number, o: { id?: string; archive?: string } = {}): Promise<PassResult> {
  const loadStart = loadavg()[0]!;
  const args = ['--expose-gc', join(PROBE, 'pass.mjs'), home, mode, String(now), ...(o.id ? [o.id] : []), ...(o.archive ? ['--archive', o.archive] : [])];
  const child = spawn(NODE, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LC_ALL: 'C' } });
  let out = '';
  let err = '';
  let sampling = false;
  let outsidePeak = 0;
  let sampler: Promise<void> = Promise.resolve();
  child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString('utf8');
    if (!sampling && out.includes('"at":"start"')) {
      sampling = true;
      sampler = (async () => {
        while (sampling) {
          outsidePeak = Math.max(outsidePeak, await ps(child.pid!));
          await new Promise((r) => setTimeout(r, 10));
        }
      })();
    }
    if (out.includes('"at":"end"')) sampling = false;
  });
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  sampling = false;
  await sampler;
  const line = out.trim().split('\n').reverse().find((l) => l.includes('"at":"result"'));
  if (code !== 0 || !line) throw Error(`BLOCKED: the measured pass exited ${code}: ${err.slice(-2000)}`);
  const r = JSON.parse(line) as Omit<PassResult, 'outsidePeak' | 'load'>;
  const peakRss = Math.max(r.peakRss, outsidePeak);
  return { ...r, peakRss, rise: peakRss - r.rssStart, outsidePeak, load: { start: loadStart, end: loadavg()[0]! } };
}

/** A copy of a home for one run: an APFS clone on macOS, so each run starts from the same bytes at no cost. */
export function cloneHome(from: string, to: string): void {
  const r = spawnSync('cp', process.platform === 'darwin' ? ['-cR', from, to] : ['-R', from, to], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`BLOCKED: couldn't copy ${from}: ${r.stderr}`);
}

/** The perf lane's judge of one limit on five runs after a warm-up. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<{ status: string; reason?: string; margin?: number }> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => unknown; judgeLimit: (o: unknown) => { status: string; reason?: string; margin?: number } };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
export const mb = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

/** Judges each limit; fails on any FAIL, and on anything else but PASS as INCONCLUSIVE, never a pass. */
export async function judgeAll(limits: { name: string; limit: number; runs: number[]; shown: string[] }[], loads: { start: number; end: number }[]): Promise<void> {
  const failed: string[] = [];
  const open: string[] = [];
  for (const l of limits) {
    const j = await judgeLimit(l.limit, l.runs, loads);
    const said = `${l.name}: ${l.shown.join('; ')} → ${j.status}${j.reason ? ` (${j.reason})` : ''}`;
    console.log(said);
    if (j.status === 'FAIL') failed.push(said);
    else if (j.status !== 'PASS') open.push(said);
  }
  if (failed.length) expect.fail(`FAIL: ${[...failed, ...open].join(' | ')}`);
  if (open.length) expect.fail(`INCONCLUSIVE: ${open.join(' | ')}; this is not a pass`);
}
