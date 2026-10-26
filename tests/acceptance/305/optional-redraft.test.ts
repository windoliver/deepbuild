// #305.a15bd49b, redrafted (REDRAFT-388.md), the clause: in a build with test.b (whose manifest marks
// test.a optional, and whose operator test.b.echo reads test.a's array) and without test.a, a
// document that uses b's feature that reads a (`echo` set) is refused with module_missing naming
// test.a and its check is BLOCKED, while a document that doesn't use it draws and its check passes.
// The build is `core` with test-b: `core` is the core with text and look, which every build set
// holds (Registry and seal), test.b's kind draws itself, and no build set holds a test canvas module,
// so nothing in it provides test.a.
import { describe, expect, it } from 'vitest';
import {
  EMPTY, bItem, board, check, issues, moduleMissing, moduleMissingFailures, registry, requires, revisionsOf, run, scenario, show,
  theSnapshot, useBuilds, useEvidence, REGISTRY, type Build, type JsonObject,
} from './helpers.ts';

const CORE_B: Build = { set: 'core', with: ['test-b'] };
const builds = useBuilds([CORE_B]);
const evidence = useEvidence();

/** One doc ID per document and caller, so no revision of one document stands on another's. */
const id = (n: number): string => `01JB7R${String(n).padStart(20, '0')}`;
const DOCS = { empty: id(1), plain: id(2), plainCheck: id(3), echo: id(4), echoCheck: id(5) } as const;
const withDocs = (s: JsonObject): JsonObject => ({ ...s, docs: Object.fromEntries(Object.values(DOCS).map((d) => [d, { panel: 'main' }])) });

const BOX = [60, 50, 140, 90];
/** test.b's kind with `echo` unset: it doesn't use the feature that reads test.a. */
const PLAIN = board('b without echo', [bItem('b-1', BOX, 'a0')], requires({ 'test.b': '^1' }));
/** The same item with `echo` set: the feature test.b.echo evaluates by reading test.a.value. */
const ECHO = board('b with echo', [bItem('b-1', BOX, 'a0', 3)], requires({ 'test.b': '^1' }));

describe('#305.a15bd49b without test.a, a document using b\'s feature that reads a is refused with module_missing naming a and its checks are BLOCKED, while one that doesn\'t use it draws (redraft)', () => {
  it('#305.a15bd49b in core,test-b a document with echo set is refused with module_missing naming test.a and its check is BLOCKED, and one without echo draws and its check passes', () => {
    const { replies } = run(builds.bin(CORE_B), withDocs(scenario(evidence(), [
      REGISTRY,
      show(EMPTY, { doc: DOCS.empty, pixels: true }),
      show(PLAIN, { doc: DOCS.plain, pixels: true }),
      check(PLAIN, { doc: DOCS.plainCheck }),
      show(ECHO, { doc: DOCS.echo, pixels: true }),
      revisionsOf(DOCS.echo),
      check(ECHO, { doc: DOCS.echoCheck }),
    ])));
    const [reg, empty, plain, plainCheck, echo, echoRevs, echoCheck] = replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];

    // The build is the one the clause names: test.b sealed, test.a absent.
    const sealedSet = registry(reg);
    expect(sealedSet.modules, 'core,test-b seals with test.b').toContain('test.b');
    expect(sealedSet.modules, 'and without test.a').not.toContain('test.a');

    // Without echo: drawn, and its check passes.
    const blank = theSnapshot(empty, 'the empty board').sha256;
    const drawn = theSnapshot(plain, 'the test.b board without echo').sha256;
    expect(drawn, 'the board without echo draws: its snapshot is not the empty board\'s').not.toBe(blank);
    expect(issues(plain, 'the board without echo').filter((i) => i.severity === 'error'), 'it is presented with no error').toEqual([]);
    expect(moduleMissing(plain, 'test.a'), 'nothing in it is module_missing for test.a').toEqual([]);
    expect(plainCheck['result'], `deep show --check of the board without echo passes: ${JSON.stringify(plainCheck).slice(0, 1500)}`).toBe('PASS');

    // With echo: refused with module_missing naming test.a, on the item that uses the feature, and nothing drawn.
    expect(moduleMissingFailures(echo, 'test.a', false, 'deep_show of the board with echo'), 'refused with module_missing naming test.a, an error, no snapshot').toEqual([]);
    const named = moduleMissing(echo, 'test.a');
    expect(named.some((i) => i.ids.includes('b-1') || (i.path ?? '').startsWith('items/b-1')), `the module_missing points at b-1, the item whose echo needs test.a: ${JSON.stringify(named)}`).toBe(true);
    const current = (echoRevs['revisions'] as JsonObject[] | undefined ?? []).filter((r) => r['state'] === 'current');
    expect(current, 'no revision of the refused document becomes current').toEqual([]);

    // Its check: BLOCKED, not FAIL, with the same module_missing.
    expect(moduleMissingFailures(echoCheck, 'test.a', true, 'deep show --check of the board with echo'), 'the check is BLOCKED, with module_missing naming test.a').toEqual([]);
  }, 600_000);
});
