// #548.eec090d8: deep_query returns the flock item's region map, each read, write and emit entry with its offset, size
// and type in declaration order, and the layout digest check computed for it; and a planted map that lists the reads by
// name instead of in declaration order returns offsets the program doesn't use and another digest, and fails, naming
// the first entry that differs
//
// The flock reads `wind` then `gust` (by name `gust` comes first), writes `pos`, `vel`, `score`, and emits `crossing`.
// deep_query's map (README: deep_query) is judged against the layout `check` (`deep-logic`) gives the same item, which
// the flock's program is built against (the offsets it reads and writes at), entry by entry in declaration order, and
// against what the design fixes on its own: the names in declaration order with the step's seed after the reads, each
// size from its type and count, and offsets that rise without overlap from each region's start. The planted
// `region_map_reads_by_name` (a scenario's `planted`) lists `gust` before `wind`.

import { describe, expect, it } from 'vitest';
import { FLOCK_NAMES } from './programs.ts';
import { flockDoc, flockPiece, flockProgram } from './fixtures.ts';
import {
  AC, DOC, MS, admitted, checkCall, entryText, failsNaming, logic, logicBin, logicReadOf, none, prebuild, presented, putEvidence, queryLogic,
  runShow, scenario, showBin, showCall, useTemp, type Layout, type ShowPlanted,
} from './helpers.ts';

prebuild(() => { logicBin(); showBin(); });
const temp = useTemp();
/** Each entry's size from the design: a slider's slot (a u32 count, 4 zero bytes, 16 entries of a u32 player, 4 zero bytes and an f64), the seed, the writes by type and count, and the emit kind's count and 16 rows of {a, b, boid, side}. */
const SIZES: Record<string, number> = { wind: 8 + 16 * 16, gust: 8 + 16 * 16, seed: 8, pos: 24 * 100, vel: 16 * 100, score: 4, crossing: 4 + 16 * (8 + 4 + 4) };
const TYPES: Record<string, string | null> = { seed: 'i64', pos: 'vec3', vel: 'vec2', score: 'i32', wind: null, gust: null, crossing: null };

/** The criterion's judgement of a map against the layout the program uses (check's). */
function judge(map: Layout, used: Layout): string[] {
  const failures: string[] = [];
  if (map.digest !== used.digest) failures.push(`the map's digest ${map.digest} isn't the layout digest check computed, ${used.digest}`);
  const first = used.entries.find((u) => { const m = map.entries.find((e) => e.region === u.region && e.name === u.name); return !m || m.offset !== u.offset || m.size !== u.size || m.type !== u.type; });
  if (first) {
    const m = map.entries.find((e) => e.region === first.region && e.name === first.name);
    failures.push(`the first entry that differs: ${first.region} ${first.name}: ${m ? entryText(m) : 'missing'} in the map, where the program uses ${entryText(first)}`);
  }
  const order = (l: Layout): string => l.entries.map((e) => `${e.region} ${e.name}`).join(', ');
  if (order(map) !== order(used)) failures.push(`the map's entries aren't in declaration order: ${order(map)}, not ${order(used)}`);
  return failures;
}
/** What the design fixes about the flock's map on its own. */
function shaped(map: Layout): string[] {
  const failures: string[] = [];
  const names = map.entries.map((e) => [e.region, e.name]);
  if (JSON.stringify(names) !== JSON.stringify(FLOCK_NAMES)) failures.push(`the entries are ${JSON.stringify(names)}, not the declaration order ${JSON.stringify(FLOCK_NAMES)}`);
  for (const region of ['reads', 'writes', 'emits']) {
    let end = 0;
    for (const e of map.entries.filter((x) => x.region === region)) {
      if (e.size !== SIZES[e.name]) failures.push(`${entryText(e)}: size ${e.size}, not ${SIZES[e.name]}`);
      const ty = TYPES[e.name];
      if (ty ? e.type !== ty : e.type === '') failures.push(`${entryText(e)}: type ${e.type}${ty ? `, not ${ty}` : ''}`);
      if (e.offset < end) failures.push(`${entryText(e)} overlaps the entry before it (which ends at ${end})`);
      end = e.offset + e.size;
    }
    const firstOf = map.entries.find((x) => x.region === region);
    if (firstOf && firstOf.offset !== 0) failures.push(`${entryText(firstOf)}: the ${region} region's first entry isn't at its start`);
  }
  return failures;
}

function mapOf(planted?: ShowPlanted): { map: Layout; used: Layout } {
  const program = flockProgram();
  const [c] = logic([checkCall(flockPiece(program))]);
  const used = admitted(c!, 'check of the flock with its program')['flock']!;
  const ev = temp();
  putEvidence(ev, program.bytes);
  const D = DOC(6);
  const r = runShow(scenario(ev, [D], [showCall(D, flockDoc('flock', program), 1), queryLogic(D, ['flock'], [], [], 200 * MS)], planted ? { planted } : {}), 'the flock presented and its region map read');
  presented(r[0]!, 'the flock');
  return { map: logicReadOf(r[1]!, 'flock', 'deep_query of the flock\'s region map').region_map, used };
}

describe(`${AC[5]} deep_query returns the flock's region map in declaration order with check's layout digest`, () => {
  it(`${AC[5]} each read, write and emit entry with its offset, size and type in declaration order and check's digest; the planted region_map_reads_by_name fails, naming wind`, () => {
    const real = mapOf();
    none(shaped(real.used), 'check\'s layout of the flock, as the design lays it out');
    none([...shaped(real.map), ...judge(real.map, real.used)], 'deep_query\'s region map of the flock');

    const planted = mapOf('region_map_reads_by_name');
    const failures = judge(planted.map, planted.used);
    console.log(`${AC[5]} region_map_reads_by_name:\n  ${failures.join('\n  ')}`);
    expect(planted.map.digest, 'the planted map gives another digest').not.toBe(planted.used.digest);
    const wind = planted.map.entries.find((e) => e.region === 'reads' && e.name === 'wind');
    expect(wind?.offset, 'the planted map puts wind at an offset the program doesn\'t read it at').not.toBe(planted.used.entries.find((e) => e.name === 'wind')?.offset);
    failsNaming(failures, [/^the first entry that differs: reads wind:/], 'the planted region_map_reads_by_name');
  }, 3_600_000);
});
