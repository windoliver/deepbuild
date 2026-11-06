// AC2 #443.f3f6eafa: "outline.source@1's kit holds each entry to its 2D fill: text's glyph outlines of "OB",
// marks2d's outline of a path@1 square with a square hole and vector's outline of an SVG ring each cover what that
// item's 2D fill covers within flatten at 1,000 sampled points, holes by its fill rule; each entry joins its own
// module's interface digest and no other's; and the planted entry that drops the O's counter is refused at the seal,
// naming outline.source@1 and the entry"
//
// asserts: in `full`, deep://registries lists outline.source@1, the core's, filled by modules, with the kit rule
// covers_2d_fill; its entries are exactly `text` (module text), `path` (marks2d) and `vector` (vector), each
// first-party and PASS, its covers_2d_fill result on its fixture (OB, square_hole, ring) at 1,000 samples with no
// miss. Its planted entry drops_counter FAILs covers_2d_fill, naming itself, and `--planted
// kit_admits_all:outline.source@1` makes the seal refuse (`kit_admits_planted`) naming outline.source@1 and
// drops_counter. text@1's interface digest is the same in `core` (text the only filler) and `full`; marks2d@1's the
// same in `full` and `full,test-leave-out-vector` (`digestFailures`); #200's `--planted hashes_every_entry` fails
// that, naming text@1 and marks2d@1.
// Wrong programs: an entry the kit never ran, or ran on fewer points; a kit that admits the planted entry; another
// module's entries hashed into a filler's digest.

import { describe, expect, it } from 'vitest';
import {
  AC, CORE, ENTRIES, FULL, KIT_RULE, NO_VECTOR, OUTLINE_SOURCE, PLANTED_ENTRY, REGISTRIES, SAMPLES, SCHEDULE, SLOW, failsNaming, interfaceDigest,
  mentions, none, refusalOf, runShow, scenario, shown, startup, theRegistry, useBuilds, useDir, type Build, type StartPlanted,
} from './helpers.ts';

const bin = useBuilds([FULL, CORE, NO_VECTOR]);
const dir = useDir();

const listing = (): ReturnType<typeof theRegistry> => theRegistry(runShow(bin(FULL), scenario(dir(), [], [REGISTRIES]))[0]!, OUTLINE_SOURCE);
const digestIn = (b: Build, iface: string, planted?: StartPlanted): string => interfaceDigest(runShow(bin(b), scenario(dir(), [], [SCHEDULE]), planted)[0]!, iface);

/** text@1's digest with and without marks2d's and vector's entries, and marks2d@1's with and without vector's. Each failure names the interface. */
function digestFailures(planted?: StartPlanted): string[] {
  const out: string[] = [];
  const [textCore, textFull] = [digestIn(CORE, 'text@1', planted), digestIn(FULL, 'text@1', planted)];
  if (textCore !== textFull) out.push(`text@1's interface digest is ${textCore} in core (text the only filler) and ${textFull} in full`);
  const [marksFull, marksAlone] = [digestIn(FULL, 'marks2d@1', planted), digestIn(NO_VECTOR, 'marks2d@1', planted)];
  if (marksFull !== marksAlone) out.push(`marks2d@1's interface digest is ${marksFull} with vector and ${marksAlone} without it`);
  return out;
}

describe(`${AC[2]} outline.source@1's kit, its entries' digests and its planted entry`, () => {
  it(`${AC[2]} the kit holds text's "OB", marks2d's square with a square hole and vector's ring each to its 2D fill at 1,000 sampled points`, () => {
    const reg = listing();
    expect([reg.owner, reg.fill.includes('module'), reg.kit.includes(KIT_RULE)], `${OUTLINE_SOURCE} is the core's, filled by modules, with the rule ${KIT_RULE}: ${shown(reg.raw)}`).toEqual(['core', true, true]);
    expect(reg.entries.map((e) => e.name).sort(), `${OUTLINE_SOURCE}'s entries`).toEqual(ENTRIES.map((e) => e.name).sort());
    const failures: string[] = [];
    for (const want of ENTRIES) {
      const e = reg.entries.find((x) => x.name === want.name)!;
      if (e.module !== want.module || e.origin !== 'first_party') failures.push(`${want.name} is not ${want.module}'s first-party entry: ${shown(e.raw)}`);
      const r = e.kit.rules.find((x) => x.rule === KIT_RULE);
      if (e.kit.verdict !== 'PASS' || !r || r.verdict !== 'PASS') { failures.push(`${want.name} doesn't PASS ${KIT_RULE}: ${shown(e.kit.raw)}`); continue; }
      if (r.raw['fixture'] !== want.fixture || r.raw['samples'] !== SAMPLES || r.raw['misses'] !== 0) {
        failures.push(`${want.name}'s ${KIT_RULE} result is not its fixture ${want.fixture} at ${SAMPLES} samples with no miss: ${shown(r.raw)}`);
      }
    }
    none(failures, `${OUTLINE_SOURCE}'s entries`);
  }, SLOW);

  it(`${AC[2]} each entry joins its own module's interface digest and no other's`, () => {
    none(digestFailures(), 'the fillers\' interface digests');
    failsNaming(digestFailures('hashes_every_entry'), ['text@1', 'marks2d@1'], 'the seal that hashes every entry into each filler\'s digest');
  }, SLOW);

  it(`${AC[2]} the planted entry that drops the O's counter is refused at the seal, naming outline.source@1 and the entry`, () => {
    const p = listing().planted.find((x) => x.name === PLANTED_ENTRY);
    expect(p, `${OUTLINE_SOURCE} lists the planted entry ${PLANTED_ENTRY}`).toBeDefined();
    const failed = p!.result.rules.find((r) => r.rule === KIT_RULE);
    expect([p!.result.verdict, failed?.verdict, mentions(p!.result.raw, PLANTED_ENTRY)], `the kit refuses ${PLANTED_ENTRY} on ${KIT_RULE}, naming it: ${shown(p!.raw)}`).toEqual(['FAIL', 'FAIL', true]);
    const r = refusalOf(startup(bin(FULL), `kit_admits_all:${OUTLINE_SOURCE}`), `a kit that admits every entry of ${OUTLINE_SOURCE}`);
    expect([r.reason, r.registry, mentions(r.entries, PLANTED_ENTRY)], `the seal refuses it, naming ${OUTLINE_SOURCE} and ${PLANTED_ENTRY}: ${shown(r.raw)}`).toEqual(['kit_admits_planted', OUTLINE_SOURCE, true]);
  }, SLOW);
});
