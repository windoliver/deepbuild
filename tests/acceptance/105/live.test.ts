// The proof line, live: a recorded capture from a second display, through ScreenCaptureKit's system picker and #339's
// held ⌥Space, on the reference Mac. The virtual model in the other files can't show that the real picker, the real
// HID table and the real encoder do it, and a person must pick the display and hold the chord, so this test runs only
// with DEEP_105_LIVE=1 on a fit reference Mac; anywhere else it fails with INCONCLUSIVE, never a pass or a skip.
// README: The live run. At the base `deep-app` has no --capture-bug and the run ends without a report.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, environmentProblem, isObject, sha256, storeFiles, useFolders, type JsonObject, type JsonValue } from './helpers.ts';

const dirs = useFolders();

/** Top-level MP4 boxes, if the bytes are one: each `[size][type]`, sizes adding up to the file. */
function boxes(b: Buffer): string[] | null {
  const out: string[] = [];
  for (let at = 0; at < b.length;) {
    if (at + 8 > b.length) return null;
    let size = b.readUInt32BE(at);
    if (size === 1) { if (at + 16 > b.length) return null; size = Number(b.readBigUInt64BE(at + 8)); }
    else if (size === 0) size = b.length - at;
    if (size < 8 || at + size > b.length) return null;
    out.push(b.toString('latin1', at + 4, at + 8));
    at += size;
  }
  return out;
}

describe('Proof (live): a capture of a second display through the system picker on the reference Mac', () => {
  it('Proof a person picks the second display in the system picker and holds ⌥Space: one MP4 by hash, redaction unknown, its first frame within 100 ms', () => {
    if (process.env['DEEP_105_LIVE'] !== '1') expect.fail('INCONCLUSIVE: the live capture needs a person at the reference Mac with a second display; run with DEEP_105_LIVE=1 (README: The live run)');
    const problem = environmentProblem();
    if (problem) expect.fail(`INCONCLUSIVE: ${problem}`);
    const build = spawnSync('cargo', ['build', '--locked', '-p', 'deep-app'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(build.status, `cargo build --locked -p deep-app: ${(build.stderr ?? '').slice(-2000)}`).toBe(0);
    const store = dirs().evidence;
    // The app itself, not cargo, so the timeout's SIGKILL reaches the process it means.
    const run = spawnSync(join(REPO, 'target', 'debug', 'deep-app'), ['--capture-bug', store], { cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    const report = (run.stdout ?? '').split('\n').reverse().map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return null; } })
      .find((v): v is JsonObject => isObject(v ?? undefined) && (v as JsonObject)['capture'] === 105);
    expect(run.status, `deep-app --capture-bug exits 0 (${run.signal ?? 'no signal'}): ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
    expect(report, `deep-app --capture-bug prints its report line: ${(run.stdout ?? '').slice(-800)}`).toBeDefined();
    const r = report!;
    if (r['permission'] !== 'granted') expect.fail(`INCONCLUSIVE: Screen Recording is ${String(r['permission'])}; a person grants it in System Settings, then the run counts`);
    const display = isObject(r['display']) ? r['display'] : {};
    const asset = isObject(r['asset']) ? r['asset'] : {};
    const f: string[] = [];
    if (r['picker'] !== true) f.push(`picker is ${JSON.stringify(r['picker'])}: the content was not chosen through the system picker`);
    if (r['source'] !== 'screen') f.push(`source is ${JSON.stringify(r['source'])}, not screen`);
    if (display['main'] !== false) f.push(`display.main is ${JSON.stringify(display['main'])}: not a second display`);
    if (typeof r['frames'] !== 'number' || r['frames'] < 1) f.push(`frames is ${JSON.stringify(r['frames'])}, not at least one`);
    if (typeof r['first_frame_ms'] !== 'number' || r['first_frame_ms'] > 100) f.push(`first_frame_ms is ${JSON.stringify(r['first_frame_ms'])}, not within 100 ms`);
    if (typeof r['held_ms'] !== 'number' || r['held_ms'] <= 0) f.push(`held_ms is ${JSON.stringify(r['held_ms'])}: the chord was never held`);
    if (asset['redaction'] !== 'unknown') f.push(`asset.redaction is ${JSON.stringify(asset['redaction'])}, not unknown`);
    const files = storeFiles(store);
    if (files.length !== 1) f.push(`the store holds ${files.length} files, not one asset`);
    const file = files.find((e) => e.sha === asset['sha256']);
    if (!file) f.push(`asset.sha256 ${JSON.stringify(asset['sha256'])} is not a file in the store`);
    else {
      if (sha256(readFileSync(join(store, file.path))) !== file.sha) f.push(`${file.path} doesn't hash to its name`);
      const b = boxes(file.bytes);
      if (!b || b[0] !== 'ftyp' || !b.includes('moov')) f.push(`${file.path} is not a whole MP4 (boxes ${JSON.stringify(b)})`);
    }
    expect(f, 'the live capture').toEqual([]);
  }, 900_000);
});
