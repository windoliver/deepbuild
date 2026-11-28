import { beforeAll, describe, expect, it } from 'vitest';
import { AC, CHECK, LISTED, NAMES, SECOND, TIMEOUT, UNLISTED, UNLISTED_IMPORT, chart, check, errorsOf, fetchFile, holdsWord, importTable, isDash, label, list, openFiles, openWorld, piece, proof, publish, rowsOf, show, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(await openFiles()); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

describe(`${AC[5]} the fetch's ask shows what the list will name, and a file approved without it is never given a name`, () => {
  it(`${AC[5]} each fetch's ask shows its file's title, publisher and edition beside the size and the license; a file approved without them lists under its host's name with a dash for each`, async () => {
    const world = must(w, 'a hub with the table import and the table.derive tools');
    const p = must(await piece(world), 'three files fetched after one yes each, imported, and the first two derived into one table');
    proof('ac5-asks.json', NAMES.map((n) => ({ file: n, ask: p.files[n].ask })));
    for (const n of NAMES) {
      const f = p.files[n];
      expect(f.ask === null ? `the fetch of ${n} raised no ask` : '', 'each fetch holds on one authority ask').toBe('');
      const shown = f.ask!.inbox;
      expect([holdsWord(shown, String(f.file.size)), holdsWord(shown, f.file.license.id)], `deep inbox shows ${n}'s ask with the size and the license: ${JSON.stringify(shown)}`).toEqual([true, true]);
      const lacks = (['title', 'publisher', 'edition'] as const).filter((k) => !holdsWord(shown, f.file[k]!)).map((k) => `${k}, ${f.file[k]!}`);
      expect(lacks, `deep inbox shows ${n}'s ask with the file's title, publisher and edition: ${JSON.stringify(shown)}`).toEqual([]);
    }

    const [bare] = must(await publish(world, [UNLISTED]), 'a fourth file listed with no title, publisher or edition');
    const fetched = must(await fetchFile(world, bare!), 'that file fetched after your yes');
    const table = must(await importTable(world, { sha256: fetched.file.sha256 }, UNLISTED_IMPORT), 'that file imported as a table');
    const doc = chart([SECOND(), label('plain', 'plain', 'metro', 'schools', 60), list({ of: 'document', fields: ['title', 'publisher', 'edition'], group: 'publisher' })], { population: p.tables.population, plain: table.sha256 });
    const c = must(check(world, doc), 'deep-canvas-render check answers');
    expect(errorsOf(c), `the piece passes the check, ${CHECK} included`).toEqual([]);
    const rows = must(rowsOf(c), 'the rows the list draws');
    proof('ac5-rows.json', { record: fetched.record, rows });
    const named = rows.find((r) => r.fields.title === LISTED.population.title);
    const plain = rows.filter((r) => r !== named);
    expect([rows.length, named?.group, plain.length], `two rows, the one of the file approved with a publisher under that publisher: ${show(rows, 900)}`).toEqual([2, LISTED.population.publisher, 1]);
    expect(['title', 'publisher', 'edition'].map((k) => isDash(plain[0]!.fields[k])), `the file approved without them shows a dash for its title, its publisher and its edition: ${show(plain[0], 600)}`).toEqual([true, true, true]);
    const host = new URL(bare!.url);
    expect([host.hostname, host.host].includes(plain[0]!.group ?? ''), `and lists under its host's name, ${host.hostname}: ${show(plain[0], 600)}`).toBe(true);
  }, TIMEOUT);
});
