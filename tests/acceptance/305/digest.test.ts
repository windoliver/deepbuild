import { describe, expect, it } from 'vitest';
import {
  CORE_ONLY, CORE_ONLY_EDITED, DOC, REGISTRY, aItem, board, check, clone, currentHash, issues, outcome, rect, registry, replySchemaFailures, requires,
  revisionsOf, run, scenario, sealed, show, stamp, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const FULL_A: Build = { set: 'full', with: ['test-a'] };
const builds = useBuilds([FULL, FULL_A]);
const evidence = useEvidence();

/** The core-only board plus one rect with no name: an error (name is required when pickable), so the revision is refused. */
const WITH_NAMELESS = (() => {
  const out = clone(CORE_ONLY);
  const nameless = rect('nameless', 'x', [40, 40, 60, 30], 'a3');
  delete nameless['name'];
  (out['items'] as JsonObject)['nameless'] = nameless;
  return out;
})();
/** A third document, nothing like the first two. */
const OTHER = board('Other', [rect('tile', 'Tile', [100, 60, 80, 80], 'b0', 'ground')]);
/** A board of `test.a`'s kind, what the `full,test-a` build draws and `full` doesn't hold. */
const A_BOARD = board('Module a', [aItem('a-1', [20, 20, 100, 60], 'a0', 7)], requires({ 'test.a': '^1' }));

// deep_show calls are alpha's, on DOC.a; `deep show --check` calls are from your shell, another writer,
// so they go on DOC.b and never touch a layer alpha's session already presented. The refused revision is
// a superset of the presented one on the same document, so no ID is dropped without `removes`.
const CHECK = (document: JsonObject): JsonObject => check(document, { doc: DOC.b });

describe('#305.21e03b37 every deep_show reply and every document check result carries core@version and the module-set digest; the digest changes when a test canvas module joins the build and stays the same when only a document changes; a planted reply without the digest fails the reply schema, naming the field', () => {
  it('#305.21e03b37 a presented reply, a refused reply, a PASS check result and a FAIL check result each carry core and set_digest, all equal to the registry\'s', () => {
    const { replies } = run(builds.bin(FULL), scenario(evidence(), [REGISTRY, show(CORE_ONLY), show(WITH_NAMELESS), CHECK(CORE_ONLY), CHECK(WITH_NAMELESS)]));
    const [reg, presented, refused, pass, fail] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
    const set = registry(reg);
    expect(outcome(presented), 'the core-only board is presented').toBe('presented');
    expect(outcome(refused), 'the board with a nameless rect is refused').toBe('refused');
    expect(issues(refused).some((i) => i.severity === 'error' && i.ids.includes('nameless')), 'for an error on the nameless rect').toBe(true);
    expect(pass['result'], 'the check of the core-only board passes').toBe('PASS');
    expect(fail['result'], 'the check of the board with a nameless rect fails').toBe('FAIL');
    const stamps = { presented: stamp(presented, 'the presented reply'), refused: stamp(refused, 'the refused reply'), pass: stamp(pass, 'the PASS check result'), fail: stamp(fail, 'the FAIL check result') };
    for (const [what, s] of Object.entries(stamps)) {
      expect(s, `${what}: core and set_digest equal the registry's`).toEqual({ core: set.core, set_digest: set.set_digest });
    }
  }, 120_000);

  it('#305.21e03b37 the digest changes when the test canvas module test.a joins the build, and core stays the same', () => {
    const full = sealed(builds.bin(FULL), evidence());
    const withA = sealed(builds.bin(FULL_A), evidence());
    expect(withA.modules, 'full,test-a holds test.a').toContain('test.a');
    expect(full.modules, 'full does not').not.toContain('test.a');
    expect(withA.core, 'the core version is the same in both builds').toBe(full.core);
    expect(withA.set_digest, 'the module-set digest is another one once test.a joins the build').not.toBe(full.set_digest);
    const { replies } = run(builds.bin(FULL_A), scenario(evidence(), [show(A_BOARD)]));
    expect(outcome(replies[0]!), 'a board of test.a@1 is presented in full,test-a').toBe('presented');
    expect(stamp(replies[0]!, 'its reply'), 'and its reply carries that build\'s stamps').toEqual({ core: withA.core, set_digest: withA.set_digest });
  }, 120_000);

  it('#305.21e03b37 three documents in one run, one an edit of another, and a fresh process all carry one digest: a document change never changes it', () => {
    const bin = builds.bin(FULL);
    const { replies } = run(bin, scenario(evidence(), [show(CORE_ONLY), revisionsOf(DOC.a), show(CORE_ONLY_EDITED), revisionsOf(DOC.a), show(OTHER, { doc: DOC.b }), REGISTRY]));
    const [first, before, edited, after, other, reg] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
    for (const [what, r] of [['the first board', first], ['its edit', edited], ['the other board', other]] as const) expect(outcome(r), `${what} is presented`).toBe('presented');
    expect(currentHash(after), 'the edit is a document change: another revision hash').not.toBe(currentHash(before));
    const set = registry(reg);
    for (const [what, r] of [['the first board', first], ['its edit', edited], ['the other board', other]] as const) {
      expect(stamp(r, `${what}'s reply`), `${what}'s reply carries the run's one core and digest`).toEqual({ core: set.core, set_digest: set.set_digest });
    }
    const fresh = sealed(bin, evidence());
    expect([fresh.core, fresh.set_digest], 'a fresh process of the same build carries the same core and digest').toEqual([set.core, set.set_digest]);
  }, 120_000);

  it('#305.21e03b37 a planted reply without the digest is presented, yet fails the reply schema, the failure naming set_digest', () => {
    const { replies } = run(builds.bin(FULL), scenario(evidence(), [show(CORE_ONLY), CHECK(CORE_ONLY)], 'reply_without_digest'));
    const [presented, checked] = replies as [JsonObject, JsonObject];
    expect(outcome(presented), 'the planted deep_show still presents the board').toBe('presented');
    for (const [what, r] of [['the deep_show reply', presented], ['the check result', checked]] as const) {
      const failures = replySchemaFailures(r, what);
      expect(failures.length, `the reply schema fails ${what} that leaves out the module-set digest`).toBeGreaterThan(0);
      expect(failures.join('\n'), `the failure on ${what} names the set_digest field`).toContain('set_digest');
    }
  }, 120_000);
});
