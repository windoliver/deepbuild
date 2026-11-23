// AC2 #1488.3ac65184: A JPEG probes in the worker with `size` and color tags. The merge base refuses it as
// `unreadable` and fails.
//
// Through `deep-show run` (#498's calls): `media_import` of a plain 160 × 96 JPEG (JFIF, no EXIF; README: Fixtures),
// then `workers`. The probe is the asset's (kind `image`, `sha256` the file's, one `image` stream with `size` and
// `color: {primaries, transfer, matrix, range, assumed}`, as the worker's PNG probe has them), and it ran in the
// decode worker: the reply's `worker.pid` is a `decode_worker` that `workers` lists with a `probe` job on the file's
// hash. The tags' values aren't read: the criterion names the fields, not what an untagged JPEG assumes. The wrong
// program is the merge base, which refuses the file `unreadable` (BASE-FAILURE.txt).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isObject, useBinary, useTemp } from '../499/video/helpers.ts';
import { PLAIN, answered, importCall, plainJpeg, refusal, scenario, sha256, show, showRun, type JsonObject } from './helpers.ts';

const showBin = useBinary('deep-show');
const temp = useTemp('1488-probe');
const FIELDS = ['primaries', 'transfer', 'matrix', 'range'];

describe('AC2 #1488.3ac65184 a JPEG probed in the decode worker', () => {
  it('AC2 #1488.3ac65184 a JPEG probes in the worker with size and color tags, not refused unreadable', () => {
    const dir = temp();
    const bytes = plainJpeg();
    const file = join(dir, 'plain.jpg');
    writeFileSync(file, bytes);
    const sha = sha256(readFileSync(file));
    const [probed, listed] = answered(showRun(showBin(), scenario(join(dir, 'evidence'), [importCall(file), { call: 'workers' }])), 'media_import of the JPEG, then workers') as [JsonObject, JsonObject];

    expect(refusal(probed), `the worker refuses the JPEG: ${show(probed)}`).toBeNull();
    const a = probed['asset'];
    expect(isObject(a), `media_import answers an asset: ${show(probed)}`).toBe(true);
    const asset = a as JsonObject;
    expect(asset['kind'], 'the asset is an image').toBe('image');
    expect(asset['sha256'], 'the asset is the file, by its SHA-256').toBe(sha);
    const streams = isObject(asset['probe']) && Array.isArray(asset['probe']['streams']) ? asset['probe']['streams'] : [];
    const s = streams.find((x) => isObject(x) && x['type'] === 'image');
    expect(isObject(s), `the probe has an image stream: ${show(asset['probe'])}`).toBe(true);
    const stream = s as JsonObject;
    expect(stream['size'], `the probe's size is the JPEG's, [${PLAIN.w}, ${PLAIN.h}]`).toEqual([PLAIN.w, PLAIN.h]);
    const color = stream['color'];
    expect(isObject(color), `the probe has color tags: ${show(stream)}`).toBe(true);
    const tags = color as JsonObject;
    for (const f of FIELDS) expect(typeof tags[f] === 'string' && tags[f] !== '', `the probe's color.${f} is named: ${show(tags)}`).toBe(true);
    expect(Array.isArray(tags['assumed']) && tags['assumed'].every((f) => typeof f === 'string' && FIELDS.includes(f)), `color.assumed lists which of ${FIELDS.join(', ')} were assumed: ${show(tags['assumed'])}`).toBe(true);

    // In the worker: the reply names its process, which `workers` lists as a decode worker that probed this file.
    const pid = isObject(probed['worker']) ? probed['worker']['pid'] : undefined;
    expect(typeof pid === 'number' && pid > 0, `media_import names the worker's process: ${show(probed['worker'])}`).toBe(true);
    const workers = Array.isArray(listed['workers']) ? listed['workers'].filter(isObject) : [];
    const w = workers.find((x) => x['pid'] === pid);
    expect(w?.['role'], `workers lists process ${String(pid)} as a decode worker: ${show(listed)}`).toBe('decode_worker');
    const jobs = Array.isArray(w?.['jobs']) ? w['jobs'] : [];
    expect(jobs.some((j) => isObject(j) && j['op'] === 'probe' && j['file'] === sha), `the decode worker ran a probe on the JPEG's hash: ${show(jobs)}`).toBe(true);
  }, 3_600_000);
});
