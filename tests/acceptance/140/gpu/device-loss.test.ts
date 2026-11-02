// AC20: the GPU backend's device-loss test with work in flight off the UI thread. A compile-thread job for the
// fixture scene's eight pipelines is held open (`compile` with `hold`), the device is forced lost (`lose_device`), and
// the job is then released (`release_job`). What the job returns was made on the lost device: it must be dropped,
// the pipelines compiled again on the new device's epoch, no frame may draw a pipeline from the lost device, and the
// first settled frame must equal a clean start's by pixel hash. `--planted installs_stale_pipelines` installs
// whatever the compile thread returns; the check fails it naming the pipeline and both epochs. At the base the
// `compile` call has no `hold` and there is no `lose_device` or `release_job` call.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { arr, num, obj, requireMac, run, sha256, shown, str, useBuilds, useOut, type JsonObject, type Startup } from './helpers.ts';

const bins = useBuilds(['default']);
const out = useOut();
const SCENE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pipelines.scene');
const PIPELINES = 8;
const COUNT = 60;
/** The scene's 128 × 64 frame with nothing but its opaque black background, as BGRA8 rows: what a frame drawing no cell would hash to. */
const BACKGROUND = sha256(Buffer.from(new Uint8Array(128 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0))));

interface Frame { frame: number; epoch: number; settling: boolean; hash: string | null; pipelines: { key: string; epoch: number }[] }
function frames(reply: JsonObject, what: string): Frame[] {
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const hash = f['pixel_hash'];
    return {
      frame: num(f['frame'], `${what}: frames[${i}].frame`),
      epoch: num(f['device_epoch'], `${what}: frames[${i}].device_epoch`),
      settling: f['settling'] === true,
      hash: typeof hash === 'string' ? hash : null,
      pipelines: arr(f['pipelines'], `${what}: frames[${i}].pipelines`).map((p, j) => {
        const o = obj(p, `${what}: frames[${i}].pipelines[${j}]`);
        return { key: str(o['key'], `${what}: frames[${i}].pipelines[${j}].key`), epoch: num(o['device_epoch'], `${what}: frames[${i}].pipelines[${j}].device_epoch`) };
      }),
    };
  });
}

/** The check: after the loss every frame is on the new device and draws only pipelines made on it. */
function staleDraws(fs: Frame[], lost: number, current: number): string[] {
  const f: string[] = [];
  for (const x of fs) {
    if (x.epoch !== current) f.push(`frame ${x.frame} drew on device epoch ${x.epoch}, not the new device's ${current}`);
    for (const p of x.pipelines) if (p.epoch !== x.epoch) f.push(`frame ${x.frame} drew pipeline ${p.key} made on epoch ${p.epoch}${p.epoch === lost ? ' (the lost device)' : ''} on the device at epoch ${x.epoch}`);
  }
  return f;
}

interface LossRun { held: JsonObject; lost: number; current: number; released: JsonObject; frames: Frame[] }
function lossRun(startup: Startup = {}): LossRun {
  // The job, the loss, the release and the frames are one scenario: one process, one app, one held job.
  const replies = run(bins.bin(), out(), [
    { call: 'compile', scene: SCENE, hold: true }, { call: 'lose_device' }, { call: 'release_job' }, { call: 'frames', scene: SCENE, count: COUNT },
  ], startup);
  const h = replies[0]!;
  const l = replies[1]!;
  expect(h['state'], `the compile job is held open: ${shown(h)}`).toBe('held');
  const lost = num(l['lost_epoch'], 'lose_device: lost_epoch');
  const current = num(l['device_epoch'], 'lose_device: device_epoch');
  expect(num(h['device_epoch'], 'compile: device_epoch'), 'the held job compiles on the device that is then lost').toBe(lost);
  expect(current, 'the new device has a later epoch').toBeGreaterThan(lost);
  return { held: h, lost, current, released: replies[2]!, frames: frames(replies[3]!, 'frames after the loss') };
}

describe('AC20 a device lost while a compile-thread job for a document\'s pipelines is held open: nothing from the lost device is drawn, the pipelines compile again on the new epoch, and the next settled frame equals a clean start\'s', () => {
  it('AC20 the released job\'s pipelines are dropped, every frame draws only pipelines made on the new device\'s epoch, all eight compile again there, and the first settled frame equals a clean start\'s by pixel hash', () => {
    requireMac();
    const r = lossRun();
    expect(r.released['outcome'], `what the job returned after the loss is dropped: ${shown(r.released)}`).toBe('dropped');
    expect(num(r.released['compiled_on'], 'release_job: compiled_on'), 'the job had compiled on the lost device').toBe(r.lost);
    expect(r.frames.length, 'the frames after the loss were presented').toBeGreaterThan(0);
    expect(staleDraws(r.frames, r.lost, r.current), 'no frame draws a pipeline from the lost device').toEqual([]);
    const settled = r.frames.find((x) => !x.settling);
    expect(settled, `a frame settles within ${COUNT} frames of the loss`).toBeDefined();
    const keys = new Set(settled!.pipelines.map((p) => p.key));
    expect(keys.size, `the settled frame draws the scene's ${PIPELINES} pipelines`).toBe(PIPELINES);
    expect(settled!.pipelines.every((p) => p.epoch === r.current), 'each compiled again on the new device\'s epoch').toBe(true);
    const clean = frames(run(bins.bin(), out(), [{ call: 'frames', scene: SCENE, count: COUNT }])[0]!, 'a clean start').find((x) => !x.settling);
    expect(clean?.hash ?? null, 'a clean start settles with pixels').not.toBe(null);
    expect(clean!.hash, 'the clean start draws the cells, not the background alone').not.toBe(BACKGROUND);
    expect(settled!.hash, 'the next settled frame after the loss equals a clean start\'s by pixel hash').toBe(clean!.hash);
  }, 1_800_000);

  it('AC20 a planted view that installs whatever the compile thread returns fails, naming the pipeline and both epochs', () => {
    requireMac();
    const r = lossRun({ planted: 'installs_stale_pipelines' });
    const f = staleDraws(r.frames, r.lost, r.current);
    expect(f.length, `the planted view draws a pipeline from the lost device: ${shown(r.released)}`).toBeGreaterThan(0);
    const named = f.find((x) => x.includes(`epoch ${r.lost}`) && x.includes(`epoch ${r.current}`) && /pipeline \S+/.test(x));
    expect(named, `a failure names the pipeline and both epochs (${r.lost}, ${r.current}): ${f.slice(0, 3).join('; ')}`).toBeDefined();
  }, 1_800_000);
});
