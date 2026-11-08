// Criterion 2, offline half: the privacy section and the threats table are changed to match the new section, and a
// search for the old "refuses any request carrying a browser Origin" wording finds only new wording. It reads docs/ and
// README.md here and at the base commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, baseDesign, baseTextsHolding, currentTexts, normal, readDesign, sectionBySlug, tableRows } from './helpers.mjs';

const PHRASE = 'refuses any request carrying a browser origin';
// A file's sentences and table cells, normalized, so a hit is judged by the whole sentence it sits in.
const pieces = (text) => normal(text).split(/(?<=\.)\s+|\s*\|\s*/);

test(`#1352.7a887cd4 criterion 2: a search of docs/ and README.md for "${PHRASE}" finds none of the sentences that held it at ${BASE}`, () => {
  const old = new Set(baseTextsHolding('browser').flatMap(([, text]) => pieces(text).filter((p) => p.includes(PHRASE))));
  assert.ok(old.size >= 2, `the base's sentences holding the phrase weren't found (${old.size}), so this search reads nothing`);
  const files = currentTexts();
  assert.ok(files.some(([f]) => f === 'docs/technical-design.md'), 'the search found no docs/technical-design.md to read');
  const hits = files.flatMap(([f, text]) => pieces(text).filter((p) => old.has(p)).map((p) => `${f}: "${p}"`));
  assert.deepEqual(hits, [], 'the old wording is still there');
});

const THREATS = 'threats-and-what-stops-each-one';
const BROWSER_ROW = [/\bweb client\b/i, /\bown hub\b/i, /\bauthenticated connection\b/i, /\bpasskeys?\b/i];

test(`#1352.7a887cd4 criterion 2: the threats table has a row in which a web client reaches only the person's own hub over the authenticated connection with a passkey, and no row refuses every browser without it`, () => {
  const rows = tableRows(sectionBySlug(readDesign(), THREATS).body);
  const before = new Set(tableRows(sectionBySlug(baseDesign(), THREATS).body).map((r) => r.trim()));
  const browser = rows.filter((r) => BROWSER_ROW.every((w) => w.test(r)));
  assert.ok(browser.length > 0, `no row of the threats table holds all of ${BROWSER_ROW.join(', ')}; the rows naming a browser or a web client:\n${rows.filter((r) => /browser|web client/i.test(r)).map((r) => r.slice(0, 300)).join('\n')}`);
  assert.ok(browser.some((r) => !before.has(r.trim())), `the threats table's browser row is unchanged from ${BASE}`);
  const refusing = rows.filter((r) => /browser origin|every browser|any browser/i.test(r) && !/\bweb client\b/i.test(r)).map((r) => r.slice(0, 300));
  assert.deepEqual(refusing, [], 'a row of the threats table still refuses browsers without naming the web client that may reach the hub');
});

// What the privacy section must now say plainly (README.md, The privacy section).
const PRIVACY = [/\bcloud\b/i, /\bsign[- ]?up\b/i, /\bfirst screen\b/i, /\bencrypt/i, /\bat rest\b/i, /\bwho can read\b/i];

test(`#1352.7a887cd4 criterion 2: the privacy section is changed from ${BASE} and says that a hosted hub's work lives on that cloud machine: shown on the first screen before sign-up, encrypted at rest, and who can read it`, () => {
  const before = sectionBySlug(baseDesign(), 'privacy').body, now = sectionBySlug(readDesign(), 'privacy').body;
  assert.ok(now !== before, `the privacy section is the same as at ${BASE}`);
  const missing = PRIVACY.filter((w) => !w.test(now));
  assert.deepEqual(missing, [], 'the privacy section lacks these words');
});
