// AC7 #485.05404a40: With the two inputs added and unused, the castle fixture (`packs/examples/castle.json`) keeps the
// pixel hash it has under the default responses on one machine. A planted core.ambient@1 that adds 0.01 × n.z changes
// the hash and fails, naming the fixture and its first differing pixel.
//
// The castle as committed, in its own look with its recipes, at its own 1280 × 800, with core.light@1 and
// core.ambient@1 set on every material (helpers: `castle`, `withDefaults`; core.ambient@1 takes n and v and ignores
// them), drawn by this checkout; "the pixel hash it has under the default responses" before the inputs were added is
// the castle's hash at the merge base (`git merge-base HEAD origin/main`, built apart), where the castle shades by
// today's shading, which AC1 holds the defaults to. Frame 0 by `view3d` on this Mac; the frames' `pixel_hash`es.
// 1. The castle under the default responses has the merge base's pixel hash.
// 2. `--planted ambient_adds_nz` (core.ambient@1 adds 0.01 × n.z, n the view-space normal, wherever a part shades by
//    it): the same check fails, naming the castle and its first differing pixel.
// Wrong programs: the base (no responses: the operator is refused); an ambient default that reads n or v; one whose
// inputs moved what it returns.
import { describe, it } from 'vitest';
import { AC, REPO, TIMEOUT, baseGpu, castle, drawFirst, failsNaming, hashFailures, none, requireMetal, useDir, useGpu, type Frame, type Planted } from './helpers.ts';

const ID = AC[7];
const bin = useGpu();
const dir = useDir();

let today: { sha: string; castle: Frame } | null = null;
function castleFailures(out: string, planted?: Planted): string[] {
  const [set] = drawFirst(bin(), out, [castle(REPO, out, true)], ['final'], planted) as [Frame];
  if (!today) {
    const b = baseGpu();
    const [c] = drawFirst(b.bin, out, [castle(b.root, out, false)], ['final']) as [Frame];
    today = { sha: b.sha, castle: c };
  }
  return hashFailures('the castle', set, today.castle, `under the default responses (n and v added, unused), against its hash at the merge base ${today.sha.slice(0, 12)}`);
}

describe(`${ID} the castle keeps its pixel hash with n and v added to ambient's inputs`, () => {
  it(`${ID} the castle under the default responses, core.ambient@1 taking n and v unused, keeps the pixel hash it had before on this Mac`, () => {
    requireMetal();
    none(castleFailures(dir()), 'the castle under the default responses');
  }, TIMEOUT);

  it(`${ID} a planted core.ambient@1 that adds 0.01 × n.z (--planted ambient_adds_nz) changes the hash and fails, naming the castle and its first differing pixel`, () => {
    requireMetal();
    const failures = castleFailures(dir(), 'ambient_adds_nz');
    failsNaming(failures, ['the castle', 'first differing pixel is pixel ('], '--planted ambient_adds_nz');
    console.log(`${ID}: --planted ambient_adds_nz fails: ${failures[0]}`);
  }, TIMEOUT);
});
