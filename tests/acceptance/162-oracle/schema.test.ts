// AC1 #162.ba90a515: "A title with a trim, a repeater, a mask and Bézier keys exports to Lottie with no shape or layer
// type Lottie 1.0.1 doesn't define, validates against its schema, and imported back evaluates to the same item values at
// 100 random times within 1e-4; the same title with a named ease and a spring exports them as linear keys at the export
// frame rate, matches at every export frame within 1e-4, and lists both in warnings"
//
// This file holds the schema and the types (roundtrip.test.ts the round trip and the sampled keys). The upstream test,
// vendor/lottie-spec-4b55957472/tests/validate_animations.test.js, compiles the 1.0.1 schema with a JSON Schema 2020-12
// validator and the keyword `$version`, and holds the spec's 20 examples and 9 valid files valid and its 3 invalid ones
// invalid. The port (helpers.ts) gives exactly those verdicts first, and then runs on our files: the title and its eased
// twin as the export writes them. The schema lets any other type through as unknown, so the stricter walk names every
// layer type outside 0 to 4 and every shape type outside those the schema's parts define. Each comparison has a planted
// mismatch beside it: our title's file with its first layer's in point removed must fail the schema, and with a
// repeater shape (`rp`) or a text layer (`ty: 5`) added must fail the walk, naming it.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, clone, exportedOf, lottieExport, none, readLottie, schema, showRun, titleDoc, undefinedTypes, upstreamVerdicts, useShow,
  useTemp, validate, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

describe(`${AC[1]} the title's Lottie file holds only the types Lottie 1.0.1 defines and validates against its schema`, () => {
  it(`${AC[1]} the title and its eased twin, as exported, validate against the 1.0.1 schema and hold no undefined type; the planted mismatches fail`, () => {
    none(upstreamVerdicts(), 'the port of validate_animations.test.js gives the upstream verdict on the spec\'s own files (harness)');
    const { shapes, layers } = schema();
    expect([...layers].sort(), 'the schema defines layer types 0 to 4 (harness)').toEqual([0, 1, 2, 3, 4]);
    expect(shapes.includes('rp') || shapes.includes('mm'), 'the schema defines no repeater and no merge path (harness)').toBe(false);

    const evidence = temp(); const dir = temp();
    const replies = showRun(shows.bin(FULL), evidence, [titleDoc(evidence), titleDoc(evidence, 'eased')], [lottieExport(0, join(dir, 'title.json')), lottieExport(1, join(dir, 'eased.json'))], 'the title and its eased twin');
    for (const [k, name] of ['title.json', 'eased.json'].entries()) {
      exportedOf(replies[k]!, name);
      const anim = readLottie(join(dir, name), name);
      const r = validate(anim);
      expect(r.valid, `${name} validates against the Lottie 1.0.1 schema: ${r.errors}`).toBe(true);
      none(undefinedTypes(anim), `${name} holds no layer or shape type Lottie 1.0.1 doesn't define`);
    }

    const anim = readLottie(join(dir, 'title.json'), 'title.json');
    const noIn = clone(anim);
    const first = (noIn['layers'] as JsonObject[])[0]!;
    delete first['ip'];
    expect(validate(noIn).valid, 'planted: the title\'s file with its first layer\'s in point removed fails the schema').toBe(false);
    const withRepeater = clone(anim);
    const layer = (withRepeater['layers'] as JsonObject[]).find((l) => Array.isArray(l['shapes']) && (l['shapes'] as JsonObject[]).length > 0);
    expect(layer, 'the title\'s file has a shape layer with shapes').toBeDefined();
    (layer!['shapes'] as JsonObject[]).unshift({ ty: 'rp', nm: 'Repeater', c: { a: 0, k: 3 }, o: { a: 0, k: 0 }, tr: {} });
    expect(undefinedTypes(withRepeater).some((f) => f.includes('"rp"')), 'planted: a repeater shape added fails the walk, naming rp').toBe(true);
    const withText = clone(anim);
    (withText['layers'] as JsonObject[]).push({ ty: 5, nm: 'Text', ind: 999, ip: 0, op: 48, st: 0, ks: {}, t: { d: { k: [] } } });
    expect(undefinedTypes(withText).some((f) => f.includes('layer type 5')), 'planted: a text layer added fails the walk, naming type 5').toBe(true);
  }, TIMEOUT);
});
