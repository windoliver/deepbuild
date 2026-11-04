// AC3: In a quote of a CRLF line that starts with a tab and reads retries = 3 # café with a decomposed é, honest
// numbers lists the 3 as quotation with the raw byte range that holds it and counts no number, and a twin whose raw
// bytes differ from the source by one byte fails quote_mismatch, never honest numbers.
// The source is the one line's bytes, put in the check's store by sha256: a tab, `retries = 3 # cafe`, U+0301 (CC 81)
// and CR LF, 23 bytes. The code item `cfg` (Text `text@1`: code) holds them as its `raw` and quotes the source's line 1
// (`quote: {source: sha256, path, lines: [1, 1]}`). The 3 is raw byte 11 (tab 0, `retries` 1-7, space 8, `=` 9,
// space 10), so its range is [11, 12]; in the display text, with the tab expanded to 4 columns, it is at 14. The twin's
// raw drops the CR (22 bytes): it draws the same, and differs from the source by one byte.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, check, envelope, listed, naming, put, shownErrors, shownListing, textItem, useBuilds, useTemp, type JsonObject } from './helpers.ts';

const bin = useBuilds(['deep-canvas-render']);
const temp = useTemp('quote');

const LINE = '\tretries = 3 # café\r\n';
const SOURCE = Buffer.from(LINE, 'utf8');
const ITEM = 'cfg';

function quoting(raw: string, sha: string): JsonObject {
  return envelope('quote-406', 'figure', [textItem(ITEM, 'a1', {
    font: 'mono', size: 16, code: { language: 'python' }, raw, quote: { source: sha, path: 'config/retry.py', lines: [1, 1] },
  })], {
    assets: { 'retry-source': { sha256: sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' } } },
  });
}

describe('AC3 a quote\'s digits are quotation listed by raw byte range, and its raw bytes alone decide whether it matches', () => {
  it('AC3 the quote passes, listing its 3 as quotation at raw bytes [11, 12] and counting no number', () => {
    expect(SOURCE.length, 'the line is 23 bytes').toBe(23);
    expect(SOURCE.subarray(11, 12).toString('latin1'), 'raw byte 11 is the 3').toBe('3');
    expect(SOURCE.subarray(18, 21).toString('hex'), 'the é is decomposed: e, CC 81').toBe('65cc81');
    const store = temp();
    const c = check(bin('deep-canvas-render'), quoting(LINE, put(store, SOURCE)), store);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the quote matches its source and counts no number: ${shownErrors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    expect(listed(c, ITEM, '3', /quot/i, [11, 12]).length, `the check lists ${ITEM}'s 3 as quotation with raw byte range [11, 12]: ${shownListing(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it('AC3 a twin whose raw drops the CR fails quote_mismatch naming the item, never honest numbers', () => {
    const twin = LINE.replace('\r\n', '\n');
    expect(Buffer.from(twin, 'utf8').length, 'the twin is one byte shorter than the source').toBe(SOURCE.length - 1);
    const store = temp();
    const c = check(bin('deep-canvas-render'), quoting(twin, put(store, SOURCE)), store);
    expect(c.ok, `the check fails: ${shownErrors(c)}`).toBe(false);
    expect(naming(c, 'quote_mismatch', ITEM).length, `quote_mismatch names ${ITEM}: ${shownErrors(c)}`).toBeGreaterThan(0);
    expect(c.errors.filter((e) => e.code === 'number_unsourced').map((e) => e.ids), `honest numbers raises nothing: ${shownErrors(c)}`).toEqual([]);
  }, TIMEOUT);
});
