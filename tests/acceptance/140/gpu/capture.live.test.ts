// AC5 (its second half), live: the capture seam's macOS backend starts a capture only through the system picker, with
// the system's indicator showing. `deep-app --capture-seam` first asks the backend for a capture of the main display
// with no picker, which must be refused with no frame and no indicator; then it opens ScreenCaptureKit's system
// picker, a person picks any display or window, it records 3 s, and it reads from the window server whether the
// system's screen-recording indicator shows while frames arrive. A person must answer the picker, so this runs only
// with DEEP_140_LIVE=1; otherwise it fails INCONCLUSIVE, never passing. At the base `deep-app` has no
// --capture-seam and the run ends without a report.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO, buildApp, isObject, reportLine, requireLive, shown } from './helpers.ts';

describe('AC5 capture starts only through the system picker, with the system\'s indicator showing (live)', () => {
  it('AC5 a capture asked for without the picker is refused with no frame and no indicator; through the picker a person answers, it records what they picked, and the system\'s indicator shows while it does', () => {
    requireLive('the capture check, where a person answers the system picker,');
    const app = buildApp();
    try {
      expect(app.error, 'deep-app builds: cargo build --locked -p deep-app').toBe('');
      const r = spawnSync(app.bin, ['--capture-seam'], { cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
      expect(r.status, `deep-app --capture-seam exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
      const line = reportLine(r.stdout ?? '', 'capture');
      expect(line, `deep-app --capture-seam prints its report line: ${(r.stdout ?? '').slice(-800)}`).toBeDefined();
      const x = line!;
      if (x['permission'] !== 'granted') expect.fail(`INCONCLUSIVE: Screen Recording is ${String(x['permission'])}; a person grants it in System Settings, then the run counts`);
      const f: string[] = [];
      const backend = isObject(x['backend']) ? x['backend'] : {};
      if (typeof backend['name'] !== 'string' || typeof backend['version'] !== 'string') f.push(`the report names no capture backend and version: ${shown(x['backend'])}`);
      const direct = isObject(x['direct']) ? x['direct'] : {};
      if (direct['outcome'] !== 'refused') f.push(`a capture asked for without the picker was ${shown(direct['outcome'])}, not refused`);
      if (direct['frames'] !== 0) f.push(`the capture asked for without the picker kept ${shown(direct['frames'])} frames`);
      if (!isObject(direct['indicator']) || direct['indicator']['system'] !== false) f.push(`the system's indicator during the refused capture read ${shown(direct['indicator'])}, not off`);
      if (x['picker'] !== true) f.push(`picker is ${shown(x['picker'])}: the capture didn't start through the system picker`);
      if (!isObject(x['picked']) || JSON.stringify(x['picked']) !== JSON.stringify(x['recorded'])) f.push(`it recorded ${shown(x['recorded'])}, not what the person picked, ${shown(x['picked'])}`);
      if (typeof x['frames'] !== 'number' || x['frames'] < 1) f.push(`frames is ${shown(x['frames'])}, not at least one`);
      if (!isObject(x['indicator']) || x['indicator']['system'] !== true) f.push(`the system's indicator while recording read ${shown(x['indicator'])}, not showing`);
      expect(f, 'the capture seam').toEqual([]);
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  }, 900_000);
});
