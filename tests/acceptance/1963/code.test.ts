// AC1: A code item quoting lines 10 to 12 of a file at a commit fails quote_mismatch naming line 11 when its raw bytes
// differ from that line's, and passes otherwise with its digits listed as quotation; the same code unquoted fails
// honest numbers naming the item.
// The file is a 15-line Go file, `retry/retry.go`, as it stood at a commit, put in the check's asset store by sha256
// and listed in the document's `assets`. The code item `retry-fn` (Text `text@1`: code) holds lines 10 to 12, the
// function `Default`, as its `raw` and quotes them (`quote: {source: sha256, path, lines: [10, 12]}`). Line 11 starts
// with a tab and holds the digits 3 and 250. The twin's line 11 starts with four spaces instead: at the default tab of
// 4 columns it draws the same, and its raw bytes differ from the file's on line 11 alone.
import { describe, expect, it } from 'vitest';
import { LICENSE, TIMEOUT, check, envelope, linesOf, listed, naming, namesLine, put, shownErrors, shownListing, useFolders, useRender, type Folders, type JsonObject } from './helpers.ts';

const render = useRender();
const folders = useFolders('code');

const COMMIT = '5d0c1e7a9b3f4e2d8c6a1b0f9e8d7c6b5a4f3e2d';
const PATH = 'retry/retry.go';
const FILE = [
  '// Package retry tries a call again after a wait.',
  'package retry',
  '',
  'import "time"',
  '',
  '// Policy says how often a call is tried and how long it waits.',
  'type Policy struct{ Attempts int; Wait time.Duration }',
  '',
  '// Default is the policy most calls use.',
  'func Default() Policy {',
  '\treturn Policy{Attempts: 3, Wait: 250 * time.Millisecond}',
  '}',
  '',
  '// Once tries a call a single time.',
  'func Once() Policy { return Policy{Attempts: 1} }',
  '',
].join('\n');
const SOURCE = Buffer.from(FILE, 'utf8');
const RAW = linesOf(FILE, [10, 12]);
const LINE_11 = linesOf(FILE, [11, 11]);
const TWIN = RAW.replace(LINE_11, LINE_11.replace('\t', '    '));
const ITEM = 'retry-fn';

function code(f: Folders, raw: string, quoted: boolean): JsonObject {
  const params: JsonObject = { font: 'mono', size: 16, code: { language: 'go' }, raw };
  const extra: JsonObject = {};
  if (quoted) {
    const sha = put(f, SOURCE);
    params['quote'] = { source: sha, path: PATH, lines: [10, 12] };
    extra['assets'] = { [`retry-go-at-${COMMIT.slice(0, 7)}`]: { sha256: sha, license: LICENSE } };
  }
  const item: JsonObject = { id: ITEM, kind: 'text@1', layer: 'main', name: 'Default, quoted from its commit', order: 'a1', at: { pos: [24, 40, 0] }, params };
  return envelope(`code-1963-${quoted ? 'quoted' : 'unquoted'}`, [item], extra);
}

describe('AC1 a code item quoting lines 10 to 12 of a file at a commit is held to that file\'s bytes', () => {
  it('AC1 the quote passes, with its digits 3 and 250 listed as quotation', () => {
    expect(FILE.split('\n').length - 1, 'the file has 15 lines').toBe(15);
    expect(RAW, 'lines 10 to 12 are the function Default').toBe('func Default() Policy {\n\treturn Policy{Attempts: 3, Wait: 250 * time.Millisecond}\n}\n');
    const f = folders();
    const c = check(render(), code(f, RAW, true), f);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the quote matches lines 10 to 12 and counts no number: ${shownErrors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    for (const n of ['3', '250']) {
      expect(listed(c, ITEM, n, /quot/i).length, `the check lists ${ITEM}'s ${n} as quotation: ${shownListing(c)}`).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('AC1 a twin whose raw bytes differ on line 11 fails quote_mismatch naming line 11', () => {
    const [a, b] = [RAW.split('\n'), TWIN.split('\n')];
    expect(a.map((l, i) => l === b[i]), 'the twin differs from the quote on the file\'s line 11 alone').toEqual([true, false, true, true]);
    expect(b[1], 'the twin\'s line 11 is the file\'s with its tab as the 4 columns it draws as').toBe(`    ${(a[1] ?? '').slice(1)}`);
    const f = folders();
    const c = check(render(), code(f, TWIN, true), f);
    expect(c.ok, `the check fails: ${shownErrors(c)}`).toBe(false);
    const named = naming(c, 'quote_mismatch', ITEM);
    expect(named.length, `quote_mismatch names ${ITEM}: ${shownErrors(c)}`).toBeGreaterThan(0);
    expect(named.some((e) => namesLine(e, 11)), `quote_mismatch names line 11, the file's first line that differs: ${shownErrors(c)}`).toBe(true);
  }, TIMEOUT);

  it('AC1 the same code unquoted fails honest numbers naming the item', () => {
    const f = folders();
    const c = check(render(), code(f, RAW, false), f);
    expect(c.ok, `the check fails: ${shownErrors(c)}`).toBe(false);
    expect(naming(c, 'number_unsourced', ITEM).length, `number_unsourced names ${ITEM}, whose digits are its own: ${shownErrors(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
