// AC10 #501.187057b7: "Across architectures, audio is a reading: the peak per-sample difference of the export kinds'
// fixture film's PCM between macOS arm64 and Linux x86_64 is reported in dBFS, and above −96 dBFS the cross-machine
// audio result is INCONCLUSIVE, never PASS; a planted mixer whose Linux build is one 16-bit step off, about −90 dBFS,
// reads INCONCLUSIVE, and a check that gives it PASS or FAIL fails this test"
//
// The fixture film's sound (README: Fixtures, two panned tones as #499's media document) is rendered offline by
// #499's `media_mix`, the export's sound, once by `deep-show` on this Mac and once by the same checkout built for
// linux/amd64 in a container (#532's leg; the design counts it as the other architecture for CPU checks, recorded as
// emulated), both writing their float WAVs into one evidence store. `cross_machine` (README) is the check that reads the
// two: it reports the peak per-sample difference in dBFS and a verdict. This suite computes the same peak from the two
// WAVs and holds the check to it: the reading within 0.01 dB, INCONCLUSIVE above −96 dBFS, PASS at or below it (or when
// the two are identical). The planted mixer: `--planted mixer_linux_one_step`, given to the Linux run. Without Docker or
// the image the test is BLOCKED.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, FULL, LINUX, TIMEOUT, filmSound, fl, getEvidence, hex64, none, num, obj, onLinux, putEvidence, readWav, runShow, show, str, tone,
  useShow, wav16, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** The evidence store, under target/ so the container can mount it. */
function store(): string { mkdirSync(LINUX, { recursive: true }); const d = mkdtempSync(join(LINUX, 'evidence-')); made.push(d); return d; }

const wavOf = (reply: JsonObject, what: string): string => {
  const segs = obj(reply['mix'], `${what}: mix`)['segments'];
  expect(Array.isArray(segs) && segs.length === 1, `${what}: one segment`).toBe(true);
  return hex64(obj((segs as JsonObject[])[0], `${what}: segment`)['wav'], `${what}: the segment's WAV`);
};

/** The peak per-sample difference of two WAVs in dBFS (−Infinity when they are identical). */
function peakDbfs(a: Buffer, b: Buffer): number {
  const x = readWav(a, 'the Mac\'s WAV'); const y = readWav(b, 'the Linux WAV');
  expect([x.rate, x.channels.length, x.channels[0]!.length], 'the two renders hold the same samples').toEqual([y.rate, y.channels.length, y.channels[0]!.length]);
  let peak = 0;
  x.channels.forEach((c, ch) => { for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]! - y.channels[ch]![i]!)); });
  return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}

/** The sound rendered on both machines and the check's reading of the two, against this suite's. */
function across(planted?: string): { ours: number; failures: string[] } {
  const evidence = store();
  const left = putEvidence(evidence, wav16([tone(440, 192_000, 0.3)]));
  const right = putEvidence(evidence, wav16([tone(550, 144_000, 0.3)]));
  const mix: JsonObject = { call: 'media_mix', doc: filmSound(left, right), segments: [{ from: 0, to: fl(4), write: true }] };
  const [mac] = runShow(shows.bin(FULL), { evidence, calls: [mix] }, 'the film\'s sound on this Mac');
  const [linux] = onLinux({ evidence, calls: [mix] }, evidence, 'the film\'s sound', planted);
  const macWav = wavOf(mac!, 'this Mac'); const linuxWav = wavOf(linux!, 'linux/amd64');
  const ours = peakDbfs(getEvidence(evidence, macWav, 'the Mac\'s WAV'), getEvidence(evidence, linuxWav, 'the Linux WAV'));
  const [reply] = runShow(shows.bin(FULL), { evidence, calls: [{ call: 'cross_machine', audio: [macWav, linuxWav] }] }, 'the cross-machine audio check');
  const r = obj(reply, 'cross_machine');
  const failures: string[] = [];
  if (r['outcome'] !== 'read') failures.push(`the check doesn't read the two renders: ${show(r)}`);
  else {
    const db = r['peak_dbfs'] === null ? -Infinity : num(r['peak_dbfs'], 'cross_machine.peak_dbfs');
    if (!(db === ours || Math.abs(db - ours) <= 0.01)) failures.push(`the check reports a peak difference of ${db} dBFS; the two WAVs' is ${ours.toFixed(3)} dBFS`);
    const verdict = str(r['verdict'], 'cross_machine.verdict');
    const want = ours > -96 ? 'INCONCLUSIVE' : 'PASS';
    if (verdict !== want) failures.push(`at ${ours.toFixed(2)} dBFS the cross-machine audio result is ${verdict}, not ${want}`);
  }
  return { ours, failures };
}

describe(`${AC[10]} across architectures, audio is a reading in dBFS, never a PASS above −96 dBFS`, () => {
  it(`${AC[10]} the fixture film's PCM on macOS arm64 and Linux x86_64: the check reports their peak per-sample difference in dBFS and reads INCONCLUSIVE above −96 dBFS`, () => {
    const { ours, failures } = across();
    console.log(`${AC[10]}: macOS ${process.arch} against linux/amd64 (emulated): peak difference ${ours.toFixed(3)} dBFS`);
    none(failures, 'the cross-machine audio check');
  }, TIMEOUT);

  it(`${AC[10]} a planted mixer whose Linux build is one 16-bit step off reads about −90 dBFS and INCONCLUSIVE; a check that gives it PASS or FAIL fails`, () => {
    const { ours, failures } = across('mixer_linux_one_step');
    expect(ours, 'the planted mixer\'s Linux render is one 16-bit step off: 20·log10(1/32,768) ≈ −90.3 dBFS').toBeGreaterThan(-91);
    expect(ours, 'and no more').toBeLessThan(-89);
    none(failures, 'the cross-machine audio check on the planted mixer');
  }, TIMEOUT);
});
