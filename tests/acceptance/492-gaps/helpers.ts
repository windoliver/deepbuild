// Test-side tools for the #492 gap tests: `deep-motion eval` and `deep-show run` built once per file, the scene the
// world clause sends, and the kit's report read just far enough to find one corpus case. Nothing here stands in for
// motion or the kit: every answer a test reads comes from a binary, every expected value from the issue and the design.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/492-gaps is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
export const fl = (s: number): number => Math.round(s * FLICKS);

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);

/** `cargo build --locked --bin <name>`, once per file; `bin()` fails the test with cargo's error when it failed. */
export function useBin(name: string): { bin: () => string } {
  let error = '';
  beforeAll(() => {
    const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
  }, 7_200_000);
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${name}`).toBe(''); return join(TARGET, 'debug', name); } };
}

// ---------------------------------------------------------------------------------------------------
// The world clause: `deep-motion eval` (README: The surface assumed, clause 1)

/** `deep-motion eval`, one document per line; the run exits 0 with one answer per line. */
export function evalDocs(bin: string, docs: JsonObject[]): JsonObject[] {
  const text = docs.map((doc) => JSON.stringify({ doc, times: [0, fl(3)] })).join('\n');
  const run = spawnSync(bin, ['eval'], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(run.error, `deep-motion eval ran: ${run.error?.message ?? ''}`).toBeUndefined();
  expect(run.status, `deep-motion eval exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '').map((l): JsonValue => JSON.parse(l) as JsonValue);
  expect(out.length, 'deep-motion eval: one answer per line').toBe(docs.length);
  return out.map((a, i) => obj(a, `answer ${i}`));
}

export const WORLD = 'pond_world';
export const REMAP = 'rewind_take';
/** The driver that reads the world. */
export const READ = 'fall_read';

/** The world that takes inputs: one poke, declared as `inputs: {ID → {kind, targets, and the kind's defaults}}`. */
export const POKE: JsonObject = { shove: { kind: 'poke', targets: ['ball'], impulse: 1 } };

/** A `physics.world@1` document, inlined under the scene's `worlds`; `inputs` is left out when undefined. */
export function world(inputs?: JsonObject): JsonObject {
  const out: JsonObject = {
    format: 1, id: WORLD, profile: 'world', title: 'Pond', description: 'One ball the scene reads.',
    capacity: { bodies: 1, shapes: 1, joints: 0, contacts: 8, particles: 0 },
    items: { ball: { id: 'ball', kind: 'body@1', name: 'Ball', order: 'a0', params: { kind: 'dynamic', shapes: [] } } },
  };
  if (inputs !== undefined) out['inputs'] = inputs;
  return out;
}

export const REVERSE: JsonValue = 'reverse';
/** A remap at half rate: the design's `map: channel (parent flick → child flick)`, 6 s of parent over 3 s of child. */
export const HALF_RATE: JsonValue = {
  type: 'f32',
  keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '6s', value: fl(3), interp: 'linear' } },
};

/**
 * A scene that lists one world. Placement `take` binds clip `slide` to `mover`, and the remap targets `take`. The driver
 * `fall_read` reads `<world ID>.occurrences` from `reader`, by default `mover`, so by default the remap's target reads
 * the world. With `reader: 'bystander'` an item outside the placement reads it instead.
 */
export function scene(id: string, listed: JsonObject, map: JsonValue, reader: 'mover' | 'bystander' = 'mover'): JsonObject {
  const rect = (rid: string, order: string, y: number): JsonObject => ({ id: rid, kind: 'rect@1', name: `Rect ${rid}`, order, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [0, y, 0] } });
  return {
    format: 1, id, profile: 'scene', title: `#492 ${id}`, description: `The #492 gap tests' document ${id}.`,
    transport: { span: '6s' },
    items: { mover: rect('mover', 'a0', 0), bystander: rect('bystander', 'a1', 40) },
    clips: {
      slide: {
        slots: { target: { type: 'rect@1', required: true } }, span: 'auto',
        channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '6s', value: 240, interp: 'linear' } } } },
      },
    },
    placements: { take: { clip: 'slide', slots: { target: 'mover' }, start: '0s' } },
    worlds: { [WORLD]: listed },
    drivers: { [READ]: { target: `items/${reader}/at/pos/1`, expr: 'count(hits)', vars: { hits: { list: `${WORLD}.occurrences` } } } },
    time_remaps: { [REMAP]: { target: 'take', map } },
  };
}

// ---------------------------------------------------------------------------------------------------
// The corpus clause: the kit through `deep-show run` (README: The surface assumed, clause 2)

export const CORPUS_NAME = 'replace-keeps-unkeyed';
export const CORPUS_FILE = join(REPO, 'crates', 'deep-show', 'kit-corpus', `${CORPUS_NAME}.json`);

export interface CorpusCase { module: string; verdict: string; part: JsonObject; raw: JsonObject }
export interface Kit { verdict: string; cases: CorpusCase[]; raw: JsonObject }

/**
 * The `kit` call of `scripts/canvas-kit.mjs`, in the same process setup, over the `migration` part alone and without
 * its `ledger`. `corpus` is added only where a test must read a changed copy; without it this is the default kit.
 */
export function kit(bin: string, corpus?: string): Kit {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-492-gaps-'));
  try {
    const call: JsonObject = { call: 'kit', parts: ['migration'], param_sets: 10 };
    if (corpus !== undefined) call['corpus'] = corpus;
    const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ evidence, calls: [call] })}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT, killSignal: 'SIGKILL' });
    expect(run.error, `deep-show run ran: ${run.error?.message ?? ''}`).toBeUndefined();
    expect(run.status, `deep-show run exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
    const answer = obj(JSON.parse((run.stdout ?? '').trim().split('\n')[0] ?? 'null') as JsonValue, 'the answer');
    expect(answer['ok'], `deep-show accepted the kit call: ${show(answer)}`).toBe(true);
    const reply = obj(arr(answer['replies'], 'replies')[0], 'the kit reply');
    const cases: CorpusCase[] = [];
    for (const [i, m] of arr(reply['modules'], 'modules').entries()) {
      const mod = obj(m, `modules[${i}]`);
      for (const [j, p] of arr(mod['parts'], `modules[${i}].parts`).entries()) {
        const part = obj(p, `modules[${i}].parts[${j}]`);
        if (part['part'] !== 'migration') continue;
        for (const c of arr(part['cases'], 'migration cases')) {
          const o = obj(c, 'a migration case');
          if (o['case'] === CORPUS_NAME) cases.push({ module: String(mod['module']), verdict: String(o['verdict']), part, raw: o });
        }
      }
    }
    return { verdict: String(reply['verdict']), cases, raw: reply };
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
