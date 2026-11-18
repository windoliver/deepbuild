// A playtest's soak (#1048; Check input: playtest): one long run of a named bot that reads, every `every` steps, the
// size of the piece's logic memories and the window's p99 step time, against the brief's limits, failing
// playtest.soak at the first window over a limit, naming the measure, the window and the value. A step time counts
// only on a reference Mac (Every task carries its own budgets); elsewhere it's a reading. A save's size is read only
// when the play interface names a save action, and game.play@1 names none yet, so the save limit reads nothing.
import { spawnSync } from 'node:child_process';
import type { PlayAnswer } from './types.ts';

export interface Window { window: number; from: number; to: number; memory: number; p99_ms: number }

const MIB = 1024 * 1024;

/** The p99 of a list of step times in ns, in ms. */
function p99(ns: number[]): number {
  if (!ns.length) return 0;
  const sorted = [...ns].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)]! / 1e6;
}

/** The soak's windows from its run, each with its logic memories' size and its p99 step time. Window n, from 1, holds steps (n − 1) × every to n × every − 1, each measure read at its last step. */
export function windowsOf(answer: PlayAnswer, every: number): Window[] {
  return (answer.memory ?? []).map((m, w) => {
    const from = w * every;
    return { window: w + 1, from, to: m.step, memory: m.bytes, p99_ms: p99(answer.step_times.slice(from, m.step + 1)) };
  });
}

/** Whether this Mac is one of the design's reference Macs, where a soak's step limit counts. */
let reference: boolean | undefined;
export function onReferenceMac(): boolean {
  if (reference !== undefined) return reference;
  if (process.platform !== 'darwin') return (reference = false);
  const sysctl = (key: string): string => spawnSync('sysctl', ['-n', key], { encoding: 'utf8' }).stdout.trim();
  const macs: Record<string, { gb: number; cores: string }> = { 'Mac15,7': { gb: 36, cores: '12' }, 'Mac15,12': { gb: 16, cores: '8' } };
  const mac = macs[sysctl('hw.model')];
  return (reference = !!mac && sysctl('hw.memsize') === String(mac.gb * 2 ** 30) && sysctl('hw.ncpu') === mac.cores);
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/** The first window over a limit, as playtest.soak's words, or nothing. */
export function soakFailure(name: string, windows: Window[], limits: { memory?: number; step?: number }, stepCounts: boolean): string | undefined {
  for (const w of windows) {
    const over: string[] = [];
    if (limits.memory !== undefined && w.memory > limits.memory * MIB) over.push(`memory is ${w.memory / MIB} MiB, over its limit of ${limits.memory} MiB`);
    if (stepCounts && limits.step !== undefined && w.p99_ms > limits.step) over.push(`step's p99 is ${w.p99_ms} ms, over its limit of ${limits.step} ms`);
    if (over.length) return `playtest.soak: ${name}: in window ${w.window} (steps ${fmt(w.from)} to ${fmt(w.to)}), ${over.join('; ')}`;
  }
  return undefined;
}
