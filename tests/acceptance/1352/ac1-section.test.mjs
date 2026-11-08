// Criterion 1: the design holds a section answering each of the issue's eight Scope decisions, with what was not
// taken, and the Decided table gains its rows. Offline: it reads docs/technical-design.md here and at the base commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, NO_SECTION, baseDesign, decidedRows, findSection, isSectionHeading, readDesign } from './helpers.mjs';

// Each Scope decision by the words any answer to it has to use (README.md, What "answers" means).
const DECISIONS = [
  ['a hub of your own, not a shared service (one isolated machine, the only writer)', [/\bisolated\b/i, /\bwriter\b/i, /\bshared\b/i]],
  ['the same hub (the Linux hub in a sandbox, the host seam, the remote connection)', [/\bLinux\b/, /\bsandbox(?:ed|es)?\b/i, /\bseams?\b|host@1/i, /\bconnection\b/i]],
  ['who runs it (hosted with one sign-up, the same image on your own account or machine)', [/\bhosted\b/i, /\bsign[- ]?up\b/i, /\bimage\b/i, /\block(?:ed)?[- ]in\b/i]],
  ['whose agents and plan (the unmodified agent on your own account, an API key kept as a secret)', [/\bunmodified\b/i, /\baccounts?\b/i, /\bsubscriptions?\b/i, /\bAPI keys?\b/i, /\bsecrets?\b/i]],
  ['what leaves your machine (privacy, the first screen before sign-up, encryption at rest, who can read it)', [/\bprivacy\b/i, /\bfirst screen\b/i, /\bencrypt/i, /\bat rest\b/i, /\bwho can read\b/i]],
  ["the browser (a web client, the person's own hub, the authenticated connection, a passkey; no agent, page or plug-in answers an ask)", [/\bweb client\b/i, /\bown hub\b/i, /\bauthenticated connection\b/i, /\bpasskeys?\b/i, /\bplug-ins?\b/i, /\bask\b/i]],
  ['who pays for hosting (pay for use, idle machines asleep, bring-your-own free; not free for everyone, not a flat plan)', [/\bpay(?:s|ing)?\b/i, /\bidle\b/i, /\basleep\b/i, /\bbring[- ]your[- ]own\b/i, /\bfree\b/i, /\bflat\b/i]],
  ['moving (deep backup and deep restore, the writer generation refusing a stale copy)', [/\bdeep backup\b/, /\bdeep restore\b/, /\bgeneration\b/i, /\bstale\b/i]],
];

test('#1352.4c4e63a7 criterion 1: the design holds one section, its heading naming the hub and the cloud, that answers each of the eight Scope decisions, with at least eight "Not taken"', () => {
  const section = findSection(readDesign());
  assert.ok(section, NO_SECTION);
  const unanswered = DECISIONS.filter(([, words]) => !words.every((w) => w.test(section.body)))
    .map(([decision, words]) => `${decision}: missing ${words.filter((w) => !w.test(section.body)).join(', ')}`);
  assert.deepEqual(unanswered, [], `the section "${section.heading}" doesn't answer these decisions`);
  const notTaken = section.body.match(/\bnot taken\b/gi)?.length ?? 0;
  assert.ok(notTaken >= DECISIONS.length, `the section "${section.heading}" says "Not taken" ${notTaken} times; each of the ${DECISIONS.length} decisions needs what was not taken`);
});

test(`#1352.4c4e63a7 criterion 1: the Decided table has more rows than at ${BASE}, and a new row links to the new section or names the hub and the cloud`, () => {
  const before = decidedRows(baseDesign()), now = decidedRows(readDesign());
  assert.ok(now.length > before.length, `the Decided table has ${now.length} rows, and had ${before.length} at ${BASE}: it gained none`);
  const old = new Set(before.map((r) => r.trim()));
  const added = now.filter((r) => !old.has(r.trim()));
  const anchors = findSection(readDesign())?.anchors ?? [];
  const about = added.filter((r) => anchors.some((a) => r.includes(`#${a})`)) || isSectionHeading(r));
  assert.ok(about.length > 0, `none of the Decided table's ${added.length} new rows links to the new section (${anchors.map((a) => `#${a}`).join(', ') || 'no section'}) or names the hub and the cloud:\n${added.join('\n')}`);
});
