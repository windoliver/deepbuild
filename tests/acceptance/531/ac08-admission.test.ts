// Criterion 8 (no upstream test): "Every logic item's program reaches its engine only as sandbox@1's rewritten bytes
// (#238): each of sandbox@1's refusal fixtures, named as a logic item's program, is refused at check with sandbox@1's
// report, naming the item; and a planted logic module that runs a program as the agent built it, without sandbox@1's
// check and rewrite, runs the import fixture and fails, naming the item"
//
// Through `deep-logic check` and `bake`, against `deep-sandbox` (#238's runner, README: deep-sandbox's logic role).
// sandbox@1's refusal fixtures are its kit's own (crates/deep-canvas-sandbox/kit, every `refuse.*` fixture in
// kit.json, `refuse.over_4mib` padded from pass_subset.wat to 4 MiB + 1 byte as the kit pads it). "With sandbox@1's
// report" is read as: the refusals equal, field for field, what `deep-sandbox`'s `check` answers for the same bytes
// in the logic role. The import fixture named as a logic program is `logic_import` (programs.ts): a logic item's
// exports, and a call to env.forbidden_fn from its step.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, bakeCall, checkCall, kitRefusalFixtures, logicBin, mentions, none, onMac, onSandbox, piece, prebuild, refusedOf, sandboxBin, sha256, show, str, type JsonObject, type Program } from './helpers.ts';
import { logicImport, tally } from './programs.ts';

prebuild(() => { logicBin(); sandboxBin(); });

const itemOf = (fixture: string): string => `prog_${fixture.replace(/\W/g, '_')}`;
const asItem = (id: string, p: Program): JsonObject => piece({ seed: 531_08, items: { [id]: { program: p, writes: { k: { type: 'i32' } } } } });
const sandboxCheck = (p: Program): JsonObject => ({ call: 'check', program: p.b64, role: 'logic' });
const sandboxRewrite = (p: Program): JsonObject => ({ call: 'rewrite', program: p.b64, role: 'logic' });

describe(`${AC[8]} a logic item's program reaches its engine only as sandbox@1's rewritten bytes`, () => {
  it(`${AC[8]} each of sandbox@1's refusal fixtures, named as a logic item's program, is refused at check with sandbox@1's report, naming the item`, () => {
    const fixtures = kitRefusalFixtures();
    expect(fixtures.length, 'sandbox@1\'s kit holds its refusal fixtures').toBeGreaterThanOrEqual(15);
    const logic = onMac(fixtures.map((f) => checkCall(asItem(itemOf(f.fixture), f.program))));
    const sandbox = onSandbox(fixtures.map((f) => sandboxCheck(f.program)));
    const failures: string[] = [];
    fixtures.forEach((f, i) => {
      const want = sandbox[i]!;
      if (want['ok'] !== false || want['code'] !== 'subset_refused') { failures.push(`${f.fixture}: deep-sandbox's check in the logic role doesn't refuse it: ${show(want)}`); return; }
      const got = logic[i]!;
      if (got['ok'] !== false) { failures.push(`${f.fixture}: admitted as a logic item's program: ${show(got)}`); return; }
      const r = refusedOf(got, f.fixture);
      if (r.code !== 'subset_refused') failures.push(`${f.fixture}: refused as ${r.code}, not with sandbox@1's subset refusal`);
      if (r.item !== itemOf(f.fixture)) failures.push(`${f.fixture}: the refusal names item ${r.item}, not ${itemOf(f.fixture)}`);
      if (JSON.stringify(r.refusals) !== JSON.stringify(want['refusals'])) failures.push(`${f.fixture}: the refusals ${show(r.refusals)} aren't sandbox@1's report ${show(want['refusals'])}`);
    });
    none(failures, 'every sandbox@1 refusal fixture named as a logic program is refused with sandbox@1\'s report, naming the item');
  }, TIMEOUT);

  it(`${AC[8]} the import fixture as a logic program is refused, naming env.forbidden_fn and the item; an admitted program runs as sandbox@1's rewrite of it, never as built`, () => {
    const imp = logicImport();
    const good = tally();
    const [refused, checked, baked] = onMac([checkCall(asItem('imp', imp)), checkCall(asItem('good', good)), bakeCall(asItem('good', good), { steps: 2 })]);
    const r = refusedOf(refused!, 'logic_import');
    expect([r.code, r.item], 'a subset refusal naming the item').toEqual(['subset_refused', 'imp']);
    expect(r.refusals.some((x) => JSON.stringify(x['import']) === JSON.stringify({ module: 'env', name: 'forbidden_fn' })), `naming the import env.forbidden_fn: ${show(r.refusals)}`).toBe(true);
    const [rewrite] = onSandbox([sandboxRewrite(good)]);
    expect(rewrite!['ok'], `deep-sandbox rewrites the program in the logic role: ${show(rewrite)}`).toBe(true);
    const sandboxHash = str(rewrite!['hash'], 'deep-sandbox rewrite: hash');
    const item = admitted(checked!, 'the good program')['good']!;
    expect(item.program, 'the item names its program as built').toBe(good.sha);
    expect(item.hash, 'the program that runs is sandbox@1\'s rewrite of it').toBe(sandboxHash);
    expect(item.hash, 'which isn\'t the program as built').not.toBe(good.sha);
    expect(admitted(baked!, 'the good program\'s bake')['good']!.hash, 'the bake runs those rewritten bytes').toBe(sandboxHash);
  }, TIMEOUT);

  it(`${AC[8]} a planted logic module that runs programs as built (runs_unchecked) runs the import fixture and fails, naming the item`, () => {
    const imp = logicImport();
    const good = tally();
    const [checked, baked, goodChecked] = onMac([checkCall(asItem('imp', imp)), bakeCall(asItem('imp', imp), { steps: 2 }), checkCall(asItem('good', good))], 'runs_unchecked');
    const failures: string[] = [];
    if (checked!['code'] !== 'subset_refused') failures.push(`item imp: the planted logic module admits logic_import, which imports env.forbidden_fn, without sandbox@1's check (${show(checked)})`);
    if (baked!['code'] !== 'subset_refused') failures.push(`item imp: the planted logic module runs logic_import as built (${show(baked).slice(0, 300)})`);
    const goodHash = goodChecked!['ok'] === true ? admitted(goodChecked!, 'the good program under the twin')['good']!.hash : null;
    if (goodHash === good.sha) failures.push(`item good: the planted logic module runs the program as built (hash ${goodHash} is the built bytes' sha256 ${sha256(good.bytes)})`);
    expect(failures.length, 'the planted logic module fails the criterion').toBeGreaterThan(0);
    expect(failures.every((f) => /^item (imp|good):/.test(f)), 'each failure names the item').toBe(true);
    expect(failures[0], 'the first failure names the item whose program imports a function').toMatch(/^item imp:/);
    expect(mentions(baked, 'imp') || checked!['ok'] === true, 'the twin admitted or ran the import fixture under the item imp').toBe(true);
  }, TIMEOUT);
});
