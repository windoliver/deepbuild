// AC12 #194.2ec78bb6: "A platformer whose logic reads `tuning.jump_height` 1.0 at init and fires its hero's
// character-body jump with it peaks 1.0185 m up within 1 mm at 120 Hz under 9.81 m/s²; a patch that sets the row to 1.5
// keeps the logic program's hash, re-bakes under the catalog's new hash and peaks 1.5227 m within 1 mm; and a planted
// program with the jump height compiled in keeps all 600 full-state hashes equal with the row moved to 1.25 and fails
// logic.tuning, naming tuning.jump_height"
//
// The platformer (programs.ts `platformer`): a 5 s scene whose world `platform` holds a flat floor and #182's capsule
// `hero` at 120 Hz under 9.81 m/s², its input `hop` a jump taken from the logic item `tuner` (`on: {logic: tuner}`);
// `tuner` at 120 Hz names the tuning catalog in `assets`, reads `tuning.jump_height` in its init by hashes, and fires
// `hop` with it at step 60 through its fire region (`fires: {platform: [hop]}`, `fires_at`). The catalog is the tuning
// table's CSV (fixtures.ts `tuningCsv`), imported through deep-show's `catalog_import`, whose asset's SHA-256 is the one
// `deep-catalog pack` gives the same file. One deep-show run:
// - the world's bake (`world`) keeps the jump as a derived entry from `logic:tuner` with height 1, and the hero's lowest
//   point rises 1.0185 m (#182's discrete solution, computed here) within 1 mm;
// - the patch, the same file with the row's value 1.5, imported again: a new catalog hash; the document's revision
//   naming it keeps `deep_query`'s program `hash` and gives another `bake_key` (and the first catalog gives the first
//   key back), and peaks 1.5227 m within 1 mm;
// - logic.tuning (deep-show's `logic` call with `check: "logic.tuning"`) on the clean program moves the row to 1.25,
//   reports {row: tuning.jump_height, from: 1, to: 1.25, steps: 600, equal < 600} and passes; on the planted program
//   with 1.0 compiled in, every one of the 600 full-state hashes is equal and it fails, naming tuning.jump_height.
// The wrong programs: the base (no catalog_import, a logic item's `fires` refused by name), a logic module that fires no
// entry or loses its height, a bake key that ignores the catalog's hash, and a logic.tuning that passes a program the
// row never reaches.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DT, G, HERO, discreteHeights, lowest, statesOf } from '../182/helpers.ts';
import { binOf, prebuild, presented, putEvidence, runShow, scenario, SESSION, showCall } from '../538/helpers.ts';
import { AC, DOC, TIMEOUT, packAll, prebuildCatalog, scratch, show, type Obj } from './helpers.ts';
import { TUNING_SCHEMA, tuningCsv } from './fixtures.ts';
import { FIRE_STEP, PLATFORM, TUNER, platformer, tuner } from './programs.ts';

prebuildCatalog();
prebuild(['full']);

const STEPS = 600;
/** The discrete peak of a jump of `h` m at 120 Hz under 9.81 m/s² (#182's rule). */
const peakOf = (h: number): number => Math.max(...discreteHeights(Math.sqrt(2 * G * h), STEPS));
/** The hero's peak over the world's bake: its lowest point's highest rise above where it stood at the jump's step. */
function peak(reply: Obj, what: string): { peak: number; jump: Obj | undefined } {
  const states = statesOf(reply as never, HERO, what);
  const inputs = Array.isArray(reply['inputs']) ? (reply['inputs'] as Obj[]) : [];
  const jump = inputs.find((e) => e['kind'] === 'jump' && e['target'] === HERO);
  const k = Number(jump?.['step'] ?? FIRE_STEP);
  return { peak: Math.max(...states.slice(k + 1).map(lowest)) - lowest(states[k]!), jump };
}

describe(`${AC[12]} a tuning row reaches the jump, a patch re-bakes it, and logic.tuning catches a height compiled in`, () => {
  it(`${AC[12]} jump_height 1.0 peaks 1.0185 m; the 1.5 patch keeps the program's hash, re-bakes under the new catalog and peaks 1.5227 m; the height compiled in keeps all 600 hashes equal and fails logic.tuning naming tuning.jump_height`, () => {
    expect(Math.abs(peakOf(1) - 1.0185), `the discrete solution for 1 m (dt ${DT}) is the issue's 1.0185`).toBeLessThan(5e-5);
    expect(Math.abs(peakOf(1.5) - 1.5227), 'and for 1.5 m the issue\'s 1.5227').toBeLessThan(5e-5);
    const dir = scratch('ac12');
    const file = (name: string, text: string): string => { mkdirSync(join(dir, name), { recursive: true }); const p = join(dir, name, 'tuning.csv'); writeFileSync(p, text); return p; };
    const [one, patched] = [file('v1', tuningCsv('1.0')), file('v2', tuningCsv('1.5'))];
    const [p1, p2] = packAll([
      { op: 'pack', tables: { tuning: { path: one } }, schema: TUNING_SCHEMA, out: join(dir, 'v1.bin') },
      { op: 'pack', tables: { tuning: { path: patched } }, schema: TUNING_SCHEMA, out: join(dir, 'v2.bin') },
    ], 'the tuning table and its patch');
    expect(p2!.sha256, 'the patch is a new catalog hash').not.toBe(p1!.sha256);

    const [clean, compiled] = [tuner(false), tuner(true)];
    const ev = scratch('ev');
    for (const b of [clean.bytes, compiled.bytes]) putEvidence(ev, b);
    const [doc, planted] = [DOC(31), DOC(32)];
    const query = (d: string): Obj => ({ call: 'deep_query', session: SESSION, doc: d, what: 'logic', items: [TUNER], steps: [0], at: 0 });
    const tuning = (d: string): Obj => ({ call: 'logic', doc: d, steps: STEPS, check: 'logic.tuning' });
    const r: Obj[] = runShow(binOf('full'), scenario(ev, [doc, planted], [
      { call: 'catalog_import', tables: { tuning: { path: one } }, schema: TUNING_SCHEMA },
      { call: 'catalog_import', tables: { tuning: { path: patched } }, schema: TUNING_SCHEMA },
      showCall(doc, platformer(clean, p1!.sha256) as never), { call: 'world', doc, world: PLATFORM }, query(doc), tuning(doc),
      showCall(doc, platformer(clean, p2!.sha256) as never), { call: 'world', doc, world: PLATFORM }, query(doc),
      showCall(doc, platformer(clean, p1!.sha256) as never), query(doc),
      showCall(planted, platformer(compiled, p1!.sha256) as never), tuning(planted),
    ]), 'AC12 the platformer');
    for (const [i, sha] of [[0, p1!.sha256], [1, p2!.sha256]] as const) {
      expect([r[i]!['asset']?.['sha256'], r[i]!['asset']?.['kind'], r[i]!['asset']?.['layout']], `catalog_import ${i + 1} gives the catalog asset deep-catalog packs: ${show(r[i])}`).toEqual([sha, 'catalog', 'table.layout@1']);
    }
    presented(r[2]!, 'the platformer naming jump_height 1.0');
    const first = peak(r[3]!, 'the platformer\'s bake at 1.0');
    expect(first.jump, `the bake keeps the tuner's jump as a derived entry: ${show(r[3]!['inputs'])}`).toMatchObject({ kind: 'jump', target: HERO, input: 'hop', from: `logic:${TUNER}`, data: { height: 1 } });
    expect(Math.abs(first.peak - 1.0185), `the hero peaks ${first.peak.toFixed(5)} m up, not 1.0185 within 1 mm`).toBeLessThanOrEqual(0.001);
    const q1 = r[4]!['logic']?.[TUNER] as Obj | undefined;
    expect(typeof q1?.['hash'] === 'string' && typeof q1?.['bake_key'] === 'string', `deep_query answers the tuner's program hash and bake_key: ${show(r[4])}`).toBe(true);

    const report = r[5]!['check'] as Obj | undefined;
    expect(report?.['kind'], `the logic call runs logic.tuning: ${show(r[5], 1500)}`).toBe('logic.tuning');
    expect(report!['verdict'], `logic.tuning passes the program that reads the row: ${show(report)}`).toBe('PASS');
    const row = (report!['rows'] as Obj[] | undefined)?.find((x) => x['row'] === 'tuning.jump_height');
    expect(row, `the report lists tuning.jump_height: ${show(report!['rows'])}`).toMatchObject({ row: 'tuning.jump_height', from: 1, to: 1.25, steps: STEPS });
    expect(row!['equal'], 'and the moved row changes the full-state hash at some step').toBeLessThan(STEPS);

    presented(r[6]!, 'the platformer patched to 1.5');
    const second = peak(r[7]!, 'the platformer\'s bake at 1.5');
    expect(second.jump, 'the patched bake jumps 1.5 m').toMatchObject({ kind: 'jump', target: HERO, data: { height: 1.5 } });
    expect(Math.abs(second.peak - 1.5227), `the patched hero peaks ${second.peak.toFixed(5)} m up, not 1.5227 within 1 mm`).toBeLessThanOrEqual(0.001);
    const [q2, q3] = [r[8]!['logic']?.[TUNER] as Obj | undefined, r[10]!['logic']?.[TUNER] as Obj | undefined];
    expect(q2?.['hash'], 'the patch keeps the logic program\'s hash').toBe(q1!['hash']);
    expect(q2?.['bake_key'], 'and re-bakes under another key, the catalog\'s new hash in it').not.toBe(q1!['bake_key']);
    expect(q3?.['bake_key'], 'the first catalog again gives the first key back').toBe(q1!['bake_key']);

    presented(r[11]!, 'the platformer with the jump height compiled in');
    const caught = r[12]!['check'] as Obj | undefined;
    expect(caught?.['kind'], `the logic call runs logic.tuning on the planted program: ${show(r[12], 1500)}`).toBe('logic.tuning');
    expect(caught!['verdict'], `logic.tuning fails the jump height compiled in: ${show(caught)}`).toBe('FAIL');
    expect((caught!['rows'] as Obj[] | undefined)?.find((x) => x['row'] === 'tuning.jump_height'), 'with the row moved to 1.25, all 600 full-state hashes are equal')
      .toMatchObject({ row: 'tuning.jump_height', from: 1, to: 1.25, steps: STEPS, equal: STEPS });
    expect(JSON.stringify(caught!['failures'] ?? []).includes('tuning.jump_height'), `its failure names tuning.jump_height: ${show(caught!['failures'])}`).toBe(true);
  }, TIMEOUT);
});
