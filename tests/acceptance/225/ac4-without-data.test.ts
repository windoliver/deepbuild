// AC4 #225.8a53ced7: "On a build without the data module, a document whose constraint is `follow_stream` is refused
// with `module_missing`, naming data, and motion's interface digest equals the full build's; a planted motion that
// registers `follow_stream` itself changes that digest and fails, naming the entry"
//
// Three builds of deep-show (README: Run): `full`; `full,test-leave-out-data` (#489's build without the data module);
// and `full,test-leave-out-data,test-follow-stream-in-motion`, the planted motion module that registers the entry
// `follow_stream` in the core's `constraint@1` itself (README: The planted programs). The document: criterion 3's dot
// film, `ride` a follow_stream constraint on the field `swirl`.
// The judge, on a build without the data module, beside the full build:
// - `deep show` refuses the document: an error issue with code `module_missing` whose JSON names `data` and the
//   constraint (`ride` or `follow_stream`), so the vector field's own missing kind can't stand in for it;
// - deep://schedule's `interfaces["motion@1"].digest` equals the full build's;
// - deep://registries' `constraint@1` holds no `follow_stream` filled by motion (the full build's is the data module's).
// The full build presents the same document with no error, so the refusal is the build's, not the document's.
// The plant changes motion@1's digest, and the judge fails on it, a failure naming `follow_stream`.
// Wrong programs: the base (the full build refuses follow_stream too: the module_missing at the base names no module
// and the full build can't present it; no test-follow-stream-in-motion feature); the plant; a no-data build that
// skips the constraint or presents the dot unmoved; a digest that hashes the data module's kinds.
import { describe, expect, it } from 'vitest';
import {
  AC, SWIRL, TIMEOUT, digestOf, dot, entryModule, errorsOf, failsNaming, field, film, followStream, mentions, none, present, presented, registryRow, run, scenario,
  useBins, useFolders, type Bin, type JsonObject,
} from './helpers.ts';

const bin = useBins(['show', 'show-no-data', 'show-plant']);
const folder = useFolders();
const DOC: JsonObject = film('a dot carried', [640, 480], [
  field('swirl', 'a0', { fn: SWIRL, streams: { starts: { points: [[2, 0, 0]] }, step: 0.05, time: 3 } }),
  dot('dot', 'a1'),
], { transport: { span: '3s' }, constraints: { ride: followStream('dot', 'swirl', [2, 0, 0]) } });

interface Seen { shown: JsonObject; motion: string | null; filler: string | null }
function see(b: Bin): Seen {
  const [shown, schedule, registries] = run(bin(b), scenario(folder(), [present(DOC), { call: 'schedule' }, { call: 'registries' }]));
  return { shown: shown!, motion: digestOf(schedule!, 'motion@1'), filler: entryModule(registryRow(registries!, 'constraint@1'), 'follow_stream') };
}
/** The judge of a build without the data module, against the full build's motion@1 digest. */
function judge(seen: Seen, fullMotion: string | null, build: string): string[] {
  const out: string[] = [];
  const refusal = errorsOf(seen.shown).find((i) => i['code'] === 'module_missing' && mentions(i, 'data') && (mentions(i, 'ride') || mentions(i, 'follow_stream')));
  if (seen.shown['outcome'] === 'presented' || !refusal) out.push(`${build}: the document whose constraint ride is follow_stream isn't refused with module_missing naming data and the constraint: ${JSON.stringify(seen.shown).slice(0, 800)}`);
  if (seen.motion === null || seen.motion !== fullMotion) out.push(`${build}: motion@1's interface digest ${seen.motion} isn't the full build's ${fullMotion}`);
  if (seen.filler === 'motion') out.push(`${build}: constraint@1's entry follow_stream is filled by motion, not the data module`);
  return out;
}

describe(`${AC[4]} follow_stream is the data module's, and motion doesn't change without it`, () => {
  it(`${AC[4]} on a build without the data module, a follow_stream document is refused with module_missing, naming data, and motion's interface digest equals the full build's`, () => {
    const full = see('show');
    presented(full.shown, 'the follow_stream document on the full build');
    expect(full.filler, 'the full build\'s constraint@1 holds follow_stream, filled by the data module').toBe('data');
    expect(full.motion, 'the full build answers motion@1\'s digest').not.toBeNull();
    none(judge(see('show-no-data'), full.motion, 'full,test-leave-out-data'), 'the build without the data module');
  }, TIMEOUT);

  it(`${AC[4]} a planted motion that registers follow_stream itself changes that digest and fails, naming the entry`, () => {
    const full = see('show');
    const planted = see('show-plant');
    expect(planted.motion, 'the planted motion\'s interface digest differs from the full build\'s').not.toBe(full.motion);
    failsNaming(judge(planted, full.motion, 'full,test-leave-out-data,test-follow-stream-in-motion'), ['follow_stream'], 'the judge on the planted motion');
  }, TIMEOUT);
});
