// AC7: "Shown to you: screenshots of the bar chart with its formula beside it, the swept 3D frame in its finished look
// and the spring, taken by the check run from the app at the reference window, with a recording of the spring and the
// sweep, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// asserts: the check run (README: AC7) wrote into $TMPDIR/deep-1162-proof/ac7/ the three screenshots, each a PNG of the
// reference window (1512 × 982 points at 2×: 3024 × 1964 px), and the recording, an MP4 (an ISO BMFF `ftyp` box first).
// A missing or malformed file fails, naming it. Then the taste call: `TASTE.json` in this folder (README) whose `files`
// name exactly this run's SHA-256s; with none, or one made on other pictures, the test fails INCONCLUSIVE, never
// passes; `looks_wrong` fails; `looks_right` passes. It never reads a picture's pixels.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROOF_DIR, inconclusive, isObject, sha256, shown, type JsonValue } from './helpers.ts';

const AC7_DIR = join(PROOF_DIR, 'ac7');
const TASTE = join(dirname(fileURLToPath(import.meta.url)), 'TASTE.json');
/** The reference window (technical design: 1512 × 982 points at 2×). */
const REFERENCE: [number, number] = [3024, 1964];
const SCREENSHOTS = ['chart-formula.png', 'frame-3d.png', 'spring.png'] as const;
const RECORDING = 'spring-sweep.mp4';

describe('AC7 shown to you, with one taste call recorded', () => {
  it('AC7 the check run wrote the screenshots at the reference window and the recording, and the run reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right', () => {
    const hashes: Record<string, string> = {};
    for (const name of SCREENSHOTS) {
      const path = join(AC7_DIR, name);
      expect(existsSync(path), `AC7: the check run wrote the screenshot ${name} into ${AC7_DIR}`).toBe(true);
      const png = readFileSync(path);
      expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `AC7: ${name} is a PNG`).toBe(true);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `AC7: ${name} is taken at the reference window, ${REFERENCE.join(' × ')} px`).toEqual(REFERENCE);
      hashes[name] = sha256(png);
    }
    const rec = join(AC7_DIR, RECORDING);
    expect(existsSync(rec), `AC7: the check run wrote the recording ${RECORDING} into ${AC7_DIR}`).toBe(true);
    const mp4 = readFileSync(rec);
    expect(mp4.length > 12 && mp4.toString('latin1', 4, 8) === 'ftyp', `AC7: ${RECORDING} is an MP4`).toBe(true);
    hashes[RECORDING] = sha256(mp4);
    console.log(`AC7: shown to you: ${JSON.stringify(hashes)}`);
    if (!existsSync(TASTE)) inconclusive('AC7: no taste call is recorded for these screenshots and the recording');
    const call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue;
    const files = isObject(call) && isObject(call['files']) ? call['files'] : {};
    if (JSON.stringify(Object.fromEntries(Object.entries(files).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(hashes).sort()))) {
      inconclusive(`AC7: the recorded taste call was made on other files (${shown(files)}), not this run's (${JSON.stringify(hashes)})`);
    }
    expect(isObject(call) ? call['verdict'] : undefined, `AC7: the taste call says the pictures look right: ${shown(call)}`).toBe('looks_right');
  }, 60_000);
});
