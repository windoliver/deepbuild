// AC6 #211.aaf0f08b: "A world whose pages 0 to 63 come from a provider's out: pages range loads each with the bytes the
// provider wrote, by its content key, and a world whose init asset is a pages@1 file with a repeated page number is
// refused at check, naming it; a step with 8 moves records 524,288 more fuel than the same step without them, and
// logic.budget fails a step whose moves push it past the ceiling, naming the step"
//
// The provider's pages through `deep-show run` (README: a provider's `out: pages`), the only binary that runs providers
// at a document's check and plays its logic items: the pack test/pagegen@1.0.0 carries `pagegen.region` (programs.ts),
// `out: {pages: {first: 0, count: 64}}`; a figure's logic item `world` names `pages.init: {gen: "pagegen.region",
// params: {tone: 9}}`, and its reader (programs.ts: reader64) asks for pages 0 to 63 and writes each one's FNV-1a as it
// lands. The provider's bytes are what its program writes, run in Node's own WebAssembly. The rest through `deep-logic`:
// a world whose init asset is a pages@1 file of pages 0, 3, 3 at check; the mover (programs.ts) with and without 8 moves
// landing at step 7, its own fuel the same at every step; and logic.budget (#546's ceiling rule) on the mover with a
// spin at step 20 sized so the step fits its app ceiling without the 8 moves landing there and passes it with them.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, DIGEST, SESSION, TIMEOUT, arr, bakeCall, bakeOf, budgetCall, budgetOf, checkCall, figureDoc, int, isObject, logic, obj, pagesAsset, pagesOf,
  piece, presented, runShow, scenario, sha256, show, showCall, str, useBuilds, useTemp, writePack, type JsonObject, type JsonValue,
} from './helpers.ts';
import { PROVIDED, fnvPage, kWrites, mover, pagegen, pagegenInNode, reader64, readerWrites } from './programs.ts';

const ID = AC(6);
useBuilds(['show', 'logic']);
const temp = useTemp();

const SEED = 211_06;
const MOVE = 65_536;
/** Some object anywhere in `v` that `pred` holds of. */
function findObject(v: JsonValue | undefined, pred: (o: JsonObject) => boolean): JsonObject | undefined {
  if (Array.isArray(v)) { for (const x of v) { const f = findObject(x, pred); if (f) return f; } return undefined; }
  if (!isObject(v)) return undefined;
  if (pred(v)) return v;
  for (const x of Object.values(v)) { const f = findObject(x, pred); if (f) return f; }
  return undefined;
}
const fuelOf = (reply: JsonObject, steps: number, item: string, what: string): number[] => bakeOf(reply, steps, what).steps.map((s) => s.items[item]!.fuel);
const busyPiece = (spin: number, moves: boolean): JsonObject => piece({
  seed: SEED, class: 'data_view',
  items: { busy: { program: mover({ name: `busy_${spin}_${moves}`, moves, at: 16, spinAt: 20, spin }), writes: kWrites, pages: pagesOf({ max: 64, slots: 8 }), budget: { fuel: 10_000_000 } } },
});

describe(`${ID} provided pages, a refused init asset, and moves as fuel`, () => {
  it(`${ID} pages 0 to 63 load with the provider's bytes by its content key; a pages@1 init asset with a repeated page is refused naming it; 8 moves add 524,288 fuel; logic.budget fails the step its moves push past the ceiling`, () => {
    // The provider's pages, at a document's check.
    const root = temp();
    const evidence = join(root, 'evidence');
    mkdirSync(evidence, { recursive: true });
    const gen = pagegen();
    const pack = writePack(root, {
      name: 'pagegen', version: '1.0.0', license: 'MIT', description: 'A test pack of the #211 acceptance suite: a provider that writes a range of a world\'s pages.',
      requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
      providers: { region: { program: gen.sha, params: { tone: { type: 'u32', default: 7, range: [0, 255] } }, out: { pages: { first: 0, count: PROVIDED } } } },
    }, { 'pagegen.wasm': gen.bytes });
    const doc = DOC(6);
    const figure = figureDoc(evidence, {
      title: 'Provided pages', seed: SEED, id: 'world', program: reader64(), extra: { packs: [`${pack.id}@${pack.version}`] },
      params: { writes: readerWrites, pages: pagesOf({ max: 1024, slots: 64, init: { gen: 'pagegen.region', params: { tone: 9 } } }) as unknown as JsonObject, budget: { fuel: 2_000_000, memory: 5 } },
    });
    const r = runShow(scenario(evidence, [doc], [
      { call: 'install_pack', id: pack.id, dir: pack.dir },
      showCall(doc, figure),
      { call: 'provided', doc },
      { call: 'deep_query', session: SESSION, doc, what: 'logic', items: ['world'], steps: [19] },
    ]), 'the provided world');
    expect(r[0]!['outcome'], `test/pagegen@1.0.0 installs: ${show(r[0])}`).toBe('installed');
    presented(r[1], 'the figure whose world comes from pagegen.region');
    const bytes = pagegenInNode(gen, BigInt(SEED), 9);
    const row = arr(r[2]!['provided'], 'provided').filter(isObject).find((x) => x['item'] === 'world');
    expect(row?.['provider'], `the world's pages come from pagegen.region: ${show(r[2])}`).toBe('pagegen.region');
    expect(str(row!['key'], 'the provided row\'s content key'), 'by its content key').toMatch(DIGEST);
    expect(row!['trap'] ?? null, 'the provider ran without a trap').toBeNull();
    const out = obj(obj(row!['out'], 'the provided row\'s out')['data'], 'out.data');
    expect([out['layout'], out['asset']], 'its out: pages range, pages 0 to 63 in pages@1, is the provider\'s own bytes').toEqual(['pages@1', sha256(bytes)]);
    const logicRead = obj(obj(r[3]!['logic'], `deep_query's logic: ${show(r[3])}`)['world'], 'deep_query logic.world');
    const step19 = arr(logicRead['steps'], 'logic.world.steps').filter(isObject).find((s) => s['step'] === 19);
    const sums = arr(obj(step19?.['arrays'], 'step 19\'s arrays')['world.sums'], 'world.sums').map((x, i) => int(x, `world.sums[${i}]`));
    const want = Array.from({ length: PROVIDED }, (_, p) => fnvPage(bytes.subarray(16 + p * 65_540, 16 + p * 65_540 + 65_536)));
    const wrong = want.map((w, p) => (sums[p] === w ? -1 : p)).filter((p) => p >= 0);
    expect(wrong, 'each of pages 0 to 63 loads with the bytes the provider wrote').toEqual([]);

    // A pages@1 init asset with a repeated page number, refused at check.
    const bad = pagesAsset([{ number: 0 }, { number: 3 }, { number: 3 }]);
    const refusedPiece = piece({ seed: SEED, items: { world: { program: mover({ name: 'still', moves: false, at: 3 }), writes: kWrites, pages: pagesOf({ max: 64, slots: 8, init: { asset: sha256(bad) } }) } }, data: [bad] });
    const [checked] = logic([checkCall(refusedPiece)]);
    expect([checked!['ok'], checked!['item']], `the world is refused at check: ${show(checked)}`).toEqual([false, 'world']);
    const named = findObject(checked, (o) => o['asset'] === sha256(bad) && o['layout'] === 'pages@1' && o['offset'] === 12 + 2 * 65_540);
    expect(named, `the refusal names the init asset, pages@1 and the repeated page's offset 131,092: ${show(checked)}`).toBeDefined();

    // 8 moves charge 65,536 fuel each to the step they land at.
    const fuelPiece = (moves: boolean): JsonObject => piece({ seed: SEED, items: { mover: { program: mover({ name: `mover_${moves}`, moves, at: 3 }), writes: kWrites, pages: pagesOf({ max: 64, slots: 8 }) } } });
    const [a, b] = logic([bakeCall(fuelPiece(true), 12), bakeCall(fuelPiece(false), 12)]);
    const fa = fuelOf(a!, 12, 'mover', 'the mover with 8 moves');
    const fb = fuelOf(b!, 12, 'mover', 'the mover without them');
    expect(fa.map((f, k) => f - fb[k]!), 'step 7, where the 8 moves land, records 524,288 more fuel; every other step the same').toEqual(fa.map((_, k) => (k === 7 ? 8 * MOVE : 0)));

    // logic.budget holds a step's moves to the ceiling.
    const [c1, c2, probe] = logic([bakeCall(busyPiece(100_000, false), 24), bakeCall(busyPiece(200_000, false), 24), budgetCall(busyPiece(100_000, false), 24)]);
    const f1 = fuelOf(c1!, 24, 'busy', 'the spin of 100,000')[20]!;
    const f2 = fuelOf(c2!, 24, 'busy', 'the spin of 200,000')[20]!;
    const ceiling = int(obj(obj(obj(budgetOf(probe!, 'logic.budget of the calibration').report['items'], 'report.items')['busy'], 'report.items.busy')['ceiling'], 'ceiling')['app'], 'the app ceiling');
    const per = (f2 - f1) / 100_000;
    const spin = Math.round((ceiling - 4 * MOVE - (f1 - per * 100_000)) / per);
    const [over, under, overBake, underBake] = logic([
      budgetCall(busyPiece(spin, true), 24), budgetCall(busyPiece(spin, false), 24), bakeCall(busyPiece(spin, true), 24), bakeCall(busyPiece(spin, false), 24),
    ]);
    const own = fuelOf(underBake!, 24, 'busy', 'the spin without moves')[20]!;
    expect(own < ceiling && own > ceiling - 8 * MOVE, `step 20's own fuel (${own}) fits the app ceiling (${ceiling}) by less than its 8 moves' 524,288`).toBe(true);
    expect(fuelOf(overBake!, 24, 'busy', 'the spin with moves')[20], 'with the moves landing there, step 20 passes the ceiling').toBeGreaterThan(ceiling);
    const u = budgetOf(under!, 'logic.budget without the moves');
    expect([u.verdict, u.failures], 'logic.budget passes the step without its moves').toEqual(['PASS', []]);
    const o = budgetOf(over!, 'logic.budget with the moves');
    expect(o.verdict, `logic.budget fails the step its moves push past the ceiling: ${show(o.raw)}`).toBe('FAIL');
    expect(o.failures.filter((f) => f['rule'] === 'ceiling').map((f) => [f['item'], f['step'], f['host']]), 'it names step 20, and only it').toEqual([['busy', 20, 'app']]);
  }, TIMEOUT * 2);
});
