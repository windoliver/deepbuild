// AC2 #3032.b6de0329: "Each mapped name's recipe lowers to one item of its target kind, and each of its parameters has
// a `params` row. A planted recipe that accepts a parameter and draws nothing from it fails the pack's check, naming
// the field"
//
// Which of the issue's twenty the tree maps is read from its census. Each must have an alias onto a recipe of the
// pack, the target its row names, and one `params` row, mapped or refused, for each parameter its class takes in the
// reference (fixtures/names.json). Each is then written alone in a document of its own, with only the inputs its
// reference itself requires, through `deep-show run` with the tree's pack installed: the revision must be presented
// and the instance must lower to exactly one item, of the kind the issue pairs the name with where it pairs one
// (`camera@1` with `projection: orthographic`, `material@1` with `unlit`, and the rest of fixtures/names.json).
// Wrong programs: the merge base, which maps none of the twenty; a name mapped with no recipe behind it; a parameter
// with no row, or left open; a recipe that makes two items, none, or an item of another kind; a lit material for the
// unlit one; and the planted `parameter_draws_nothing`: a copy of the tree's pack whose recipe for the first mapped
// name gains an input no step reads, with the `params` row the census gives every input a recipe takes. The pack's
// check (`install_pack`) must refuse it with an error that names the kit part `field.effect` and the field, where it
// installs the same copy unchanged.

import { describe, expect, it } from 'vitest';
import { SLOW, UNREAD, WORD, copyPack, familiar, install, installs, none, plantUnread, run, showWord, sub, suite, useShow, useTemp } from './helpers.ts';
import { AC, TWENTY, decided, inertProblems, isObject, loweredProblems, paramRowProblems, recipeFor, recipeProblems, requiredParams } from './judges.ts';

const bin = useShow();
const temp = useTemp();

describe(`${AC[2]} each mapped name's recipe and its parameter rows`, () => {
  it(`${AC[2]} each of the twenty the census maps has a recipe that lowers to one item of its target kind, and each of its parameters has a params row`, () => {
    const { named } = suite();
    const pack = familiar();
    const { mapped } = decided(pack.census);
    expect(mapped.length, `the census maps at least one of the twenty, so there is a recipe to lower; it maps none of ${TWENTY.join(', ')}`).toBeGreaterThan(0);
    const problems = mapped.flatMap((row) => [...recipeProblems(pack.manifest, row), ...paramRowProblems(pack.census, named.get(row.name)!)]);

    const calls = mapped.map((row, i) => showWord(i, pack, `${row.name} through its recipe`, { kind: recipeFor(pack.manifest, row.name), params: requiredParams(pack.census, named.get(row.name)!) }));
    const { installed, replies } = run(bin(), sub(temp(), 'evidence'), pack, calls);
    installs(installed, `packs/${pack.folder}`);
    const recipes = Object.keys(isObject(pack.manifest['recipes']) ? pack.manifest['recipes'] : {});
    mapped.forEach((row, i) => problems.push(...loweredProblems(replies[i]!, WORD, named.get(row.name)!, recipes)));
    none(problems, 'the names the census maps');
  }, SLOW);

  it(`${AC[2]} the planted parameter_draws_nothing, a recipe that accepts a parameter and draws nothing from it, fails the pack's check, naming the field`, () => {
    suite();
    const pack = familiar();
    const { mapped } = decided(pack.census);
    expect(mapped.length, `the census maps at least one of the twenty, so there is a recipe to plant the parameter on; it maps none of ${TWENTY.join(', ')}`).toBeGreaterThan(0);
    const [row] = mapped;
    none(recipeProblems(pack.manifest, row!), `${row!.name}'s recipe`);

    const control = copyPack(pack, sub(temp(), 'control'));
    installs(install(bin(), sub(temp(), 'evidence-control'), control), 'a copy of the pack as shipped');
    const planted = copyPack(pack, sub(temp(), 'planted'));
    plantUnread(planted, row!.name);
    none(inertProblems(install(bin(), sub(temp(), 'evidence-planted'), planted), UNREAD), `the planted parameter_draws_nothing on ${row!.name}'s recipe`);
  }, SLOW);
});
