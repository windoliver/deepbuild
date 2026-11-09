// Criterion 8 (README: Criteria to tests): replica and live snapshots are equal for a fixture using all three
// primitives. all.json has a layer (opacity 0.6, radii 16, a 4 pt soft edge) around two overlapping quads and text, a
// panel with a half-scale backdrop read by frost@1 placed under its own text, and an element painted after both. The
// replica's snapshot is `deep-replica --chrome all.json` at the fixture's scale 2; the live one is `deep-app --chrome
// all.json --snapshot <png>`, the app's real window on this Mac's screen, read back from the drawable it presented. Every
// pixel must be equal. Runs only with DEEP_1434_LIVE=1; otherwise it fails INCONCLUSIVE, never passing. A display that
// isn't at scale 2 can't show the fixture at the replica's scale: INCONCLUSIVE too.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../391/helpers.ts';
import { differing, fixture, live, replica, requireLive, useBuild } from './helpers.ts';

const replicaBin = useBuild('replica', true);
const appBin = useBuild('app');
const ALL = fixture('all.json');

describe('#1434 AC8 replica and live snapshots are equal for a fixture using all three primitives', () => {
  it('AC8 the replica\'s screenshot of all.json and the live window\'s presented drawable are equal at every pixel', () => {
    requireLive('the live snapshot');
    const fromReplica = replica(replicaBin(), ALL).png;
    const { report, dir } = live(appBin(), ALL, ['--snapshot', join('{dir}', 'live.png')]);
    try {
      if (report['scale'] !== 2) expect.fail(`INCONCLUSIVE: the live window drew at scale ${String(report['scale'])}, the replica at the fixture's 2`);
      const fromLive = decodePng(readFileSync(join(dir, 'live.png')));
      expect([fromLive.width, fromLive.height], 'the live snapshot is the window in device px').toEqual([fromReplica.width, fromReplica.height]);
      expect(differing(fromLive, fromReplica, [0, 0, fromReplica.width, fromReplica.height]), 'live against replica').toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 3_600_000);
});
