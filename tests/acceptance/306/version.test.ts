// AC2: "A document names pack@version and keeps expanding that version's recipes byte for byte after a
// newer version of the pack is installed, and publishing a version again with different contents is
// refused"
//
// asserts: in the build without scene3d, with test/chart@1.0.0 installed, a board naming test/chart@1.0.0
// with c1 {n: 5} is presented with its expansion and a snapshot; after `install_pack` of test/chart@1.1.0
// (installed) the same board sent again expands to the same bytes (the expansion's key and derived items,
// and the snapshot's sha256), while a board naming test/chart@1.1.0 expands differently (the control: the
// newer version is live); `install_pack` of test/chart@1.0.0 from a folder with other contents is refused,
// naming the pack and the version, the store keeps the version as first published, and the first board
// still expands to the same bytes after it.

import { describe, expect, it } from 'vitest';
import {
  CHART, CHART_1_1, CHART_CHANGED, DOC, PACKS, R1, board, canon, expansionOf, installPack, installed, instance, outcome, packAt, packRow, run, scenario, show, snapshots,
  useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

const bars = (pack: string) => board('Bars', [pack], [instance('c1', 'chart.bars@1', { n: 5 }, 'a0', [40, 40])]);
const expansionBytes = (reply: Parameters<typeof expansionOf>[0], what: string): string => {
  const e = expansionOf(reply, 'c1', what);
  return canon({ key: e.key, derived: e.derived });
};

describe('AC2 a document names pack@version and keeps that version byte for byte; a published version never changes', () => {
  it('AC2 after test/chart@1.1.0 is installed the board naming 1.0.0 expands to the same bytes, and a board naming 1.1.0 expands differently', () => {
    const [first, install, second, newer] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main' }, [CHART], [
      show(bars(packAt(CHART)), { pixels: true }),
      installPack(CHART_1_1),
      show(bars(packAt(CHART)), { pixels: true }),
      show(bars(packAt(CHART_1_1)), { pixels: true, doc: DOC.b }),
    ]));
    expect(outcome(first!), `the board naming ${packAt(CHART)} is presented: ${JSON.stringify(first!['issues']).slice(0, 600)}`).toBe('presented');
    expect(installed(install!).state, `${packAt(CHART_1_1)} installs: ${JSON.stringify(install).slice(0, 600)}`).toBe('installed');
    expect(outcome(second!), 'the same board sent again is presented').toBe('presented');
    expect(expansionBytes(second!, 'after 1.1.0 was installed'), 'the board naming 1.0.0 expands to the same bytes after 1.1.0 is installed').toBe(expansionBytes(first!, 'before 1.1.0 was installed'));
    expect(snapshots(second!)[0]?.sha256, 'and draws the same pixels').toBe(snapshots(first!)[0]?.sha256);
    expect(outcome(newer!), `the board naming ${packAt(CHART_1_1)} is presented: ${JSON.stringify(newer!['issues']).slice(0, 600)}`).toBe('presented');
    expect(expansionBytes(newer!, 'naming 1.1.0'), 'the board naming 1.1.0 expands with 1.1.0 (other bytes): the newer version is live, and 1.0.0 is kept by name').not.toBe(expansionBytes(first!, 'naming 1.0.0'));
  });

  it('AC2 publishing test/chart@1.0.0 again with other contents is refused, naming the pack and the version, and the first contents stay', () => {
    const [first, again, packs, after] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main' }, [CHART], [
      show(bars(packAt(CHART)), { pixels: true }),
      installPack(CHART_CHANGED),
      PACKS,
      show(bars(packAt(CHART)), { pixels: true }),
    ]));
    expect(outcome(first!), 'the board is presented').toBe('presented');
    const refusal = installed(again!, 'the second publish of 1.0.0');
    expect(refusal.state, `publishing ${packAt(CHART)} again with other contents is refused: ${JSON.stringify(again).slice(0, 600)}`).toBe('refused');
    expect(refusal.pack, 'the refusal names the pack').toBe(CHART.id);
    expect(refusal.version, 'the refusal names the version').toBe(CHART.version);
    expect(packRow(packs!, CHART).state, 'the store still holds 1.0.0 as first published').toBe('installed');
    expect(expansionBytes(after!, 'after the refused republish'), 'the board expands to the first contents after the refused republish').toBe(expansionBytes(first!, 'before it'));
    expect(snapshots(after!)[0]?.sha256, 'and draws the same pixels').toBe(snapshots(first!)[0]?.sha256);
  });
});
