// AC13 #233.2163815c: "math@1's `aliases` holds smooth with the target `ease@1` entry sigmoid(10) and its conversion,
// and the pack passes its pack check; a test pack whose alias names an `ease@1` entry the build doesn't hold is refused
// at pack check, naming the word"
//
// The field: packs/math-1.0.0/pack.json's `aliases.smooth` has the target `{ease: {name: "sigmoid", params: 10}}` (an
// ease@1 entry with its parameters, in a key interp's own form; params also as `{k: 10}`: README: An alias to an ease)
// and a non-empty `conversion`. The pack check: `install_pack` of packs/math-1.0.0 (with the verbs installed first)
// answers `installed` with no issue, and deep_kinds' `word` then answers smooth with that target and conversion.
// The test pack: fixtures/packs/matheases-1.0.0 (test233/matheases@1.0.0), whose alias smooth maps to sigmoid(10) and
// wobble to `wobble_in_out`, which no build holds. `install_pack` refuses it, an issue naming wobble (its path
// `aliases/wobble`, or its text); the same pack without wobble installs.
// Wrong programs: the base (its pack check takes a target only as `name@major`, so it refuses the clean pack too); a
// check that takes any ease name; smooth mapped to smoothstep or to sigmoid with another k; a refusal naming no word.
import { describe, expect, it } from 'vitest';
import {
  AC, MATH, TIMEOUT, VERBS, brief, install, isObject, mathManifest, run, scenario, testPack, useBins, useFolders, word, type JsonObject,
  type JsonValue,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
/** sigmoid's params as written: 10, or an object holding the one number 10. */
const isTen = (p: JsonValue | undefined): boolean => p === 10 || (isObject(p) && Object.values(p).length === 1 && Object.values(p)[0] === 10);

describe(`${AC[13]} an alias to an ease@1 entry`, () => {
  it(`${AC[13]} math@1's aliases holds smooth with the target ease@1 entry sigmoid(10) and its conversion, and the pack passes its pack check`, () => {
    const manifest = mathManifest();
    expect(manifest, 'packs/math-1.0.0/pack.json exists').not.toBeNull();
    const aliases = isObject(manifest!['aliases']) ? manifest!['aliases'] : {};
    const smooth = aliases['smooth'];
    expect(isObject(smooth), 'aliases holds smooth').toBe(true);
    const s = smooth as JsonObject;
    const ease = isObject(s['target']) && isObject(s['target']['ease']) ? s['target']['ease'] : null;
    expect(ease !== null && ease['name'] === 'sigmoid' && isTen(ease['params']), `smooth's target is the ease@1 entry sigmoid(10): ${brief(s)}`).toBe(true);
    expect(typeof s['conversion'] === 'string' && s['conversion'] !== '', `smooth states its conversion: ${brief(s)}`).toBe(true);

    const a = run(bin('deep-show'), scenario(folder(), [install(VERBS), install(MATH), word('smooth')], { packs: [] }));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const [, installed, answered] = a.replies as [JsonObject, JsonObject, JsonObject];
    expect(installed['outcome'], `math@1 passes its pack check: ${brief(installed, 3000)}`).toBe('installed');
    expect(Array.isArray(installed['issues']) ? installed['issues'] : [], 'with no issue').toEqual([]);
    expect(answered['target'], `deep_kinds answers smooth with the pack's target: ${brief(answered)}`).toEqual(s['target']);
    expect(answered['conversion'], 'and its conversion').toEqual(s['conversion']);
  }, TIMEOUT);

  it(`${AC[13]} a test pack whose alias names an ease@1 entry the build doesn't hold is refused at pack check, naming the word`, () => {
    const bad = testPack('matheases');
    const clean = testPack('matheases', folder(), (al) => { delete al['wobble']; });
    const a = run(bin('deep-show'), scenario(folder(), [install(clean)], { packs: [] }));
    const c = run(bin('deep-show'), scenario(folder(), [install(bad)], { packs: [] }));
    expect(a.ok && c.ok, `deep-show run accepts both scenarios: ${a.why} ${c.why}`).toBe(true);
    expect(a.replies[0]!['outcome'], `the pack without wobble, its smooth an alias to sigmoid(10), installs: ${brief(a.replies[0])}`).toBe('installed');
    const refused = c.replies[0]!;
    expect(refused['outcome'], `the pack whose alias wobble names wobble_in_out is refused at pack check: ${brief(refused)}`).toBe('refused');
    const issues = Array.isArray(refused['issues']) ? refused['issues'] : [];
    // The word itself, not only the entry it names (wobble_in_out).
    expect(issues.some((i) => /wobble(?!_in_out)/.test(JSON.stringify(i))), `an issue names the word wobble: ${brief(issues as JsonValue)}`).toBe(true);
  }, TIMEOUT);
});
