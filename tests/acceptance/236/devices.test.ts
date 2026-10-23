// #236 AC1: a sandboxed piece's child processes get no devices, as the piece itself gets none. The piece is a
// process started through the supervisor with an ordinary grant (its programs and an output folder); the
// helper is fixtures/devices.m, run as the piece itself and as a child the piece spawns (README, AC1).
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bins, cleanup, DEVICES, devicesIn, runId, sub, tempDir, tried, type Device } from './helpers.ts';
import { openWorld, type World } from './world.ts';

afterEach(cleanup, 30_000);

/** The helper's lines inside a piece the supervisor started: as the piece itself, or as a child it spawns. */
async function inPiece(w: World, asChild: boolean): Promise<Device[]> {
  const b = bins();
  const dir = tempDir();
  const out = sub(dir, 'out');
  const file = join(out, 'devices.json');
  const argv = asChild ? [b.probe, '-o', join(out, 'probe.json'), 'spawn', b.devices, file] : [b.devices, file];
  const run = runId();
  const started = await w.sup.start({ run, argv, cwd: dir, grant: { read: [b.dir], write: [out] } });
  expect(started.status, `${run} didn't start: ${JSON.stringify(started)}`).toBe('started');
  await w.sup.wait(run);
  await w.sup.cleanup(run);
  if (asChild) expect(tried(join(out, 'probe.json'), 'spawn', b.devices).ok, 'the piece spawned the helper and it ran').toBe(true);
  const lines = devicesIn(file);
  expect(lines.map((l) => l.device), `the helper reported every device (${file})`).toEqual([...DEVICES]);
  return lines;
}
/** The same helper run by the test itself, outside any sandbox: what the app it is credited to may do. */
function outside(): Device[] {
  const file = join(sub(tempDir(), 'out'), 'devices.json');
  execFileSync(bins().devices, [file]);
  return devicesIn(file);
}

describe('AC1 #236.5dec450f a sandboxed piece and its child processes get no devices', () => {
  it('AC1 the piece and a helper it spawns are denied the camera, the microphone, the audio output and a screen capture by the sandbox', async () => {
    const control = outside();
    for (const d of control) expect(d.sandbox, `BLOCKED: outside any sandbox the helper reads ${d.device} as ${d.sandbox}, so it can't tell a denial`).toBe('allow');
    const w = await openWorld();
    try {
      for (const asChild of [false, true]) {
        const who = asChild ? 'a helper the piece spawned' : 'the piece itself';
        for (const d of await inPiece(w, asChild)) {
          expect(d.sandbox, `${who}: the sandbox allows the ${d.device}`).toBe('deny');
          expect(d.open, `${who} opened the ${d.device}`).not.toBe('ok');
        }
      }
    } finally {
      await w.close();
    }
  }, 60_000);

  it('AC1 on a Mac where the app holds the permissions, the same helper that opens each device outside the sandbox is denied inside it', async (ctx) => {
    const control = outside();
    const missing = control.filter((d) => d.open !== 'ok').map((d) => `${d.device} (${d.open})`);
    if (missing.length) ctx.skip(`INCONCLUSIVE: outside the sandbox this machine's app can't open ${missing.join(', ')}; run on the reference Mac with DeepBuild holding the camera, microphone and screen recording permissions`);
    const w = await openWorld();
    try {
      for (const d of await inPiece(w, true)) {
        expect(d.open, `a helper the piece spawned opened the ${d.device}, which the app it is credited to may open`).not.toBe('ok');
        expect(d.sandbox, `the ${d.device} failed, but not by the sandbox`).toBe('deny');
      }
    } finally {
      await w.close();
    }
  }, 60_000);
});
