import { describe, expect, it } from 'vitest';
import { AC1, TREE_ARGS, failureOf, featureTree, featuresOf, judgeTree } from '../1662/helpers.ts';
import { baseManifestsApart } from './base-apart.ts';

describe(`${AC1} cargo ${TREE_ARGS.join(' ')} lists no plant-* feature`, () => {
  it(`${AC1} the tree of this checkout names deep-app and no plant-* feature of it`, async () => {
    const tree = await featureTree();
    expect(featuresOf(tree).length, 'the tree reaches deep-app\'s features at all (at least "default")').toBeGreaterThan(0);
    judgeTree(tree);
  }, 10 * 60_000);

  it(`${AC1} (wrong program) the merge base's manifests, where deep-replica's dependency turns plant-row on, fail the judge naming plant-row (redraft config)`, async () => {
    const message = await failureOf(async () => judgeTree(await featureTree(baseManifestsApart())));
    expect(message, 'the judge must fail on the merge base, or it proves nothing').toMatch(/turns on deep-app's "plant-row"/);
    expect(message, 'and say who turns it on').toMatch(/<- .*deep-replica/);
  }, 10 * 60_000);

  it(`${AC1} the judge, on written trees: a plant-* feature fails named, a tree of other features holds`, () => {
    const clean = 'deep-app v0.0.0 (/x/crates/deep-app)\n├── deep-app feature "default" (command-line)\n└── deep-app feature "env-plants"\n    └── deep-replica v0.0.0 (/x/crates/deep-replica)\n';
    expect(featuresOf(clean).map((f) => f.feature)).toEqual(['default', 'env-plants']);
    judgeTree(clean);
    const planted = `${clean}└── deep-app feature "plant-handle-rows"\n    └── deep-replica v0.0.0 (/x/crates/deep-replica)\n`;
    expect(() => judgeTree(planted)).toThrow(/turns on deep-app's "plant-handle-rows".*<- .*deep-replica/);
  });
});
