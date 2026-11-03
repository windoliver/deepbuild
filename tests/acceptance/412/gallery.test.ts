// AC4: "Every deep_kinds example validates against the schema it was generated from, and fixtures pairing a query or
// familiar word with names that must and must not appear pass, no_match cases included
// (parity/agent/kinds-catalog-include-exclude.view)"
//
// AC5: "Searching deep_kinds for "turntable" returns the product reveal example first, with its hash; reading a guide
// longer than one page returns the page with truncated set and the next offset, and reading from that offset
// returns the rest; an example whose stored bytes don't match its hash is never served, and the reply names it"
//
// AC18: "A planted corpus run that played 0 of an example's 600 declared steps leaves the example listed unverified,
// naming it and 0 of 600 steps, and an example with no run on this digest is listed not run; a planted listing that
// takes a run's exit status as verified lists that example verified and fails, naming it"
//
// asserts: AC4: in `full`, every entry's example is read by its hash (its stored bytes hash to it) and each item of
// the entry's kind in it validates against the entry's schema (@deepbuild/contracts' validator), circle@1 and rect@1
// among them; in `core` with test/words installed, every word and query case of the include fixture passes, no_match
// cases included, and the check fails a planted answer that maps Circle to rect@1, naming circle@1. AC5: in `core`,
// with the installed gallery, the first hit for "turntable" is the product reveal example with a sha256 its stored
// bytes hash to; with a gallery folder written for the test (README: The gallery folder), its ~80 KB guide reads in
// pages, each but the last truncated with the next offset, until the rest, every page under 64 KB, the pages
// together the guide; with one example's bytes changed after its hash was recorded, reading it is refused with
// error@2 naming its hash and no text, while its untouched neighbour reads. AC18: with corpus runs recorded for
// that gallery (scenario `corpus_runs`: 0 of 600 steps on this digest, 120 of 120 on this digest, one run on
// another digest), the gallery lists Six hundred steps unverified with 0 of 600, Played out verified and Never run
// here not run; `--planted verified_by_exit` lists Six hundred steps verified and fails the check, naming it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry as schemaRegistry, validate } from '@deepbuild/contracts';
import { describe, expect, it } from 'vitest';
import {
  CORE, FULL, REPLY_CAP, SHA256, WORDS, allEntries, answer, arr, bytesOf, errorOf, failsNaming, galleryRow, includeCall, includeCases, includeFailures,
  isObject, kinds, listAll, none, obj, run, scenario, sha256Of, show, str, useBuilds, useEvidence, useTempDirs, verifiedFailures, writeGallery,
  type JsonObject, type JsonValue,
} from './helpers.ts';

useTempDirs();
const builds = useBuilds([CORE, FULL]);
const evidence = useEvidence();

describe('AC4 every deep_kinds example validates against its schema, and the include fixture passes', () => {
  it('AC4 every example, read by its hash, holds items of its kind whose params validate against the schema it was generated from', () => {
    const bin = builds.bin(FULL);
    const withExamples = allEntries(listAll(bin, evidence())).filter((e) => typeof e.example === 'string');
    expect(withExamples.map((e) => e.name), 'circle@1 and rect@1 come with examples').toEqual(expect.arrayContaining(['circle@1', 'rect@1']));
    const failures: string[] = [];
    const validated = new Set<string>();
    for (let k = 0; k < withExamples.length; k += 50) {
      const batch = withExamples.slice(k, k + 50);
      const replies = run(bin, scenario(evidence(), batch.map((e) => kinds('read', { example: e.example! }))));
      batch.forEach((e, i) => {
        const reply = replies[i]!;
        if (errorOf(reply) || typeof reply['text'] !== 'string') { failures.push(`${e.name}: its example ${e.example} isn't served: ${show(reply, 600)}`); return; }
        const text = reply['text'];
        if (sha256Of(text) !== e.example) failures.push(`${e.name}: its example's bytes hash to ${sha256Of(text)}, not ${e.example}`);
        let doc: JsonValue;
        try { doc = JSON.parse(text) as JsonValue; } catch { failures.push(`${e.name}: its example is not JSON`); return; }
        const items = isObject(doc) && isObject(doc['items']) ? Object.values(doc['items']).filter(isObject).filter((it) => it['kind'] === e.name) : [];
        if (!items.length) return;
        const schema = e.raw['schema'];
        if (!isObject(schema)) { failures.push(`${e.name}: its example holds its kind, but it lists no schema`); return; }
        let checked;
        try { checked = schemaRegistry([{ name: e.name, schema }]); } catch (err) { failures.push(`${e.name}: its schema is outside the closed node list: ${(err as Error).message}`); return; }
        for (const item of items) {
          const v = checked.validate(e.name, item['params'] ?? {});
          if (!v.ok) failures.push(`${e.name}: item ${String(item['id'])} of its example fails its schema: ${v.issues.map((x) => `${x.path} ${x.code}`).join(', ')}`);
        }
        validated.add(e.name);
      });
    }
    none(failures, 'the examples');
    expect([...validated], 'circle@1\'s and rect@1\'s examples were validated against their schemas').toEqual(expect.arrayContaining(['circle@1', 'rect@1']));
  }, 1_800_000);

  it('AC4 the include fixture\'s words and queries give the names that must appear and none that mustn\'t, no_match cases included', () => {
    const cases = includeCases().filter((c) => c.word !== undefined || c.query !== undefined);
    expect(cases.filter((c) => c.no_match).length, 'the fixture holds no_match cases').toBeGreaterThan(0);
    const replies = run(builds.bin(CORE), scenario(evidence(), cases.map(includeCall), { packs: [WORDS] }));
    none(cases.flatMap((c, i) => includeFailures(c, replies[i]!)), 'the include fixture');
    // The check can fail: an answer that maps Circle onto rect@1 is reported, naming circle@1.
    failsNaming(includeFailures(cases.find((c) => c.word === 'Circle')!, { word: 'Circle', target: 'rect@1' }), ['circle@1', 'rect@1'], 'a made-up mapping');
  }, 1_800_000);
});

describe('AC5 the guides and gallery: search, read in pages, and never serve an example whose bytes don\'t match its hash', () => {
  it('AC5 searching the installed gallery for turntable returns the product reveal example first, with its hash', () => {
    const bin = builds.bin(CORE);
    const [found] = run(bin, scenario(evidence(), [kinds('search', { query: 'turntable' })]));
    const hits = arr(answer(found!, 'deep_kinds search turntable')['hits'], 'search turntable: hits');
    const first = obj(hits[0], `the first hit for turntable (hits: ${show(hits as JsonValue[], 800)})`);
    expect(first['kind'], 'the first hit is an example').toBe('example');
    expect(String(first['title'] ?? first['name']).toLowerCase(), 'the first hit is the product reveal').toContain('product reveal');
    const hash = str(first['hash'], 'the product reveal\'s hash');
    expect(hash, 'its hash is a sha256').toMatch(SHA256);
    const [read] = run(bin, scenario(evidence(), [kinds('read', { example: hash })]));
    expect(sha256Of(str(answer(read!, 'deep_kinds read the product reveal')['text'], 'its stored text')), 'its stored bytes hash to the hash the search gave').toBe(hash);
  }, 1_800_000);

  it('AC5 a guide longer than one page reads as pages with truncated and the next offset, and reading from that offset returns the rest', () => {
    const g = writeGallery('guide');
    const bin = builds.bin(CORE);
    let offset = 0;
    let text = '';
    let pages = 0;
    for (; pages < 40; pages++) {
      const [reply] = run(bin, scenario(evidence(), [kinds('read', { guide: g.guide.name, ...(offset ? { offset } : {}) })], { gallery: g.dir }));
      const page = answer(reply!, `deep_kinds read ${g.guide.name} at ${offset}`);
      expect(bytesOf(page), `page ${pages + 1} is under 64 KB`).toBeLessThanOrEqual(REPLY_CAP);
      expect(page['offset'] ?? 0, `page ${pages + 1} starts at the offset asked`).toBe(offset);
      const chunk = str(page['text'], `page ${pages + 1}: text`);
      text += chunk;
      if (page['truncated'] !== true) break;
      expect(page['next'], `page ${pages + 1} is cut, so it names the next offset`).toBe(offset + Buffer.byteLength(chunk));
      offset = page['next'] as number;
    }
    expect(pages, 'the guide is longer than one page: the first read was truncated').toBeGreaterThan(0);
    expect(text, 'the pages together are the whole guide').toBe(g.guide.text);
  }, 1_800_000);

  it('AC5 an example whose stored bytes don\'t match its hash is never served, and the reply names it', () => {
    const g = writeGallery('tampered');
    const [bad, good] = g.examples;
    const file = join(g.dir, bad!.file);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Six hundred steps', 'Six hundred stops'));
    const [refused, served] = run(builds.bin(CORE), scenario(evidence(), [kinds('read', { example: bad!.hash }), kinds('read', { example: good!.hash })], { gallery: g.dir }));
    const e = errorOf(refused!);
    expect(e, `the changed example is refused: ${show(refused)}`).toBeDefined();
    const checked = validate('error@2', e);
    expect(checked.ok ? [] : checked.issues.map((x) => `${x.path}: ${x.code}`), `the refusal is error@2: ${show(e)}`).toEqual([]);
    expect(String(e!['actual']), 'the refusal names the example by its hash').toContain(bad!.hash);
    expect(refused!['text'], 'none of its bytes are served').toBeUndefined();
    expect(sha256Of(str(answer(served!, 'its untouched neighbour')['text'], 'the neighbour\'s text')), 'the untouched example is served').toBe(good!.hash);
  }, 1_800_000);
});

describe('AC18 verified means played: an example is verified only when its last run on this digest played its declared steps', () => {
  /** This build's module-set digest, from deep_kinds. */
  const digestOf = (bin: string, gallery: string): string => str(answer(run(bin, scenario(evidence(), [kinds('list')], { gallery }))[0]!, 'deep_kinds list')['module_set'], 'module_set');
  const runsFor = (g: ReturnType<typeof writeGallery>, here: string): JsonObject[] => [
    { example: g.examples[0]!.hash, module_set: here, played: 0, exit: 0 },
    { example: g.examples[1]!.hash, module_set: `d1:${'0'.repeat(64)}`, played: 120, exit: 0 },
    { example: g.examples[2]!.hash, module_set: here, played: 120, exit: 0 },
  ];

  it('AC18 a run that played 0 of 600 declared steps leaves the example unverified, naming 0 of 600; one with no run on this digest is not run', () => {
    const g = writeGallery('runs');
    const bin = builds.bin(CORE);
    const here = digestOf(bin, g.dir);
    const runs = runsFor(g, here);
    const [reply] = run(bin, scenario(evidence(), [kinds('gallery')], { gallery: g.dir, corpus_runs: runs }));
    const listing = answer(reply!, 'deep_kinds gallery');
    none(verifiedFailures(listing, runs, here, g), 'the gallery\'s verified marks');
    const six = galleryRow(listing, g.examples[0]!.hash, 'the gallery');
    expect([six['title'], six['status'], six['played'], six['steps']], 'Six hundred steps: unverified, 0 of 600').toEqual(['Six hundred steps', 'unverified', 0, 600]);
    expect(galleryRow(listing, g.examples[1]!.hash, 'the gallery')['status'], 'Never run here: not run on this digest').toBe('not_run');
    expect(galleryRow(listing, g.examples[2]!.hash, 'the gallery')['status'], 'Played out: verified').toBe('verified');
  }, 1_800_000);

  it('AC18 a planted listing that takes a run\'s exit status as verified lists Six hundred steps verified and fails, naming it', () => {
    const g = writeGallery('exit');
    const bin = builds.bin(CORE);
    const here = digestOf(bin, g.dir);
    const runs = runsFor(g, here);
    const [reply] = run(bin, scenario(evidence(), [kinds('gallery')], { gallery: g.dir, corpus_runs: runs }), 'verified_by_exit');
    expect(galleryRow(answer(reply!, 'the planted gallery'), g.examples[0]!.hash, 'the planted gallery')['status'], 'the planted listing marks it verified').toBe('verified');
    failsNaming(verifiedFailures(reply!, runs, here, g), ['Six hundred steps'], 'the listing that takes exit 0 as verified');
  }, 1_800_000);
});
