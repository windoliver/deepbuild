// AC10 #142.d708e2b3: "A test pack's recipe acme.slides, whose grammar rule of one entrance at a time is a pack kind rule
// with its planted twin, installs with no canvas-module change and refuses a cue list whose two entrances overlap,
// naming the cue and the rule, while its clean twin passes"
//
// The test pack acme/acme@1.0.0, written by `writeSlides` into a temporary folder (README: The test pack): its film
// recipe and pack kind `acme.slides@1` (inputs `cues` and `stage`; one title per cue) carries the kind rule
// `acme.one_entrance`, written over its cue list (`over: "cues"`, README: A rule over a cue list) as
// `!(cue.class == enter && other.class == enter && other.start < cue.end && cue.start < other.end)`, with its clean
// example (slide_one then slide_two, 0.5 s each) and its planted twin (slide_two `with` slide_one) by hash.
// In one process: `registry`, `install_pack`, `packs`, `registry` again, then the two twins presented as films naming
// the pack. The pack installs (its kit ran: the clean example passes the rule and the twin fails it) with no error;
// the module-set digest (`set_digest` on the `registry` reply) is the same before and after; the overlapping list is
// refused with an error naming slide_two and acme.one_entrance; the clean twin is presented with no error. And no Rust
// source under crates/ outside tests names acme.slides or acme.one_entrance.
// Wrong programs: the base (a kind rule can't read a cue list); a rule over cues compiled into a canvas module; a rule
// whose refusal doesn't name the cue; a check that refuses the clean twin.
import { describe, expect, it } from 'vitest';
import {
  ACME_RULE, AC, SLIDES, SLIDES_CLEAN, SLIDES_OVERLAP, TIMEOUT, VERBS, arr, brief, docId, isObject, none, present, presented, refusalFailures,
  run, rustNaming, scenario, slidesFilm, str, useFolders, useShow, writeSlides,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();

describe(`${AC[10]} a test pack's film recipe carries its grammar rule as data`, () => {
  it(`${AC[10]} acme.slides installs with no canvas-module change, refuses two overlapping entrances naming slide_two and acme.one_entrance, and passes its clean twin`, () => {
    const acme = writeSlides(folder());
    const [before, installed, packs, after, overlap, clean] = run(show(), scenario(folder(), [
      { call: 'registry' }, { call: 'install_pack', id: acme.id, dir: acme.dir }, { call: 'packs' }, { call: 'registry' },
      present(docId(1), slidesFilm('Two slides at once', SLIDES_OVERLAP)), present(docId(2), slidesFilm('Two slides in turn', SLIDES_CLEAN)),
    ], { packs: [VERBS] }));
    expect(installed!['outcome'], `acme/acme@1.0.0 installs: ${brief(installed!, 2000)}`).toBe('installed');
    const row = arr(packs!['packs'], 'packs: packs').filter(isObject).find((r) => r['pack'] === acme.id && r['version'] === acme.version);
    expect(row?.['state'], `acme/acme@1.0.0 is installed: ${brief(row ?? null)}`).toBe('installed');
    expect((Array.isArray(row?.['issues']) ? row['issues'] : []).filter((i) => isObject(i) && i['severity'] === 'error'), 'acme installs with no error').toEqual([]);
    expect(str(after!['set_digest'], 'the registry reply\'s set_digest after the install'), 'the module-set digest is the same before and after acme installs').toBe(str(before!['set_digest'], 'the registry reply\'s set_digest'));
    expect(rustNaming([SLIDES, ACME_RULE]), 'no canvas module names the test pack\'s recipe or rule').toEqual([]);
    none(refusalFailures(overlap!, 'slide_two', ACME_RULE, 'two slides entering at once'), 'the overlapping entrances are refused');
    presented(clean!, 'the clean twin, the slides in turn');
  }, TIMEOUT);
});
