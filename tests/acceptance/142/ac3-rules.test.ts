// AC3 #142.083a5161: "A cue list that breaks a grammar rule is refused naming the cue and the rule, and each rule has a
// planted-fault twin"
//
// The refusal fixtures (README: Fixtures, the kinetic-type films): six explain.kinetic_type films on the 2D stage, each
// breaking one of the issue's six grammar rules in one cue and otherwise clean, with a tempo map of 120 BPM (a beat
// every 0.5 s), every cue a first-party verb (`fade_in` enters, `fade_out` exits, `rotate` moves):
//   one entrance at a time      cue_crowd enters `with` cue_opening (both 0–0.5 s)            explain.one_entrance
//   main word ≥ 3 × its sub     cue_small's word at 80 u over a 40 u sub-line (2×)            explain.main_word_size
//   landings on the beat grid   cue_offbeat enters over 0.3 s, landing at 0.8 s               explain.on_beat
//   text still once landed      cue_turn turns cue_opening's landed word by 15°               explain.still_once_landed
//   exits faster than entrances cue_leave fades cue_opening out over 1 s; it entered in 0.5 s explain.exit_faster
//   a section of at most 8 s    cue_hold waits 9.5 s after cue_opening: one section of 10 s  explain.section_length
// Each is refused with an error naming its cue and its rule; where the film ends with cue_coda, an entrance that breaks
// nothing, that error doesn't name cue_coda. The clean twin, every rule's feature inside its limit (a 124 u word over a
// 40 u sub-line, an exit of 0.25 s after a 0.5 s entrance, every landing on a beat), is presented with no error.
//
// Each rule has its planted-fault twin: the pack's manifest (`packs/explain-1.0.0/pack.json`) declares the ten recipes
// as pack kinds `explain.<recipe>@1`, each with at least one rule; between them the six codes, all six on
// explain.kinetic_type@1; every rule with a twin `{example: sha256, expect: code}` (#202's form), whose example is a
// pack asset of that hash. The store installs the pack (its kit ran every twin), and each twin, presented as it is,
// is refused with an error naming the code it expects.
// Wrong programs: the base; a rule that refuses without naming the cue or the rule; a rule that names every cue; a
// check that refuses the clean twin; a rule with no twin, or a twin that passes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, EXPLAIN, RECIPES, RULES, TIMEOUT, arr, brief, docId, enter, isObject, kindOf, kinetic, names, none, obj, present, presented,
  refusalFailures, run, scenario, useFolders, useShow, type JsonObject, type JsonValue,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();

const opening = enter('cue_opening', 'MAKE');
const coda = (at: number): JsonObject => enter('cue_coda', 'END', at);
/** Each rule's breaking film, the cue it must name, and whether it ends with cue_coda. */
const BREAKS: { rule: string; cue: string; doc: JsonObject; coda: boolean }[] = [
  { rule: RULES.oneEntrance, cue: 'cue_crowd', coda: true, doc: kinetic('Two entrances at once', [opening, enter('cue_crowd', 'LOUD', 0.5, { when: 'with' }), coda(0.5)]) },
  { rule: RULES.mainWord, cue: 'cue_small', coda: true, doc: kinetic('A main word twice its sub-line', [opening, enter('cue_small', 'TINY', 0.5, { sub: 'a sub-line half its size', data: { size: 80, sub_size: 40 } }), coda(0.5)]) },
  { rule: RULES.onBeat, cue: 'cue_offbeat', coda: true, doc: kinetic('A landing off the beat', [opening, enter('cue_offbeat', 'LATE', 0.3), coda(0.7)]) },
  { rule: RULES.still, cue: 'cue_turn', coda: true, doc: kinetic('A landed word turned', [opening, { id: 'cue_turn', kind: 'rotate', targets: ['cue_opening'], params: { angle: 15 }, span: '0.5s' }, coda(0.5)]) },
  { rule: RULES.exitFaster, cue: 'cue_leave', coda: true, doc: kinetic('An exit slower than its entrance', [opening, { id: 'cue_leave', kind: 'fade_out', targets: ['cue_opening'], span: '1s' }, coda(0.5)]) },
  { rule: RULES.section, cue: 'cue_hold', coda: false, doc: kinetic('A section of 10 s', [opening, { id: 'cue_hold', span: '9.5s' }], 12) },
];
const CLEAN = kinetic('Every rule kept', [
  enter('cue_opening', 'MAKE', 0.5, { sub: 'it move', data: { size: 124, sub_size: 40 } }),
  { id: 'cue_leave', kind: 'fade_out', targets: ['cue_opening'], span: '0.25s' },
  coda(0.75),
]);

describe(`${AC[3]} a cue list that breaks a grammar rule is refused naming the cue and the rule, and each rule has a planted twin`, () => {
  it(`${AC[3]} each of the six rules refuses its breaking cue list, naming the cue and the rule, and the clean twin is presented`, () => {
    const replies = run(show(), scenario(folder(), [...BREAKS.map((b, i) => present(docId(i + 1), b.doc)), present(docId(9), CLEAN)]));
    const failures = BREAKS.flatMap((b, i) => refusalFailures(replies[i]!, b.cue, b.rule, `${b.rule}'s breaking film`, b.coda ? 'cue_coda' : undefined));
    none(failures, 'each breaking cue list is refused naming its cue and its rule');
    presented(replies[BREAKS.length]!, 'the clean twin, every rule kept');
  }, TIMEOUT);

  it(`${AC[3]} every rule of the ten recipes has a planted twin, and each twin is refused naming its rule`, () => {
    const manifest = join(EXPLAIN.dir, 'pack.json');
    expect(existsSync(manifest), `the explain pack's manifest is at packs/explain-1.0.0/pack.json`).toBe(true);
    const pack = obj(JSON.parse(readFileSync(manifest, 'utf8')) as JsonValue, 'pack.json');
    const kinds = obj(pack['kinds'], 'pack.json: kinds');
    const assets = (Array.isArray(pack['assets']) ? pack['assets'] : []).filter(isObject);
    const failures: string[] = [];
    const codes = new Set<string>();
    const twins: { kind: string; expect: string; doc: JsonObject }[] = [];
    for (const recipe of RECIPES) {
      const kind = kinds[kindOf(recipe)];
      if (!isObject(kind)) { failures.push(`pack.json declares no pack kind ${kindOf(recipe)}`); continue; }
      const rules = (Array.isArray(kind['rules']) ? kind['rules'] : []).filter(isObject).map((r) => String(r['code']));
      if (!rules.length) failures.push(`${kindOf(recipe)} carries no grammar rule`);
      rules.forEach((c) => codes.add(c));
      if (recipe === 'kinetic_type') for (const c of Object.values(RULES)) if (!rules.includes(c)) failures.push(`${kindOf(recipe)} doesn't carry ${c}`);
      const list = (Array.isArray(kind['twins']) ? kind['twins'] : []).filter(isObject);
      for (const code of rules) if (!list.some((t) => t['expect'] === code)) failures.push(`${kindOf(recipe)}: the rule ${code} has no planted twin`);
      for (const t of list) {
        const asset = assets.find((a) => a['sha256'] === t['example']);
        const path = asset && typeof asset['path'] === 'string' ? join(EXPLAIN.dir, asset['path']) : '';
        if (!path || !existsSync(path)) { failures.push(`${kindOf(recipe)}: the twin ${brief(t['example'] ?? null)} is no asset of the pack`); continue; }
        const bytes = readFileSync(path);
        if (createHash('sha256').update(bytes).digest('hex') !== t['example']) failures.push(`${kindOf(recipe)}: the twin's file ${String(asset!['path'])} doesn't hash to ${String(t['example'])}`);
        twins.push({ kind: kindOf(recipe), expect: String(t['expect']), doc: obj(JSON.parse(bytes.toString('utf8')) as JsonValue, `the twin ${String(asset!['path'])}`) });
      }
    }
    for (const c of Object.values(RULES)) if (!codes.has(c)) failures.push(`no recipe carries ${c}`);
    none(failures, 'every rule of the ten recipes has its planted twin');

    const replies = run(show(), scenario(folder(), [{ call: 'packs' }, ...twins.map((t, i) => present(docId(100 + i), t.doc))]));
    const row = arr(replies[0]!['packs'], 'packs: packs').filter(isObject).find((r) => r['pack'] === EXPLAIN.id && r['version'] === EXPLAIN.version);
    expect(row?.['state'], `the explain pack is installed, its kit run on every twin: ${brief(row ?? null)}`).toBe('installed');
    twins.forEach((t, i) => {
      const r = replies[1 + i]!;
      if (r['outcome'] === 'presented') failures.push(`${t.kind}: its twin expecting ${t.expect} is presented`);
      else if (!(Array.isArray(r['issues']) ? r['issues'] : []).some((x) => isObject(x) && x['severity'] === 'error' && names(x, t.expect))) failures.push(`${t.kind}: its twin is refused with no error naming ${t.expect}: ${brief(r['issues'] ?? null, 1200)}`);
    });
    none(failures, 'each planted twin is refused, naming its rule');
  }, TIMEOUT);
});
