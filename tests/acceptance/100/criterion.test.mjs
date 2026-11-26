// #100's criterion on the checkout this file sits in, offline: the two Decided tables the issue links record build
// first for ropes and cloth, and no public doc has a rope, cloth or solver waiting on a licensing or patent review.
// The rendered issues are searched in issues.live.test.mjs. README: what each test means by the criterion's words.
// Run: node --test tests/acceptance/100/criterion.test.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DOCS, outline } from '../../../scripts/doc-links.mjs';
import { blocks, waiting } from './reader.mjs';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// The issue's Design links to the two tables: each doc, and the anchor its link lands on.
const TABLES = [['docs/technical-design.md', 'decided'], ['docs/canvas-primitives.md', 'whats-decided-and-what-would-reopen-it']];
const BUILD_FIRST = /\bbuil(?:d|ds|t|ding)(?: \w+){0,2}? first\b/g;
const DENIED = /\b(?:not|never|nor|neither|rather than|instead of|without|cannot)\b|n't\b/;

/** Why the Decided table a link lands on doesn't record build first for ropes and cloth, or null when a row of it does. */
function unrecorded(doc, anchor) {
  const file = join(CHECKOUT, doc);
  const { anchors, headings } = outline(file);
  const at = headings.findIndex(({ id }) => id === anchors.get(anchor));
  if (at < 0) return `${doc}: no heading or <a id> is #${anchor}, where the issue links its Decided table`;
  // The section runs to the next heading of its level or higher; its table's rows, without the rule under the header.
  const end = headings.find(({ level }, index) => index > at && level <= headings[at].level)?.offset;
  const [header, ...rows] = blocks(readFileSync(file).subarray(headings[at].offset, end).toString('utf8')).filter(({ row, cells }) => row && !cells.every((cell) => /^:?-+:?$/.test(cell)));
  const decision = header?.cells.indexOf('decision') ?? -1;
  if (decision < 0) return `${doc}#${anchor}: the section has no table with a Decision column`;
  const ours = rows.filter(({ cells }) => /\bropes?\b/.test(cells.join(' ')) && /\bcloth\b/.test(cells.join(' ')));
  const said = (cell = '') => [...cell.matchAll(BUILD_FIRST)].some(({ index }) => !DENIED.test(cell.slice(0, index).trim().split(' ').slice(-3).join(' ')));
  return ours.some(({ cells }) => said(cells[decision])) ? null
    : `${doc}#${anchor}: of ${rows.length} rows, ${ours.length} name ropes and cloth (${ours.map(({ cells }) => `"${cells[0]}"`).join(', ') || 'none'}), and none says build first in its Decision cell`;
}

test('AC1 #100.acd6f892 both docs\' Decided tables record build first for ropes and cloth', () => {
  const silent = TABLES.map(([doc, anchor]) => unrecorded(doc, anchor)).filter(Boolean);
  assert.deepEqual(silent, [], `${silent.length} of the two Decided tables ${silent.length === 1 ? "doesn't" : "don't"} record build first for ropes and cloth`);
});

test('AC1 #100.acd6f892 a search of the public docs finds no rope, cloth or solver of ours waiting on a licensing or patent review', () => {
  // The public docs: the two design docs, which must be there, and every other Markdown file of docs/ and of the root.
  const markdown = (folder) => readdirSync(join(CHECKOUT, folder)).filter((name) => name.endsWith('.md')).map((name) => join(folder, name));
  const docs = [...new Set([...DOCS, ...markdown('docs'), ...markdown('')])];
  const found = docs.flatMap((doc) => waiting(readFileSync(join(CHECKOUT, doc), 'utf8')).map(({ line, sentence }) => `${doc}:${line}: ${sentence}`));
  assert.deepEqual(found, [], `the ${docs.length} public docs have a rope, cloth or solver waiting on a licensing or patent review in ${found.length} statement${found.length === 1 ? '' : 's'}`);
});
