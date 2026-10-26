// #382.90bd5f67: A new revision of a document that a host shows through level-of-detail open or a sheet cell misses
// the host's caches and reruns the host's check, so the host never shows the earlier revision after the new one is
// current.
// For each host kind (`lod_open`, `sheet_cell`): the film with its lamp bound, nine frames at 60 fps; revision 2 at
// frame 3 recolors the lamp to the crate's role; revision 3 at frame 6 recolors it to `spill`, a role 0.05 from fail,
// which the host's check must refuse. Per frame the reply names the revision shown, the current revision and the
// cell's or opened document's cache key with whether it hit. Expected: frames 0–2 show revision 1 (frame 0 a miss,
// 1–2 hits on one key), 3–8 show revision 2 (frame 3 a miss on a new key, 4–8 hits), the shown revision equals the
// current one at every frame, the check ran once per revision (three entries: 1 ok, 2 ok, 3 refused with
// `status_distance`), and frame 3's pixels equal (by pixel hash) a fresh host run whose first revision is the
// recolored document, so the host drew the new revision and not its cache. At the base there is no host call;
// `--planted host_cache_by_doc_id` keys the cache by document ID (frame 3 hits and shows revision 1);
// `--planted host_check_once` checks only the first revision (revision 3 becomes current, two checks missing).
import { describe, expect, it } from 'vitest';
import {
  STATUS, VERDICT, WRITER, alongL, answered, arr, bool, clone, deltaEOk, film, framesOf, fromHex, look3, num, obj, requireGpu, run1, set, str, useBin, useOut, writeJson,
  type JsonObject, type Rgb, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();

const ROLES: Record<string, Rgb> = { lamp: [240, 200, 120], block: [32, 192, 176], crate: [64, 128, 255], floor: [172, 172, 172], spill: alongL(fromHex(STATUS.fail), 0.05) };
const HOST_LOOK: JsonObject = look3('host-382', ROLES);
const KINDS = ['lod_open', 'sheet_cell'] as const;
type Kind = (typeof KINDS)[number];

interface Shown { frame: number; rev: number; current: number; key: string; hit: boolean; pixel: string | null }
function hostRun(kind: Kind, startup: Startup, doc: JsonObject, revisions: JsonObject[], frames: number): { shown: Shown[]; checks: JsonObject[] } {
  const bin = bins.bin();
  const path = writeJson(out(), `${kind}-${startup.planted ?? 'real'}-${doc['id']}.json`, doc);
  const reply = answered(run1(bin, out(), { call: 'host', kind, look: HOST_LOOK, size: [480, 360], doc: path, states: { [VERDICT]: 'pass' }, frames, fps: 60, revisions }, startup), `the ${kind} host`);
  const shown = framesOf(reply, 'host').map((f): Shown => {
    const cache = obj(f.raw['cache'], `frame ${f.frame}: cache`);
    return { frame: f.frame, rev: num(f.raw['rev'], `frame ${f.frame}: rev`), current: num(f.raw['current_rev'], `frame ${f.frame}: current_rev`), key: str(cache['key'], `frame ${f.frame}: cache.key`), hit: bool(cache['hit'], `frame ${f.frame}: cache.hit`), pixel: f.pixel_hash };
  });
  const checks = arr(reply['checks'], 'host: checks').map((c, i) => obj(c, `checks[${i}]`));
  return { shown, checks };
}

function revisions(kind: Kind, startup: Startup): string[] {
  const doc = film(`host-doc-382`, { binding: true });
  const patches: JsonObject[] = [
    { frame: 3, writer: WRITER, ops: [set('lamp', 'params/paint/fill/role', 'crate')] },
    { frame: 6, writer: WRITER, ops: [set('lamp', 'params/paint/fill/role', 'spill')] },
  ];
  const { shown, checks } = hostRun(kind, startup, doc, patches, 9);
  const failures: string[] = [];
  const at = (n: number): Shown | undefined => shown.find((s) => s.frame === n);
  for (let n = 0; n < 9; n++) {
    const s = at(n);
    if (!s) { failures.push(`${kind}: frame ${n} is missing from the reply`); continue; }
    const want = n < 3 ? 1 : 2;
    if (s.current !== want) failures.push(`${kind}: frame ${n}: current revision ${s.current}, expected ${want} (revision 3 is refused, so 2 stays current)`);
    if (s.rev !== s.current) failures.push(`${kind}: frame ${n}: shows revision ${s.rev} while revision ${s.current} is current`);
    if (s.rev !== want) failures.push(`${kind}: frame ${n}: shows revision ${s.rev}, expected ${want}`);
    const wantHit = n !== 0 && n !== 3;
    if (s.hit !== wantHit) failures.push(`${kind}: frame ${n}: cache ${s.hit ? 'hit' : 'miss'}, expected a ${wantHit ? 'hit' : 'miss'}`);
  }
  const f0 = at(0); const f2 = at(2); const f3 = at(3); const f8 = at(8);
  if (f0 && f2 && f0.key !== f2.key) failures.push(`${kind}: frames 0 and 2 (one revision) have different cache keys`);
  if (f2 && f3 && f2.key === f3.key) failures.push(`${kind}: revision 2 at frame 3 reuses revision 1's cache key ${f3.key.slice(0, 12)}…`);
  if (f3 && f8 && f3.key !== f8.key) failures.push(`${kind}: frames 3 and 8 (one revision) have different cache keys`);
  if (f2 && f3 && f2.pixel !== null && f2.pixel === f3.pixel) failures.push(`${kind}: frame 3's pixels equal frame 2's: the recolored lamp didn't show`);
  // The check reran per revision: 1 and 2 pass, 3 is refused for its data color near fail.
  if (checks.length !== 3) failures.push(`${kind}: ${checks.length} checks ran, expected one per revision (3): ${JSON.stringify(checks).slice(0, 600)}`);
  const check = (rev: number): JsonObject | undefined => checks.find((c) => c['rev'] === rev);
  for (const rev of [1, 2]) { const c = check(rev); if (!c) failures.push(`${kind}: no check of revision ${rev}`); else if (c['ok'] !== true) failures.push(`${kind}: revision ${rev} fails its check: ${JSON.stringify(c).slice(0, 400)}`); }
  const c3 = check(3);
  if (!c3) failures.push(`${kind}: no check of revision 3`);
  else {
    if (c3['ok'] !== false) failures.push(`${kind}: revision 3 (lamp 0.05 from fail) passes the host's check`);
    const codes = Array.isArray(c3['issues']) ? c3['issues'].map((i) => (i && typeof i === 'object' && !Array.isArray(i) ? i['code'] : null)) : [];
    if (!codes.includes('status_distance')) failures.push(`${kind}: revision 3's refusal lacks status_distance: ${JSON.stringify(c3).slice(0, 400)}`);
  }
  // The frame the new revision shows equals a fresh host run of the recolored document.
  if (f3 && f3.pixel !== null) {
    const recolored = clone(doc);
    recolored['id'] = 'host-doc-382-rev2';
    (obj(obj(obj(obj(recolored['items'], 'items')['lamp'], 'lamp')['params'], 'params')['paint'], 'paint')['fill'] as JsonObject)['role'] = 'crate';
    const fresh = hostRun(kind, startup, recolored, [], 1).shown[0];
    if (!fresh || fresh.pixel !== f3.pixel) failures.push(`${kind}: frame 3 (${f3.pixel.slice(0, 12)}…) differs from a fresh run of the recolored document (${fresh?.pixel?.slice(0, 12) ?? 'none'}…)`);
  }
  return failures;
}

describe('#382.90bd5f67 a new revision shown through level-of-detail open or a sheet cell misses the host\'s caches and reruns its check', () => {
  it('#382.90bd5f67 the spill role sits 0.05 from fail, so the host\'s check must refuse revision 3', () => {
    expect(Math.abs(deltaEOk(ROLES['spill']!, fromHex(STATUS.fail)) - 0.05)).toBeLessThanOrEqual(0.0025);
  });
  for (const kind of KINDS) {
    it(`#382.90bd5f67 through ${kind}: revision 2 misses the cache and shows from frame 3, revision 3 is checked and refused`, () => {
      requireGpu();
      const failures = revisions(kind, {});
      expect(failures, failures.join('\n')).toEqual([]);
    }, 1_800_000);
    it(`#382.90bd5f67 through ${kind}: a planted host that keys its cache by document ID fails, naming the frame`, () => {
      requireGpu();
      const failures = revisions(kind, { planted: 'host_cache_by_doc_id' });
      expect(failures.some((f) => /frame 3/.test(f)), `the mutant shows revision 1 at frame 3: ${failures.join('\n')}`).toBe(true);
    }, 1_800_000);
    it(`#382.90bd5f67 through ${kind}: a planted host that checks only the first revision fails, naming the missing checks`, () => {
      requireGpu();
      const failures = revisions(kind, { planted: 'host_check_once' });
      expect(failures.some((f) => /checks ran|no check of revision|current revision/.test(f)), `the mutant reruns no check: ${failures.join('\n')}`).toBe(true);
    }, 1_800_000);
  }
});
