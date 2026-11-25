// AC5 #3032.5d808b13: "`deep_kinds` asked for each of the twenty returns its recipe or its refusal. A word still open
// answers that it is undecided, never an empty reply"
//
// One `deep-show run` with the tree's pack installed asks `deep_kinds {op: "word"}` for each of the issue's twenty and
// for one name the tree's census still leaves open. A name the census maps must answer its recipe, {state: "mapped",
// target}, the recipe of the pack that pack.json's alias maps it to; a name it refuses must answer its refusal,
// {state: "refused", reason, target}, as its row gives them; a name of the twenty it leaves undecided fails. The open
// word must answer {word, state: "open"}: that it is undecided, never `no_match` and never an answer with no state.
// Wrong programs: the merge base, where each of the twenty answers `open`; an answer from another table than the
// tree's census; a refusal with no reason or nothing to write instead; `no_match` for a word the census holds.

import { describe, expect, it } from 'vitest';
import { SLOW, askWord, familiar, installs, none, run, sub, suite, useShow, useTemp } from './helpers.ts';
import { AC, TWENTY, openWord, openWordProblems, wordProblems } from './judges.ts';

const bin = useShow();
const temp = useTemp();

describe(`${AC[5]} deep_kinds answers each of the twenty`, () => {
  it(`${AC[5]} deep_kinds asked for each of the twenty returns its recipe or its refusal, and a word still open answers that it is undecided, never an empty reply`, () => {
    suite();
    const pack = familiar();
    const open = openWord(pack.census, TWENTY);
    expect(open, 'the census still leaves a name open beside the twenty, to ask for').toBeDefined();

    const { installed, replies } = run(bin(), sub(temp(), 'evidence'), pack, [...TWENTY, open!].map(askWord));
    installs(installed, `packs/${pack.folder}`);
    const problems = TWENTY.flatMap((name, i) => wordProblems(replies[i]!, name, pack.census, pack.manifest));
    none([...problems, ...openWordProblems(replies[TWENTY.length]!, open!)], 'deep_kinds\' answers');
  }, SLOW);
});
