// Test-side tools for the #860 acceptance tests (README: The surface). They build `deep-logic` (#534's helper) and #533's
// assembler (#555's helper, from a copy), assemble the story and the puzzle against the layouts the logic module's own
// `check` reports, send JSON lines to `deep-logic [--planted <name>]...`, read its replies and judge them by the issue's
// numbers. Every hash, array, track and refusal read here is the implementation's own; the expected values are the
// issue's and this suite's fixtures' (programs.ts). Nothing stands in for the logic module. Processes are cargo's and
// `deep-logic`'s, each waited for by spawnSync; nothing is stopped by name or port.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect } from 'vitest';
import { bakeOf, logicBin, openedOf, prebuild, replies, savesDir, start, type Bake, type Opened, type StepRecord } from '../534/helpers.ts';
import { assemble, type Program } from '../555/helpers.ts';
import { blocked, macOnly, none, show } from '../184/helpers.ts';
import { PRIVATE, PUZZLE, PUZZLE_READS, PUZZLE_WRITES, READS_AT, STORY, STORY_READS, STORY_WRITES, WRITES_AT, puzzlePiece, puzzleText, storyPiece, storyText, type Obj } from './programs.ts';

export { blocked, logicBin, macOnly, none, prebuild, savesDir, show };
export type { Bake, Obj, Opened, Program, StepRecord };

/** Each criterion's ID (scripts/proof-change.mjs: `#860.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = { 1: '#860.6adcae15', 2: '#860.e18a3535', 3: '#860.af17db8f', 4: '#860.5892cccc', 5: '#860.08c1702c' } as const;
/** Every test passes this timeout (90 minutes): a cold build of the replica or the app takes many minutes on a loaded Mac. */
export const TIMEOUT = 5_400_000;

// ---------------------------------------------------------------------------------------------------
// Cargo and `deep-logic`

const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
/** Cargo that can't run is BLOCKED, never a pass (README: Run them). */
export function cargoRuns(): void {
  const env = { ...process.env, ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}) };
  const r = spawnSync('cargo', ['--version'], { encoding: 'utf8', env });
  if (r.error || r.status !== 0) blocked(`cargo could not run (${r.error?.message ?? r.stderr.trim()}); this suite builds deep-logic, deep-drive, deep-show and #533's assembler. Unblock: install rustup's cargo`);
}

/** README, Planted twins: each one criterion's wrong rewind, reachable only through `deep-logic --planted <name>`. */
export type Planted = 'rewind_restores_arrays_only' | 'rewind_clears_seen';
/** `calls` through one `deep-logic [--planted p]...` process, which then exits: one reply each, in order. */
export function logic(calls: Obj[], planted: Planted[] = []): Obj[] {
  const args = planted.flatMap((p) => ['--planted', p]);
  return replies(start(logicBin(), args, calls as never), calls as never, `deep-logic ${args.join(' ')}`.trim()) as Obj[];
}

// ---------------------------------------------------------------------------------------------------
// The programs, built against the layout `check` reports for each piece (a probe program first, built for no layout).

const PROBE = `(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT})) (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`;
/** Each region entry's absolute address in the item's memory, by name, from the logic module's own `check`. */
function addresses(piece: Obj, item: string, reads: string[], writes: string[]): Record<string, number> {
  const [reply] = logic([{ call: 'check', piece }]);
  expect(reply!['ok'], `deep-logic check takes the ${item} probe's piece: ${show(reply)}`).toBe(true);
  const entries = reply!['items']?.[item]?.['layout']?.['entries'] as { region: string; name: string; offset: number; size: number }[] | undefined;
  expect(Array.isArray(entries), `check reports ${item}'s region map: ${show(reply)}`).toBe(true);
  const out: Record<string, number> = {};
  for (const [region, names, base] of [['reads', reads, READS_AT], ['writes', writes, WRITES_AT]] as const) {
    for (const name of names) {
      const e = entries!.find((x) => x.region === region && x.name === name);
      expect(e, `${item}'s region map has the ${region} entry ${name}: ${show(entries)}`).toBeDefined();
      out[name] = base + e!.offset;
    }
    const end = Math.max(0, ...entries!.filter((x) => x.region === region).map((x) => x.offset + x.size));
    expect(base + end, `${item}'s ${region} region ends before the next region`).toBeLessThanOrEqual(region === 'reads' ? WRITES_AT : PRIVATE);
  }
  return out;
}
let story: Program | undefined;
/** The story (programs.ts), built for the region map `check` gives the story's piece. */
export function storyProgram(): Program {
  if (story) return story;
  const probe = assemble('story860probe', PROBE);
  const a = addresses(storyPiece(probe, { seen: true, saves: true }), STORY, STORY_READS, Object.keys(STORY_WRITES));
  story = assemble('story860',storyText({ next: a['next']!, choose: a['choose']!, skip: a['skip']!, save: a['save']!, line: a['line']!, text: a['text']!, stop: a['stop']!, choices: a['choices']!, seen: a['seen']!, request: a['request']! }));
  return story;
}
let puzzle: Program | undefined;
/** The puzzle (programs.ts), built for the region map `check` gives the puzzle's piece. */
export function puzzleProgram(): Program {
  if (puzzle) return puzzle;
  const probe = assemble('puzzle860probe', PROBE);
  const a = addresses(puzzlePiece(probe), PUZZLE, PUZZLE_READS, Object.keys(PUZZLE_WRITES));
  puzzle = assemble('puzzle860',puzzleText({ move: a['move']!, board: a['board']!, moves: a['moves']!, stop: a['stop']! }));
  return puzzle;
}

// ---------------------------------------------------------------------------------------------------
// Calls (#531's, #532's and #534's, with the README's additions)

export const bakeCall = (piece: Obj, track: Obj[], steps: number, extra: Obj = {}): Obj => ({ call: 'bake', piece, track, steps, ...extra });
export const determinismCall = (piece: Obj, track: Obj[], steps: number, atTimes: number[]): Obj => ({ call: 'determinism', piece, track, steps, at_times: atTimes });
export const openCall = (piece: Obj, track: Obj[]): Obj => ({ call: 'open', piece, track });
export const stepCall = (session: string, to: number): Obj => ({ call: 'step', session, to });
export const appendCall = (session: string, entry: Obj): Obj => ({ call: 'append', session, entry });
export const openSaveCall = (piece: Obj, savesDir: string, slot: number, track: Obj[], steps: number): Obj => ({ call: 'open_save', piece, saves_dir: savesDir, slot, track, steps });

/** README, The surface: a closed branch, by the step of the stop its rewind returned to and the rewind's own step. */
export interface Closed { stop: number; rewind: number }
/** A reply's `closed` (README, The surface), checked to be a list of {stop, rewind}. */
export function closedIn(run: { raw: Obj }, what: string): Closed[] {
  const v = run.raw['closed'];
  expect(Array.isArray(v), `${what}: closed lists the closed branches (README, The surface), got ${show(v, 400)}`).toBe(true);
  return (v as Obj[]).map((c, i) => {
    expect(Number.isSafeInteger(c?.['stop']) && Number.isSafeInteger(c?.['rewind']), `${what}: closed[${i}] is {stop, rewind}, got ${show(c, 300)}`).toBe(true);
    return { stop: c['stop'] as number, rewind: c['rewind'] as number };
  });
}
/** A bake that ran (#531's Bake, #534's reader), with the track it read. */
export interface Baked extends Bake { track: Obj[]; raw: Obj }
export function baked(reply: Obj, what: string): Baked {
  const b = bakeOf(reply as never, what);
  expect(Array.isArray(reply['track']), `${what}: track lists the entries the bake read`).toBe(true);
  return { ...b, track: reply['track'] as Obj[], raw: reply };
}
/** An opened save (#534's Opened). */
export interface OpenedSave extends Opened { raw: Obj }
export function openedSave(reply: Obj, what: string): OpenedSave {
  return { ...openedOf(reply as never, what), raw: reply };
}

/** What a run reports of its steps and checkpoints: a bake's, or an opened save's. */
export type Run = Pick<Bake, 'steps' | 'checkpoints'>;
/** A value an array path holds in a step record: its first value. */
const first = (v: unknown): number => Number(Array.isArray(v) ? v[0] : v);
export const recordAt = (b: Run, k: number): StepRecord | undefined => b.steps.find((s) => s.step === k);
/** The story's line, text, choices and seen a step left, or null when no step ran there. */
export function shownAt(b: Run, k: number): { line: number; text: number; choices: number[]; seen: number[] } | null {
  const r = recordAt(b, k);
  if (!r) return null;
  const a = r.arrays;
  return { line: first(a[`${STORY}.line`]), text: first(a[`${STORY}.text`]), choices: (a[`${STORY}.choices`] ?? []).map(Number), seen: (a[`${STORY}.seen`] ?? []).map(Number) };
}
const sortedArrays = (r: StepRecord): string => JSON.stringify(Object.entries(r.arrays).sort(([x], [y]) => (x < y ? -1 : 1)));

// ---------------------------------------------------------------------------------------------------
// The judgements (the test's own)

/**
 * Two runs of the story after step `from`: every step that ran after it (each item's step hash and every array) and
 * every checkpoint after it (each full-state hash) must be the same. Each failure starts with `named`, then names the
 * step or checkpoint that differs first and the line each run shows there.
 */
export function sameAfter(a: Run, b: Run, o: { item: string; from: number; named: string; names: [string, string] }): string[] {
  const [an, bn] = o.names;
  const lineOf = (r: StepRecord | undefined): string => (r && r.arrays[`${o.item}.line`] !== undefined ? `line ${first(r.arrays[`${o.item}.line`])}` : 'no line');
  const failures: string[] = [];
  const x = a.steps.filter((s) => s.step > o.from);
  const y = b.steps.filter((s) => s.step > o.from);
  if (!y.length) failures.push(`${o.named}: ${bn} ran no step after it`);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (!p || !q || p.step !== q.step) {
      failures.push(`${o.named}: ${an} ran step ${p?.step ?? 'none'} where ${bn} ran step ${q?.step ?? 'none'} (step ${i + 1} after it)`);
      break;
    }
    if (p.items[o.item]?.hash !== q.items[o.item]?.hash || sortedArrays(p) !== sortedArrays(q)) {
      failures.push(`${o.named}: at step ${p.step}, the first after it that differs, ${an} shows ${lineOf(p)} and ${bn} ${lineOf(q)} (step hashes ${p.items[o.item]?.hash} and ${q.items[o.item]?.hash})`);
      break;
    }
  }
  const cx = (a.checkpoints[o.item] ?? []).filter((c) => c.step > o.from);
  const cy = (b.checkpoints[o.item] ?? []).filter((c) => c.step > o.from);
  if (!cy.length) failures.push(`${o.named}: ${bn} took no checkpoint after it`);
  for (const step of [...new Set([...cx, ...cy].map((c) => c.step))].sort((m, n) => m - n)) {
    const hx = cx.filter((c) => c.step === step).map((c) => c.deep_hash);
    const hy = cy.filter((c) => c.step === step).map((c) => c.deep_hash);
    if (JSON.stringify(hx) !== JSON.stringify(hy)) {
      failures.push(`${o.named}: the full-state hash at checkpoint ${step} is ${hx.join(', ') || 'none'} in ${an} and ${hy.join(', ') || 'none'} in ${bn} (${lineOf(recordAt(a, step - 1))} against ${lineOf(recordAt(b, step - 1))})`);
      break;
    }
  }
  return failures;
}
/**
 * Criterion 1's comparison: a rewound run against a fresh play of its current branch, after the rewind. Each failure
 * names the stop the rewind returned to (its step and line).
 */
export const branchFailures = (rewound: Run, fresh: Run, o: { item: string; rewindAt: number; stop: { step: number; line: number } }): string[] =>
  sameAfter(rewound, fresh, { item: o.item, from: o.rewindAt, named: `the rewind at step ${o.rewindAt} to the stop at step ${o.stop.step} (line ${o.stop.line})`, names: ['the rewound run', 'the fresh play'] });

/**
 * Criterion 2's judgement of a run of `skippingStory`: at the first step after the rewind, `seen` holds every text the
 * closed branch read; the skip-read at step `skipAt` stops at the first unread line. Each failure names the line.
 */
export function seenFailures(run: Run, o:{ firstAfter: number; closedTexts: number[]; skipAt: number; firstUnread: { line: number; text: number } }): string[] {
  const failures: string[] = [];
  const after = shownAt(run, o.firstAfter);
  if (!after) failures.push(`no step ran at step ${o.firstAfter}, the option taken after the rewind`);
  else {
    const lacking = o.closedTexts.filter((t) => after.seen[t] !== 1);
    if (lacking.length) failures.push(`at step ${o.firstAfter}, the first after the rewind, seen lacks the text of line ${lacking.join(', line ')}, read on the closed branch`);
  }
  const skipped = shownAt(run, o.skipAt);
  if (!skipped) failures.push(`no step ran at step ${o.skipAt}, the skip-read`);
  else if (skipped.line !== o.firstUnread.line || skipped.text !== o.firstUnread.text) {
    failures.push(`the skip-read at step ${o.skipAt} stopped at line ${skipped.line} (text ${skipped.text}), not at line ${o.firstUnread.line} (text ${o.firstUnread.text}), the first line no branch has read`);
  }
  return failures;
}

/** A refusal (ok: false) and its code. */
export function refusedWith(reply: Obj, code: string, what: string): Obj {
  expect([reply['ok'], reply['code']], `${what} is refused with ${code}: ${show(reply, 800)}`).toEqual([false, code]);
  return reply;
}
