// Criterion 1: the design holds a section answering each of the issue's six Scope decisions, with what was not taken,
// and the Decided table gains its rows. Offline: it reads docs/technical-design.md here and at the base commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, baseDesign, decidedRows, findSection, isSectionHeading, readDesign } from './helpers.mjs';

// Each Scope decision by the words any answer to it has to use (README.md, What "answers" means).
const DECISIONS = [
  ['who writes the record (the only writer, over a connection that names the person)', [/\bwriters?\b/i, /\brecord\b/i, /\bconnections?\b/i]],
  ["what's shared, and what isn't (personal scope, transcripts)", [/\bshared\b/i, /\bpersonal\b/i, /\btranscripts?\b/i]],
  ['where it runs (an always-on machine, hosts behind host@1)', [/\balways[- ]on\b/i, /host@1/]],
  ['whose plan a session spends (the account)', [/\bplans?\b/i, /\baccounts?\b/i]],
  ['who approves what (asks any one person answers, asks that go to a named one)', [/\bapprov/i, /\basks?\b/i, /\bnamed\b/i]],
  ['no model decides to start work (the hub dispatches)', [/\bmodel\b/i, /\bdispatch/i]],
];

test('#1336.4c4e63a7 criterion 1: the design holds one section, its heading naming the hub and the project, that answers each of the six Scope decisions, with at least six "Not taken" lines', () => {
  const section = findSection(readDesign());
  assert.ok(section, 'docs/technical-design.md has no heading holding the words "hub" and "project", so it has no section for one hub for a project shared by several people');
  const unanswered = DECISIONS.filter(([, words]) => !words.every((w) => w.test(section.body)))
    .map(([decision, words]) => `${decision}: missing ${words.filter((w) => !w.test(section.body)).join(', ')}`);
  assert.deepEqual(unanswered, [], `the section "${section.heading}" doesn't answer these decisions`);
  const notTaken = section.body.match(/\bnot taken\b/gi)?.length ?? 0;
  assert.ok(notTaken >= DECISIONS.length, `the section "${section.heading}" says "Not taken" ${notTaken} times; each of the ${DECISIONS.length} decisions needs what was not taken`);
});

test(`#1336.4c4e63a7 criterion 1: the Decided table has more rows than at ${BASE}, and a new row links to the new section or names the hub and the project`, () => {
  const before = decidedRows(baseDesign()), now = decidedRows(readDesign());
  assert.ok(now.length > before.length, `the Decided table has ${now.length} rows, and had ${before.length} at ${BASE}: it gained none`);
  const old = new Set(before.map((r) => r.trim()));
  const added = now.filter((r) => !old.has(r.trim()));
  const anchors = findSection(readDesign())?.anchors ?? [];
  const about = added.filter((r) => anchors.some((a) => r.includes(`#${a})`)) || isSectionHeading(r));
  assert.ok(about.length > 0, `none of the Decided table's ${added.length} new rows links to the new section (${anchors.map((a) => `#${a}`).join(', ') || 'no section'}) or names the hub and the project:\n${added.join('\n')}`);
});
