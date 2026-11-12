// AC1 #220.a1078979: "`parts: ["a^2", "+", "b^2", "=", "c^2"]` writes an SVG with zero `<text>` and zero `<use>`
// elements and exactly five part groups; two runs, and runs on two target triples, give byte-identical SVG; the union of
// the parts' outlines equals the same source typeset as one part, point for point"
//
// Through deep_job in a real hub with the plug-in installed (README: The surface under test): the five parts, and the
// same source ("a^2 + b^2 = c^2", the parts joined by one space) as one part. The SVG's elements are read by this
// suite's XML reader: no element named text or use in any namespace, and exactly five part groups (<g> with id and
// data-source), one for each part's source. The union of the five groups' outlines (every sub-path drawn inside them,
// each transform from the root applied) equals the one part's group's outlines as multisets of sub-paths, verb for verb
// and point for point within 0.001 user units; the comparison is shown to catch one part moved by 0.01. Two runs: the
// same params in a second hub of its own, both misses, give the same SVG hash. Two target triples: the tool's own
// process on this Mac and in a linux/amd64 container of the repo's Node (no network), each given the job's request,
// write the job's SVG bytes; without Docker or that image, that half is INCONCLUSIVE, never a pass.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, answerOutputs, elements, inconclusive, linuxImage, linuxMissing, moved, mustHavePlugin, mustTypeset, none, openWorld, paramsOf,
  partGroups, partsOf, parseXml, proof, request, runToolOnLinux, runToolOnce, sameOutlines, sha256, sourceOf, toolFiles, useBuilds,
  type Typeset, type World,
} from './helpers.ts';

const built = useBuilds({ show: false });
const FIVE = ['a^2', '+', 'b^2', '=', 'c^2'];
const ONE = [sourceOf(FIVE)];
/** Two points of the two outputs are the same when they agree within this many user units. */
const TOL = 1e-3;

let first: Promise<{ w: World; five: Typeset; one: Typeset }> | undefined;
/** One world for the file: the five parts and the one part, each run once. */
const firstWorld = () => (first ??= (async () => {
  built.hub();
  const w = await openWorld();
  const five = await mustTypeset(w, paramsOf(FIVE), 'the five parts a^2, +, b^2, =, c^2');
  const one = await mustTypeset(w, paramsOf(ONE), `"${ONE[0]}" as one part`);
  proof('ac1-five.svg', five.svg);
  proof('ac1-one.svg', one.svg);
  return { w, five, one };
})());

describe(`${AC[1]} five parts write outlines in five part groups, the same bytes every run and on two target triples, the union equal to the formula as one part`, () => {
  it(`${AC[1]} the five parts write an SVG with zero <text> and zero <use> elements and exactly five part groups`, async () => {
    mustHavePlugin();
    const { five } = await firstWorld();
    const root = parseXml(five.svg.toString('utf8'));
    const all = elements(root);
    expect(all.filter((e) => e.local === 'text').map((e) => e.name), 'the SVG holds no <text> element').toEqual([]);
    expect(all.filter((e) => e.local === 'use').map((e) => e.name), 'the SVG holds no <use> element').toEqual([]);
    const groups = partGroups(root);
    expect(groups.length, `exactly five part groups (<g> with id and data-source): ${JSON.stringify(groups.map((g) => g.attrs))}`).toBe(5);
    expect(groups.map((g) => g.attrs['data-source']).sort(), 'one part group for each part, its data-source the part\'s source').toEqual([...FIVE].sort());
  }, TIMEOUT);

  it(`${AC[1]} the union of the five parts' outlines equals the same source typeset as one part, point for point`, async () => {
    mustHavePlugin();
    const { five, one } = await firstWorld();
    const parts = partsOf(five.svg).parts;
    const whole = partsOf(one.svg).parts;
    expect(whole.map((p) => p.source), `"${ONE[0]}" as one part writes exactly one part group, its data-source the source`).toEqual(ONE);
    expect(parts.length, 'the five parts write five part groups').toBe(5);
    for (const p of parts) expect(p.subs.length, `the part ${p.source} (${p.id}) draws its outlines inside its group`).toBeGreaterThan(0);
    const union = parts.flatMap((p) => p.subs);
    none(sameOutlines(union, whole[0]!.subs, TOL, ['the union of the five parts', 'the one part']), `the union of the five parts' outlines (${union.length} sub-paths) equals "${ONE[0]}" as one part (${whole[0]!.subs.length}), point for point within ${TOL} user units`);
    // The comparison bites: the same union with its first part moved by 0.01 user units is not equal.
    const mutant = [...moved(parts[0]!.subs, 0.01, 0), ...parts.slice(1).flatMap((p) => p.subs)];
    expect(sameOutlines(mutant, whole[0]!.subs, TOL, ['the moved union', 'the one part']).length, 'the comparison catches one part moved by 0.01 user units').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[1]} two runs, each a miss in a hub of its own, give byte-identical SVG`, async () => {
    mustHavePlugin();
    const { five } = await firstWorld();
    const second = await openWorld();
    const again = await mustTypeset(second, paramsOf(FIVE), 'the five parts in a second hub');
    expect(five.receipt['cache'], `the first run ran the tool: ${JSON.stringify(five.receipt)}`).toBe('miss');
    expect(again.receipt['cache'], `the second run, in a hub of its own, ran the tool again: ${JSON.stringify(again.receipt)}`).toBe('miss');
    expect(again.shas.svg, 'the two runs\' SVGs are byte-identical: the same SHA-256').toBe(five.shas.svg);
  }, TIMEOUT);

  it(`${AC[1]} runs on two target triples, this Mac and x86_64 Linux, give byte-identical SVG`, async () => {
    mustHavePlugin();
    const { five } = await firstWorld();
    const files = await toolFiles();
    const req = request(paramsOf(FIVE));
    const here = `${process.arch}-${process.platform}`;
    const mac = answerOutputs(await runToolOnce(files, req, `the tool on ${here}`), `the tool on ${here}`);
    expect(sha256(mac.svg), `the tool's own process on ${here}, given the job's request, writes the job's SVG`).toBe(five.shas.svg);
    if (process.platform === 'linux' && process.arch === 'x64') inconclusive('this machine is x86_64 Linux, so the container would run the same target triple');
    const missing = linuxMissing();
    if (missing) inconclusive(`the second target triple: ${missing}`);
    const linux = runToolOnLinux(files, req);
    if ('open' in linux) inconclusive(`the second target triple: ${linux.open}`);
    const out = answerOutputs(linux.answer, `the tool in ${linuxImage()} (linux/amd64)`);
    proof('ac1-five-linux.svg', out.svg);
    expect(sha256(out.svg), `the tool on x86_64 Linux writes the same SVG bytes as on ${here}`).toBe(five.shas.svg);
  }, TIMEOUT);
});
