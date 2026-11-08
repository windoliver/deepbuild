// #33 AC12: the corpus also holds the numeric fakes, each refused while its clean twin passes: a kernel that
// accumulates in FP16 where its contract says FP32; a softmax clamped without the rescale that undoes the clamp;
// blocks of a batch skipped without an error; and a speedup timed against a baseline its claim doesn't name, or on
// warm caches its check doesn't declare.
//
// Five tags (helpers.ts NUMERIC; the speedup is two fakes, its two forms): `numeric:fp16-accumulation`,
// `numeric:clamped-softmax`, `numeric:skipped-blocks`, `numeric:unnamed-baseline`, `numeric:warm-caches`. The kernel
// fakes' bases declare a numeric contract (the word `contract` in a base file, as done.yaml's field is named); the
// FP16 fake adds a narrower type, the softmax fake is a softmax, and each speedup fake's claim states a speed in its
// stop words. The kit plays the five on the shipped gate: each claim refused, each twin PASS. The issue names no wrong
// program here; the base fails, having no corpus.
import { afterEach, describe, it } from 'vitest';
import { AC12, CORPUS, NUMERIC, addedLines, caseFor, changed, cleanup, expectedOf, kit, kitPassed, must, readManifest, treeOf, type Case } from './helpers.ts';

afterEach(cleanup, 60_000);

const headOf = (c: Case) => treeOf(CORPUS, c, c.claim.commits[c.claim.commits.length - 1]!);

describe(`${AC12} the numeric fakes, each refused while its clean twin passes`, () => {
  it(`${AC12} the corpus holds the five numeric fakes with their marks, and the kit refuses each claim and passes each twin`, async () => {
    const m = readManifest();
    const cases = NUMERIC.map((tag) => [tag, caseFor(m, tag, AC12)] as const);
    for (const [tag, c] of cases) {
      must(!expectedOf(c.claim).includes('PASS'), `${AC12} ${c.id} (${tag}) is refused: its claim expects ${JSON.stringify(c.claim.expected)}`);
      must(expectedOf(c.twin).join() === 'PASS', `${AC12} ${c.id}'s clean twin expects PASS: ${JSON.stringify(c.twin.expected)}`);
      const base = treeOf(CORPUS, c, 'base');
      const head = headOf(c);
      const added = changed(base, head).flatMap((p) => addedLines(base.get(p), head.get(p)));
      if (['numeric:fp16-accumulation', 'numeric:clamped-softmax', 'numeric:skipped-blocks'].includes(tag)) {
        must([...base.values()].some((t) => /\bcontract\b/.test(t)), `${AC12} ${c.id}'s check declares a numeric contract: no base file names one`);
      }
      if (tag === 'numeric:fp16-accumulation') must(added.some((l) => /fp16|float16|half|Float16Array/i.test(l)), `${AC12} ${c.id} accumulates in FP16: the lines it adds are ${JSON.stringify(added).slice(0, 600)}`);
      if (tag === 'numeric:clamped-softmax') must([...head.values()].some((t) => /softmax/i.test(t)), `${AC12} ${c.id} is a softmax: no file of its head names one`);
      if (tag === 'numeric:unnamed-baseline' || tag === 'numeric:warm-caches') must(/\d(\.\d+)?\s*(×|x\b)|faster|µs|\bms\b/.test(c.stop ?? ''), `${AC12} ${c.id}'s claim states a speed in its stop words: ${JSON.stringify(c.stop)}`);
    }
    const ids = [...new Set(cases.map(([, c]) => c.id))];
    kitPassed(AC12, await kit(['run', ...ids.flatMap((id) => ['--case', id])], { timeoutMs: 2 * 3_600_000 }), ids);
  }, 2 * 3_600_000 + 600_000);
});
