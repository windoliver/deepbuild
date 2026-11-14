// AC4 #538.5538b44f: A text item 200 u wide with max_lines 1, over a copy table whose key 23 in de, with its argument at
// its widest '999', shapes wider than 200 u, fails the fit check at check, naming key 23, the locale de and the width,
// though no step picks key 23; and a number argument with neither a widest nor a range its source declares is refused at
// check, naming it
//
// The offer (fixtures.ts `offerDoc`): `offer`, 200 u wide, one line, over `items` (en and de, keys 1 and 23), fed by
// `rules` (programs.ts `shopProgram`: rules.item 1 at every step, so no step picks key 23). Key 23 in de is a sentence
// of about 90 characters at 13 u, far past 200 u with '999' in it; its control is the same document with key 23 in de
// 'Edelsteine: {0}', which fits. "Fails the fit check at check" is `deep_show`'s check: refused, with an error issue
// whose own fields name 23, de and the width the string shapes to (a number above 200). The bare argument is `args:
// ["rules.count"]`, a logic array, which declares no range: refused with an error naming `rules.count` in its fields or
// pointing its path at the argument.
import { describe, expect, it } from 'vitest';
import { shopProgram } from './programs.ts';
import { LONG_DE, offerDoc } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, binOf, errorsOf, names, namedIn, numbersOf, prebuild, presented, putEvidence, runShow, scenario, show, showCall, useTemp,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { long: DOC(1), short: DOC(2), bare: DOC(3) };
const WIDTH = 200;

describe(`${AC[4]} the fit check over every key in every locale, and an argument with no widest`, () => {
  it(`${AC[4]} key 23 in de, at its widest '999', fails the fit check at check naming 23, de and its width though no step picks it; the same with a short key 23 is presented; an argument with no widest and no range is refused, naming it`, () => {
    const ev = temp();
    const program = shopProgram();
    putEvidence(ev, program.bytes);
    const [long, short, bare] = runShow(binOf(), scenario(ev, Object.values(D), [
      showCall(D.long, offerDoc(program, LONG_DE)),
      showCall(D.short, offerDoc(program, 'Edelsteine: {0}')),
      showCall(D.bare, offerDoc(program, 'Edelsteine: {0}', ['rules.count'])),
    ]), 'AC4 the offer');

    expect(long!['outcome'], `the offer whose key 23 in de doesn't fit 200 u is refused at check: ${show(long, 2000)}`).toBe('refused');
    const unfit = errorsOf(long!).filter((i) => names(namedIn(i), '23') && names(namedIn(i), 'de') && numbersOf(i).some((n) => n > WIDTH));
    expect(unfit.length, `an error issue names key 23, the locale de and the width the string shapes to (above ${WIDTH} u) in its own fields; the errors: ${show(errorsOf(long!), 2500)}`).toBeGreaterThan(0);

    presented(short!, 'the offer whose every key fits 200 u in en and de');

    expect(bare!['outcome'], `the offer whose number argument has no widest and no range is refused at check: ${show(bare, 2000)}`).toBe('refused');
    const named = errorsOf(bare!).filter((i) => names(namedIn(i), 'rules.count') || /\/args\/0$/.test(String(i['path'] ?? '')));
    expect(named.length, `an error issue names the argument rules.count: ${show(errorsOf(bare!), 2500)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
