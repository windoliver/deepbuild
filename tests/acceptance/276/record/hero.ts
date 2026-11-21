// This suite's piece (README: Fixtures): `hero`, one logic item at 60 Hz that keeps a player's xp and look in its
// profile record, as a logic program in WebAssembly text built against the item's region map as `deep-logic`'s
// `check` reports it; its stage assets; the sessions that start it in the app; and the pieces past and at the cap.
// Every program exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and
// `writes_at` (Logic `logic@1`: Exports) and keeps to the logic subset. Expected values are this file's own
// functions of the step and of what step 0 read, never read from a run.

import { expect } from 'vitest';
import {
  assemble, check, entry, isObject, limited, logic, profileOpened, sha256, show, stepped, str,
  type Checked, type JsonObject, type JsonValue, type Planted, type ProfileOpened, type Program, type StepRecord, type Stepped,
} from './helpers.ts';

export const HERO = 'hero';
export const SEED = 276_01;
/** A step at 60 Hz, in flicks (705,600,000 a second). */
export const STEP_FLICKS = 705_600_000 / 60;

/** The profile's shape: `look`'s count and `stash`'s (none in the small piece). */
export interface Shape { look: number; stash: number }
/** The piece of criteria 1, 2 and 5: xp and a look of 4 values. */
export const SMALL: Shape = { look: 4, stash: 0 };
/** Criterion 2's changed count: the look of 6 values. */
export const WIDER: Shape = { look: 6, stash: 0 };
/** Criteria 3 and 6: a stash of 1,024 values beside them, so a record holds over 4 KiB of numbers that don't
 * compress, and a write past one block of `ulimit -f 1` (512 or 1,024 bytes) is cut short. */
export const BIG: Shape = { look: 4, stash: 1024 };

/** xp after step k of a run whose step 0 read `base` (0 without a record): base + ⌊4k / 3⌋, so 1,200 at step 900
 * from 0 and 2,000 at step 600 from 1,200. */
export const xpAt = (base: number, k: number): number => base + Math.floor((4 * k) / 3);
/** The look a run writes without a record: 10, 20, 30, …; with one, the look it reopened. */
export const defaultLook = (n: number): number[] => Array.from({ length: n }, (_, i) => 10 * (i + 1));

type Writes = Record<string, { type: 'i32'; count?: number }>;
/** The item's writes: its profile's arrays (xp, look, stash), its request array, and what step 0 read from the
 * profile's read entry (got_flag: the u32; got_xp; got_look). */
export function writesOf(s: Shape): Writes {
  return {
    xp: { type: 'i32' }, look: { type: 'i32', count: s.look }, ...(s.stash ? { stash: { type: 'i32' as const, count: s.stash } } : {}),
    request: { type: 'i32' }, got_flag: { type: 'i32' }, got_xp: { type: 'i32' }, got_look: { type: 'i32', count: s.look },
  };
}
/** The design's field (Logic: saves): the record's arrays, in this order, and the request array. */
export function profileOf(s: Shape): JsonObject {
  return {
    arrays: { xp: { type: 'i32', count: 1 }, look: { type: 'i32', count: s.look }, ...(s.stash ? { stash: { type: 'i32', count: s.stash } } : {}) },
    request: 'request',
  };
}

/** The stage assets (data assets the item names, its content): the first stage, and the new one criterion 2 adds. */
export const STAGE_1 = Buffer.from('stage 1: the moor, 12 rooms, 3 shrines; made by the #276 acceptance tests (CC0)\n', 'utf8');
export const STAGE_2 = Buffer.from('stage 2: the keep, 9 rooms, 1 gate; made by the #276 acceptance tests (CC0)\n', 'utf8');

// ---------------------------------------------------------------------------------------------------
// Programs

const W = 16384;
const STATE = 32768;
const ASSETS_AT = 49152;
/** The hero's init writes this over the profile's read entry, so a module that leaves the entry unfilled shows it. */
export const GARBAGE = 0xa5a5a5a5 | 0;

/** A program built for no layout: `check` of an item naming it reports the item's region map. */
const probe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
/** The region map `check` gives the hero's item with this profile shape (its `rest` control read, its writes and
 * its `profile`): the first call each test makes. */
export function regions(s: Shape): Checked {
  return check({
    seed: 276, controls: { rest: { kind: 'slider' } },
    items: { probe: { kind: 'logic@1', params: { program: probe().sha, reads: ['rest'], writes: writesOf(s) as unknown as JsonObject, profile: profileOf(s) } } },
    assets: { [probe().sha]: probe().bytes.toString('base64') },
  }, `check of a layout probe with profile ${JSON.stringify(profileOf(s)['arrays'])}`)['probe']!;
}

/**
 * The hero (every criterion here). Its init writes GARBAGE over the profile's read entry. At step 0 it copies the
 * entry's u32 and its xp and look into its state at 32768. Every step k writes xp = (xp read) + ⌊4k / 3⌋; look = the
 * look read when the u32 was 1, else 10, 20, 30, …; got_flag, got_xp and got_look = what step 0 read; request = 1
 * when the step reads an entry of the `rest` control (a rest point the player reaches), else 0; and, with a stash,
 * stash[i] = a 32-bit mix of xp + i. It reads its stage assets at `assets_at` not at all: they are content only.
 */
export function hero(c: Checked, s: Shape): Program {
  const p = entry(c, 'reads', 'profile');
  const rest = entry(c, 'reads', 'rest').offset;
  const w = (n: string): number => W + entry(c, 'writes', n).offset;
  const stash = s.stash ? `
    (local.set $i (i32.const 0))
    (block $sdone (loop $seach
      (br_if $sdone (i32.ge_u (local.get $i) (i32.const ${s.stash})))
      (local.set $x (i32.mul (i32.add (local.get $xp) (local.get $i)) (i32.const ${0x9e3779b1 | 0})))
      (local.set $x (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 16))))
      (local.set $x (i32.mul (local.get $x) (i32.const ${0x85ebca6b | 0})))
      (local.set $x (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 13))))
      (i32.store (i32.add (i32.const ${w('stash')}) (i32.shl (local.get $i) (i32.const 2))) (local.get $x))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $seach)))` : '';
  return assemble(`hero_${s.look}_${s.stash}_${p.offset}_${p.size}_${rest}_${w('xp')}_${w('request')}`, `
(module
  (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const ${p.size})))
      (i32.store (i32.add (i32.const ${p.offset}) (local.get $i)) (i32.const ${GARBAGE}))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $each))))
  (func $step (export "step") (param $k i64) (local $i i32) (local $x i32) (local $flag i32) (local $base i32) (local $xp i32)
    (if (i64.eqz (local.get $k)) (then
      (memory.copy (i32.const ${STATE}) (i32.const ${p.offset}) (i32.const ${8 + 4 * s.look}))))
    (local.set $flag (i32.load (i32.const ${STATE})))
    (local.set $base (i32.load (i32.const ${STATE + 4})))
    (local.set $xp (i32.add (local.get $base) (i32.wrap_i64 (i64.div_u (i64.mul (local.get $k) (i64.const 4)) (i64.const 3)))))
    (i32.store (i32.const ${w('xp')}) (local.get $xp))
    (i32.store (i32.const ${w('got_flag')}) (local.get $flag))
    (i32.store (i32.const ${w('got_xp')}) (local.get $base))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const ${s.look})))
      (local.set $x (i32.load (i32.add (i32.const ${STATE + 8}) (i32.shl (local.get $i) (i32.const 2)))))
      (i32.store (i32.add (i32.const ${w('got_look')}) (i32.shl (local.get $i) (i32.const 2))) (local.get $x))
      (i32.store (i32.add (i32.const ${w('look')}) (i32.shl (local.get $i) (i32.const 2)))
        (select (local.get $x) (i32.mul (i32.add (local.get $i) (i32.const 1)) (i32.const 10)) (local.get $flag)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const ${w('request')}) (i32.ne (i32.load (i32.const ${rest})) (i32.const 0)))${stash}))`);
}

// ---------------------------------------------------------------------------------------------------
// The piece, its track and its sessions in the app

/** The hero's piece as `deep-logic` takes it: the `rest` control, the item with its profile and stage assets, and
 * `more` assets carried beside them (a check's fixture record). */
export function heroPiece(program: Program, s: Shape, stages: Buffer[], more: Buffer[] = []): JsonObject {
  const assets: JsonObject = { [program.sha]: program.bytes.toString('base64') };
  for (const b of [...stages, ...more]) assets[sha256(b)] = b.toString('base64');
  return {
    seed: SEED, controls: { rest: { kind: 'slider' } },
    items: { [HERO]: { kind: 'logic@1', params: { program: program.sha, reads: ['rest'], writes: writesOf(s) as unknown as JsonObject, checkpoint: { every: 60 }, profile: profileOf(s), assets: stages.map((b) => sha256(b)) } } },
    assets,
  };
}
/** The piece of a shape with stage 1 (and `stages` if given), its program built against its region map. */
export const piece = (s: Shape, stages: Buffer[] = [STAGE_1]): JsonObject => heroPiece(hero(regions(s), s), s, stages);

/** The player reaches a rest point at step k: an entry of the `rest` control, of yours, on the step. */
export const rest = (k: number): JsonObject => ({ t: k * STEP_FLICKS, seq: 0, control: 'rest', value: 1, writer: 'you', player: 1 });

/** `open`: the piece starts in the app, its records kept in `dir` (README: open); `fresh` is start fresh. */
export const openCall = (p: JsonObject, dir: string, track: JsonObject[], fresh = false): JsonObject =>
  ({ call: 'open', piece: p, saves_dir: dir, track: track as JsonValue, ...(fresh ? { fresh: true } : {}) });

/** One session of the app in its own process: the piece started with its records in `dir`, run through step `to`,
 * then closed (the process exits). */
export interface Session { opened: ProfileOpened; run: Stepped }
export function session(p: JsonObject, dir: string, to: number, track: JsonObject[], what: string, o: { fresh?: boolean; planted?: Planted | undefined } = {}): Session {
  const [open, step] = logic([openCall(p, dir, track, o.fresh), { call: 'step', session: 's1', to }], what, o.planted);
  const opened = profileOpened(open!, `${what}: open`);
  expect(str(open!['session'], `${what}: open.session`), `${what}: the first session a process opens is s1 (#531's)`).toBe('s1');
  const run = stepped(step!, `${what}: step to ${to}`);
  expect(run.steps.map((s) => s.step), `${what}: the session runs steps 0 to ${to}`).toEqual(Array.from({ length: to + 1 }, (_, k) => k));
  return { opened, run };
}

/**
 * A session whose record's write is cut short (README: A write cut short): the piece started with its records in
 * `dir` in a process under a file-size limit of one block (`ulimit -f 1`), run to step k − 1, then through step k, whose
 * rest point asks for a record of over 4 KiB. The process is stopped by the kernel (SIGXFSZ) in the write, or the
 * write fails; either way no reply lists the record as written whole. What its start reopened.
 */
export function cutShort(p: JsonObject, dir: string, track: JsonObject[], k: number, what: string, fresh = false): ProfileOpened {
  const r = limited([openCall(p, dir, track, fresh), { call: 'step', session: 's1', to: k - 1 }, { call: 'step', session: 's1', to: k }]);
  const why = `${what} (status ${String(r.status)}, signal ${String(r.signal)}; stdout ${r.stdout.slice(0, 600)}; stderr ${r.stderr.slice(-600)})`;
  expect(r.replies.length, `${why}: the session opens and runs to step ${k - 1} under the limit`).toBeGreaterThanOrEqual(2);
  const opened = profileOpened(r.replies[0]!, `${what}: open`);
  expect(stepped(r.replies[1]!, `${what}: step to ${k - 1}`).profiles, `${what}: no record is asked for before step ${k}`).toEqual([]);
  const third = r.replies[2];
  const listed = third !== undefined && third['ok'] !== false && Array.isArray(third['profiles'])
    && third['profiles'].some((x) => isObject(x) && x['ok'] !== false && typeof x['hash'] === 'string');
  expect(listed, `${why}: the record asked for at step ${k} is cut short past one block, never listed as written whole`).toBe(false);
  expect(r.signal === 'SIGXFSZ' || third !== undefined, `${why}: the cut-short write stops the process (SIGXFSZ) or fails with a reply`).toBe(true);
  return opened;
}

/** What a step read at step 0 and wrote, as the hero writes it. */
export interface Read { flag: unknown; xp: unknown; look: unknown; xpNow: unknown; lookNow: unknown }
export function readAt(s: StepRecord | undefined): Read {
  const a = (n: string): JsonValue[] | undefined => s?.arrays[`${HERO}.${n}`];
  return { flag: a('got_flag')?.[0], xp: a('got_xp')?.[0], look: a('got_look'), xpNow: a('xp')?.[0], lookNow: a('look') };
}
/** What step 0 reads with a record of xp `xp` and look `look`. */
export const readWith = (xp: number, look: number[]): Read => ({ flag: 1, xp, look, xpNow: xp, lookNow: look });
/** What step 0 reads without one: a u32 0 and zeros, never the garbage init left there. */
export const readWithout = (n: number): Read => ({ flag: 0, xp: 0, look: Array.from({ length: n }, () => 0), xpNow: 0, lookNow: defaultLook(n) });
export const stepZero = (r: Stepped): StepRecord | undefined => r.steps.find((s) => s.step === 0);
export const showRead = (r: Read): string => show(r as unknown as JsonValue, 400);

// ---------------------------------------------------------------------------------------------------
// The cap (criterion 6): a profile at 64 KiB of numbers and one past it

/** 64 KiB of numbers: the cap a profile is held to. */
export const CAP = 65_536;
const CAP_W = 131072;
/** A probe with room for a profile at the cap in both regions. */
const capProbe = (): Program => assemble('cap_probe', `
(module
  (memory (export "memory") 4 4)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${CAP_W}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
/** A piece whose profile holds xp (1 i32) and a stash of `n` i32: 4 + 4n bytes of numbers. */
export function capPiece(n: number): JsonObject {
  const pr = capProbe();
  return {
    seed: 276, items: {
      [HERO]: {
        kind: 'logic@1', params: {
          program: pr.sha, writes: { xp: { type: 'i32' }, stash: { type: 'i32', count: n }, request: { type: 'i32' } },
          profile: { arrays: { xp: { type: 'i32', count: 1 }, stash: { type: 'i32', count: n } }, request: 'request' },
        },
      },
    },
    assets: { [pr.sha]: pr.bytes.toString('base64') },
  };
}
