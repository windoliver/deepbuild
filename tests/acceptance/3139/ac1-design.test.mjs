// #3139 AC1 (README: AC1): the design states, for the wait ratchet, the size ratchet and the repo rules, how each treats
// tests/acceptance/, as the owner decided. The decision puts it in the Repo guards bullet of "How we know version 0
// works" in docs/technical-design.md. Each fact below must hold in that bullet, within one sentence or two sentences
// side by side, so the wording is free; the message names each fact the bullet misses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC1, root } from './helpers.mjs';

const ACCEPTANCE = /tests\/acceptance|twin|blind|suite|acceptance test/i;
const OUT = /\bout\b|\bleaves?\b|\bleft\b|\bskip|exclud|ignor|exempt|outside|not judged|never judged|no longer judge/i;

/** Each fact: what the decision says, and the patterns one sentence, or two side by side, must all match. */
const FACTS = [
  { what: 'the wait ratchet: how it treats tests/acceptance/', all: [/\bwaits?\b|ratchets/i, ACCEPTANCE] },
  { what: 'the size ratchet: how it treats tests/acceptance/', all: [/\bsizes?\b|1,500|over-long|ratchets/i, ACCEPTANCE] },
  { what: 'the repo rules: how they treat tests/acceptance/', all: [/repo rules|repo-rules|dependenc|manifest|secret|home path/i, ACCEPTANCE] },
  { what: "the ratchets: a planted twin, a file under a twins/ folder, is out", all: [/twin/i, OUT, /ratchet|\bwaits?\b|\bsizes?\b/i] },
  { what: "the ratchets: a suite's own file is judged only in the change that adds it, and once the merge base holds it a file with no ceiling is out", all: [/suite|tests\/acceptance|blind/i, /merge base|change that adds|adds it|added|starts at zero/i] },
  { what: "the deps rule: twins' manifests are out", all: [/twin/i, /manifest|package\.json|Cargo\.toml|dependenc/i, OUT] },
  { what: "the deps rule: a suite's own tooling crate gets its row like any dependency", all: [/suite|tooling|blind/i, /crate|dependenc|manifest/i, /\brows?\b|listed|repo-rules\.json/i] },
  { what: 'the secrets rule: it keeps judging all of tests/acceptance/ for home paths', all: [/home path|secret/i, /tests\/acceptance|acceptance|suite|record/i, /judg|check|scan|keep|still|fail/i] },
  { what: 'run records: written with home paths redacted, as ~', all: [/record|BASE-FAILURE|\brun\b/i, /redact|`~`|\bas ~|~\//i] },
];

/** The Repo guards bullet of "How we know version 0 works": its line and any continuation lines. */
function repoGuards() {
  const design = readFileSync(join(root, 'docs', 'technical-design.md'), 'utf8');
  const section = design.split(/^## How we know version 0 works\s*$/m)[1]?.split(/^## /m)[0];
  assert.ok(section, 'docs/technical-design.md has no "How we know version 0 works" section');
  const lines = section.split('\n');
  const start = lines.findIndex((line) => /^\s*[-*] \*\*Repo guards\.?\*\*/.test(line));
  assert.ok(start >= 0, 'the "How we know version 0 works" section has no Repo guards bullet');
  let end = start + 1;
  while (end < lines.length && lines[end].trim() && !/^\s*[-*] /.test(lines[end])) end++;
  return lines.slice(start, end).join(' ');
}

test(`${AC1} AC1: the Repo guards bullet states how the wait ratchet, the size ratchet and the repo rules each treat tests/acceptance/, as the owner decided`, () => {
  const bullet = repoGuards();
  // Sentences end at a full stop, colon or semicolon before white space; code spans keep their dots.
  const sentences = bullet.split(/(?<=[.;:])\s+/);
  const windows = sentences.map((sentence, index) => `${sentence} ${sentences[index + 1] ?? ''}`);
  const missing = FACTS.filter(({ all }) => !windows.some((text) => all.every((pattern) => pattern.test(text)))).map(({ what }) => what);
  assert.deepEqual(missing, [], `the Repo guards bullet doesn't state ${missing.length} of the decision's ${FACTS.length} facts:\n- ${missing.join('\n- ')}`);
  assert.ok(/tests\/acceptance/.test(bullet), 'the Repo guards bullet never names tests/acceptance/');
});
