// AC10 #233.1cae712c: "math@1's `aliases` holds ShowCreation with target Create and renamed_from set, and deep_kinds
// answers from that field alone; a test familiar-names pack whose alias names a target the pack doesn't hold is refused
// at pack check, naming the word"
//
// The field: packs/math-1.0.0/pack.json's `aliases.ShowCreation` has a `target` that is Create (the word Create, or the
// same target as `aliases.Create`) and a non-empty `renamed_from`.
// From that field alone: math@1 copied with only its `aliases` changed (ShowCreation's entry moved to the made-up word
// ShowCreation233, the rest as shipped) and installed as deepbuild/math@1.0.0 in place of the shipped folder:
// deep_kinds' `word` then answers ShowCreation `no_match`, and ShowCreation233 with what the shipped pack answers for
// ShowCreation (target, conversion, renamed_from), so nothing but the field holds the mapping.
// The test pack: fixtures/packs/mathwords-1.0.0 (test233/mathwords@1.0.0), whose alias Dot maps to its own recipe and
// Ghost to mathwords.ghost@1, which neither the pack nor the build holds. `install_pack` refuses it, and an issue names
// Ghost (its path `aliases/Ghost`, or its text); the same pack without Ghost installs, so the refusal is Ghost's.
// Wrong programs: the base (no math@1; its pack check takes any `name@major` target); a rename table in code that
// deep_kinds reads beside the field; a check that refuses the whole pack without naming the word.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, VERBS, brief, install, isObject, mathCopy, mathManifest, mentions, run, scenario, testPack, useBins, useFolders, word, type JsonObject,
  type JsonValue,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();

describe(`${AC[10]} math@1's aliases and the pack check on an alias's target`, () => {
  it(`${AC[10]} math@1's aliases holds ShowCreation with target Create and renamed_from set, and deep_kinds answers from that field alone`, () => {
    const manifest = mathManifest();
    expect(manifest, 'packs/math-1.0.0/pack.json exists').not.toBeNull();
    const aliases = isObject(manifest!['aliases']) ? manifest!['aliases'] : {};
    const show = aliases['ShowCreation'];
    expect(isObject(show), `aliases holds ShowCreation: ${brief(Object.keys(aliases) as JsonValue)}`).toBe(true);
    const s = show as JsonObject;
    const create = isObject(aliases['Create']) ? aliases['Create'] : null;
    expect(s['target'] === 'Create' || (create !== null && JSON.stringify(s['target']) === JSON.stringify(create['target'])), `ShowCreation's target is Create: ${brief(s)} (Create: ${brief(create)})`).toBe(true);
    expect(typeof s['renamed_from'] === 'string' && s['renamed_from'] !== '', `ShowCreation has renamed_from set: ${brief(s)}`).toBe(true);

    const shipped = run(bin('deep-show'), scenario(folder(), [word('ShowCreation')]));
    expect(shipped.ok, `deep-show run accepts the scenario: ${shipped.why}`).toBe(true);
    const was = shipped.replies[0]!;
    expect(was['code'], `the shipped math@1 answers ShowCreation: ${brief(was)}`).toBeUndefined();

    const moved = mathCopy(folder(), (m) => {
      const a = m['aliases'] as JsonObject;
      a['ShowCreation233'] = a['ShowCreation']!;
      delete a['ShowCreation'];
    });
    const b = run(bin('deep-show'), scenario(folder(), [word('ShowCreation'), word('ShowCreation233')], { packs: [moved, VERBS] }));
    expect(b.ok, `deep-show run accepts the scenario: ${b.why}`).toBe(true);
    const [gone, renamed] = b.replies as [JsonObject, JsonObject];
    expect(gone['code'], `with ShowCreation moved out of aliases, deep_kinds answers it no_match: ${brief(gone)}`).toBe('no_match');
    for (const k of ['target', 'conversion', 'renamed_from']) {
      expect(renamed[k], `ShowCreation233, which only the field names, is answered with ShowCreation's ${k}: ${brief(renamed)} against ${brief(was)}`).toEqual(was[k]);
    }
  }, TIMEOUT);

  it(`${AC[10]} a test familiar-names pack whose alias names a target the pack doesn't hold is refused at pack check, naming the word`, () => {
    const ghost = testPack('mathwords');
    const clean = testPack('mathwords', folder(), (a) => { delete a['Ghost']; });
    const a = run(bin('deep-show'), scenario(folder(), [install(clean)], { packs: [] }));
    const c = run(bin('deep-show'), scenario(folder(), [install(ghost)], { packs: [] }));
    expect(a.ok && c.ok, `deep-show run accepts both scenarios: ${a.why} ${c.why}`).toBe(true);
    expect(a.replies[0]!['outcome'], `the pack without Ghost installs: ${brief(a.replies[0])}`).toBe('installed');
    const refused = c.replies[0]!;
    expect(refused['outcome'], `the pack whose alias Ghost names mathwords.ghost@1 is refused at pack check: ${brief(refused)}`).toBe('refused');
    const issues = Array.isArray(refused['issues']) ? refused['issues'] : [];
    expect(issues.some((i) => mentions(i, 'Ghost')), `an issue names the word Ghost: ${brief(issues as JsonValue)}`).toBe(true);
  }, TIMEOUT);
});
