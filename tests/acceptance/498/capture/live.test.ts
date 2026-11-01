// Criterion 4, live: the real camera and microphone through AVFoundation on this Mac, held by #339's ⌥Space in the
// HID key-state table. The virtual model in the other files can't show that the real device sessions start only at
// the hold, stop within one frame of the release and stay closed until the next hold, and a person must hold the
// chord, so this test runs only with DEEP_498_LIVE=1 on macOS with DeepBuild's Camera and Microphone permissions
// already granted; anywhere else it fails with INCONCLUSIVE, never a pass or a skip. The run never asks for a
// permission, so it never shows an OS prompt (README: The live run). At the base `deep-app` has no --capture-devices.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO, TARGET, exe, isObject, storeFiles, useFolders, type JsonObject, type JsonValue } from './helpers.ts';

const dirs = useFolders();
const made: string[] = [];
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Top-level ISO-BMFF boxes (MP4, MOV, M4A), if the bytes are such a file: each `[size][type]`, sizes adding up. */
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

const n = (v: JsonValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

describe('criterion 4 (live): the camera and microphone through AVFoundation, kept only while ⌥Space is held', () => {
  it('criterion 4 live a person holds ⌥Space twice: each hold keeps the camera\'s frames and the microphone\'s samples from its down to within one frame of its up, and the later request keeps nothing before the second hold', () => {
    if (process.env['DEEP_498_LIVE'] !== '1') expect.fail('INCONCLUSIVE: the live capture needs a person at a Mac with a camera and a microphone, DeepBuild\'s Camera and Microphone permissions already granted; run with DEEP_498_LIVE=1 (README: The live run)');
    if (process.platform !== 'darwin') expect.fail(`INCONCLUSIVE: the live capture runs on macOS, not ${process.platform}`);
    const build = spawnSync('cargo', ['build', '--locked', '-p', 'deep-app'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(build.status, `cargo build --locked -p deep-app: ${(build.stderr ?? '').slice(-2000)}`).toBe(0);
    const bin = mkdtempSync(join(tmpdir(), 'deep-498-app-'));
    made.push(bin);
    copyFileSync(join(TARGET, 'debug', exe('deep-app')), join(bin, exe('deep-app')));
    const store = dirs().evidence;
    // The app itself, not cargo, so the timeout's SIGKILL reaches the process it means; its prompts to the person go
    // to the terminal on stderr.
    const run = spawnSync(join(bin, exe('deep-app')), ['--capture-devices', store], {
      cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const report = (run.stdout ?? '').split('\n').reverse().map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return null; } })
      .find((v): v is JsonObject => isObject(v ?? undefined) && (v as JsonObject)['capture'] === 498);
    expect(run.status, `deep-app --capture-devices exits 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(-800)}`).toBe(0);
    expect(report, `deep-app --capture-devices prints its report line: ${(run.stdout ?? '').slice(-800)}`).toBeDefined();
    const r = report!;
    const permission = isObject(r['permission']) ? r['permission'] : {};
    for (const s of ['camera', 'microphone']) {
      if (permission[s] !== 'granted') expect.fail(`INCONCLUSIVE: DeepBuild's ${s} permission is ${JSON.stringify(permission[s])}; a person grants it in System Settings, then the run counts`);
    }
    const f: string[] = [];
    if (r['via'] !== 'os_permission + trusted control') f.push(`via is ${JSON.stringify(r['via'])}, not "os_permission + trusted control"`);
    if (r['hold'] !== 'shortcut') f.push(`hold is ${JSON.stringify(r['hold'])}, not "shortcut"`);
    const holds = Array.isArray(r['holds']) ? r['holds'].filter(isObject) : [];
    if (holds.length !== 2) f.push(`holds lists ${holds.length} holds, not 2`);
    const caps = Array.isArray(r['captures']) ? r['captures'].filter(isObject) : [];
    if (caps.length !== 4) f.push(`captures lists ${caps.length} captures, not the camera and microphone for each of 2 requests`);
    const assets: string[] = [];
    for (const req of [1, 2]) {
      const hold = holds[req - 1];
      const down = n(hold?.['down_ms']);
      const up = n(hold?.['up_ms']);
      if (down === null || up === null || up <= down) { f.push(`hold ${req}: down_ms ${JSON.stringify(hold?.['down_ms'])}, up_ms ${JSON.stringify(hold?.['up_ms'])}: not a hold`); continue; }
      for (const s of ['camera', 'microphone']) {
        const c = caps.find((x) => x['request'] === req && x['source'] === s);
        const w = `request ${req}'s ${s} capture`;
        if (!c) { f.push(`${w} is not in captures`); continue; }
        const requested = n(c['requested_ms']);
        if (requested === null || requested >= down) f.push(`${w}: requested_ms ${JSON.stringify(c['requested_ms'])} is not before its hold's down at ${down}`);
        if (req === 2 && (requested === null || requested <= n(holds[0]?.['up_ms'])!)) f.push(`${w}: requested_ms ${JSON.stringify(c['requested_ms'])} is not after the first hold's release`);
        if (c['kept_before_hold'] !== 0) f.push(`${req === 2 ? 'after the release: the later request' : 'before the hold:'} ${w} kept ${JSON.stringify(c['kept_before_hold'])} before its hold`);
        const period = n(c['period_ms']);
        const kept = n(c['kept']);
        const first = n(c['first_ms']);
        const last = n(c['last_ms']);
        if (period === null || period <= 0) f.push(`${w}: period_ms ${JSON.stringify(c['period_ms'])} is not the device's frame duration`);
        if (kept === null || kept < 1) f.push(`${w}: kept ${JSON.stringify(c['kept'])}, not at least one`);
        if (first === null || first < down) f.push(`before the hold: ${w}'s first kept is at ${JSON.stringify(c['first_ms'])} ms, before its hold's down at ${down} ms`);
        if (last === null || period === null || last >= up + period) f.push(`after the release: ${w}'s last kept is at ${JSON.stringify(c['last_ms'])} ms, not within one frame (${period} ms) of the release at ${up} ms`);
        const asset = isObject(c['asset']) ? c['asset'] : {};
        if (asset['redaction'] !== 'unknown') f.push(`${w}: asset.redaction is ${JSON.stringify(asset['redaction'])}, not unknown`);
        if (typeof asset['sha256'] === 'string') assets.push(asset['sha256']); else f.push(`${w}: asset.sha256 is ${JSON.stringify(asset['sha256'])}`);
      }
    }
    const files = storeFiles(store);
    if (files.length !== 4) f.push(`the store holds ${files.length} files, not the four assets`);
    for (const sha of assets) {
      const file = files.find((e) => e.sha === sha);
      if (!file) { f.push(`asset ${sha} is not a file in the store`); continue; }
      if (createHash('sha256').update(readFileSync(join(store, file.path))).digest('hex') !== file.sha) f.push(`${file.path} doesn't hash to its name`);
      const b = boxes(file.bytes);
      if (!b || b[0] !== 'ftyp' || !b.includes('moov')) f.push(`${file.path} is not a whole MP4, MOV or M4A (boxes ${JSON.stringify(b)})`);
    }
    expect(f, 'the live capture').toEqual([]);
  }, 900_000);
});
