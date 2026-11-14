// #2435 AC4, rebuilds: a mesh of 10,000, 50,000 and 100,000 triangles posed anew each frame for 300 frames
// after warm-up; its bottom level's rebuild time under the fast-build and the fast-trace preference, and a
// 1080p trace at one ray per pixel against each, as p50 and p95 from GPU timestamps. wgpu-core 30.0.1 turns
// an update into a rebuild; the report shows it. Timings are readings: a run timed while another GPU job
// holds the machine's GPU lease reads INCONCLUSIVE, never a number. The tests read the timings from the
// committed report and never run the 300-frame timing themselves.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { NOT_PASS, RECORD, count, exitedNotPass, finite, loadRecord, obj, recordPart, recordPlant, runProbe } from './helpers.mjs';

const SIZES = [10_000, 50_000, 100_000];
const PREFERENCES = ['fast_build', 'fast_trace'];
const FRAMES = 300;
const RAYS = 10_000;
const PLANT = 'lease_held';

const percentiles = (x) => obj(x) && finite(x.p50) && finite(x.p95) && x.p50 > 0 && x.p50 <= x.p95;

test('#2435 AC4 the report gives the six rebuild and six trace times as p50 and p95, and a structure asked to update is rebuilt: 10,000 rays at frame 2 hit where a fresh build\'s do', () => {
  const r = recordPart(loadRecord(), 'rebuilds');
  assert.equal(r.status, 'PASS', `rebuilds reads ${r.status}: ${r.reason}`);
  assert.ok(PREFERENCES.includes(r.form_for_475), `the report names the form #475 takes, one of ${PREFERENCES.join(', ')}: ${JSON.stringify(r.form_for_475)}`);
  assert.ok(Number.isInteger(r.frames) && r.frames >= FRAMES, `rebuilds: timed over 300 frames after warm-up: ${JSON.stringify(r.frames)}`);
  assert.deepEqual(r.resolution, [1920, 1080], 'rebuilds: the trace is one ray per pixel at 1080p');
  assert.ok(Array.isArray(r.timings) && r.timings.length === SIZES.length * PREFERENCES.length, `rebuilds: six timings: ${JSON.stringify(r.timings)?.slice(0, 500)}`);
  for (const triangles of SIZES) {
    for (const preference of PREFERENCES) {
      const at = r.timings.filter((t) => obj(t) && t.triangles === triangles && t.preference === preference);
      assert.equal(at.length, 1, `rebuilds: one timing for ${triangles} triangles under ${preference}`);
      assert.ok(percentiles(at[0].rebuild_ms), `${triangles} ${preference}: rebuild_ms p50 and p95, with 0 < p50 <= p95: ${JSON.stringify(at[0].rebuild_ms)}`);
      assert.ok(percentiles(at[0].trace_ms), `${triangles} ${preference}: trace_ms p50 and p95, with 0 < p50 <= p95: ${JSON.stringify(at[0].trace_ms)}`);
    }
  }
  const u = r.update_check;
  assert.ok(obj(u), 'rebuilds: no update_check');
  assert.equal(u.frame, 2, 'update_check: the structure asked to update is traced at frame 2');
  assert.equal(u.rays, RAYS, 'update_check: 10,000 rays');
  assert.match(String(u.log), /only rebuild (is )?implemented/, 'update_check: wgpu-core\'s own log line shows the structure was asked to update and rebuilt');
  assert.ok(count(u.differ_from_frame_1) && u.differ_from_frame_1 > 0 && u.differ_from_frame_1 <= RAYS, `update_check: the frame-2 pose moves some of the 10,000 answers from frame 1's, or a stale structure would pass: ${JSON.stringify(u.differ_from_frame_1)}`);
  assert.equal(u.same_as_fresh, RAYS, `update_check: ${u.same_as_fresh} of 10,000 rays hit where a fresh build's do`);
});

// Every timing in a part: a number under a key ending in _ms, or a {p50, p95} with a number in it.
function timings(x, path = []) {
  if (Array.isArray(x)) return x.flatMap((v, i) => timings(v, [...path, i]));
  if (!obj(x)) return [];
  return Object.entries(x).flatMap(([k, v]) => {
    const at = [...path, k];
    if (k.endsWith('_ms') && (finite(v) || (obj(v) && (finite(v.p50) || finite(v.p95))))) return [at.join('.')];
    return timings(v, at);
  });
}

function inconclusive(out, shown) {
  const r = out?.parts?.rebuilds;
  assert.ok(obj(r), `${shown}: the report has no parts.rebuilds`);
  if (r.status === 'BLOCKED') throw new Error(`BLOCKED: ${shown} read BLOCKED, so the lease couldn't be judged: ${r.reason}`);
  assert.equal(r.status, 'INCONCLUSIVE', `${shown}: timed while another GPU job holds the lease, rebuilds reads ${r.status}`);
  assert.ok(NOT_PASS.includes(out.status), `${shown}: the run reads ${out.status}`);
  assert.match(String(r.reason), /lease/i, `${shown}: the INCONCLUSIVE names the held lease: ${JSON.stringify(r.reason)}`);
  assert.deepEqual(timings(r), [], `${shown}: a run timed under another job's lease gives no number`);
}

test('#2435 AC4 plant: a run timed while another GPU job holds the lease reads INCONCLUSIVE, never a number, in the report and live', () => {
  inconclusive(recordPlant(loadRecord(), PLANT), `${RECORD} plants.${PLANT}`);
  // The machine's GPU lease (crates/deep-show/src/kit/goldens.rs, GpuLease): $HOME/.cache/deepbuild-gpu/lease,
  // holding the holder's PID. A HOME of the test's own holds it for this test's live process, so no other
  // session's GPU work waits on it.
  const home = mkdtempSync(join(tmpdir(), 'deepbuild-2435-lease-'));
  try {
    const lease = join(home, '.cache', 'deepbuild-gpu', 'lease');
    mkdirSync(dirname(lease), { recursive: true });
    writeFileSync(lease, String(process.pid));
    const run = runProbe(['--part', 'rebuilds'], { env: { HOME: home } });
    inconclusive(run.out, run.shown);
    exitedNotPass(run);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
