// Criterion 8: "The reference library links only after every fixture passes on this core and in headless Chrome with the
// same step hashes (#531)."
//
// Through `deep-logic first_party`, `check`, `bake`, `web_plan` and `web_runner`, and the web runner's `bake` in headless
// Chrome (#190's helpers: inChrome), as #531, #416 and #981 run them (README: The surface). "Every fixture": each of
// process@1's own fixtures (first_party) and this suite's four (steady, belt, grant, pallet; fixtures.ts). "Links only
// after every fixture passes on this core": a piece linking the reference library is admitted with every process@1
// fixture run on it and PASS in its receipt, and a library that fails one, each planted library of process@1 claiming
// process@1, is refused at link, naming process@1 and a fixture. "In headless Chrome with the same step hashes": each
// fixture's bake on this core and the web runner's bake of web_plan's request for it give the same step hash at every
// step and the same checkpoints' full-state hashes, which for process@1's own fixtures are the receipt's too.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, WEB_RUNNER, arr, bakeCall, bakeOf, checkCall, cps, inChrome, isObject, logicBin, obj, onHost, prebuild, refusedOf, show, str,
  webPlanCall, type Bake, type Entry, type JsonObject,
} from '../190/helpers.ts';
import { beltFixture, grantFixture, palletFixture, steadyFixture, type Fixture } from './fixtures.ts';
import { AC, INTERFACE, PLANTED, PROCESS, carry, fixturePiece, layout, plantsPack, processLib, type Assets } from './helpers.ts';
import { processWrites, sceneProgram } from './programs.ts';
import { BELT, GRANT, PALLET, STEADY } from './scenes.ts';

prebuild(() => { logicBin(); });

/** This suite's four fixtures, each program importing process@1 through the interface, and every program they name. */
function ours(assets: Assets): Fixture[] {
  return [[STEADY, steadyFixture], [BELT, beltFixture], [GRANT, grantFixture], [PALLET, palletFixture]].map(([s, make]) => {
    const scene = s as typeof STEADY, writes = processWrites(scene);
    layout(writes);
    const program = sceneProgram(scene, INTERFACE);
    carry(assets, program);
    return (make as typeof steadyFixture)(program, writes);
  });
}
/** The reference library's interface fixture runs in a check's receipt, by fixture: verdict, ran and deep_hashes. */
function receiptRuns(reply: JsonObject, library: string): Record<string, { verdict: string; ran: boolean; deep: Record<string, string> }> {
  expect(reply['ok'], `the check admits the piece: ${show(reply)}`).toBe(true);
  const lib = arr(obj(obj(reply['items'], 'items')['fixture'], 'items.fixture')['libraries'], 'libraries').map((l) => obj(l, 'a library')).find((l) => l['name'] === library);
  expect(lib, `the receipt names ${library}`).toBeDefined();
  const runs = arr(lib!['interfaces'], `${library}.interfaces`).map((i) => obj(i, 'an interface run')).find((i) => i['interface'] === PROCESS);
  expect(runs, `the receipt records ${PROCESS}'s fixtures run on ${library}: ${show(lib!['interfaces'])}`).toBeDefined();
  return Object.fromEntries(arr(runs!['fixtures'], 'fixtures').map((f) => {
    const o = obj(f, 'a fixture run');
    return [str(o['fixture'], 'fixture'), { verdict: str(o['verdict'], 'verdict'), ran: o['ran'] === true, deep: isObject(o['deep_hashes']) ? (o['deep_hashes'] as Record<string, string>) : {} }];
  }));
}
const stepHashes = (b: Bake): (string | null)[] => b.steps.map((s) => s.items['fixture']?.hash ?? null);

describe(`${AC[8]} the reference library is proved on this core and in headless Chrome`, () => {
  it(`${AC[8]} the reference library links only after every process@1 fixture passes on this core, and a library that fails one doesn't`, () => {
    const L = processLib();
    const assets: Assets = { ...L.assets };
    const [steady] = ours(assets);
    const [check] = onHost([checkCall(fixturePiece(steady as never, L.ref, assets))]);
    const runs = receiptRuns(check!, L.ref.name);
    expect(Object.keys(runs).sort(), `every ${PROCESS} fixture ran on the reference library`).toEqual([...L.iface.fixtures].sort());
    expect(Object.values(runs).map((r) => [r.verdict, r.ran]), 'and passed, at this check').toEqual(L.iface.fixtures.map(() => ['PASS', true]));
    // A library that fails a fixture: each planted library of process@1, claiming it, is refused at link.
    for (const id of L.iface.planted) {
      const a: Assets = { ...assets };
      const plants = plantsPack(L.program(id), true, '1.0.1', a);
      const [reply] = onHost([checkCall(fixturePiece(steady as never, { name: PLANTED, asset: id }, a, [plants]))]);
      const r = refusedOf(reply!, `the check of the steady fixture linking planted library ${id} as ${PROCESS}`);
      expect([r.code, r.refusals.some((x) => x['interface'] === PROCESS && typeof x['fixture'] === 'string')], `planted library ${id} is refused at link, naming ${PROCESS} and a fixture: ${show(r.refusals as never)}`).toEqual(['link_refused', true]);
    }
  }, TIMEOUT);

  it(`${AC[8]} every fixture gives the same step hashes and checkpoint hashes on this core and in headless Chrome`, async () => {
    const L = processLib();
    const assets: Assets = { ...L.assets };
    const mine = ours(assets);
    const theirs = L.iface.fixtures.map((id) => ({ id, json: L.fixture(id) }));
    const all = [
      ...mine.map((f) => ({ name: f.name, piece: fixturePiece(f as never, L.ref, assets), steps: f.steps, track: [] as Entry[], id: null as string | null })),
      ...theirs.map(({ id, json }) => ({ name: String(json['name']), piece: fixturePiece(json, L.ref, assets), steps: Number(json['steps']), track: (json['track'] ?? []) as unknown as Entry[], id })),
    ];
    const replies = onHost([checkCall(all[0]!.piece), WEB_RUNNER, ...all.map((f) => bakeCall(f.piece, f.steps, f.track)), ...all.map((f) => webPlanCall(f.piece, f.steps, f.track))]);
    const runs = receiptRuns(replies[0]!, L.ref.name);
    const bakes = all.map((f, i) => bakeOf(replies[2 + i]!, `${f.name}'s bake on this core`));
    const plans = all.map((f, i) => { const r = replies[2 + all.length + i]!; expect(r['ok'], `web_plan gave ${f.name}'s request: ${show(r)}`).toBe(true); return r['request']!; });
    const chrome = await inChrome(str(replies[1]!['source'], 'web_runner.source'), plans);
    expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
    all.forEach((f, i) => {
      const web = bakeOf(obj(chrome.replies[i], `${f.name} in Chrome`), `${f.name}'s bake in headless Chrome`, true);
      expect(stepHashes(bakes[i]!).every((h) => typeof h === 'string'), `${f.name}: every step has a hash on this core`).toBe(true);
      expect(stepHashes(web), `${f.name}: the same step hash at every step in headless Chrome`).toEqual(stepHashes(bakes[i]!));
      expect(cps(web, 'fixture'), `${f.name}: the same checkpoints' full-state hashes in headless Chrome`).toEqual(cps(bakes[i]!, 'fixture'));
      if (f.id) {
        const deep = Object.entries(runs[f.id]!.deep).map(([k, h]) => `${k} ${h}`).sort();
        expect(deep, `${f.name}: the receipt's full-state hashes are this core's`).toEqual([...cps(bakes[i]!, 'fixture')].sort());
      }
    });
  }, TIMEOUT);
});
