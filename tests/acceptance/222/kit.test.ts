// AC4 #222.d9fdb65d: "A test pack's verb `acme.stamp` installs and expands with no canvas-module change and motion's
// interface digest unchanged; every first-party verb passes the cue kit, an emphasis verb ending with every path it
// wrote at its base value bit for bit; and the kit refuses a planted `indicate` that ends at scale 1.0000001, a
// `fade_in` whose last key lands one flick past its span and a verb that writes a non-target's path, each naming the
// verb"
//
// acme.stamp: the test pack `acme/acme` (README: The test pack), written into a temporary folder, holds one cue.kind@1
// entry, `acme.stamp`, an emphasis whose recipe writes a pulse on its targets' scale. In one process: `schedule`,
// `install_pack`, `schedule` again: motion@1's interface digest is the same before and after; the pack is installed
// with no error; deep://registries lists `acme.stamp` in cue.kind@1 with origin `pack` and a PASSing kit. A film
// whose cue plays `acme.stamp` on a square over 1 s presents with no error, its expansion writes only under the square
// and only inside [0, 1] s, and the square's scale swells (x ≥ 1.2 at 0.5 s) and is back at 1 s, bit for bit, to
// what it was at 0 s. No Rust source under crates/ names `acme.stamp`. Wrong programs: a verb list compiled into
// motion (the pack's entry refused, or its cue unresolved); a pack entry hashed into motion's interface (its digest
// moves at install).
//
// The first-party verbs: each of the 29 is listed with origin `first_party` and a kit result PASS on each of the cue
// kit's five rules (README: The cue kit). Independently of the kit's word, each emphasis verb's fixture film (README:
// Fixtures) is read at its cue's start, its end and one flick after: every path its cue wrote on its targets (its
// expansion's channels, derived items left out) reads, at the end and after, exactly what it read at the start.
// Wrong program: an emphasis that leaves a residue (a scale of 1.0000001, an opacity of 0.9999999).
//
// The planted entries: cue.kind@1's row lists them with their kit results: `indicate` FAILs the rule
// `back_to_base`, `fade_in` FAILs `inside_span`, and `nudge` (the verb that writes a non-target's path) FAILs
// `targets_only`, each failure's message naming the verb. Wrong program: a kit that admits any of them.
import { describe, expect, it } from 'vitest';
import {
  ACME_STAMP, AC, CUE_KINDS, EMPHASIS, KIT_RULES, PLANTED_ENTRIES, TIMEOUT, VERBS, VERBS_PACK, arr, brief, cueList, docId, evalAt,
  expansionOf, film, fixtureOf, fl, isObject, itemOf, kitOf, markerOf, none, num, obj, packAt, present, presented, registryRow, run, rustNaming,
  scenario, showTime, square, str, useFolders, useShow, valuesOf, verbCue, writeAcme, type Fixture, type JsonObject, type JsonValue,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const SCALE = 'items/sq/at/scale';

/** motion@1's interface digest in deep://schedule (#185). */
function motionDigest(schedule: JsonObject, what: string): string {
  const i = obj(obj(schedule['interfaces'], `${what}: interfaces`)['motion@1'], `${what}: interfaces.motion@1`);
  return str(i['digest'], `${what}: motion@1's digest`);
}

describe(`${AC[4]} a pack adds a verb as data, the first-party verbs pass the cue kit, and the kit refuses its planted entries`, () => {
  it(`${AC[4]} acme.stamp installs and expands with no canvas-module change and motion's digest unchanged; every first-party verb passes the cue kit, each emphasis verb ending at its base value bit for bit`, () => {
    const acme = writeAcme(folder());
    const stamped = film('A stamp', [square('sq'), cueList([{ id: 's', kind: ACME_STAMP, targets: ['sq'], span: '1s' }])], { span: 2, packs: [packAt(acme)] });
    const DOC = docId(1);
    const [before, installed, packs, after, registries, shown, at0, atMid, atEnd] = run(show(), scenario(folder(), [
      { call: 'schedule' }, { call: 'install_pack', id: acme.id, dir: acme.dir }, { call: 'packs' }, { call: 'schedule' }, { call: 'registries' },
      present(DOC, stamped), evalAt(DOC, 0, { paths: [SCALE] }), evalAt(DOC, fl(0.5), { paths: [SCALE] }), evalAt(DOC, fl(1), { paths: [SCALE] }),
    ], { packs: [VERBS_PACK] }));
    expect(installed, 'install_pack answers').toBeDefined();

    expect(motionDigest(after!, 'the schedule after the install'), 'motion@1\'s interface digest is the same before and after acme installs').toBe(motionDigest(before!, 'the schedule before the install'));
    const row = arr(packs!['packs'], 'packs: packs').filter(isObject).find((r) => r['pack'] === acme.id && r['version'] === acme.version);
    expect(row?.['state'], `${packAt(acme)} is installed: ${brief(row)}`).toBe('installed');
    expect((Array.isArray(row?.['issues']) ? row['issues'] : []).filter((i) => isObject(i) && i['severity'] === 'error'), `${packAt(acme)} installs with no error`).toEqual([]);
    expect(rustNaming(ACME_STAMP), 'no Rust source under crates/ names acme.stamp: the verb is data').toEqual([]);

    const reg = registryRow(registries!, CUE_KINDS);
    expect(reg['owner'], `${CUE_KINDS} is declared by motion`).toBe('motion');
    const entries = arr(reg['entries'], `${CUE_KINDS}: entries`).filter(isObject);
    const failures: string[] = [];
    const stamp = entries.find((e) => e['name'] === ACME_STAMP);
    if (!stamp) failures.push(`${CUE_KINDS} doesn't list ${ACME_STAMP}`);
    else {
      if (stamp['origin'] !== 'pack') failures.push(`${ACME_STAMP} is listed with origin ${brief(stamp['origin'])}, not pack`);
      if (kitOf(stamp['kit'], `${ACME_STAMP}'s kit`).verdict !== 'PASS') failures.push(`${ACME_STAMP}'s kit result is ${brief(stamp['kit'])}`);
    }
    for (const verb of VERBS) {
      const e = entries.find((x) => x['name'] === verb);
      if (!e) { failures.push(`${CUE_KINDS} doesn't list the first-party verb ${verb}`); continue; }
      if (e['origin'] !== 'first_party') failures.push(`${verb} is listed with origin ${brief(e['origin'])}, not first_party`);
      const kit = kitOf(e['kit'], `${verb}'s kit`);
      if (kit.verdict !== 'PASS') failures.push(`${verb}'s cue kit result is ${kit.verdict}: ${brief(kit.raw, 400)}`);
      for (const rule of KIT_RULES) {
        const r = kit.rules.find((x) => x.rule === rule);
        if (r?.verdict !== 'PASS') failures.push(`${verb}: the cue kit's rule ${rule} reads ${r ? r.verdict : 'nothing'}`);
      }
    }
    none(failures, `${CUE_KINDS} lists acme.stamp and every first-party verb, each passing the cue kit`);

    presented(shown!, 'the film playing acme.stamp');
    const e = expansionOf(shown!, 'the film playing acme.stamp');
    const writes = e.channels.filter((c) => c.cue === 's');
    expect(writes.length, 'acme.stamp\'s cue writes a channel').toBeGreaterThan(0);
    for (const c of writes) {
      expect(itemOf(c.target), `acme.stamp writes only under its target sq, not ${c.target}`).toBe('sq');
      for (const t of c.times) expect(t >= 0 && t <= fl(1), `acme.stamp keys inside [0, 1] s, not at ${showTime(t)}`).toBe(true);
    }
    const scale = (reply: JsonObject, what: string): JsonValue => valuesOf(reply, what)[SCALE] ?? null;
    const mid = arr(scale(atMid!, 'the stamp at 0.5 s'), `the stamp at 0.5 s: ${SCALE}`);
    expect(num(mid[0], 'the stamp\'s x scale at 0.5 s') >= 1.2, `acme.stamp swells its target: x scale at 0.5 s is ${brief(mid)}`).toBe(true);
    expect(JSON.stringify(scale(atEnd!, 'the stamp at 1 s')), 'acme.stamp leaves the scale at 1 s, bit for bit, as at 0 s').toBe(JSON.stringify(scale(at0!, 'the stamp at 0 s')));

    // Each emphasis verb's fixture film, read at its cue's start, end and one flick after (README: Fixtures).
    const read = EMPHASIS.map((verb) => ({ verb, f: fixtureOf(verb) }));
    none(read.flatMap(({ f }) => (Array.isArray(f) ? f : [])), 'each emphasis verb ships a fixture this suite can read');
    const fixtures = read.map(({ verb, f }) => ({ verb, fixture: f as Fixture }));
    const shownFixtures = run(show(), scenario(folder(), fixtures.map((p, i) => present(docId(100 + i), p.fixture.document)), { packs: [VERBS_PACK] }));
    const plans = fixtures.map((p, i) => {
      presented(shownFixtures[i]!, `${p.verb}'s fixture film`);
      const ex = expansionOf(shownFixtures[i]!, `${p.verb}'s fixture film`);
      const cue = verbCue(p.fixture.document, p.verb);
      const m = markerOf(ex, cue, `${p.verb}'s fixture film`);
      const paths = [...new Set(ex.channels.filter((c) => c.cue === cue && !ex.derived.includes(itemOf(c.target))).map((c) => c.target))];
      expect(paths.length, `${p.verb}'s cue writes a path on its targets`).toBeGreaterThan(0);
      return { ...p, paths, times: [m.t, m.t + m.span, m.t + m.span + 1] };
    });
    const readings = run(show(), scenario(folder(), [
      ...plans.map((p, i) => present(docId(100 + i), p.fixture.document)),
      ...plans.flatMap((p, i) => p.times.map((t) => evalAt(docId(100 + i), t, { paths: p.paths }))),
    ], { packs: [VERBS_PACK] }));
    const residues: string[] = [];
    plans.forEach((p, i) => {
      const [start, end, past] = p.times.map((t, k) => valuesOf(readings[plans.length + 3 * i + k]!, `${p.verb}'s film at ${showTime(t)}`));
      for (const path of p.paths) {
        const base = JSON.stringify(start![path] ?? null);
        if (start![path] === undefined || start![path] === null) residues.push(`${p.verb}: ${path} reads nothing at the cue's start`);
        if (JSON.stringify(end![path] ?? null) !== base) residues.push(`${p.verb}: ${path} ends at ${brief(end![path])}, not its base ${base}, bit for bit`);
        if (JSON.stringify(past![path] ?? null) !== base) residues.push(`${p.verb}: ${path} reads ${brief(past![path])} one flick after its cue, not its base ${base}`);
      }
    });
    none(residues, 'every emphasis verb ends with every path it wrote at its base value, bit for bit');
  }, TIMEOUT);

  it(`${AC[4]} the cue kit refuses its planted indicate ending at scale 1.0000001, its fade_in keyed one flick past its span and a verb writing a non-target's path, each naming the verb`, () => {
    const [registries] = run(show(), scenario(folder(), [{ call: 'registries' }], { packs: [VERBS_PACK] }));
    const reg = registryRow(registries!, CUE_KINDS);
    const planted = arr(reg['planted'], `${CUE_KINDS}: planted`).filter(isObject);
    const failures: string[] = [];
    for (const p of PLANTED_ENTRIES) {
      const entry = planted.find((x) => x['name'] === p.name);
      if (!entry) { failures.push(`${CUE_KINDS} lists no planted entry ${p.name} (${p.what}); it lists ${planted.map((x) => brief(x['name'])).join(', ') || 'none'}`); continue; }
      const kit = kitOf(entry['result'], `the planted ${p.name}'s kit result`);
      if (kit.verdict !== 'FAIL') failures.push(`the kit admits the planted ${p.name} (${p.what}): ${brief(kit.raw, 400)}`);
      const rule = kit.rules.find((r) => r.rule === p.rule);
      if (rule?.verdict !== 'FAIL') failures.push(`the planted ${p.name} (${p.what}) doesn't fail the rule ${p.rule}: ${brief(kit.raw, 400)}`);
      else if (!rule.message.includes(p.name)) failures.push(`the rule ${p.rule}'s failure on the planted ${p.name} doesn't name the verb: ${JSON.stringify(rule.message)}`);
    }
    none(failures, 'the cue kit refuses each planted entry, naming the verb');
  }, TIMEOUT);
});
