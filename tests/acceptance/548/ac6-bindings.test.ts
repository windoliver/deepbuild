// #548.d9cc61ff: The flock item's Rust bindings list each of its reads, writes and emits with the offsets and types
// deep_query returns, and a program built against them exports a `regions_digest` equal to the item's layout digest; a
// program that reads `score` as f64 where the item declares i32 fails to build against them, the build naming the
// field and the line; a program built against bindings of another layout digest is refused at check, before any step
// runs, naming the first entry whose offset differs; and a planted generator that orders fields by name gives offsets
// that differ from the region map and fails, naming the first field
//
// deep_kinds' bindings (README: deep_kinds `bindings`) of the flock document's item, against deep_query's region map
// of the same item; this suite's Rust program (flock-rs/) built against them for wasm32 with the pinned toolchain, its
// exported `regions_digest` read from the module, then checked and baked by `deep-logic` as the flock item's program:
// it reads and writes by name only, so the arrays and rows its rule gives on a track (worked here) show the bindings
// put every field where the item's layout has it. The same program with `wrong_score` must not build. A second
// document's flock reads `gust` before `wind` (another layout); the program built against its bindings is checked under
// it, then baked as the flock's program, which check must refuse, naming `wind`. The planted generator
// `bindings_fields_by_name` (`deep-show run --planted`) orders fields by name.

import { describe, expect, it } from 'vitest';
import { BOIDS, FLOCK_READS } from './programs.ts';
import { flockDoc, flockPiece, flockProgram } from './fixtures.ts';
import {
  AC, DOC, MS, STEP, admitted, arr, bakeCall, bakeOf, bindingsCall, bindingsOf, buildRust, checkCall, entryAt, entryText, exportedDigest,
  failsNaming, firstDiff, logic, logicBin, logicReadOf, none, obj, prebuild, presented, programOf, putEvidence, queryLogic, runShow, same, scenario,
  show, showBin, showCall, useTemp, type Bindings, type Entry, type JsonValue, type KindsPlanted, type Layout,
} from './helpers.ts';

prebuild(() => { logicBin(); showBin(); });
const temp = useTemp();
const V1_READS = ['gust', 'wind'];
const STEPS = 120;
const TRACK: Entry[] = [entryAt('wind', 30, 2.5), entryAt('gust', 60, 1.5), entryAt('gust', 60, -0.5, 1), entryAt('wind', 90, -4), entryAt('gust', 110, 3)];

/** The flock's region map from deep_query and its Rust bindings from deep_kinds, and the second layout's bindings. */
function read(kindsPlanted?: KindsPlanted): { map: Layout; bindings: Bindings; v1: Bindings } {
  const p2 = flockProgram();
  const p1 = flockProgram(V1_READS);
  const ev = temp();
  for (const p of [p1, p2]) putEvidence(ev, p.bytes);
  const [D, D1] = [DOC(7), DOC(8)];
  const r = runShow(scenario(ev, [D, D1], [
    showCall(D, flockDoc('flock', p2), 1), showCall(D1, flockDoc('flock_v1', p1, V1_READS), 2),
    queryLogic(D, ['flock'], [], [], 200 * MS), bindingsCall(D, 'flock', 300 * MS), bindingsCall(D1, 'flock', 400 * MS),
  ]), 'the flock\'s documents presented, the region map and the bindings read', kindsPlanted);
  presented(r[0]!, 'the flock'); presented(r[1]!, 'the flock reading gust first');
  return { map: logicReadOf(r[2]!, 'flock', 'deep_query of the flock\'s region map').region_map, bindings: bindingsOf(r[3]!, 'the flock\'s bindings'), v1: bindingsOf(r[4]!, 'the second layout\'s bindings') };
}
/** The criterion's judgement of bindings against the region map: the first field whose offset, size or type differs, in declaration order. */
function judge(b: Bindings, map: Layout): string[] {
  const failures: string[] = [];
  const first = map.entries.find((m, i) => { const f = b.fields.find((x) => x.region === m.region && x.name === m.name); return !f || f.offset !== m.offset || f.size !== m.size || f.type !== m.type || b.fields[i]?.name !== m.name; });
  if (first) {
    const f = b.fields.find((x) => x.region === first.region && x.name === first.name);
    failures.push(`the first field that differs from the region map: ${first.region} ${first.name}: ${f ? entryText(f) : 'missing'} in the bindings, ${entryText(first)} in the map`);
  }
  if (b.fields.length !== map.entries.length) failures.push(`the bindings list ${b.fields.length} fields, the map ${map.entries.length} entries`);
  if (b.digest !== map.digest) failures.push(`the bindings' digest ${b.digest} isn't the item's layout digest ${map.digest}`);
  for (const m of map.entries) if (!new RegExp(`\\b${m.name}\\b`).test(b.source)) failures.push(`the source names no field ${m.name}`);
  if (b.language !== 'rust') failures.push(`the language is ${b.language}, not rust`);
  return failures;
}
/** What the Rust program's rule gives at step k on TRACK (flock-rs/src/lib.rs). */
function expected(k: number): Record<string, JsonValue[]> {
  const upTo = TRACK.filter((e) => e.t <= k * STEP);
  const winds = upTo.filter((e) => e.control === 'wind');
  const gusts = upTo.filter((e) => e.control === 'gust');
  const wind = winds.length ? winds[winds.length - 1]!.value : 0;
  const sum = gusts.reduce((s, e) => s + e.value, 0);
  return {
    'flock.pos': Array.from({ length: BOIDS }, (_, i) => [i, wind, k]),
    'flock.vel': Array.from({ length: BOIDS }, (_, i) => [sum, i]),
    'flock.score': [gusts.length],
  };
}

describe(`${AC[6]} the flock item's Rust bindings, a program built against them, and the refusals`, () => {
  it(`${AC[6]} the bindings list each read, write and emit at deep_query's offsets and types; a program built against them exports the layout digest, reads and writes by name; score as f64 fails to build naming the field and the line; another layout's program is refused at check naming wind; the planted bindings_fields_by_name fails, naming wind`, async () => {
    const { map, bindings, v1 } = read();
    none(judge(bindings, map), 'the flock\'s bindings against its region map');
    expect(v1.digest, 'the second layout has another digest').not.toBe(map.digest);

    // A program built against them.
    const built = buildRust('real', bindings.source);
    expect(built.ok, `the Rust program builds against the bindings (cargo build --locked --release --target wasm32-unknown-unknown):\n${built.stderr.slice(-3000)}`).toBe(true);
    const rust = programOf('flock-rs', built.bytes!);
    expect(await exportedDigest(rust.bytes), 'the program exports regions_digest, the item\'s layout digest').toBe(map.digest);
    const [c, b] = logic([checkCall(flockPiece(rust)), bakeCall(flockPiece(rust), STEPS, TRACK)]);
    expect(admitted(c!, 'check of the flock with the Rust program')['flock']!.digest, 'check admits it with the item\'s layout digest').toBe(map.digest);
    const bake = bakeOf(b!, 'the Rust flock\'s bake');
    expect(bake.traps, 'the Rust program never traps').toEqual([]);
    const failures: string[] = [];
    for (const s of bake.steps) {
      for (const [name, want] of Object.entries(expected(s.step))) {
        const d = firstDiff(s.arrays[name] ?? [], want);
        if (d) { failures.push(`step ${s.step}: ${name} at ${d}`); break; }
      }
    }
    const rows = (bake.occurrences['flock'] ?? []).map((o) => [o['step'], o['kind'], o['a'], o['b'], obj(o['fields'], 'a row\'s fields')['boid'], obj(o['fields'], 'a row\'s fields')['side']]);
    const wantRows = TRACK.filter((e) => e.control === 'gust').map((e) => { const j = TRACK.filter((x) => x.control === 'gust' && x.t === e.t && x.seq < e.seq).length; const k = e.t / STEP; return [k, 'crossing', j, k, j, e.value > 0 ? 1 : -1]; });
    if (!same(rows as JsonValue[], wantRows)) failures.push(`the crossing rows ${show(rows)} aren't ${show(wantRows)}`);
    none(failures, 'the program built against the bindings reads and writes every region by name');

    // score read as f64 where the item declares i32.
    const wrong = buildRust('wrong-score', bindings.source, ['wrong_score']);
    const line = wrong.lib.split('\n').findIndex((l) => l.includes('WRONG: score read as f64')) + 1;
    expect(wrong.ok, 'the program that reads score as f64 doesn\'t build against the bindings').toBe(false);
    expect([/\bscore\b/.test(wrong.stderr), new RegExp(`src/lib\\.rs:${line}\\b`).test(wrong.stderr)], `the build names the field and the line (src/lib.rs:${line}):\n${wrong.stderr.slice(-2500)}`).toEqual([true, true]);

    // A program built against bindings of another layout digest.
    const other = buildRust('other-layout', v1.source);
    expect(other.ok, `the Rust program builds against the second layout's bindings:\n${other.stderr.slice(-3000)}`).toBe(true);
    const old = programOf('flock-rs-v1', other.bytes!);
    const [c1, refused] = logic([checkCall(flockPiece(old, V1_READS)), bakeCall(flockPiece(old, FLOCK_READS), STEPS, TRACK)]);
    admitted(c1!, 'check of the second layout with its own program');
    expect([refused!['ok'], refused!['code'], refused!['item']], `the bake of the flock with the other layout's program is refused at check: ${show(refused, 1500)}`).toEqual([false, 'logic_refused', 'flock']);
    expect(refused!['steps'], 'before any step runs: the refusal holds no step').toBeUndefined();
    const named = arr(refused!['refusals'], 'refusals').map((x) => obj(x, 'a refusal')['entry']).filter((e) => e !== undefined);
    expect(named, 'the refusal names the first entry whose offset differs: reads wind').toEqual([{ region: 'reads', name: 'wind' }]);

    // The planted generator: the real one passed above.
    const planted = read('bindings_fields_by_name');
    const pf = judge(planted.bindings, planted.map);
    console.log(`${AC[6]} bindings_fields_by_name:\n  ${pf.join('\n  ')}`);
    failsNaming(pf, [/^the first field that differs from the region map: reads wind:/], 'the planted bindings_fields_by_name');
  }, 5_400_000);
});
