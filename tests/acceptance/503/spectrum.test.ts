// AC1 #503.385199c8: "Spectrum bands: on a 10 s mono 48 kHz file holding a 937.5 Hz sine of amplitude 0.5 from 2 s to
// 4 s and silence elsewhere, a spectrum bake with bands 16, scale log, range [40, 16000], rate 60 and window 2048
// reads, at its row for 3 s, band 8 (800 to 1,163 Hz) at −6.02 dB within 0.01 dB and every other band at the −120 dB
// floor, and every band at the floor at 1 s; a bar chart whose 16 rows' heights read the bands draws the same heights
// seeked or played at every frame; the bake run again on the Linux machine is byte for byte equal, and bands 32 with
// window 8192 bakes under a new key, while bands 32 with window 2048 is refused at check, naming bands 1 and 2; a
// planted bake with bands spaced evenly in hertz puts the tone in band 0 and fails, naming band 8, and one that skips
// the window's normalization reads band 8 at 49.93 dB and fails"
//
// Everything runs through `deep-show run` (README: The surface under test): `media_bake` with kind `spectrum`, a
// document's `bakes` checked by `deep show`, `eval` with `arrays` and `pixels`, and `determinism`. The fixture is made
// here (32-bit float, so no quantization noise reaches the bands); the readings are the criterion's numbers.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ARRAY, BAKE16, BAND8, CHART, DOC, FLICKS, FLOOR, FULL, LINUX_STORE, TIMEOUT, arr, decodePng, docRun, emptyBands, failsNaming, getEvidence,
  hex64, isObject, logEdges, namedEmptyBands, none, num, obj, onLinux, present, putEvidence, rowAt, runShowPid, scenario, secs, show,
  spectrumCall, spectrumDocument, spectrumFailures, spectrumOf, str, toneWav, useShow, useTemp, barHeight, type JsonObject, type ShowPlanted,
  type Spectrum, type SpectrumAsk,
} from './helpers.ts';

const show_ = useShow([FULL]);
const temp = useTemp();

/** The bakes of one `deep-show run` of `calls` over a store holding the fixture, under `planted` if given. */
function bakes(evidence: string, asks: SpectrumAsk[], what: string, planted?: ShowPlanted): Spectrum[] {
  const sha = putEvidence(evidence, toneWav());
  const { replies } = runShowPid(show_.bin(FULL), scenario(evidence, asks.map((a) => spectrumCall(sha, a)), planted ? { planted } : {}), what);
  return replies.map((r, i) => spectrumOf(r, `${what}: bake ${i + 1} (bands ${asks[i]!.bands}, window ${asks[i]!.window})`));
}
const same = (a: Spectrum, b: Spectrum): boolean =>
  a.key === b.key && a.sha256 === b.sha256 && a.rate === b.rate && JSON.stringify(a.bands) === JSON.stringify(b.bands) && JSON.stringify(a.rows) === JSON.stringify(b.rows);
const BAKE32_8192: SpectrumAsk = { ...BAKE16, bands: 32, window: 8192 };
const BAKE32_2048: SpectrumAsk = { ...BAKE16, bands: 32, window: 2048 };

describe(`${AC[1]} spectrum bands as an analysis bake`, () => {
  it(`${AC[1]} the 16-band bake reads band 8 at −6.02 dB at 3 s and every other band, and every band at 1 s, at the −120 dB floor; it re-checks to an exact match; bands 32 with window 8192 bakes under a new key; bands 32 with window 2048 is refused at check, naming bands 1 and 2`, () => {
    // The suite's own band arithmetic agrees with the criterion before it judges anything.
    const e = logEdges(16, 40, 16000);
    expect([e[8]!.toFixed(1), e[9]!.toFixed(1)], 'band 8 of 16 log bands across [40, 16000] is 800 to 1,163 Hz').toEqual(['800.0', '1163.4']);
    expect(emptyBands(BAKE16), 'every band of the 16-band bake holds a bin centre at window 2048').toEqual([]);
    expect(emptyBands(BAKE32_8192), 'every band of the 32-band bake holds a bin centre at window 8192').toEqual([]);
    const empty = emptyBands(BAKE32_2048);
    expect(empty, 'at window 2048 the 32-band bake leaves bands 1 and 2 empty, filled first at 8192 and 4096').toEqual([{ band: 1, window: 8192 }, { band: 2, window: 4096 }]);

    const evidence = temp();
    const [a, again, b32] = bakes(evidence, [BAKE16, BAKE16, BAKE32_8192], 'the fixture baked twice at 16 bands and once at 32');
    none(spectrumFailures(a!, 'the 16-band bake'), 'the 16-band bake');
    hex64(a!.key, 'the bake key');
    expect(same(a!, again!), `the same bake again re-checks to an exact match (key ${a!.key} and ${again!.key}; rows and readings' hash)`).toBe(true);
    const [other] = bakes(evidence, [BAKE16], 'the 16-band bake in a second process');
    expect(same(a!, other!), 'the 16-band bake in a second process is the same bake, key, rows and readings').toBe(true);
    expect(b32!.key, 'bands 32 with window 8192 bakes under a key of its own').not.toBe(a!.key);
    expect(b32!.bands.length, 'the 32-band bake has 32 bands').toBe(32);
    const e32 = logEdges(32, 40, 16000);
    b32!.bands.forEach(([lo, hi], i) => expect(Math.abs(lo - e32[i]!) <= 0.5 && Math.abs(hi - e32[i + 1]!) <= 0.5, `the 32-band bake's band ${i} spans ${lo} to ${hi} Hz, log spaced`).toBe(true));
    const at3 = rowAt(b32!, 3);
    expect(at3 && at3.length, 'the 32-band bake has a row of 32 levels at 3 s').toBe(32);

    // At check: a document declaring the 32-band bake at window 2048 is refused, naming bands 1 and 2 with the window
    // that fills each; the same document at 16 bands is presented.
    const sha = putEvidence(evidence, toneWav());
    const { replies } = runShowPid(show_.bin(FULL), scenario(evidence, [
      present(DOC.a, spectrumDocument(sha, BAKE32_2048, false)),
      present(DOC.b, spectrumDocument(sha, BAKE16, false)),
    ]), 'the bake documents at check');
    const refused = replies[0]!;
    expect(refused['outcome'], `the document with bands 32 and window 2048 is refused at check: ${show(refused)}`).toBe('refused');
    const issues = arr(refused['issues'], 'the refusal: issues').map((v, i) => obj(v, `the refusal: issues[${i}]`));
    expect(namedEmptyBands(issues, 'the refusal'), 'the refusal names bands 1 and 2, each with the shortest window of the list that fills it').toEqual(empty);
    expect(replies[1]!['outcome'], `the same document with bands 16 at window 2048 is presented: ${show(replies[1])}`).toBe('presented');
  }, TIMEOUT);

  it(`${AC[1]} a bar chart whose 16 rows' heights read the bands draws the band levels, and the same heights seeked or played at every frame`, () => {
    const evidence = temp();
    const sha = putEvidence(evidence, toneWav());
    const frame = FLICKS / CHART.fps;
    const times = Array.from({ length: CHART.seconds * CHART.fps }, (_, k) => k * frame);
    const [baked, at1, at3, compared] = docRun(show_.bin(FULL), evidence, spectrumDocument(sha, BAKE16, true), [
      spectrumCall(sha, BAKE16),
      { call: 'eval', doc: DOC.a, t: FLICKS, pixels: true, arrays: [ARRAY] },
      { call: 'eval', doc: DOC.a, t: 3 * FLICKS, pixels: true, arrays: [ARRAY] },
      { call: 'determinism', doc: DOC.a, display_hz: CHART.fps, at_times: times, compare: 'same_machine' },
    ], 'the bar chart');
    const s = spectrumOf(baked!, 'the bake');
    none(spectrumFailures(s, 'the bake'), 'the bake the chart reads');
    for (const [seconds, reply] of [[1, at1!], [3, at3!]] as const) {
      const what = `the chart at ${seconds} s`;
      expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
      const read = arr(obj(reply['arrays'], `${what}: arrays`)[ARRAY], `${what}: arrays["${ARRAY}"], its 16 bands as the frame read them`).map((v, i) => num(v, `${what}: band ${i}`));
      expect(read, `${what}: the array holds the bake's row for ${seconds} s exactly`).toEqual(rowAt(s, seconds));
      const shot = arr(reply['snapshots'], `${what}: snapshots`);
      const png = decodePng(getEvidence(evidence, str(obj(shot[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`), `${what}: the snapshot`));
      expect([png.width, png.height], `${what}: the snapshot is the page`).toEqual(CHART.size);
      const ground: [number, number, number] = [png.rgba[8]!, png.rgba[9]!, png.rgba[10]!];
      const failures: string[] = [];
      read.forEach((level, i) => {
        const [x0, x1] = CHART.bar(i);
        const got = barHeight(png, Math.round((x0 + x1) / 2), ground);
        const want = level - FLOOR;
        if (Math.abs(got - want) > 1.5) failures.push(`${what}: bar ${i} is ${got} px tall, not band ${i}'s ${level.toFixed(2)} dB + 120 = ${want.toFixed(2)} u`);
      });
      none(failures, `${what}: each bar's height reads its band`);
    }
    expect(compared!['outcome'], `the comparison of seek and play: ${show(compared)}`).toBe('compared');
    const frames = arr(compared!['frames'], 'the comparison: frames').map((v, i) => obj(v, `the comparison: frames[${i}]`));
    expect(frames.length, 'one comparison per frame of the 6 s chart at 30 fps').toBe(times.length);
    const failures: string[] = [];
    for (const f of frames) {
      const t = num(f['t'], 'a compared frame t');
      const play = obj(f['play'], `played to ${secs(t)}`); const seek = obj(f['seek'], `seeked to ${secs(t)}`);
      if (str(play['pixels'], `played to ${secs(t)}: pixels`) !== str(seek['pixels'], `seeked to ${secs(t)}: pixels`)) failures.push(`frame ${Math.round(t / frame)} (${secs(t)}): the played and seeked frames differ`);
      if (isObject(play) && typeof play['pixel_hash'] === 'string' && play['pixel_hash'] !== seek['pixel_hash']) failures.push(`frame ${Math.round(t / frame)} (${secs(t)}): the pixel hashes differ`);
    }
    none(failures, 'the chart seeked equals the chart played at every frame');
  }, TIMEOUT);

  it(`${AC[1]} the bake run again on the Linux machine is byte for byte equal`, () => {
    const started = Date.now();
    mkdirSync(LINUX_STORE, { recursive: true });
    const evidence = mkdtempSync(join(LINUX_STORE, 'evidence-'));
    try {
      const sha = putEvidence(evidence, toneWav());
      const sc = scenario(evidence, [spectrumCall(sha, BAKE16)]);
      const mac = spectrumOf(runShowPid(show_.bin(FULL), sc, 'the bake on this Mac').replies[0]!, 'the bake on this Mac');
      none(spectrumFailures(mac, 'the bake on this Mac'), 'the bake on this Mac');
      const linux = spectrumOf(onLinux(sc, evidence, 'the bake', TIMEOUT - 900_000 - (Date.now() - started))[0]!, 'the bake on Linux x86_64');
      expect(linux.key, 'the Linux bake has the same key').toBe(mac.key);
      expect(linux.sha256, 'the Linux bake has the same readings hash').toBe(mac.sha256);
      expect(JSON.stringify(linux.bands), 'the Linux bake has the same band edges').toBe(JSON.stringify(mac.bands));
      const off = linux.rows.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(mac.rows[i]));
      expect([linux.rows.length, off], `the Linux bake has the same ${mac.rows.length} rows, level for level (first differing row ${off}: ${show(linux.rows[off] as unknown as JsonObject)} against ${show(mac.rows[off] as unknown as JsonObject)})`).toEqual([mac.rows.length, -1]);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, TIMEOUT);

  it(`${AC[1]} planted: a bake with bands spaced evenly in hertz puts the tone in band 0 and fails, naming band 8`, () => {
    const [s] = bakes(temp(), [BAKE16], 'the 16-band bake', 'spectrum_bands_even_hz');
    const at3 = rowAt(s!, 3);
    expect(at3 && at3[0]! > -7, `the planted bake puts the tone in band 0 at 3 s (it reads ${at3?.[0]} dB)`).toBe(true);
    failsNaming(spectrumFailures(s!, 'the planted bake'), /band 8\b/, 'the bake with bands spaced evenly in hertz');
  }, TIMEOUT);

  it(`${AC[1]} planted: a bake that skips the window's normalization reads band 8 at 49.93 dB and fails`, () => {
    const [s] = bakes(temp(), [BAKE16], 'the 16-band bake', 'spectrum_skips_window_norm');
    const level = rowAt(s!, 3)?.[8];
    expect(level !== undefined && Math.abs(level - BAND8.unnormalized) <= 0.01, `the planted bake reads band 8 at 3 s at ${BAND8.unnormalized} dB within 0.01 dB (it reads ${level})`).toBe(true);
    failsNaming(spectrumFailures(s!, 'the planted bake'), /band 8\b/, 'the bake without the window normalization');
  }, TIMEOUT);
});
