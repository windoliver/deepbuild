// Test-side tools for the #500 "bake" acceptance tests (criteria 3 and 5) and the #500 Oracle lane: `deep-show` built
// once per file and driven by one JSON scenario on stdin (`deep-show run`, #393's convention, as #499's suites drive
// it); the new `media_bake` call (Analysis bake) and its loudness and envelope readings, read strictly; the EBU loudness
// test set fetched by hash on first use into a cache outside the checkout, read from its zip, each signal checked
// against its pinned SHA-256 and against the checkout's tracked blobs (never committed); and 16-bit WAV assets the tests
// write. Nothing here stands in for a meter or an envelope: every reading is what `deep-show` answers.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/500/bake is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const SHOW_BIN = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** Every `it` passes this timeout: a first build of `deep-show` on a shared Mac can take many minutes, and the EBU set
 * is 92 MB to fetch and about 25 minutes of audio to bake in a debug build. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: `#<issue>.<8 hex of the text's sha256>`), which starts its test's name. */
export const AC = {
  3: 'AC3 #500.5b74b67b',
  5: 'AC5 #500.add6fff5',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(value), `${what} is a whole number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
/** A reading that may be −∞ (a silent window), written null; a missing field fails, naming it. */
function numOrNull(o: JsonObject, key: string, what: string): number | null {
  expect(key in o, `${what}: the field \`${key}\` is present (a number, or null for −∞)`).toBe(true);
  return o[key] === null ? null : num(o[key], `${what}.${key}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-show` once per file, copied out of the target folder (honoring
// CARGO_TARGET_DIR), as #499's suites do; a test that uses a build that failed fails, naming it.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', SHOW_BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** The deep-show binary for this file's tests. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-500-bake-bin-'));
    error = cargoBuild();
    const target = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    if (error === '') copyFileSync(join(target, 'debug', exe(SHOW_BIN)), join(dir, exe(SHOW_BIN)));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, exe(SHOW_BIN));
  };
}

/** A fresh evidence store per call (one per world), all deleted after the test. */
export function useEvidence(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), 'deep-500-bake-ev-'));
    made.push(d);
    return d;
  };
}

const SURFACE = 'the `media_bake` call and its loudness and envelope readings, README: The surface under test';

/** `deep-show run` on one scenario line: exit 0, one line out, answered ok with one reply per call, in call order. A run
 * that hangs is stopped by spawnSync's own timeout, which signals only this child. */
function runShow(bin: string, s: JsonObject, what: string, timeoutMs = 3_000_000): JsonObject[] {
  const r = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within ${timeoutMs} ms`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one output line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run answers the scenario ok (${SURFACE}${s['planted'] ? `, planted ${String(s['planted'])}` : ''}); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return replies;
}

export const SEC = 705_600_000;
export const RATE = 48_000;

export type Planted = 'sample_peak_meter' | 'envelope_reads_peak';

// ---------------------------------------------------------------------------------------------------
// `media_bake` (README: The surface under test): one analysis bake of one asset in the evidence store.

/** A loudness channel's place (Analysis bake: "channel weights by azimuth and elevation"), degrees, BS.2051's sense
 * (azimuth positive to the left), or `"lfe"` for a channel loudness leaves out. */
export type Place = { azimuth: number; elevation: number } | 'lfe';
export type Ask =
  | { asset: string; kind: 'loudness'; tp_oversample: 4 | 8; channels?: Place[] }
  | { asset: string; kind: 'envelope'; rate: number; outputs: ('rms' | 'centroid')[] };

/** A loudness bake's readings. `momentary[k]` and `short_term[k]` are the readings of the windows that end at
 * (k + 1) × 10 ms, the end of sub-block k; null is −∞. */
export interface Loudness { integrated: number | null; range: number; momentary: (number | null)[]; short_term: (number | null)[]; true_peak: number }
export interface Row { t: number; rms: number }

function series(o: JsonObject, key: string, what: string): (number | null)[] {
  return arr(o[key], `${what}.${key}`).map((v, i) => (v === null ? null : num(v, `${what}.${key}[${i}]`)));
}

/** The bakes, one call each, in one offline scenario. */
export function bakes(bin: string, evidence: string, asks: Ask[], what: string, planted?: Planted): JsonObject[] {
  const label = planted ? `${what} (planted ${planted})` : what;
  const calls: JsonObject[] = asks.map((bake) => ({ call: 'media_bake', bake: bake as unknown as JsonObject }));
  return runShow(bin, { evidence, ...(planted ? { planted } : {}), calls }, label).map((r, i) => {
    const b = obj(r['bake'], `${label}: replies[${i}].bake`);
    expect(b['asset'], `${label}: replies[${i}].bake.asset is the asset asked`).toBe(asks[i]!.asset);
    expect(b['kind'], `${label}: replies[${i}].bake.kind is the kind asked`).toBe(asks[i]!.kind);
    expect(typeof b['analyzer'] === 'string' && /^[^@\s]+@[^@\s]+$/.test(b['analyzer']), `${label}: replies[${i}].bake.analyzer is an id@version, got ${JSON.stringify(b['analyzer'])}`).toBe(true);
    return b;
  });
}

export function loudnessOf(b: JsonObject, what: string): Loudness {
  return {
    integrated: numOrNull(b, 'integrated', what), range: num(b['range'], `${what}.range`),
    momentary: series(b, 'momentary', what), short_term: series(b, 'short_term', what), true_peak: num(b['true_peak'], `${what}.true_peak`),
  };
}

export function rowsOf(b: JsonObject, what: string): Row[] {
  return arr(b['rows'], `${what}.rows`).map((v, i) => {
    const o = obj(v, `${what}.rows[${i}]`);
    num(o['centroid'], `${what}.rows[${i}].centroid (asked in outputs)`);
    return { t: int(o['t'], `${what}.rows[${i}].t`), rms: num(o['rms'], `${what}.rows[${i}].rms`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<first 2 hex>/<other 62 hex>`, each file named by its bytes' SHA-256)

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export function putAsset(evidence: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

/** One channel as a 16-bit PCM WAV at 48 kHz. */
export function wav16(x: Float32Array): Uint8Array {
  const data = x.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + 2 * i);
  return new Uint8Array(b);
}

// ---------------------------------------------------------------------------------------------------
// The EBU loudness test set v05 (30 March 2016; Tech 3341 signals 1 to 23, Tech 3342 signals 1 to 6), fetched by hash on
// first use and never committed (README: The EBU signals). tech.ebu.ch answers automated downloads with HTTP 403, so the
// fetch reads the Internet Archive's raw copy of the EBU's own URL; its SHA-512 and size equal those Gentoo's
// media-libs/libebur128 Manifest pins for the file it fetches from tech.ebu.ch. A copy downloaded from the EBU's page
// in a browser, put in the cache folder, is the same file.

export const EBU = {
  page: 'https://tech.ebu.ch/publications/ebu_loudness_test_set',
  url: 'https://web.archive.org/web/20170331172519id_/https://tech.ebu.ch/docs/testmaterial/ebu-loudness-test-setv05.zip',
  file: 'ebu-loudness-test-setv05.zip',
  sha256: '9cc500b4df83f7c21855c74dce795ef5209a752bf884253ae57d0ce512efb062',
  bytes: 91_631_421,
} as const;

/** Each signal file in the zip, by its name there, and its SHA-256 (read once from the pinned zip). */
export const SIGNALS: Record<string, string> = {
  'seq-3341-1-16bit.wav': '50dff94bf941756cae2b3e1a67931a28e1605a876be1b7f3707f2ffcf485955c',
  'seq-3341-2-16bit.wav': '7c9399188aed09980c76a67adc36b33f2d61c3e0c8457d83f7bf879122534ce3',
  'seq-3341-3-16bit-v02.wav': '1fced6ac2397d4337257185908bd49bb18314f441a0daf0ef602f671254d9efb',
  'seq-3341-4-16bit-v02.wav': '514a6edd342d20c999d30062f0371d3f33ca86aa668ed3606484564db8dbdf93',
  'seq-3341-5-16bit-v02.wav': '7acd129ddebb1935980585742075ad4aa82abe1147f7ce8abd28346b49561e61',
  'seq-3341-6-5channels-16bit.wav': 'bd6ba138931b7450abf83044b2645fd6ef4c8dafc170758b8a2f32cbaa7ef58b',
  'seq-3341-6-6channels-WAVEEX-16bit.wav': 'c7a5b24cfedfd9c781beafd05547e9dd90118ab6a78c4ccf181a02ae85160fc0',
  'seq-3341-7_seq-3342-5-24bit.wav': 'dc48d551d72c8060a4f8ba9e09d247cbd5ba48e3ddebd9ce2f9af0b204fc1293',
  'seq-3341-2011-8_seq-3342-6-24bit-v02.wav': '13cb1c1ca8496c868a768bd1afc5e6a75841235000b68285e895bce62c2bdc6a',
  'seq-3341-9-24bit.wav': '8157f3e794eac577b6007586fe47f51db8bfdc636729e6a773928c72791ef0f2',
  'seq-3341-10-1-24bit.wav': 'd8c3596d1351450229e00afc81299bc128fcb7ccd4eb6e6cc4b7963af0644103',
  'seq-3341-10-2-24bit.wav': '4e6a057ee75c1cd6ed4ed5d5b84b9e3d2c709c71eeef818ba6ccd76bafd4f959',
  'seq-3341-10-3-24bit.wav': '64005281bb93a6dc25f52441a9bfad52cad9929d7db44dd5f0902a177acd4f06',
  'seq-3341-10-4-24bit.wav': '1ddd72e2559dc5fd18b143cdb9037cb0c408af49ef1bff71cce2547356f9c426',
  'seq-3341-10-5-24bit.wav': '8fb38288204e70b75c01f3f79d12f636f8291cd96d8edc4b0f4d795b28aecce9',
  'seq-3341-10-6-24bit.wav': '64bc54354117d947e09ca6aaa92e4eaa1978786dd14bcd41f300e4d875d13af5',
  'seq-3341-10-7-24bit.wav': '66db47cf0f6f94f98e0da60529a55ce3644a7932bde2cd19558ea02db1a6047b',
  'seq-3341-10-8-24bit.wav': 'e40b68f80fbd312fdd81810dc7a73d642b7830307b5f97e3e0f0ba06b9ed3f5a',
  'seq-3341-10-9-24bit.wav': '26aa8668443b8b5176b50ee2bff7ae830747053788da9a1d414956a2d8f7b763',
  'seq-3341-10-10-24bit.wav': '0f39a821b9d0275b799154b7466810861065084274f3344b79f8c873c0281fb6',
  'seq-3341-10-11-24bit.wav': '7c15c7d6e40ccb57de573aaabcf168761eebf24b7f246cbd4fb7da64decc9776',
  'seq-3341-10-12-24bit.wav': '7911ad106257ddb428fe5eb4e98270fd64a82e574540bad70049b2cc24b0faeb',
  'seq-3341-10-13-24bit.wav': '2526684a09326f51a2bc69a0391084d05e7c76535182d8216abee3f7acb01d7e',
  'seq-3341-10-14-24bit.wav': '6285779d85b9565dca377cc10843a73b522f497bd93b82b570249b806fc5158a',
  'seq-3341-10-15-24bit.wav': '621d223f90471edf9487ad4fc3fb7906b2921203db1c6947c676d65d12fcef34',
  'seq-3341-10-16-24bit.wav': '7968f978f3de277c5c70c07fe50b7db87278ef6181c70ccda21928560c66e130',
  'seq-3341-10-17-24bit.wav': 'ee47b73e0a1ec9c6b5ebad0d6eb897f83e3b6e908e1e19b0220ef55c78895e18',
  'seq-3341-10-18-24bit.wav': '36e7922bfe93e95973325d6da638bf79b25f82bd17bddc2edc6771e096751d5a',
  'seq-3341-10-19-24bit.wav': '0d9645639c17d6102e10bcb45b7b71e6cae9bfe58216cc4dfeda6462163ce524',
  'seq-3341-10-20-24bit.wav': '86b78fad8cfbf22a0b0ba9e69d9c8e24160395b89f5abc7ab6f26176afcbada7',
  'seq-3341-11-24bit.wav': 'a3dedc4a23fd85111f234afc35ca73a9e94b440d0eafa6a78b66b5992b405a99',
  'seq-3341-12-24bit.wav': 'd7fc88e31003553bb1329e84a8921217ae7c58045dfd620bc6b530d399a6933b',
  'seq-3341-13-1-24bit.wav': '45cf95c6cd973dab326fae608d98a3ebe2dc702ac80d281ee07e9da47c7d16e0',
  'seq-3341-13-2-24bit.wav': 'f29ee316201ba8c514fe57be5f4ca3440353a81d1974881836d72631470411a1',
  'seq-3341-13-3-24bit.wav.wav': '52e6688b361ae61ec2a2efa636884cbc592485fc539beacfad61e35794bbab64',
  'seq-3341-13-4-24bit.wav.wav': '3e1d053545e49119752e013bfdfbf1f0ec22029db040ddd0bba688395788c55a',
  'seq-3341-13-5-24bit.wav.wav': 'fb5d316fd48510fab62bf395bbebd1874f52030ac00cb9639a9b93a3d18148e8',
  'seq-3341-13-6-24bit.wav.wav': '820efc240c7a301e5f50c2a9a9f04003ecb5ec29ddda115192043835ac29f61e',
  'seq-3341-13-7-24bit.wav.wav': 'ddf6271cf0f73344a60f0a700bb438275b66193b497e6d0e7c83f4a72952dfa5',
  'seq-3341-13-8-24bit.wav.wav': 'faa7bcbbee1846341821cacc2a3b61348a4ebf759e448722a3f4228d97674df1',
  'seq-3341-13-9-24bit.wav.wav': 'a382f6884a0fae18ba39cb0774d6cd7774f62f193c75b47ecf4f009eafd2dede',
  'seq-3341-13-10-24bit.wav.wav': '1e12c05373595fb6b9674940b8d414a1106d09aa563ee27280b5c44156c6fd4c',
  'seq-3341-13-11-24bit.wav.wav': 'b242927ac1a7e03ea2ba91a1308f86e3a5e2a348097e9e99a19f90a56d8f036f',
  'seq-3341-13-12-24bit.wav.wav': '2c1d07376e2bcb76ec526ee4f86e06ecfdfbe774d2e0ffee0cc40293a0d722e3',
  'seq-3341-13-13-24bit.wav.wav': '4a843240403af6c13a234b060e44fa082802f23fe08c0ffd8d57459e64c3f501',
  'seq-3341-13-14-24bit.wav.wav': '0c3fb63d647192a148572e09fe7bda321c4e6785b993d5315893061d67460cc0',
  'seq-3341-13-15-24bit.wav.wav': '8bd777888183226957e367fc9fe2476f2d46fe5c58c43e9f938e90854dc779d4',
  'seq-3341-13-16-24bit.wav.wav': '585ddee873c3b402b18b3750fb7418e9d855071c75c20e8d884ad4b55defd139',
  'seq-3341-13-17-24bit.wav.wav': '23ad69f204fa8238a18e2daa5a0cc4710f9002ae3a89ede8a151d7813d7a7d8a',
  'seq-3341-13-18-24bit.wav.wav': '1a19299a88d1a0e77dbdb8f8c1f5b02b3682ac85fc35b686d6743654eeed14a8',
  'seq-3341-13-19-24bit.wav.wav': '7b9a57cce01dcc35b89de4091db4e35ac9cf8bceb35897c29961f0cc22ec803c',
  'seq-3341-13-20-24bit.wav.wav': 'c8b7f0dbe9e30a2fddb89a036b6fee88e94e7db73747da70193038576cbec577',
  'seq-3341-14-24bit.wav.wav': '7d6a7c9c21590b3376d15f6f8f095083d8898af99daa10dcf520b4a4d56b0ac5',
  'seq-3341-15-24bit.wav.wav': '86f8a70eca1bc77623dd20a4acbadbc449711cd348615d852e3b0689827bea55',
  'seq-3341-16-24bit.wav.wav': '9843c6fbc7c14d1bc5902ab23474851d766fd2ea92be5c45ab78ccd7e8a99ecd',
  'seq-3341-17-24bit.wav.wav': 'b4e7377b6c5c0c30bf68752f6d02f7b23909e40aed083a25902a550e0e1e2265',
  'seq-3341-18-24bit.wav.wav': 'd5fbe4854e93ef2a5a23260b522bdaa44bc739b69597bf751de919f11641d161',
  'seq-3341-19-24bit.wav.wav': '31bda52dc66bb63aa0d04b2e5a1e6a4332296fa5635570469b2863d05a06d309',
  'seq-3341-20-24bit.wav.wav': 'a2df8791198781579a25e0437008ce9b1a48b13605a8b71886a360c4ceed16e4',
  'seq-3341-21-24bit.wav.wav': 'fc508ae04cb6d1dbcb286d6cdffe8e81a87effa9ba7bb267c17a5807d5b273d3',
  'seq-3341-22-24bit.wav.wav': 'd238255454a091b49592b25355738e200f59868c0804be5427c901ed10b3a910',
  'seq-3341-23-24bit.wav.wav': 'c7243e22970b82e020b45241c92d210cbf47217ccc967f014787a5f6400fa8a3',
  'seq-3342-1-16bit.wav': '0b31a4813276699b5043e8fe7f93c6d7c4df3a7eacdd1a2436f0c3ee6b00e39b',
  'seq-3342-2-16bit.wav': 'e1b3c64e26ffe1c77b60072545ca41b45d0a2b599ec7e3333592f12000fdde0d',
  'seq-3342-3-16bit.wav': '6e759ba7b061f28733a5a5081301f08df94c5447c28742c4f5fe85abe9aac677',
  'seq-3342-4-16bit.wav': '6445a25325fb53fbbf03c0296bdb019962df9254468795b4c6fe46ab00bb4f2b',
};

/** The 5.0 file's channel order is L, R, C, Ls, Rs (the set's readme); the WAVE_FORMAT_EXTENSIBLE copy adds a silent
 * LFE fourth, as its channel mask says (L, R, C, LFE, Ls, Rs). */
export const FIVE: Place[] = [{ azimuth: 30, elevation: 0 }, { azimuth: -30, elevation: 0 }, { azimuth: 0, elevation: 0 }, { azimuth: 110, elevation: 0 }, { azimuth: -110, elevation: 0 }];
export const SIX: Place[] = [FIVE[0]!, FIVE[1]!, FIVE[2]!, 'lfe', FIVE[3]!, FIVE[4]!];

/** The cache the set is fetched into: `DEEP_EBU_LOUDNESS`, else the user's cache folder. Never in the checkout. */
export function ebuCache(): string {
  const env = process.env['DEEP_EBU_LOUDNESS'];
  if (env) return env;
  return process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'deepbuild', 'ebu-loudness') : join(homedir(), '.cache', 'deepbuild', 'ebu-loudness');
}

export interface EbuSet { file(name: string): Buffer }

/** The set's zip (from the cache, fetched first when missing) as a reader of its pinned signal files, or the line a test
 * that needs it fails with: `BLOCKED:`, never a pass. */
export async function ebuSet(): Promise<EbuSet | string> {
  const path = join(ebuCache(), EBU.file);
  const unblock = `Unblock: run once with network access to web.archive.org, or download ${EBU.file} from ${EBU.page} in a browser and put it at ${path} (or in the folder DEEP_EBU_LOUDNESS names)`;
  let zip: Buffer;
  if (existsSync(path)) zip = readFileSync(path);
  else {
    try {
      const r = await fetch(EBU.url, { signal: AbortSignal.timeout(900_000) });
      if (!r.ok) return `BLOCKED: the EBU loudness test set isn't cached at ${path}, and ${EBU.url} answered HTTP ${r.status}. ${unblock}`;
      zip = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return `BLOCKED: the EBU loudness test set isn't cached at ${path}, and ${EBU.url} could not be fetched (${(e as Error).message}). ${unblock}`;
    }
    if (sha256(zip) === EBU.sha256) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.${process.pid}.part`, zip);
      renameSync(`${path}.${process.pid}.part`, path);
    }
  }
  const got = sha256(zip);
  if (got !== EBU.sha256 || zip.length !== EBU.bytes) return `BLOCKED: the EBU loudness test set hashes to ${got} (${zip.length} bytes), not the pinned ${EBU.sha256} (${EBU.bytes} bytes); delete ${path} to fetch it again. ${unblock}`;
  const members = zipMembers(zip);
  return {
    file(name: string): Buffer {
      const m = members.get(name);
      expect(m, `the EBU set holds ${name}`).toBeDefined();
      const bytes = m!();
      expect(sha256(bytes), `${name} has its pinned SHA-256`).toBe(SIGNALS[name]);
      return bytes;
    },
  };
}

/** A zip's members by name, each inflated when asked (stored or deflate; the set needs no zip64). */
function zipMembers(zip: Buffer): Map<string, () => Buffer> {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  expect(eocd >= 0, 'the EBU zip has an end of central directory').toBe(true);
  const out = new Map<string, () => Buffer>();
  let o = zip.readUInt32LE(eocd + 16);
  for (let i = 0, n = zip.readUInt16LE(eocd + 10); i < n; i++) {
    const method = zip.readUInt16LE(o + 10);
    const csize = zip.readUInt32LE(o + 20);
    const nl = zip.readUInt16LE(o + 28);
    const local = zip.readUInt32LE(o + 42);
    const name = zip.toString('utf8', o + 46, o + 46 + nl);
    o += 46 + nl + zip.readUInt16LE(o + 30) + zip.readUInt16LE(o + 32);
    out.set(name, () => {
      const at = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(at, at + csize);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    });
  }
  return out;
}

/** Every blob in HEAD's tree and in the index, by git's blob ID: a signal found there was committed. */
export function trackedBlobs(): Set<string> {
  const ids = new Set<string>();
  const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  for (const line of tree.split('\n')) { const id = line.split(/\s+/)[2]; if (id) ids.add(id); }
  const index = execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  for (const line of index.split('\n')) { const id = line.split(/\s+/)[1]; if (id) ids.add(id); }
  return ids;
}
/** git's blob ID of `bytes` (SHA-1 of "blob <length>\0" and the bytes). */
export const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Readings over a loudness series (entry k ends at (k + 1) × 10 ms)

/** The entries whose windows end in (fromMs, toMs], with their end times. */
export function between(s: (number | null)[], fromMs: number, toMs: number): { ms: number; v: number | null }[] {
  const out: { ms: number; v: number | null }[] = [];
  s.forEach((v, k) => { const ms = 10 * (k + 1); if (ms > fromMs && ms <= toMs) out.push({ ms, v }); });
  return out;
}
/** The largest reading in a list (null, −∞, never wins), or null when every one is −∞ or there are none. */
export const maxOf = (xs: { v: number | null }[]): number | null => xs.reduce<number | null>((m, x) => (x.v !== null && (m === null || x.v > m) ? x.v : m), null);
export const fmt = (v: number | null): string => (v === null ? '−∞' : v.toFixed(3));
