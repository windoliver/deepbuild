// AC3 #3032.5da79b5b: "A document that uses a refused name is refused at check with the name, its reason and the
// nearest kind or recipe. A planted pack that maps a shader-text material onto `material@1` fails, naming the word"
//
// Which of the issue's twenty the tree refuses is read from its census; each such row must give a reason from the
// closed list and, as its target, what ours has in its place. A document uses a name by writing it as an item's
// `kind`, as the library spells it. Each refused name is written so, alone in a document of its own that names the
// pack, through `deep-show run` with the tree's pack installed. The revision must not be presented, and its issues
// must hold one at `items/word/kind` whose `close` holds the pack's entry {name, refuses, reason, target} as the row
// gives them and whose `fix` holds the reason and the target, with nothing drawn for the item (the reading #1493's
// suite makes of a refused word on a field, on the kind).
// The second test holds the reference's material that takes shader text, `ShaderMaterial`, to the same check: the
// Scope refuses it ("never bent to fit: a material that takes shader text"), so the tree's census must, and a copy of
// the pack as shipped must pass the check above for it. The planted `shader_text_material_mapped` is that copy with
// the word mapped instead: a recipe of one step that makes a `material@1`, an alias onto it and the row mapped. It
// must fail, naming the word: either the pack's check refuses it with an issue that names `ShaderMaterial`, or it
// installs, lowers the word to one `material@1`, and the check above fails on it.
// Wrong programs: the merge base, which refuses none of the twenty and leaves ShaderMaterial open, so a document
// that writes one is refused as text that is no kind, with no reason and nothing to write instead; a refusal that
// drops the reason or the target; a refused name drawn; the planted pack.

import { describe, expect, it } from 'vitest';
import { SHADER_RECIPE, SLOW, WORD, copyPack, failsNaming, familiar, installs, none, plantShaderMaterial, run, showWord, sub, suite, useShow, useTemp, type Familiar } from './helpers.ts';
import { AC, SHADER_TEXT, TWENTY, decided, isObject, loweredProblems, refusalProblems, refusedRowProblems, rowsFor, show } from './judges.ts';

const bin = useShow();
const temp = useTemp();
/** A document whose one item has `name` as its kind, as the library spells it. */
const uses = (i: number, pack: Familiar, name: string) => showWord(i, pack, `${name} written as a kind`, { kind: name, params: {} });

describe(`${AC[3]} a refused name at the document check`, () => {
  it(`${AC[3]} a document that uses a name the census refuses is refused at check with the name, its reason and the nearest kind or recipe`, () => {
    suite();
    const pack = familiar();
    const { refused } = decided(pack.census);
    expect(refused.length, `the census refuses at least one of the twenty, so there is a refused name to use; it refuses none of ${TWENTY.join(', ')}`).toBeGreaterThan(0);
    const problems = refused.flatMap((row) => refusedRowProblems(pack.census, row.name));

    const { installed, replies } = run(bin(), sub(temp(), 'evidence'), pack, refused.map((row, i) => uses(i, pack, row.name)));
    installs(installed, `packs/${pack.folder}`);
    refused.forEach((row, i) => problems.push(...refusalProblems(replies[i]!, WORD, row, pack.at)));
    none(problems, 'the names the census refuses');
  }, SLOW);

  it(`${AC[3]} the planted shader_text_material_mapped, a pack that maps the library's shader-text material onto material@1, fails, naming the word`, () => {
    suite();
    const pack = familiar();
    none(refusedRowProblems(pack.census, SHADER_TEXT), `${SHADER_TEXT}, the library's material that takes shader text`);
    const [row] = rowsFor(pack.census, SHADER_TEXT);

    const control = copyPack(pack, sub(temp(), 'control'));
    const shipped = run(bin(), sub(temp(), 'evidence-control'), control, [uses(0, control, SHADER_TEXT)]);
    installs(shipped.installed, 'a copy of the pack as shipped');
    none(refusalProblems(shipped.replies[0]!, WORD, row!, pack.at), `${SHADER_TEXT} under the pack as shipped`);

    const planted = copyPack(pack, sub(temp(), 'planted'));
    plantShaderMaterial(planted);
    const wrong = run(bin(), sub(temp(), 'evidence-planted'), planted, [uses(0, planted, SHADER_TEXT), showWord(1, planted, `${SHADER_TEXT} through the planted recipe`, { kind: SHADER_RECIPE, params: {} })]);
    if (wrong.installed['outcome'] !== 'installed') {
      // The pack's check itself refuses the planted pack: its refusal must be about the word, by name.
      const issues = Array.isArray(wrong.installed['issues']) ? wrong.installed['issues'].filter(isObject) : [];
      expect(issues.some((i) => JSON.stringify(i).includes(SHADER_TEXT)), `the pack's check refuses the planted shader_text_material_mapped with an issue that names ${SHADER_TEXT}: ${show(wrong.installed, 3000)}`).toBe(true);
      return;
    }
    // It installs: it is the wrong program the criterion names, one material@1 for the word, and the check fails on it.
    none(loweredProblems(wrong.replies[1]!, WORD, { name: SHADER_TEXT, file: '', line: 0, parameters: [], requires: {}, kind: 'material@1', holds: {} }, []), `the planted pack maps ${SHADER_TEXT} onto one material@1`);
    failsNaming(refusalProblems(wrong.replies[0]!, WORD, row!, pack.at), [SHADER_TEXT], 'the planted shader_text_material_mapped');
  }, SLOW);
});
