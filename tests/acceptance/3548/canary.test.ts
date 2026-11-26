// #3548.ca3e2d07 (criterion 5): "The canary sweep finds no scrubbed form in the kept log or in the bundle, with the
// canary's line placed last before the cut and first after it". With the Scope's third line: "What it reads is
// scrubbed as today, after the cut, so the cut never splits a line a value is on".
//
// The canaries are #19's sweep's (tests/acceptance/19/status/canary.test.ts): a scrub-list value, made at run time
// and given to `deep debug bundle` through DEEP_HUB_TEST_HELD, as the merge base reads it, and a pattern-shaped key, a
// GitHub token made at run time. The canary's line is one line of ~/.deepbuild/logs/hub.log that holds both, raw. The
// cut is the bundle's (README: Readings, The cut of criterion 5): the kept log is what the bundle keeps of the log.
//
// The run, with no hub (README: The canary at the cut):
//   1. A log of 10 MB of planted lines, no canary in it. `deep debug bundle`; the bundle's text of the log says where
//      the cut fell: its first whole line, and how much of the line before it kept (nothing, where the cut is at a
//      line's start). A bundle that left nothing out has no cut to place a line at, and the run says so.
//   2. Last before the cut: the same log, byte for byte but for the line before the first kept one, now the canary's
//      line, as long as the line it replaces. The value ends that line where the cut was at a line's start, and sits
//      across the cut where the reader had cut inside the line. `deep debug bundle` again, then the sweep.
//   3. First after the cut: the same with the canary's line as the first kept line, the value its first characters.
//      The bundle must still hold that line's own mark: it keeps the line and scrubs it.
// The sweep reads the bundle (its bytes, inflated, and every string in it) and every other file under ~/.deepbuild
// but the log the test wrote, for every form of the value (raw, URL-encoded, base64 at each offset), the raw key, and
// each one's two halves, which is what a cut through a value leaves. One line a hit, naming the file.

import { randomBytes } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  built, bundle, cleanup, everyForm, files, heldOf, makeHome, makeLog, mb, newTag, readBundle, shown, sweep, type Canary, type Cut, type Home, type Layout,
} from './helpers.ts';

afterEach(cleanup, 120_000);

const ID = '#3548.ca3e2d07';
const PLANT = 'bundle-cuts-by-bytes';
const SIZE = 10_000_000;
/** Every line of this log is 247 bytes or more, so the canary's line has room for the value, the key and its mark. */
const LEAST = 180;

/** The two canaries, each with its halves: a value on the scrub list (every form) and a key shaped like a GitHub token (raw). */
function canaries(): { value: string; key: string; list: Canary[] } {
  const value = `plum+${randomBytes(8).toString('hex')}=orchid/${randomBytes(3).toString('hex')}`;
  const key = `ghp_${randomBytes(27).toString('base64').replace(/[^A-Za-z0-9]/g, 'q').slice(0, 36)}`;
  const halves = (text: string) => [{ name: 'raw, its first half', text: text.slice(0, Math.floor(text.length / 2)) }, { name: 'raw, its second half', text: text.slice(Math.floor(text.length / 2)) }];
  return { value, key, list: [{ name: 'the scrub-list value', forms: [...everyForm(value), ...halves(value)] }, { name: 'the pattern-shaped key', forms: [{ name: 'raw', text: key }, ...halves(key)] }] };
}
/**
 * The canary's line, `length` characters: the value placed so that character `at` of the line is the first of its
 * second half where that fits, else as near as the line allows (`at` 0: the value starts the line; `at` the line's
 * length: it ends it). The key and the line's mark stand on whichever side has room, and dots fill the rest.
 */
function canaryLine(length: number, at: number, value: string, key: string, mark: string): string {
  const start = Math.max(0, Math.min(length - value.length, at - Math.floor(value.length / 2)));
  const words = `deep hub: canary line ${mark} ${key}`;
  const [left, right] = [start, length - start - value.length];
  if (left >= words.length + 2) return `${words} ${'.'.repeat(left - words.length - 2)} ${value}${'.'.repeat(right)}`;
  if (right >= words.length + 2) return `${'.'.repeat(left)}${value} ${words} ${'.'.repeat(right - words.length - 2)}`;
  throw Error(`BLOCKED: a line of ${length} characters has no room for the canary's value at ${start}, its key and its mark`);
}

interface Pass { problem: string | undefined; path: string | undefined; cut: Cut | undefined; marked: boolean }
/** `deep debug bundle` over the log as it stands: where its text of the log starts, and whether any string in it holds `mark`. */
async function pass(h: Home, env: Record<string, string>, layout: Layout, what: string, mark: string, swapped: ReadonlySet<number> = new Set()): Promise<Pass> {
  const made = await bundle(h, env, { timeoutMs: 600_000 });
  if (made.ran.code !== 0 || !made.path) return { problem: `${what}: deep debug bundle ${made.ran.code === 0 ? 'printed no bundle\'s path last' : 'didn\'t exit 0'}: ${shown(made.ran)}`, path: made.path, cut: undefined, marked: false };
  const b = readBundle(made.path);
  const held = heldOf(b, 'logs/hub.log', layout, swapped);
  const problem = b.tooBig ? `${what}: the bundle, ${mb(b.bytes)} on disk, inflates past 128 MiB` : !held.cut ? `${what}: the bundle holds no text of logs/hub.log: no string in it holds the log's last line and a whole line of it` : undefined;
  return { problem, path: made.path, cut: held.cut, marked: b.strings.some((s) => s.includes(mark)) };
}

interface SweepRun { placed: boolean; why: string; problems: string[]; hits: string[]; searched: number }
async function sweepRun(plant?: string): Promise<SweepRun> {
  const h = makeHome();
  const { value, key, list } = canaries();
  const scrubList = join(h.tmp, 'held');
  writeFileSync(scrubList, `${value}\n`, { mode: 0o600 });
  const env: Record<string, string> = { DEEP_HUB_TEST_HELD: scrubList, ...(plant ? { DEEP_CLI_PLANT: plant } : {}) };
  const path = join(h.root, 'logs', 'hub.log');
  const tag = newTag();
  const mark = `mark-${tag}`;
  const none: SweepRun = { placed: false, why: '', problems: [], hits: [], searched: 0 };

  // 1. Where the cut falls, on the log with no canary in it.
  let lastExtra = 0;
  let layout = makeLog(path, { tag, bytes: SIZE, least: LEAST });
  let first = await pass(h, env, layout, 'with no canary', mark);
  // A reader that cut inside a line and kept under 24 bytes of it keeps too little of a value to tell: the log's last
  // line is made 64 bytes longer, which moves such a cut along, and the cut is read again.
  if (first.cut && first.cut.fragment > 0 && first.cut.fragment < 24) {
    lastExtra = 64;
    layout = makeLog(path, { tag, bytes: SIZE, least: LEAST, lastExtra });
    first = await pass(h, env, layout, 'with no canary', mark);
  }
  if (first.problem || !first.cut) return { ...none, why: first.problem ?? 'no cut read' };
  const cut = first.cut;
  if (cut.leftOut === 0) return { ...none, why: `the bundle left nothing out of a logs/hub.log of ${mb(layout.bytes)}: it holds the log from its first line, so there is no cut for the canary's line to be placed at (Scope: at most 8 MB of each log)` };

  const problems: string[] = [];
  const hits: string[] = [];
  let searched = 0;
  // Each bundle is swept under the placement it was made with, beside every other file under the state folder that is
  // new or has changed since the sweep before, so a hit is named once, for the run that made it.
  const seen = new Set<string>();
  const stamp = (f: string): string => {
    const stat = statSync(f, { throwIfNoEntry: false });
    return `${f} ${stat?.mtimeMs} ${stat?.size}`;
  };
  const swept = (where: string, bundlePath: string): void => {
    const fresh = [...new Set([bundlePath, ...files(h.root).filter((f) => f !== path)])].filter((f) => f === bundlePath || !seen.has(stamp(f)));
    for (const f of fresh) seen.add(stamp(f));
    const found = sweep(fresh, list);
    searched += found.searched;
    hits.push(...found.hits.map((hit) => `${where}: ${hit}`));
  };

  // 2. Last before the cut: the line before the first kept line, the value at its end, or across the cut where the reader cut inside it.
  const before = cut.first - 1;
  const lengthBefore = layout.line(before).length;
  const keptOfIt = Math.max(0, cut.fragment - 1);
  const lineBefore = canaryLine(lengthBefore, lengthBefore - keptOfIt, value, key, mark);
  layout = makeLog(path, { tag, bytes: SIZE, least: LEAST, lastExtra, swap: new Map([[before, lineBefore]]) });
  const second = await pass(h, env, layout, 'with the canary\'s line last before the cut', mark, new Set([before]));
  if (second.problem) problems.push(second.problem);
  else if (second.cut!.first !== cut.first) problems.push(`with the canary's line last before the cut, the bundle's first whole line of the log is ${second.cut!.first}, not ${cut.first} as with no canary: the cut moved, so the line wasn't at it`);
  if (second.path) swept('last before the cut', second.path);

  // 3. First after the cut: the first kept line, the value its first characters. The bundle keeps the line, scrubbed.
  const lineAfter = canaryLine(layout.line(cut.first).length, 0, value, key, mark);
  layout = makeLog(path, { tag, bytes: SIZE, least: LEAST, lastExtra, swap: new Map([[cut.first, lineAfter]]) });
  const third = await pass(h, env, layout, 'with the canary\'s line first after the cut', mark, new Set([cut.first]));
  if (third.problem) problems.push(third.problem);
  else {
    if (third.cut!.first !== cut.first + 1) problems.push(`with the canary's line first after the cut, the bundle's first whole planted line is ${third.cut!.first}, not ${cut.first + 1}, the line after the canary's: the cut moved, so the line wasn't at it`);
    if (!third.marked) problems.push(`with the canary's line first after the cut, the bundle doesn't hold the line's own mark, ${mark}: the first line after the cut is kept and scrubbed, not dropped`);
  }
  if (third.path) swept('first after the cut', third.path);
  return { placed: true, why: '', problems, hits: [...new Set(hits)], searched };
}

describe(`${ID} the canary sweep at the cut`, () => {
  it(`${ID} with the canary's line placed last before the bundle's cut and first after it, the sweep finds no form of the scrub-list value or the key, whole or in half, in what the bundle keeps of the log or anywhere else in it`, async () => {
    built();
    const r = await sweepRun();
    // A bundle that makes no cut, as the merge base's, fails here: the canary's line has no cut to be placed at.
    expect(r.placed, r.why).toBe(true);
    expect(r.problems, 'the canary\'s line was at the cut in each bundle, and the bundle held the log').toEqual([]);
    // A sweep that searched no file finds nothing.
    expect(r.searched, 'the sweep searched the two bundles').toBeGreaterThanOrEqual(2);
    expect(r.hits, `canary forms found:\n${r.hits.join('\n')}`).toEqual([]);
  }, 1_800_000);

  it(`${ID} (wrong program) a reader that cuts by bytes alone, DEEP_CLI_PLANT=${PLANT}, splits the canary's line and fails the sweep, naming the bundle and the half of the value it kept`, async () => {
    built();
    const r = await sweepRun(PLANT);
    // The merge base knows no such planted program and makes no cut: the test fails here.
    expect(r.placed, r.why).toBe(true);
    const halves = r.hits.filter((hit) => hit.startsWith('last before the cut: ') && hit.includes('the scrub-list value (raw, its second half)'));
    expect(halves.length, `the sweep names the bundle that holds the second half of the value, kept unscrubbed by a cut through it; it found: ${r.hits.join('\n') || 'no form'}${r.problems.length ? `\nand: ${r.problems.join('\n')}` : ''}`).toBeGreaterThan(0);
  }, 1_800_000);
});
