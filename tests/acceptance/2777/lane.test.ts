// AC2 #2777.45abf58c: "On main after the first fill, the lane passes on every field list of the sealed listing and
// prints their count, the count by closure, and the closed lists whose `instead` is `nothing`"
//
// asserts: on the full build's sealed listing (`deep-show kinds --dump`), `node scripts/canvas-closures.mjs fields
// --listing <dump>` exits 0 with a PASS fields line and no FAIL fields line. The listing's `field_lists` name each list
// once, each with words and a closure of the rule's shape ({registry} naming a registry the listing holds; {closed,
// reopens_if, instead}, each a non-empty text, instead possibly "nothing"; or {open: item | pack}). They are every
// field list: each place where a structured field's form, as deep_kinds `op: field` prints it, offers a word (a `|`
// choice with a word among its alternatives, or a lone word; README: Readings) is a list of the listing under its
// name, of its entry and field, with at least its words. The PASS line's count is the listing's number of field lists,
// its count by closure the listing's registry, closed and open lists; the one NOTE fields reading names exactly the
// closed lists whose instead is nothing, and counts them. The same listing with camera@1.projection's closure taken
// out fails the lane, naming that list, so the PASS is the lane's own check of every list.

import { describe, expect, it } from 'vitest';
import {
  FULL, LANE, LISTS_KEY, PROJECTION, closureKind, closures, countsOf, coverageFailures, dumpOf, failsWithLine, fieldListsOf, isObject, listingFailures,
  none, passes, placesOfListing, readingOf, registryNames, saysNothing, sorted, theList, useBuilds, writeListing, type JsonObject, type JsonValue,
} from './helpers.ts';

const builds = useBuilds([FULL]);

describe('AC2 #2777.45abf58c the lane on main\'s sealed listing', () => {
  it('AC2 #2777.45abf58c on main after the first fill, the lane passes on every field list of the sealed listing and prints their count, the count by closure, and the closed lists whose instead is nothing', () => {
    const bin = builds.bin(FULL);
    const d = dumpOf(bin);
    const r = closures([LANE, '--listing', d.path]);
    console.log(`the closure lane on the full build's sealed listing:\n${r.out}`);
    passes(r, LANE, 'the closure lane on the full build\'s sealed listing');

    const lists = fieldListsOf(d.value);
    none(listingFailures(lists, registryNames(d.value)), `the sealed listing's ${lists.length} field lists`);
    const { places, fields } = placesOfListing(bin, d.value);
    expect(places.length, `the forms of the listing's ${fields} structured fields offer field lists`).toBeGreaterThan(0);
    none(coverageFailures(places, lists), `the ${places.length} field lists the forms of ${fields} structured fields offer, against the sealed listing's ${lists.length}`);

    const by = (k: 'registry' | 'closed' | 'open'): number => lists.filter((l) => closureKind(l.closure) === k).length;
    expect(countsOf(r), 'the PASS line\'s count and count by closure are the listing\'s').toEqual({ n: lists.length, registry: by('registry'), closed: by('closed'), open: by('open') });
    const reading = readingOf(r);
    expect(typeof reading === 'string' ? reading : '', 'the lane prints one reading').toBe('');
    if (typeof reading === 'string') return;
    const nothing = saysNothing(lists);
    expect(reading.count, `the reading counts the closed lists whose instead is nothing: ${reading.line}`).toBe(nothing.length);
    expect(sorted(reading.nothing), `the reading names the closed lists whose instead is nothing: ${reading.line}`).toEqual(sorted(nothing));

    // The lane checks each list: the same listing with the projection's closure taken out fails, naming it.
    theList(lists, PROJECTION);
    const planted = structuredClone(d.value) as JsonObject;
    for (const l of planted[LISTS_KEY] as JsonValue[]) if (isObject(l) && l['list'] === PROJECTION) delete l['closure'];
    failsWithLine(closures([LANE, '--listing', writeListing(planted, 'unclosed')]), LANE, [PROJECTION], `the listing with ${PROJECTION}'s closure taken out`);
  }, 3_600_000);
});
