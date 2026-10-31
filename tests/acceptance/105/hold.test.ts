// AC1: no frame is captured without the shortcut held, over 200 synthetic presses; and the scope's hold rules: every
// frame of a hold is kept and the first lands within 100 ms, an indicator shows while it records, and a hold stops at
// `max` (120 s). The hold is read from the HID key-state table, which only the keyboard writes (#339's gate); a
// synthetic press is an event software posted, whatever source state and pid it carries. Through `deep-show run` with
// #400's two displays on the virtual display clock (README: The surface under test). At the base `deep-show` has no
// `capture` call and answers every scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, B, Driver, MS, PERIOD_B, SEC, at, capture, capturesOf, framesOf, hid, holdProblems, indicatorOf, newFeed, pick,
  storeFiles, synthetic, useFolders, useShow, type Planted,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();
const T0 = 2 * SEC;
const WORDS = 'The legend overlaps the chart on the second display';

/** The four forms of a synthetic press #339's probe made: posted by a process, forged as hardware, and the mixes. */
const FORMS = [
  { state: 0, pid: 4242, name: 'posted by pid 4242' },
  { state: 1, pid: 0, name: 'forged as the HID table with no poster' },
  { state: 0, pid: 0, name: 'combined-session state, no poster' },
  { state: 1, pid: 4242, name: 'HID state, posted by pid 4242' },
] as const;

describe('AC1 no frame is captured without the shortcut held, over 200 synthetic presses', () => {
  const PRESS0 = 3 * SEC;
  const GAP = 250 * MS;
  const PRESSES = 200;
  const ENDED = PRESS0 + PRESSES * GAP; // 53 s
  const DOWN = 60 * SEC;
  const UP = 64 * SEC;

  function run(planted?: Planted): string[] {
    const feeds = { a: newFeed('feedA'), b: newFeed('feedB') };
    const dir = dirs();
    const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
    const f: string[] = [];
    // You start a capture for alpha's ask and pick the second display in the system picker; then 200 synthetic
    // presses of the chord, 100 ms each, 250 ms apart, in four forms, with no key touched.
    const presses = Array.from({ length: PRESSES }, (_, i) => {
      const form = FORMS[i % 4]!;
      return [synthetic(PRESS0 + i * GAP, 'down', form.state, form.pid), synthetic(PRESS0 + i * GAP + 100 * MS, 'up', form.state, form.pid)];
    }).flat();
    const looks = Array.from({ length: 20 }, (_, k) => at('indicator', PRESS0 + k * 10 * GAP + 50 * MS));
    const r1 = d.step([capture(T0, ALPHA.id, WORDS), pick(T0 + 500 * MS, B.uuid), ...presses, ...looks, at('captures', ENDED + SEC)], `200 synthetic presses${planted ? ` (planted ${planted})` : ''}`);
    const lit = looks.map((_, k) => indicatorOf(r1[2 + presses.length + k], `the indicator during synthetic press ${k * 10 + 1}`)).filter((i) => i.system || i.app).length;
    if (lit > 0) f.push(`synthetic presses lit the indicator in ${lit} of 20 looks`);
    const caps = capturesOf(r1[r1.length - 1], 'captures after the presses');
    if (caps.length !== 1) f.push(`synthetic presses: ${caps.length} captures listed, not the one you started`);
    for (const c of caps) {
      if (c.frames !== 0) f.push(`synthetic presses captured ${c.frames} frame(s)`);
      if (c.asset !== null) f.push(`synthetic presses saved an asset ${c.asset.sha256}`);
      if (c.state !== 'armed') f.push(`synthetic presses left the capture ${c.state}, not armed and waiting for the hold`);
    }
    const early = storeFiles(dir.evidence);
    if (early.length > 0) f.push(`synthetic presses left ${early.length} file(s) in the evidence store: ${early.map((e) => e.path).join(', ')}`);

    // The control: the chord held on the keyboard for 4 s, with synthetic ups and downs inside the hold, which change
    // nothing (no event moves the gate; the HID table does).
    const r2 = d.step([
      hid(DOWN, 'down'), synthetic(61 * SEC, 'up', 1, 0), synthetic(61.5 * SEC, 'down', 0, 4242), synthetic(62 * SEC, 'up', 0, 4242),
      at('indicator', 62.25 * SEC), hid(UP, 'up'), at('indicator', UP + 500 * MS), at('captures', UP + SEC),
    ], `the chord held 4 s${planted ? ` (planted ${planted})` : ''}`);
    const during = indicatorOf(r2[4], 'the indicator during the hold');
    if (!during.system || !during.app) f.push(`the hold: the indicator during it is ${JSON.stringify(during)}, not both system and app`);
    const after = indicatorOf(r2[6], 'the indicator after the release');
    if (after.system || after.app) f.push(`the hold: the indicator after the release is ${JSON.stringify(after)}, not off`);
    const held = capturesOf(r2[7], 'captures after the hold');
    const saved = held.find((c) => c.asset !== null);
    if (!saved) { f.push(`the hold: no capture saved an asset (${JSON.stringify(held)})`); return f; }
    const file = storeFiles(dir.evidence).find((e) => e.sha === saved.asset!.sha256);
    if (!file) { f.push(`the hold: the asset ${saved.asset!.sha256} is not in the evidence store`); return f; }
    const frames = framesOf(file.bytes, 'the hold\'s recording');
    if (saved.frames !== frames.length) f.push(`the hold: captures says ${saved.frames} frames, the recording holds ${frames.length}`);
    for (const p of holdProblems(frames, B, feeds.b, DOWN, UP)) f.push(`the hold: ${p}`);
    return f;
  }

  it('AC1 after you pick the second display, 200 synthetic presses of the chord in four forms capture no frame, light no indicator and leave no asset; holding it on the keyboard for 4 s then records every frame of the hold, the first within 100 ms, with the indicator on', () => {
    expect(run(), 'only the held shortcut records').toEqual([]);
    // Wrong program: a gate that takes any press of the chord, synthetic ones too, as the hold.
    const twin = run('records_without_hold');
    expect(twin.some((m) => m.startsWith('synthetic presses')), `the planted records_without_hold fails, naming the synthetic presses: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 900_000);
});

describe('AC1 scope: a hold records at most 120 s', () => {
  const DOWN = 3 * SEC;
  const MAX = 120 * SEC;

  function run(planted?: Planted): string[] {
    const feeds = { a: newFeed('feedA'), b: newFeed('feedB') };
    const dir = dirs();
    const d = new Driver(show(), { ...dir, feeds, ...(planted ? { planted } : {}) });
    const r = d.step([
      capture(T0, ALPHA.id, WORDS), pick(T0 + 500 * MS, B.uuid), hid(DOWN, 'down'),
      at('indicator', DOWN + MAX - 500 * MS), at('indicator', DOWN + MAX + 500 * MS), at('captures', DOWN + MAX + SEC),
      hid(DOWN + 125 * SEC, 'up'), at('captures', DOWN + 126 * SEC),
    ], `a 125 s hold${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    const before = indicatorOf(r[3], 'the indicator at 119.5 s');
    if (!before.system || !before.app) f.push(`the indicator 119.5 s into the hold is ${JSON.stringify(before)}, not on`);
    const past = indicatorOf(r[4], 'the indicator at 120.5 s');
    if (past.system || past.app) f.push(`the indicator 120.5 s into the hold, still held, is ${JSON.stringify(past)}: recording past 120 s`);
    const at121 = capturesOf(r[5], 'captures at 121 s').find((c) => c.session === ALPHA.id);
    if (!at121?.asset) f.push(`121 s into the hold the capture is ${at121?.state ?? 'missing'} with no asset: not saved at 120 s`);
    const end = capturesOf(r[7], 'captures after the release').filter((c) => c.asset !== null);
    if (end.length !== 1) { f.push(`after the release ${end.length} captures have an asset, not 1`); return f; }
    const files = storeFiles(dir.evidence);
    if (files.length !== 1) f.push(`the evidence store holds ${files.length} files, not the one recording`);
    const file = files.find((e) => e.sha === end[0]!.asset!.sha256);
    if (!file) { f.push('the asset is not in the evidence store'); return f; }
    const frames = framesOf(file.bytes, 'the recording');
    const late = frames.filter((fr) => fr.vsync > DOWN + MAX);
    if (late.length > 0) f.push(`${late.length} frame(s) past 120 s into the hold, the first ${((late[0]!.vsync - DOWN) / SEC).toFixed(3)} s in`);
    const last = frames[frames.length - 1];
    if (!last || last.vsync < DOWN + MAX - PERIOD_B) f.push(`the last frame is ${last ? ((last.vsync - DOWN) / SEC).toFixed(3) : 'none'} s into the hold, not the last vsync before 120 s`);
    for (const p of holdProblems(frames.filter((fr) => fr.vsync <= DOWN + MAX), B, feeds.b, DOWN, DOWN + MAX)) f.push(p);
    return f;
  }

  it('AC1 a 125 s hold of the chord keeps every frame of its first 120 s and none after, turns the indicator off and saves the asset at 120 s while the chord is still held', () => {
    expect(run(), 'the hold stops at 120 s').toEqual([]);
    // Wrong program: a recorder that ignores `max` and keeps every frame while held.
    const twin = run('records_past_max');
    expect(twin.some((m) => /past 120 s/.test(m)), `the planted records_past_max fails, naming frames past 120 s: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 900_000);
});
