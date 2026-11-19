// AC3 #1634.b847690e: In a fixture of 100 lamps whose ranges all reach one cluster, each lamp's weight there equals a
// CPU reference of the rule within 1e-6: at most 64 carry a weight above 0, only those inside the margin carry a
// weight strictly between 0 and 1, and `cluster_over_budget` is raised once naming the cluster and the dropped IDs. A
// planted cap that truncates by list order instead of score fails, naming the cluster.
//
// The crowd (helpers: `crowdDoc`): 100 fill lamps c00 … c99 on a lattice 0.05 m apart, 9.9 m before the eye, each
// with a 0.25 m range, so every range lies inside cluster [8, 4, 23] and none meets another cluster; their powers run
// over two stops in an order that is neither their IDs' nor the one they are created in. Three frames of the still
// view, with `clusters: true`.
// The CPU reference (reference.ts: `ordered`, `cutAt`): each lamp's score is power ÷ max(d², radius²) from the eye;
// the lamps are ordered by score bucket (eight a stop), then ID; the first 64 are kept, each at the weight
// clamp((score − cut) ÷ (0.1 × cut), 0, 1), the cut being the 65th's score; the other 36 are dropped. Here that is 57
// lamps at weight 1, six inside the margin (c17, c44, c63, c71, c90, c98, between 0.33 and 0.96), one kept at 0, and
// 36 dropped.
// The check: frame 0 lists cluster [8, 4, 23]; each lamp's weight there (0 when the list leaves it out) is the
// reference's within 1e-6; at most 64 weigh above 0; the lamps strictly between 0 and 1 are exactly the reference's
// six; the three frames carry exactly one `cluster_over_budget` notice, in frame 0, whose `clusters` holds [8, 4, 23]
// and whose `dropped` is exactly the reference's 36 IDs. Every failure names `cluster [8, 4, 23]`.
// Wrong programs: the base (no cluster lists, no notice); `--planted cluster_cap_by_list_order`, which must fail
// naming the cluster; a cap by score with no buckets, by ID alone, or with no margin; a notice per frame, per cluster
// pixel or never; a notice that names no ID.
import { describe, expect, it } from 'vitest';
import {
  AC, CROWD, PLAIN_LOOK, TIMEOUT, arr, clusterName, crowdDoc, crowdLamps, failsNaming, frameAt, framesOf, none, noticesOf, num, requireMetal, runGpu, shown, str,
  useDir, useGpu, view3dCall, writeJson, type Planted,
} from './helpers.ts';
import { PER_CLUSTER, bucketMargin, cutAt, ordered } from './reference.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const NAME = clusterName(CROWD.cluster);

/** What is wrong with the crowd's cluster, every failure naming it. */
function problems(planted?: Planted): string[] {
  requireMetal();
  const out = dir();
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'crowd', crowdDoc()), look: PLAIN_LOOK, size: CROWD.size, frames: 3, fps: 30, targets: ['final'], clusters: true })], planted ? { planted } : {});
  const frames = framesOf(out, reply!, CROWD.size, 'the crowd');
  const inOrder = ordered(CROWD.cam, crowdLamps());
  const want = cutAt(inOrder, PER_CLUSTER);
  const wanted = new Map(want.kept.map((k) => [k.id, k.weight]));
  const failures: string[] = [];
  const first = frameAt(frames, 0, 'the crowd');
  if (!first.clusters) return [`${NAME}: frame 0 reports no cluster lists (clusters: true)`];
  const cell = first.clusters.find((c) => c.name === NAME);
  if (!cell) return [`${NAME}: frame 0 lists no such cluster; it lists ${first.clusters.slice(0, 6).map((c) => `${c.name} (${c.lights.length} lights)`).join(', ')}`];
  const got = new Map(cell.lights.map((l) => [l.light, l.weight]));
  for (const lamp of crowdLamps()) {
    const [g, w] = [got.get(lamp.id) ?? 0, wanted.get(lamp.id) ?? 0];
    if (Math.abs(g - w) > 1e-6) failures.push(`${NAME}: ${lamp.id} weighs ${g} where the rule gives ${w.toFixed(7)}`);
  }
  const above = cell.lights.filter((l) => l.weight > 0);
  if (above.length > PER_CLUSTER) failures.push(`${NAME}: ${above.length} lights carry a weight above 0, more than ${PER_CLUSTER}`);
  const between = cell.lights.filter((l) => l.weight > 0 && l.weight < 1).map((l) => l.light).sort();
  const inMargin = want.kept.filter((k) => k.weight > 0 && k.weight < 1).map((k) => k.id).sort();
  if (between.join(' ') !== inMargin.join(' ')) failures.push(`${NAME}: the lights strictly between 0 and 1 are [${between.join(', ')}], where only those inside the margin are: [${inMargin.join(', ')}]`);
  const notices = frames.flatMap((f) => noticesOf(f, 'cluster_over_budget').map((n) => ({ frame: f.frame, n })));
  if (notices.length !== 1 || notices[0]!.frame !== 0) {
    failures.push(`${NAME}: cluster_over_budget is raised ${notices.length} times over three still frames (in frames ${notices.map((x) => x.frame).join(', ') || 'none'}), not once, in frame 0`);
  } else {
    const n = notices[0]!.n;
    const clusters = arr(n['clusters'], 'cluster_over_budget.clusters').map((c) => clusterName(arr(c, 'cluster_over_budget.clusters[]').map((v) => num(v, 'a cluster index'))));
    if (!clusters.includes(NAME)) failures.push(`${NAME}: cluster_over_budget names ${clusters.join(', ') || 'no cluster'}, not it: ${shown(n)}`);
    const dropped = arr(n['dropped'], 'cluster_over_budget.dropped').map((v) => str(v, 'cluster_over_budget.dropped[]')).sort();
    if (dropped.join(' ') !== [...want.dropped].sort().join(' ')) failures.push(`${NAME}: cluster_over_budget drops [${dropped.join(', ')}], where the rule drops [${[...want.dropped].sort().join(', ')}]`);
  }
  return failures;
}

describe(`${ID} a cluster past 64 lights keeps the top 64 by score bucket, then ID, dims those inside the margin, and reports the rest once`, () => {
  it(`${ID} of 100 lamps whose ranges all reach one cluster each weighs what the CPU reference of the rule gives within 1e-6, at most 64 above 0, only those inside the margin between 0 and 1, and cluster_over_budget is raised once, naming the cluster and the dropped IDs`, () => {
    const inOrder = ordered(CROWD.cam, crowdLamps());
    expect(inOrder.length, 'the fixture: every lamp scores above 0').toBe(100);
    expect(Math.min(...inOrder.map((s) => bucketMargin(s.score))), 'the fixture: no score sits on a bucket\'s edge').toBeGreaterThan(1e-3);
    const want = cutAt(inOrder, PER_CLUSTER);
    expect(want.kept.filter((k) => k.weight > 0 && k.weight < 1).length, 'the fixture: some lamps sit inside the margin').toBeGreaterThanOrEqual(4);
    none(problems(), 'the crowd\'s cluster');
  }, TIMEOUT);

  it(`${ID} a planted cap that truncates by list order instead of score (--planted cluster_cap_by_list_order) fails, naming the cluster`, () => {
    const failures = problems('cluster_cap_by_list_order');
    console.log(`${ID} --planted cluster_cap_by_list_order: ${failures.slice(0, 3).join('; ').slice(0, 1500)}`);
    failsNaming(failures, [NAME], '--planted cluster_cap_by_list_order');
  }, TIMEOUT);
});
