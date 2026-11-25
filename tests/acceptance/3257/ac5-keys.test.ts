// AC5 #3257.d4ceba15: "One image sampled at cutoffs 0.5 and 0.3 gives two chains under two keys, each keeping its own
// share, and a second load transcodes neither. A map with alpha 255 throughout gives a chain byte for byte the merge
// base's"
//
// The image (./chains.ts `twoCutoffs`): the fence's lines at alpha 255 and patches at alpha 100, so it keeps 15 ÷ 64 at
// 0.5 and 24 ÷ 64 at 0.3. The first test needs no GPU (`deep-gpu run --backend noop`):
//   - two maps with alpha 255 throughout (256 × 256, and 130 × 61, whose odd sides repeat an edge), each made as
//     base_color and as data with no `alpha_cutoff`, are the merge base's chains byte for byte;
//   - the image made twice by `transcode` jobs, at 0.5 and at 0.3: each chain keeps its own share within a point at each
//     level down to 16 × 16, on two stored alphas about its own cutoff;
//   - one document whose two `mask` materials sample it at 0.5 and 0.3, loaded twice in one run: each load's receipt has
//     two rows for the image, one a cutoff (`alpha_cutoff`), each listing its own chain's `kept`; both `transcoded` in
//     the first load and neither in the second; `workers` lists exactly two transcode jobs of the image.
// The second test, on the reference Mac: the two squares of that document side by side, 32 px across, draw each its own
// share, within 3 points of 23.4% and of 37.5%, so each material samples its own chain.
// Wrong programs: the base (one chain, one row); a key with no cutoff (one transcode, the first cutoff's chain for
// both); texels bound by hash alone (the last chain for both materials); a second load that transcodes again; an opaque
// chain that moves by a code.
import { describe, it } from 'vitest';
import { TIMEOUT, answered, none, runGpu, shown, useDir, useGpu, type JsonObject } from '../1634/helpers.ts';
import { TWO_CUTOFFS, opaque, shareFaults, storedFaults, twoCutoffs } from './chains.ts';
import {
  AC, FRAME, camera, cutout, drawCall, drawnShare, frameOf, keptFaults, onReferenceMac, points, rowsOf, scene, square, transcode, transcodesOf, useBase, writeMap, type Job,
} from './helpers.ts';

const bin = useGpu();
const base = useBase();
const dir = useDir();
const CUTOFFS = [0.5, 0.3] as const;
/** Two squares 16 m away, 32 px across, centred 32 px either side of the frame's centre, sampling the image at 0.5 and 0.3. */
const doc = (sha: string): JsonObject => scene('two-cutoffs', {
  cam: camera(16), mat_5: cutout(sha, 0.5), mat_3: cutout(sha, 0.3), at_5: square('mat_5', -2), at_3: square('mat_3', 2),
});

describe(`${AC[5]} a chain is keyed by its role and its cutoff`, () => {
  it(`${AC[5]} one image at cutoffs 0.5 and 0.3 is two chains, each keeping its own share, and a second load transcodes neither; a map with alpha 255 throughout is the merge base's chain byte for byte`, () => {
    const plain: Job[] = (['base_color', 'data'] as const).flatMap((role) => [
      { name: `square-${role}`, map: opaque(256, 256), role }, { name: `odd-${role}`, map: opaque(130, 61), role },
    ]);
    const was = transcode(base(), dir(), plain.map((j) => ({ ...j, name: `before-${j.name}` })));
    const is = transcode(bin(), dir(), plain);
    none(plain.flatMap((j, i) => (Buffer.compare(was[i]!.data, is[i]!.data) === 0 ? [] : [`${j.name}: its chain is not the merge base's, byte for byte`])), 'the maps with alpha 255 throughout');

    const map = twoCutoffs();
    const made = transcode(bin(), dir(), CUTOFFS.map((cutoff) => ({ name: `image-${cutoff}`, map, cutoff })));
    none(CUTOFFS.flatMap((c, i) => [...shareFaults(made[i]!.levels, c, TWO_CUTOFFS[c]), ...storedFaults(made[i]!.levels, c)].map((m) => `cutoff ${c}: ${m}`)), 'the image\'s two chains');

    const image = writeMap(dir(), 'image', map);
    const load = (n: number): JsonObject => drawCall(dir(), `load-${n}`, doc(image.sha), [image], []);
    const replies = runGpu(bin(), dir(), [load(1), load(2), { call: 'workers' }], { lane: 'noop' });
    const faults: string[] = [];
    for (const n of [1, 2]) {
      const rows = rowsOf(answered(replies[n - 1]!, `load ${n}`), image.sha, `load ${n}`);
      if (rows.length !== 2) faults.push(`load ${n}: the receipt has ${rows.length} rows for the image, not one a cutoff: ${shown(rows)}`);
      CUTOFFS.forEach((c, i) => {
        const row = rows.find((r) => typeof r['alpha_cutoff'] === 'number' && Math.abs(r['alpha_cutoff'] - c) < 1e-6);
        if (!row) { faults.push(`load ${n}: no row of the image names alpha_cutoff ${c}: ${shown(rows)}`); return; }
        faults.push(...keptFaults(row['kept'], made[i]!.levels, c, `load ${n}: the row at alpha_cutoff ${c}`));
        if (row['transcoded'] !== (n === 1)) faults.push(`load ${n}: the row at alpha_cutoff ${c} is marked transcoded ${shown(row['transcoded'])}`);
      });
    }
    const jobs = transcodesOf(replies[2]!, image.sha);
    if (jobs !== 2) faults.push(`the decode worker ran ${jobs} transcode jobs on the image over two loads, not one a cutoff`);
    none(faults, 'one image sampled at cutoffs 0.5 and 0.3');
  }, TIMEOUT);

  it(`${AC[5]} two squares sampling the one image at cutoffs 0.5 and 0.3 draw each its own share`, () => {
    onReferenceMac();
    const out = dir();
    const image = writeMap(out, 'image', twoCutoffs());
    const [reply] = runGpu(bin(), out, [drawCall(out, 'two-cutoffs', doc(image.sha), [image], ['ids'])]);
    const frame = frameOf(out, reply!, FRAME, 'the two squares');
    const drawn = ([['at_5', 0.5, -32], ['at_3', 0.3, 32]] as const).map(([id, c, dx]) => ({ c, share: drawnShare(frame, id, 32, `the square at cutoff ${c}`, FRAME[0] / 2 + dx) }));
    console.log(`${AC[5]}: drawn at 32 px across: ${drawn.map((d) => `cutoff ${d.c} ${points(d.share)}`).join(', ')}`);
    none(drawn.flatMap((d) => (Math.abs(d.share - TWO_CUTOFFS[d.c]) <= 0.03 ? [] : [`the square at cutoff ${d.c} draws ${points(d.share)} of its px, not its own ${points(TWO_CUTOFFS[d.c])} within 3 points`])), 'the two squares');
  }, TIMEOUT);
});
