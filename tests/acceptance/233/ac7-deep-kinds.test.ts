// AC7 #233.a838a9eb: "deep_kinds "ShowCreation" returns Create's mapping with the rename noted, and "add_updater" returns
// `no_match` naming the driver and bake routes"
//
// One `deep-show run` with math@1 and the verbs offered, asking deep_kinds' `word` op (#412) for Create, ShowCreation
// and add_updater. Create is answered with a target and its conversion, from deepbuild/math@1.0.0. ShowCreation is
// answered with Create's mapping: the same target and conversion, from the same pack, with the rename noted: a
// `renamed_from` field (#412's word answer) and the current word, Create, named in the answer (README: Readings).
// add_updater is answered `no_match`, and the answer names the driver route and the bake route (the words `driver`
// and `bake`).
// Wrong programs: the base (no math@1: every word is no_match, with no routes); ShowCreation answered no_match, or
// mapped elsewhere, or without the rename; add_updater mapped to something, or no_match with no routes.
import { describe, expect, it } from 'vitest';
import { AC, MATH_AT, TIMEOUT, brief, mentions, run, scenario, useBins, useFolders, word } from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();

describe(`${AC[7]} deep_kinds answers a math@1 word with its mapping`, () => {
  it(`${AC[7]} ShowCreation returns Create's mapping with the rename noted, and add_updater returns no_match naming the driver and bake routes`, () => {
    const a = run(bin('deep-show'), scenario(folder(), [word('Create'), word('ShowCreation'), word('add_updater')]));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const [create, show, updater] = a.replies;
    expect(create!['code'], `Create is answered: ${brief(create)}`).toBeUndefined();
    expect(create!['target'], `Create maps to a target: ${brief(create)}`).toBeTruthy();
    expect(typeof create!['conversion'] === 'string' && create!['conversion'] !== '', `Create's mapping states its conversion: ${brief(create)}`).toBe(true);
    expect(create!['pack'], 'Create is math@1\'s word').toBe(MATH_AT);

    expect(show!['code'], `ShowCreation is answered, not no_match: ${brief(show)}`).toBeUndefined();
    expect(show!['target'], `ShowCreation returns Create's target: ${brief(show)} against ${brief(create)}`).toEqual(create!['target']);
    expect(show!['conversion'], 'ShowCreation returns Create\'s conversion').toEqual(create!['conversion']);
    expect(show!['pack'], 'ShowCreation is math@1\'s word').toBe(MATH_AT);
    expect(show!['renamed_from'] !== undefined && show!['renamed_from'] !== null && show!['renamed_from'] !== '', `the answer notes the rename (renamed_from): ${brief(show)}`).toBe(true);
    expect(mentions(show, 'Create'), `the answer names the current word, Create: ${brief(show)}`).toBe(true);

    expect(updater!['code'], `add_updater is answered no_match: ${brief(updater)}`).toBe('no_match');
    expect(mentions(updater, 'driver'), `the no_match names the driver route: ${brief(updater)}`).toBe(true);
    expect(mentions(updater, 'bake'), `the no_match names the bake route: ${brief(updater)}`).toBe(true);
  }, TIMEOUT);
});
