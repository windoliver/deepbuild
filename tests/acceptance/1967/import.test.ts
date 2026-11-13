// SCOPE (the issue's Scope and Fields, not its criterion): "Terminal recordings as assets, converted at import in the
// decode worker by a pinned terminal emulator into a keyframe every second and row patches in flicks"; Fields `kind: …
// | terminal` (a size, then output bytes with their times) and `probe: {terminal: {cols, rows: u16, span: flick,
// keyframes: u32}}`. #498's `media_import` of the recording answers it as an asset of kind `terminal`, by the file's
// SHA-256, probed in a decode worker (a process other than deep-show's own) whose decoder is named and versioned (the
// pinned emulator), with its size, its span (the time of its last output, 1.5 s) and its keyframes (one each whole
// second from 0 to the span: 0 s and 1 s). Wrong programs: the base (a recording isn't an asset kind it knows);
// #498's `decodes_in_app` (the probe in deep-show's own process).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLS, ROWS, TIMEOUT, fl, int, obj, runShow, show, str, useShow, useTemp, writeRecording } from './helpers.ts';

const shows = useShow();
const temp = useTemp();

describe('SCOPE a terminal recording is an asset, converted at import in the decode worker', () => {
  it('SCOPE media_import of the recording answers kind terminal by its hash, probe.terminal {cols 20, rows 4, span 1.5 s, keyframes 2}, a named and versioned decoder, from a process that isn\'t deep-show\'s', () => {
    const dir = temp();
    const evidence = join(dir, 'evidence');
    mkdirSync(evidence);
    const rec = writeRecording(dir);
    const { replies, pid } = runShow(shows(), { evidence, calls: [{ call: 'media_import', path: rec.path }] }, 'media_import of the recording');
    const reply = replies[0]!;
    const asset = obj(reply['asset'], `media_import's asset: ${show(reply)}`);
    expect(asset['sha256'], 'the asset is the file, by its SHA-256').toBe(rec.sha);
    expect(asset['kind'], 'a terminal recording').toBe('terminal');
    const probe = obj(obj(asset['probe'], 'asset.probe')['terminal'], 'asset.probe.terminal');
    const read = { cols: int(probe['cols'], 'probe.terminal.cols'), rows: int(probe['rows'], 'probe.terminal.rows'), span: int(probe['span'], 'probe.terminal.span'), keyframes: int(probe['keyframes'], 'probe.terminal.keyframes') };
    expect(read, 'its size, its span in flicks and a keyframe at 0 s and at 1 s').toEqual({ cols: COLS, rows: ROWS, span: fl(1.5), keyframes: 2 });
    const decoder = obj(asset['decoder'], 'asset.decoder');
    expect(str(decoder['name'], 'decoder.name').length, 'the pinned emulator is named').toBeGreaterThan(0);
    expect(str(decoder['version'], 'decoder.version').length, 'and versioned').toBeGreaterThan(0);
    const worker = int(obj(reply['worker'], 'worker')['pid'], 'worker.pid');
    expect(worker, `converted in a decode worker, not in deep-show's own process ${pid}`).not.toBe(pid);
    expect(worker, 'by a real process').toBeGreaterThan(0);
    // Wrong program: #498's decodes_in_app, the probe run in deep-show's own process; the same check sees it.
    const twin = runShow(shows(), { evidence, planted: 'decodes_in_app', calls: [{ call: 'media_import', path: rec.path }] }, 'media_import of the recording (planted decodes_in_app)');
    expect(int(obj(twin.replies[0]!['worker'], 'worker (planted decodes_in_app)')['pid'], 'worker.pid (planted decodes_in_app)'), 'the planted decodes_in_app converts in deep-show\'s own process, which the check above refuses').toBe(twin.pid);
  }, TIMEOUT);
});
