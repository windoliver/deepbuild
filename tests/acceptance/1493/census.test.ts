// The census script's four criteria (README: census.test.ts): familiar@1 at the pin (AC1), a stub reference that
// gains an export or loses its cache (AC2), a mapped word moved to refused with no break file (AC4), and a gallery
// count one off (AC5). Each runs `node scripts/census.mjs` as a process on a tree laid out like the repo and reads its
// exit and its lines; AC1 also lists the reference's names here, from the cached files, apart from the script.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CENSUS, PIN, REPO, STUB_FOLDER, STUB_INDEX, STUB_INDEX_TEXT, arr, blockedFailures, census, clone, commitAll, copyFamiliar, failNamingFailures,
  isObject, obj, passFailures, publicNames, readJson, runScript, show, stubTree, useTemp, writeJson, type JsonObject,
} from './helpers.ts';

const temp = useTemp();
const STATES = ['mapped', 'refused', 'open'] as const;

const AC1 = '#1493.943e1d6c';
describe(`${AC1} familiar@1's census at the pin`, () => {
  it(`${AC1} every listed name has exactly one row, totals sum to the listing's length, mapped equals the aliases; a planted alias with no row and a planted mapped row with no alias each fail, naming the word`, () => {
    const folder = join(REPO, 'packs', 'familiar-1.0.0');
    const manifest = obj(readJson(join(folder, 'pack.json')), 'familiar@1 pack.json');
    expect(typeof manifest['census'], `familiar@1's pack.json names its census file: ${show(Object.keys(manifest))}`).toBe('string');
    const file = join(folder, String(manifest['census']));
    expect(existsSync(file), `familiar@1's census ${file} exists`).toBe(true);
    const c = obj(readJson(file), 'the census');
    const reference = obj(c['reference'], 'census.reference');
    expect(reference['commit'], 'the census names the pinned reference commit').toBe(PIN);
    expect(typeof c['scope'] === 'string' && c['scope'].trim() !== '', `the census states its scope: ${show(c['scope'])}`).toBe(true);

    // The reference files, each a lock row at the pin, read from the cache only once the fetcher has checked them.
    const files = arr(reference['files'], 'census.reference.files').map(String);
    expect(files.length, 'the census lists the reference files it counts').toBeGreaterThan(0);
    const lock = arr(obj(readJson(join(REPO, 'scripts', 'fetch-lock.json')), 'the lock')['files'], 'the lock files').filter(isObject);
    const rows = files.map((f) => lock.find((r) => r['path'] === f));
    expect(rows.map((r, i) => (r && String(r['url']).includes(PIN) ? '' : `${files[i]} has no lock row at ${PIN}`)).filter(Boolean), 'each reference file is a lock row at the pin').toEqual([]);
    const fetched = runScript(join(REPO, 'scripts', 'fetch-lock.mjs'), ['fetch', ...rows.map((r) => String(r!['url']))], REPO, homedir());
    expect(fetched.status, `BLOCKED: the reference files aren't in the cache at their pinned hashes (warm it with DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch): ${fetched.output.slice(0, 2000)}`).toBe(0);
    const listed = new Set(files.flatMap((f) => publicNames(readFileSync(join(homedir(), '.deepbuild', 'fetched', f), 'utf8'))));
    expect(listed.size, 'the reference files export public names').toBeGreaterThan(0);

    // Every listed name has exactly one row, and every row a listed name.
    const names = arr(c['names'], 'census.names').map((r, i) => obj(r, `census.names[${i}]`));
    const count = new Map<string, number>();
    for (const r of names) count.set(String(r['name']), (count.get(String(r['name'])) ?? 0) + 1);
    expect([...listed].filter((n) => count.get(n) !== 1).map((n) => `${n}: ${count.get(n) ?? 0} rows`), 'each listed name has exactly one row').toEqual([]);
    expect([...count.keys()].filter((n) => !listed.has(n)), 'no row names a word the reference files do not export').toEqual([]);
    expect(names.filter((r) => !STATES.includes(r['state'] as never)).map((r) => show(r)), 'each row is mapped, refused or open').toEqual([]);

    // Totals: each state's count is its rows, and they sum to the listing's length.
    const totals = obj(obj(c['totals'], 'census.totals')['names'], 'census.totals.names');
    for (const s of STATES) expect(totals[s], `totals.names.${s} counts the ${s} rows`).toBe(names.filter((r) => r['state'] === s).length);
    expect(STATES.reduce((n, s) => n + Number(totals[s]), 0), "the name totals sum to the listing's length").toBe(listed.size);

    // mapped equals the aliases.
    const aliases = Object.keys(obj(manifest['aliases'], 'familiar@1 aliases')).sort();
    expect(names.filter((r) => r['state'] === 'mapped').map((r) => String(r['name'])).sort(), "the mapped rows are exactly pack.json's aliases").toEqual(aliases);

    // The script agrees on the checkout, and on a copy of it; each plant in the copy fails, naming its word.
    expect(passFailures(runScript(CENSUS, ['--check'], REPO, homedir()), 'census.mjs --check on the checkout'), 'the checkout').toEqual([]);
    const tree = join(temp(), 'tree');
    const copy = copyFamiliar(tree);
    commitAll(tree);
    expect(passFailures(census(['--check'], tree, homedir()), 'census.mjs --check on a copy of familiar@1'), 'the copy').toEqual([]);

    const word = 'PlantedGeometry';
    const planted = clone(manifest);
    (planted['aliases'] as JsonObject)[word] = { target: 'familiar.box@1', conversion: 'a planted alias of the #1493 acceptance tests' };
    writeJson(join(copy, 'pack.json'), planted);
    expect(failNamingFailures(census(['--check'], tree, homedir()), word, 'a planted alias with no row'), 'the planted alias').toEqual([]);
    writeJson(join(copy, 'pack.json'), manifest);

    const open = names.find((r) => r['state'] === 'open');
    expect(open, 'the census has an open row to plant a mapped row on').toBeDefined();
    const moved = clone(c);
    const row = (moved['names'] as JsonObject[]).find((r) => r['name'] === open!['name'])!;
    row['state'] = 'mapped';
    row['target'] = 'familiar.box@1';
    const t = (moved['totals'] as JsonObject)['names'] as JsonObject;
    t['open'] = Number(t['open']) - 1;
    t['mapped'] = Number(t['mapped']) + 1;
    writeJson(join(copy, String(manifest['census'])), moved);
    expect(failNamingFailures(census(['--check'], tree, homedir()), String(open!['name']), 'a planted mapped row with no alias'), 'the planted mapped row').toEqual([]);
  }, 600_000);
});

const AC2 = '#1493.d1b3af60';
describe(`${AC2} the census is counted from the reference's own files`, () => {
  it(`${AC2} a stub reference with one added export fails --check, naming the export; with the cache removed it reads BLOCKED, never PASS`, () => {
    const s = stubTree(temp());
    commitAll(s.tree);
    expect(passFailures(census(['--check'], s.tree, s.home), 'census.mjs --check on the stub as counted'), 'the stub as counted').toEqual([]);

    s.reference(STUB_INDEX, `${STUB_INDEX_TEXT}export { Extra } from './extra.js';\n`);
    expect(failNamingFailures(census(['--check'], s.tree, s.home), 'Extra', 'the stub with one added export'), 'the added export').toEqual([]);

    s.reference(STUB_INDEX, STUB_INDEX_TEXT);
    s.dropCache();
    expect(blockedFailures(census(['--check'], s.tree, s.home), 'the stub with its cache removed'), 'the removed cache').toEqual([]);
  }, 600_000);
});

const AC4 = '#1493.4299b7da';
describe(`${AC4} a move from mapped to refused needs a break file`, () => {
  it(`${AC4} a planted move of a mapped word to refused with no break file fails, naming the word; with its break file it passes`, () => {
    const s = stubTree(temp());
    commitAll(s.tree);
    const word = 'BoxShape';
    const c = s.readCensus();
    const row = (c['names'] as JsonObject[]).find((r) => r['name'] === word)!;
    row['state'] = 'refused';
    row['reason'] = 'superseded';
    row['target'] = 'stub.box@1, written by its kind name';
    c['params'] = [];
    c['totals'] = { names: { mapped: 0, refused: 3, open: 3 }, params: { mapped: 0, refused: 0, open: 0 } };
    s.writeCensus(c);
    const m = s.readManifest();
    m['aliases'] = {};
    s.writeManifest(m);
    expect(failNamingFailures(census(['--check'], s.tree, s.home), word, `${word} moved from mapped to refused with no break file`), 'the move with no break file').toEqual([]);

    s.write(`${STUB_FOLDER}/breaks/1493.txt`, `census: ${word} mapped -> refused\nworkaround: write stub.box@1 by its kind name\n`);
    expect(passFailures(census(['--check'], s.tree, s.home), `${word} moved with its break file`), 'the move with its break file').toEqual([]);
  }, 600_000);
});

const AC5 = '#1493.e36cbcda';
describe(`${AC5} any count quoted for a pack is read from its census`, () => {
  it(`${AC5} a gallery line quoting a count one off from the census fails the lint, naming file and line`, () => {
    expect(passFailures(runScript(CENSUS, ['--counts'], REPO, homedir()), "census.mjs --counts on the checkout's gallery"), 'the checkout').toEqual([]);

    const s = stubTree(temp());
    const file = 'crates/deep-show/gallery/stub-names.md';
    const page = (n: number): string => `# Stub names\n\nstub@1 maps ${n} of 6 names of the stub library at its pin; scope: every name its index exports.\n`;
    s.write(file, page(1));
    commitAll(s.tree);
    expect(passFailures(census(['--counts'], s.tree, s.home), 'the lint on a gallery line quoting stub@1 as 1 of 6'), 'the right count').toEqual([]);

    s.write(file, page(2));
    const r = census(['--counts'], s.tree, s.home);
    expect(failNamingFailures(r, 'stub-names.md:3', 'the lint on a gallery line quoting stub@1 as 2 of 6'), 'the count one off').toEqual([]);
  }, 600_000);
});
