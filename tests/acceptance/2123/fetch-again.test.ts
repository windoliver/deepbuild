// #2123.4627e131 A fetch under a standing rule that throws can be tried again. Given a library with a standing rule
// and a source that throws on the first file read and answers on the second, when the same id is fetched twice, then
// the second fetch is fetched.
//
// The world is #1731's (tests/acceptance/1731/helpers.ts, imported): a real hub, its extension host and source block,
// the test fill installed with `deep install`, and `deep mcp` as an agent's client, with your standing rule set on the
// trusted path (`library.rule`). Only the library's remote host stands in: #1731's fixture library on 127.0.0.1, which
// here has lost the chair's file when the hub first reads it, so the hub's read of that file through the library's
// source throws, and has it again for the second read.
import { describe, expect, it } from 'vitest';
import { LIB, fetchArgs, kinds, must, onWorld } from '../1731/helpers.ts';
import { asset } from '../1731/library.ts';
import { AC } from './helpers.ts';

/** A CC0 chair, so the rule below lets it fetch with no ask. */
const ID = 'pine-chair';

describe(`${AC.fetch} A fetch under a standing rule that throws can be tried again`, () => {
  it(`${AC.fetch} under a standing rule, a chair whose file read throws the first time and answers the second: fetched twice, the second fetch is fetched`, async () => {
    const w = await onWorld();
    await must(w, 'library.rule', { library: LIB, licenses: ['CC0-1.0'] });
    const chair = asset(ID);
    const file = chair.record.files[0]!.path;
    const bytes = chair.files.get(file)!;

    // The first file read throws: the library's host has no such file when the hub reads it.
    chair.files.delete(file);
    let first;
    const from = w.library.log.length;
    try {
      first = await kinds(w, fetchArgs(ID));
    } finally {
      chair.files.set(file, bytes);
    }
    const reads = w.library.log.slice(from).filter((q) => q.path === file);
    expect(reads.length, `the hub's reads of ${file} during the first fetch: ${w.library.quote(from)}`).toBeGreaterThan(0);
    expect(first.value.status, `the first fetch, whose file read threw: ${first.text.slice(0, 600)}`).not.toBe('fetched');

    // The second read answers: the same id, fetched again.
    const second = await kinds(w, fetchArgs(ID));
    expect(second.value.status, `the second fetch of ${ID}, after the first said ${first.text.slice(0, 400)}; it said ${second.text.slice(0, 800)}; the library saw ${w.library.quote(from)}`).toBe('fetched');
  }, 600_000);
});
