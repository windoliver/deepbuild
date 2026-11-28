// What a run is admitted on (#3220; design: Lease): its expected peak memory, taken as units of the host's `mem` pool
// in the same ask as its `cpu.slot`, and started only while the kernel reads at least that much memory available. A
// check's run on a key with three clean runs expects the 95th percentile of their peaks, as its expected time is the
// median of its last clean runs; one on a key with fewer expects what its check declares, or its class's constant. An
// agent's heavy command has no key, so its own last run never sets its next: its heavy.command@1 entry's number does,
// or its class's constant. What every run used is still recorded, read only off the supervisor's scan of its tree.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { contents, keyId, type KeyRows } from './shared-runs.js';
import type { Used } from '@deepbuild/supervisor';

/** The clean runs a key needs before its own peaks admit it (drafted). */
export const CLEAN_RUNS = 3;
/** How many of a key's last clean runs its percentile reads. */
const PEAKS_READ = 20;
/** Each class's constant, in MB, for a run with nothing better to go on (drafted): a check's 1 GB, and an agent's heavy command's 4 GB. */
export const CLASS_MB = { check: 1000, heavy: 4000 } as const;

type Basis = 'runs' | 'declared' | 'class';
/** What a run is admitted on: its expected peak in MB, what that came from, what its check declares and the key whose history it read. */
export interface Admission { mb: number; on: Basis; declared?: number; key?: string }

/** The nearest-rank 95th percentile: of three peaks, the highest. */
function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!;
}

/**
 * A run's expected peak: its key's last clean peaks once there are CLEAN_RUNS of them, else what it declares, else its
 * class's constant. A run with no key (an agent's heavy command) passes no peaks.
 */
export function admitOn(peaks: readonly number[], declared: number | undefined, constant: number): Admission {
  if (peaks.length >= CLEAN_RUNS) return { mb: Math.max(1, Math.round(p95(peaks.slice(-PEAKS_READ)))), on: 'runs' };
  if (declared !== undefined && declared > 0) return { mb: Math.round(declared), on: 'declared' };
  return { mb: constant, on: 'class' };
}

/**
 * Each key's clean runs' peaks in MB, newest last, by check and key, and by stem the path sets its keys hold: every
 * keyed run's, one that never carries among them, so a key's next run is admitted by its own history. A change to a
 * file a key holds makes another key, with no history of its own.
 */
export class KeyHistory {
  private readonly peaks = new Map<string, number[]>();
  private readonly sets = new Map<string, Map<string, readonly string[]>>();
  /** `read` gives what the record holds of a key or a stem that left memory (#1866). */
  constructor(private readonly read?: KeyRows) {}
  /** Reads what the record holds of a key and its stem where either left memory, so a run added to it joins the rest. */
  async ready(check: string, key: { id: string; stem: string }): Promise<void> {
    await Promise.all([this.peaksOf(check, key.id), this.pathsOf(key.stem)]);
  }
  /** A keyed run's place in its key's history: its path set under its stem, and its peak when it ran clean. */
  add(check: string, key: { id: string; stem: string; paths: readonly string[] }, peak: number | undefined): void {
    const sets = this.sets.get(key.stem) ?? new Map<string, readonly string[]>();
    const joined = key.paths.join('\0');
    if (!sets.has(joined)) sets.set(joined, key.paths);
    newest(this.sets, key.stem, sets);
    if (peak === undefined) return;
    const id = `${check}\0${key.id}`;
    const peaks = this.peaks.get(id) ?? [];
    peaks.push(peak);
    if (peaks.length > PEAKS_READ) peaks.shift();
    newest(this.peaks, id, peaks);
  }
  /** The key a check's files in `dir` make under `stem`, and its clean peaks: the one with the most when several match. */
  async of(check: string, stem: string, dir: string): Promise<{ key?: string; peaks: number[] }> {
    let found: { key?: string; peaks: number[] } = { peaks: [] };
    for (const paths of (await this.pathsOf(stem)).values()) {
      const id = keyId(stem, paths, await contents(dir, paths));
      const peaks = await this.peaksOf(check, id);
      if (peaks.length && peaks.length >= found.peaks.length) found = { key: id, peaks: [...peaks] };
    }
    return found;
  }
  /** A key's clean peaks, from the record when it left memory. */
  private async peaksOf(check: string, key: string): Promise<number[]> {
    const id = `${check}\0${key}`;
    const known = this.peaks.get(id);
    if (known || !this.read) return known ?? [];
    const rows = await this.read.key(key).catch(() => []);
    const peaks = rows.flatMap((r) => { const peak = r.check === check ? cleanPeak(r.outcome, r.used) : undefined; return peak === undefined ? [] : [peak]; }).slice(-PEAKS_READ);
    if (peaks.length) newest(this.peaks, id, this.peaks.get(id) ?? peaks);
    return this.peaks.get(id) ?? peaks;
  }
  private async pathsOf(stem: string): Promise<Map<string, readonly string[]>> {
    const known = this.sets.get(stem);
    if (known || !this.read) return known ?? new Map();
    const read = new Map<string, readonly string[]>((await this.read.paths(stem).catch(() => [])).map((paths) => [paths.join('\0'), paths]));
    const sets = this.sets.get(stem) ?? read;
    newest(this.sets, stem, sets);
    return sets;
  }
}
/** How many keys and stems the history keeps in memory (#1866): the newest, the rest the record's. */
const HISTORY_KEPT = 64;
function newest<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) { if (map.size <= HISTORY_KEPT) break; map.delete(oldest); }
}
/** A clean run's peak memory, the one its key's next runs are admitted by (#3220): a passed run's, as the scan read it; none for any other. */
export const cleanPeak = (outcome: string, used: Used | undefined): number | undefined => (outcome === 'passed' && typeof used?.memory_peak_mb === 'number' ? used.memory_peak_mb : undefined);

/**
 * The memory available on the host, in MB, as #2980 reads it: on macOS the kernel's own measure,
 * kern.memorystatus_level, the percentage of memory free, of the whole; on Linux MemAvailable. Read at most once a
 * second, off the event loop; undefined with no reading, which holds nothing back.
 */
let read: { at: number; mb: number | undefined } | undefined;
let reading: Promise<number | undefined> | undefined;
export async function availableMb(now = Date.now()): Promise<number | undefined> {
  // DEEP_TEST_MEMORY_AVAILABLE_FILE names a file holding the reading in MB instead, read each time (tests only).
  const file = process.env.DEEP_TEST_MEMORY_AVAILABLE_FILE;
  if (file) {
    try { const mb = Number(readFileSync(file, 'utf8').trim()); return Number.isFinite(mb) && mb >= 0 ? mb : undefined; } catch { return undefined; }
  }
  if (read && now - read.at < 1000) return read.mb;
  if (process.platform === 'linux') {
    let mb: number | undefined;
    try {
      const kb = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]);
      if (kb > 0) mb = Math.floor(kb / 1024);
    } catch { /* no reading */ }
    read = { at: now, mb };
    return mb;
  }
  if (process.platform !== 'darwin') return undefined;
  reading ??= new Promise<number | undefined>((resolve) => execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level'], { encoding: 'utf8', timeout: 2000 }, (error, out) => {
    reading = undefined;
    const level = Number(out.trim());
    const mb = error || !out.trim() || !(level >= 0 && level <= 100) ? undefined : Math.floor((level * totalmem()) / 100 / 2 ** 20);
    read = { at: now, mb };
    resolve(mb);
  }));
  return reading;
}
