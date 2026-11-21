// AC8, its second sentence: "With `hidden` unset and `material` false, each of #1640's fixtures draws the same frame
// by pixel hash as before this change"
//
// "Before this change" is the base commit. Its frames can't be drawn from this checkout once it changes, so they
// were drawn once at the base on the reference Mac and their hashes kept: fixtures/base-frames.json, written by
// record-base.ts, which refuses to run anywhere but the base. The frames are unchanged.ts's: #1640's crease-edges
// scene, its AC4 cube (solid, screen dash, world dash) and four frames of its orbit, each built with #1640's own
// document builders and look, none with `hidden` or `material`; and a canary, the cube with no line. This is the
// cheapest comparison that can fail: no second checkout and no base build at test time (README: How criterion 8
// compares with the base).
//
// Conditions (reference Mac): a hash is recorded for every frame; the canary's `pixel_hash` is the recorded one,
// or else this machine doesn't draw as the recording one did and the test is INCONCLUSIVE, never a pass; then each
// of the eight fixture frames has the recorded `pixel_hash`. It passes at the base, as an unchanged frame must.
// The planted-mismatch twin: under #1640's `--planted crease_below_angle`, which draws another edge set, the canary
// still matches and the same comparison fails, naming every one of the eight frames.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, failsNaming, none, requireGpu, run, startName, useDir, useGpuBin, type Startup } from './helpers.ts';
import { BASE, BASE_FRAMES, CANARY, baseCalls, hashOf } from './unchanged.ts';

const bin = useGpuBin();
const dir = useDir();

/** The hashes recorded at the base, by frame name. */
function recorded(): Record<string, string> {
  expect(existsSync(BASE_FRAMES), 'fixtures/base-frames.json exists (recorded at the base by: node tests/acceptance/1782/record-base.ts)').toBe(true);
  const file = JSON.parse(readFileSync(BASE_FRAMES, 'utf8')) as { base?: string; frames?: Record<string, string> };
  expect(file.base, 'the hashes were recorded at the base commit').toBe(BASE);
  return file.frames ?? {};
}

/** Every fixture frame drawn on Metal against its recorded hash, the canary held first. A failure names its frame. */
function hashProblems(startup: Startup): { names: string[]; problems: string[] } {
  const want = recorded();
  const calls = baseCalls(dir());
  expect(Object.keys(want).sort(), 'a hash is recorded for every frame, and for no other').toEqual(calls.map((c) => c.name).sort());
  const replies = run(bin(), dir(), calls.map((c) => c.call), startup);
  const got = new Map(calls.map((c, i): [string, string] => {
    const reply = replies[i]!;
    if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${startName(startup)} reports unsupported_platform for ${c.name}; this is not a pass`);
    const h = hashOf(reply);
    expect('why' in h ? h.why : '', `${c.name} is drawn on ${startName(startup)}`).toBe('');
    return [c.name, 'hash' in h ? h.hash : ''];
  }));
  if (got.get(CANARY) !== want[CANARY]) {
    expect.fail(`INCONCLUSIVE: this machine draws the canary (a cube with no mesh-edge line) as ${got.get(CANARY)}, not as the machine that recorded the base's frames did (${want[CANARY]}), so the base's hashes can't be compared here; this is not a pass`);
  }
  const names = calls.map((c) => c.name).filter((n) => n !== CANARY);
  return { names, problems: names.filter((n) => got.get(n) !== want[n]).map((n) => `${n}: the pixel hash ${got.get(n)} isn't the base's, ${want[n]}`) };
}

describe(`${AC[8]} #1640's fixtures with hidden unset and material false`, () => {
  it(`${AC[8]} each draws the same frame by pixel hash as before this change (reference Mac)`, () => {
    requireGpu();
    none(hashProblems({}).problems, '#1640\'s fixture frames against the base\'s');
  }, 3_600_000);

  it(`${AC[8]} the comparison's planted-mismatch twin: under crease_below_angle, another edge set, every frame differs from the base's (reference Mac)`, () => {
    requireGpu();
    const { names, problems } = hashProblems({ planted: 'crease_below_angle' });
    failsNaming(problems, names.map((n) => `${n}: the pixel hash`), 'a run that draws another edge set');
  }, 3_600_000);
});
