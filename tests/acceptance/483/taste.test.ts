// #483.06a48810: "Shown to you: screenshots of the jump-flood outline on the 512 × 512 mask and the median-of-nine
// pass, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS,
// and no criterion above reads a picture to judge it"
//
// Two screenshots, each the `png` check_operator writes for a pass's color (the renderer's own output, README): the
// jump flood with `outline` on `helpers.ts: maskFixture` (a white band up to 4 px outside the mask, the mask at 0.35)
// and the median of nine on `helpers.ts: noisyFixture`. They are kept in DEEPBUILD_EVIDENCE_DIR (else a temporary
// folder) and their paths printed, for the PR and the session. The taste call is a file you record, named by
// DEEPBUILD_TASTE_483: {"criterion": "#483.06a48810", "by": "you", "screenshots": [sha256 × 2], "call":
// "looks_right" | "looks_wrong"}. With no record, or one made on other screenshots, the test fails as INCONCLUSIVE;
// looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, SHA, frameCall, grayRgba, inconclusive, jumpFlood, maskFixture, maskRgba, medianPass, noisyFixture, ran, readAt, requireGpu, run, useBins, useOut, writeRgba,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const N = 512;

describe(`${AC[10]} one taste call on the renderer's own screenshots`, () => {
  it(`${AC[10]} the outline and median screenshots come from the renderer's output, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const shots = [
      { name: 'jump-flood-outline', op: jumpFlood('flood', { count: 9, start: 256, max: N - 1, outline: true }), color: writeRgba(dir, 'mask', maskRgba(maskFixture())) },
      { name: 'median-of-nine', op: medianPass('median', N - 1), color: writeRgba(dir, 'noisy', grayRgba(noisyFixture())) },
    ];
    const replies = run(bins.bin(), dir, shots.map((s) => frameCall({ operators: [s.op], data: { color: s.color }, size: [N, N], read: [`${String(s.op['id'])}.color`] })));
    const keep = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-483-taste');
    mkdirSync(keep, { recursive: true });
    const hashes = shots.map((s, k) => {
      const read = readAt(ran(replies[k]!, s.name), 0, `${String(s.op['id'])}.color`, s.name);
      expect(read.png, `${s.name}: the pass's color as a PNG, named by its SHA-256`).toMatch(SHA);
      const kept = join(keep, `${s.name}-${read.png!}.png`);
      copyFileSync(join(dir, `${read.png!}.png`), kept);
      console.log(`screenshot for the taste call: ${kept}`);
      return read.png!;
    });
    const path = process.env['DEEPBUILD_TASTE_483'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${hashes.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_483`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    if (record.criterion !== AC[10] || record.by !== 'you' || JSON.stringify([...(record.screenshots ?? [])].sort()) !== JSON.stringify([...hashes].sort())) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these two screenshots (${hashes.join(', ')})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, 1_800_000);
});
