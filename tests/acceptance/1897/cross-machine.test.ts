// AC2 #1897.0cf38b45: "Across machines, the determinism check compares only Vello CPU rasters from its f32 pipeline at
// the scalar SIMD level; a raster rendered at a detected SIMD level or through the u8 pipeline is refused as
// cross-machine evidence, naming the setting"
//
// Through `deep-show run`'s `determinism` call with `compare: "cross_machine"` (README: `determinism`, cross_machine).
// Without `against` it makes this machine's record: per time, the Vello CPU raster (`raster_2d`, its raw pixels by
// SHA-256 and the `renderer` block #385's `raster` answers with) beside the evaluated data, at the `raster_2d` settings
// asked (default: f32 pipeline, scalar level). With `against`, another record, it compares the two. Here, on one
// machine: an honest record's rasters are all Vello CPU, f32, scalar, and it holds no GPU pixel hash ("It can never:
// Compare GPU pixels across machines"); a record whose rasters were rendered at the detected SIMD level, or through the
// u8 pipeline, is refused as evidence on either side of the comparison, naming `simd` or `pipeline`; an honest pair is
// never refused for its rasters, and, being one machine's, never passes as cross-machine (Golden: a run on the same
// architecture "never satisfies cross_machine"). The cross-architecture leg compares this machine's record with one
// made by the same test on a machine of the other architecture (Platform seams: aarch64 and x86_64; a linux/amd64
// container counts for CPU checks), named by DEEP_1897_OTHER_RECORD; without it the test is BLOCKED after the one-machine
// half has run. Wrong program: the base, whose `determinism` call has no cross-machine form.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, REPO, SLIDING, TIMEOUT, arr, blocked, inconclusive, int, isObject, obj, present, presented, runShow, scenario, sec, sha,
  show, str, useShow, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** The times each record holds: the start, inside the slide, and the flick before the slide's last key. */
const TIMES = [0, sec(1), sec(2) - 1];
const OTHER = 'DEEP_1897_OTHER_RECORD';

const cross = (extra: JsonObject = {}): JsonObject => ({ call: 'determinism', doc: DOC, display_hz: 144, at_times: TIMES, compare: 'cross_machine', ...extra });

interface Raster { t: number; raw: string; renderer: JsonObject }
interface Made { raw: JsonObject; arch: string; rasters: Raster[] }
/** A made record: this machine's, per time its Vello CPU raster and the renderer that drew it. */
function recordOf(reply: JsonObject, what: string): Made {
  expect(reply['outcome'], `${what} is recorded: ${show(reply)}`).toBe('recorded');
  const raw = obj(reply['record'], `${what}: record`);
  const arch = str(obj(raw['machine'], `${what}: record.machine`)['arch'], `${what}: record.machine.arch`);
  const rasters = arr(raw['frames'], `${what}: record.frames`).map((v, i) => {
    const f = obj(v, `${what}: record.frames[${i}]`);
    const r = obj(f['raster_2d'], `${what}: record.frames[${i}].raster_2d`);
    return { t: int(f['t'], `${what}: record.frames[${i}].t`), raw: sha(r['raw'], `${what}: record.frames[${i}].raster_2d.raw`), renderer: obj(r['renderer'], `${what}: record.frames[${i}].raster_2d.renderer`) };
  });
  expect(rasters.map((r) => r.t), `${what}: one frame per time asked`).toEqual(TIMES);
  return { raw, arch, rasters };
}
/** Every key path in `v` named `name`. */
function keysNamed(v: JsonValue, name: string, at = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => keysNamed(x, name, `${at}/${i}`));
  if (!isObject(v)) return [];
  return Object.entries(v).flatMap(([k, x]) => [...(k === name ? [`${at}/${k}`] : []), ...keysNamed(x, name, `${at}/${k}`)]);
}
/** The comparison refused the evidence, naming the setting that isn't the reference's. */
function refusedNaming(reply: JsonObject, setting: 'simd' | 'pipeline', what: string): void {
  expect(reply['outcome'], `${what} is refused as cross-machine evidence: ${show(reply)}`).toBe('refused');
  expect(reply['code'], `${what}: refused as a raster that isn't the reference: ${show(reply)}`).toBe('cross_machine_raster');
  expect(reply['setting'], `${what}: the refusal names the setting ${setting}: ${show(reply)}`).toBe(setting);
}

describe(`${AC[2]} across machines the determinism check compares only Vello CPU rasters from the f32 pipeline at the scalar level`, () => {
  it(`${AC[2]} an honest record holds only Vello CPU f32 scalar rasters and no GPU pixel hash; a raster at the detected SIMD level or through u8 is refused on either side, naming simd or pipeline; an honest pair from one machine is compared but never passes; the other architecture's record passes`, () => {
    const made = runShow(shows.bin(FULL), scenario(temp(), [present(SLIDING), cross(), cross({ raster_2d: { simd: 'detected' } }), cross({ raster_2d: { pipeline: 'u8' } })]), 'the records');
    presented(made[0]!, 'the sliding board');
    const honest = recordOf(made[1]!, 'the honest record');
    const detected = recordOf(made[2]!, 'the record at the detected SIMD level');
    const u8 = recordOf(made[3]!, 'the record through the u8 pipeline');
    for (const r of honest.rasters) {
      expect(r.renderer, `at ${r.t} flicks the honest record's raster is Vello CPU's f32 pipeline at the scalar level`).toMatchObject({ name: 'vello_cpu', pipeline: 'f32', simd: 'scalar' });
    }
    expect(keysNamed(honest.raw, 'pixel_hash'), 'the cross-machine record holds no GPU pixel hash').toEqual([]);
    const detectedLevel = String(detected.rasters[0]!.renderer['simd']);
    for (const r of u8.rasters) expect(r.renderer, `at ${r.t} flicks the u8 record names its pipeline`).toMatchObject({ name: 'vello_cpu', pipeline: 'u8' });

    // This machine's honest record, kept where the other architecture's run can be pointed at it.
    const keep = join(REPO, 'target', 'acceptance-1897', `record-${process.platform}-${process.arch}.json`);
    mkdirSync(join(REPO, 'target', 'acceptance-1897'), { recursive: true });
    writeFileSync(keep, `${JSON.stringify(honest.raw)}\n`);

    const noSimd = detectedLevel === 'scalar';
    const judged = runShow(shows.bin(FULL), scenario(temp(), [
      present(SLIDING),
      cross({ against: u8.raw }),
      cross({ raster_2d: { pipeline: 'u8' }, against: honest.raw }),
      cross({ against: honest.raw }),
      ...(noSimd ? [] : [cross({ against: detected.raw }), cross({ raster_2d: { simd: 'detected' }, against: honest.raw })]),
    ]), 'the comparisons');
    presented(judged[0]!, 'the sliding board');
    refusedNaming(judged[1]!, 'pipeline', 'against a record rendered through the u8 pipeline');
    refusedNaming(judged[2]!, 'pipeline', 'this side rendered through the u8 pipeline');
    const pair = judged[3]!;
    expect(pair['outcome'] === 'refused' && pair['code'] === 'cross_machine_raster', `an honest pair is not refused for its rasters: ${show(pair)}`).toBe(false);
    expect(pair['result'], `two records from one machine never pass as cross-machine: ${show(pair)}`).not.toBe('PASS');
    if (noSimd) inconclusive(`Vello CPU detects no SIMD level on this machine (${process.arch}), so the detected-level refusal can't be shown here`);
    refusedNaming(judged[4]!, 'simd', `against a record rendered at the detected SIMD level (${detectedLevel})`);
    refusedNaming(judged[5]!, 'simd', `this side rendered at the detected SIMD level (${detectedLevel})`);

    const path = process.env[OTHER];
    if (!path) blocked(`the cross-architecture leg needs the other architecture's record: run this test on a machine of the other architecture (x86_64 for this ${process.arch} one, or the reverse) and set ${OTHER} to the record it writes there (target/acceptance-1897/record-<platform>-<arch>.json); this machine's is at ${keep}`);
    const other = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `the record at ${path}`);
    const otherArch = str(obj(other['machine'], `the record at ${path}: machine`)['arch'], `the record at ${path}: machine.arch`);
    if (otherArch === honest.arch) blocked(`the record at ${path} is from ${otherArch}, this machine's own architecture; ${OTHER} must name a record from the other one`);
    const [shown, across] = runShow(shows.bin(FULL), scenario(temp(), [present(SLIDING), cross({ against: other })]), 'the cross-architecture comparison');
    presented(shown!, 'the sliding board');
    expect(across!['outcome'], `the comparison with ${otherArch}'s record runs: ${show(across)}`).toBe('compared');
    expect(across!['result'], `Vello CPU's f32 scalar rasters and the evaluated data are identical on ${honest.arch} and ${otherArch}: ${show(across, 3000)}`).toBe('PASS');
    expect(across!['machines'], `the result holds on any machine: ${show(across)}`).toBe('any');
  }, TIMEOUT);
});
