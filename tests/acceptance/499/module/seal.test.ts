// #499.64602440: "A test canvas module that reads an asset through the decode worker seals and probes its asset in a
// build with the media module left out; a planted test module whose probe calls through the media module is refused
// at that build's seal, naming media"
//
// asserts: `full,test-leave-out-media,test-probe` seals without the media module and with test.probe; an agent's
// board holding one `test.probe@1` item over a WAV in the evidence store is presented with no error issue, and the
// run's `workers` list a decode worker that ran a probe job on that WAV's SHA-256. The build
// `full,test-leave-out-media,test-probe-via-media` (the planted test.probe whose probe calls through the media
// module) is refused at startup by the seal, the refusal naming media in `modules`.
// Wrong programs: a probe that needs the media module (the first build is refused, or its item fails); a probe made
// outside the decode worker (no probe job on that file); a seal that admits a module calling through an absent
// module (the planted build starts). At the base none of the three test features exists, so cargo refuses each build.

import { describe, expect, it } from 'vitest';
import { DOC, SLOW, arr, errorsOf, obj, present, putBytes, run, scenario, show, startupRefusal, str, strs, useBuilds, useDir, wav, type Build } from './helpers.ts';

const PROBE: Build = ['full', 'test-leave-out-media', 'test-probe'];
const VIA_MEDIA: Build = ['full', 'test-leave-out-media', 'test-probe-via-media'];
const builds = useBuilds([PROBE, VIA_MEDIA]);
const dir = useDir();

/** A board with one test.probe@1 item over the asset `sha`. */
const probeBoard = (sha: string) => ({
  format: 1, profile: 'board', title: 'A probed asset',
  description: 'A board whose one item reads a sound asset through the decode worker, for the media module acceptance tests.',
  size: [320, 200],
  items: { probe: { id: 'probe', kind: 'test.probe@1', name: 'Probe', order: 'a0', params: { asset: sha } } },
});

describe('#499.64602440 a canvas module reaches the decode worker without the media module, and one that calls through media is refused at the seal', () => {
  it('#499.64602440 a test canvas module that reads an asset through the decode worker seals and probes its asset in a build with the media module left out', () => {
    const sha = putBytes(dir(), wav(1));
    const [registry, shown, workers] = run(builds.bin(PROBE), scenario(dir(), [{ call: 'registry' }, present(probeBoard(sha)), { call: 'workers' }]));
    expect(str(registry!['state'], 'registry.state'), 'the build without media seals').toBe('sealed');
    const modules = strs(registry!['modules'], 'registry.modules');
    expect(modules, 'the build leaves the media module out').not.toContain('media');
    expect(modules, 'the build holds the test canvas module test.probe').toContain('test.probe');

    expect(errorsOf(shown!, 'the probed board').map((i) => show(i.raw, 400)), `the board ${DOC} with the test.probe@1 item has no error issue`).toEqual([]);
    expect(shown!['outcome'], `the board is presented: ${show(shown)}`).toBe('presented');

    const probes = arr(workers!['workers'], 'workers').map((w, i) => obj(w, `workers[${i}]`))
      .filter((w) => w['role'] === 'decode_worker')
      .flatMap((w) => arr(w['jobs'], 'a worker\'s jobs').map((j) => obj(j, 'a job')))
      .filter((j) => j['op'] === 'probe' && j['file'] === sha);
    expect(probes.length, `a decode worker probed the item's asset ${sha}: ${show(workers)}`).toBeGreaterThan(0);
  }, SLOW);

  it('#499.64602440 a planted test module whose probe calls through the media module is refused at that build\'s seal, naming media', () => {
    const r = startupRefusal(builds.bin(VIA_MEDIA));
    expect(r.modules, `the seal's refusal names media: ${show(r.raw)}`).toContain('media');
  }, SLOW);
});
