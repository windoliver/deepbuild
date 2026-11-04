// AC21: a change to the review check's prompt, its finding filters or the model it asks for by default replays this
// issue's planted-bug diffs, their clean twins and the recorded review rounds on the merge base and on the change, and
// the local preflight lists every finding that appears or disappears: a planted prompt change that drops the planted
// bug's finding and fails no test is listed with both runs and can't merge without the maintainer's yes on the list;
// a preflight that replays only the verdict engine's cases (#569) passes it and fails this test.
//
// Through the preflight's proof lanes, `node scripts/proof.mjs replay` (the local preflight runs scripts/proof.mjs,
// #569), in a scratch repository whose review check is a stand-in package at packages/checks-review: its public entry
// exports replayReview(root), and its "model" flags each added line of a case's diff that matches a rule its prompt
// (src/prompt.md) names. The cases sit where this issue keeps them, tests/acceptance/87/review/: the planted-bug diff
// (an unchecked JSON.parse at src/config.ts:3), its clean twin, and one recorded review round. The planted change edits
// only the prompt: it drops the unchecked-JSON.parse rule and adds a TODO rule, so the planted bug's finding
// disappears and the round gains one at src/cart.ts:12; the stand-in's own test passes on it. The wrong program is the
// base's preflight, which replays only the verdict engine's cases and doesn't run on this change at all.
import { spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';
import { AC21, approve, linesOf, must, proof, scene, showProof } from './helpers.ts';

const STAND_IN = `// The stand-in review check: its "model" flags each added line of a case's diff that a rule of its prompt names.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPT = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8');
const RULES = [...PROMPT.matchAll(/^- ([a-z-]+): (.+)$/gm)].map(([, rule, pattern]) => ({ rule, re: new RegExp(pattern) }));
const CASES = 'tests/acceptance/87/review';

function added(diff) {
  const out = [];
  let file = '';
  let line = 0;
  for (const text of diff.split('\\n')) {
    if (text.startsWith('+++ ')) { file = text.slice(4).replace(/^b\\//, ''); continue; }
    const hunk = /^@@ -\\d+(?:,\\d+)? \\+(\\d+)/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (text.startsWith('+')) out.push({ file, line: line++, text: text.slice(1) });
    else if (text.startsWith(' ')) line++;
  }
  return out;
}

export async function replayReview(root) {
  return readdirSync(join(root, CASES)).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const { diff } = JSON.parse(readFileSync(join(root, CASES, name), 'utf8'));
    const findings = added(diff).flatMap((a) => RULES.filter((r) => r.re.test(a.text)).map((r) => ({ file: a.file, line: a.line, rule: r.rule, quote: a.text.trim() })));
    return { case: \`\${CASES}/\${name}\`, findings };
  });
}
`;
const PROMPT = '# Review rubric\n\nReport each finding as file, line, rule and the quoted line.\n\n- unchecked-json-parse: JSON\\.parse\\(\n- any-cast: as any\n';
// The planted prompt change: the unchecked-JSON.parse rule dropped, a TODO rule added.
const PLANTED = '# Review rubric\n\nReport each finding as file, line, rule and the quoted line.\n\n- any-cast: as any\n- todo-left: TODO\n';
const STAND_IN_TEST = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

it('the rubric names at least one rule', () => assert.match(readFileSync(new URL('../src/prompt.md', import.meta.url), 'utf8'), /^- [a-z-]+: /m));
`;
const diff = (file: string, start: number, lines: string[]): string =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${start},2 +${start},${lines.length + 2} @@\n context above\n${lines.map((l) => `+${l}`).join('\n')}\n context below\n`;
const kase = (d: string): string => `${JSON.stringify({ diff: d }, null, 2)}\n`;
const PLANTED_BUG = 'tests/acceptance/87/review/planted-bug.json';
const CLEAN_TWIN = 'tests/acceptance/87/review/clean-twin.json';
const ROUND = 'tests/acceptance/87/review/round-01.json';

const BASE: Record<string, string> = {
  'packages/checks-review/package.json': '{ "name": "@deepbuild/checks-review", "version": "0.0.0", "private": true, "type": "module", "exports": "./src/index.mjs" }\n',
  'packages/checks-review/src/index.mjs': STAND_IN,
  'packages/checks-review/src/prompt.md': PROMPT,
  'packages/checks-review/test/prompt.test.mjs': STAND_IN_TEST,
  // The unchecked JSON.parse lands on src/config.ts:3; its clean twin parses through a checked helper.
  [PLANTED_BUG]: kase(diff('src/config.ts', 2, ['const cfg = JSON.parse(raw);'])),
  [CLEAN_TWIN]: kase(diff('src/config.ts', 2, ['const cfg = parseConfig(raw);'])),
  // A recorded round: an any-cast at src/cart.ts:10 (found on both sides) and a TODO at src/cart.ts:12.
  [ROUND]: kase(diff('src/cart.ts', 9, ['const total = (items as any).sum;', 'const tax = 0;', '// TODO: round half to even'])),
};

describe(`${AC21} a change to the review check's prompt is replayed on the merge base and the change, and every finding that moves is listed`, () => {
  it(`${AC21} the planted prompt change that drops the planted bug's finding fails no test, is listed with both runs and fails the preflight until the maintainer's yes on that list`, () => {
    const s = scene(BASE, [{ files: { 'packages/checks-review/src/prompt.md': PLANTED }, message: 'Tighten the review rubric' }]);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const tests = spawnSync(process.execPath, ['--test', 'packages/checks-review/test/prompt.test.mjs'], { cwd: s.cwd, env, encoding: 'utf8' });
    must(tests.status === 0, `BLOCKED: ${AC21} the planted prompt change must fail no test of its own: ${tests.stdout}${tests.stderr}`);

    const r = proof(s, ['replay']);
    must(r.status === 1, `${AC21} the change edits the review check's prompt and drops the planted bug's finding, so the replay lane must fail (exit 1) until the maintainer says yes: ${showProof(r)}`);
    const failing = linesOf(r, ['FAIL'], 'replay');
    const gone = failing.find((l) => l.includes(PLANTED_BUG) && l.includes('unchecked-json-parse') && l.includes('src/config.ts:3'));
    must(gone !== undefined && gone.includes('on the merge base, not on the change'), `${AC21} the lane lists the planted bug's finding that disappears, with both runs: a FAIL replay line naming ${PLANTED_BUG}, unchecked-json-parse and src/config.ts:3, "on the merge base, not on the change": ${showProof(r)}`);
    const came = failing.find((l) => l.includes(ROUND) && l.includes('todo-left') && l.includes('src/cart.ts:12'));
    must(came !== undefined && came.includes('on the change, not on the merge base'), `${AC21} the lane lists the finding that appears in the recorded round: a FAIL replay line naming ${ROUND}, todo-left and src/cart.ts:12, "on the change, not on the merge base": ${showProof(r)}`);
    for (const still of [CLEAN_TWIN, 'any-cast']) must(!failing.some((l) => l.includes(still)), `${AC21} only findings that move are listed; ${still} didn't move and is listed: ${showProof(r)}`);
    const [, digest] = /list sha256:([0-9a-f]{64})/.exec(r.stdout) ?? [];
    must(digest !== undefined && failing.some((l) => l.includes(`list sha256:${digest}`) && /maintainer's yes/.test(l)), `${AC21} the list's last line asks for the maintainer's yes on it, naming its digest (list sha256:<hex>): ${showProof(r)}`);

    approve(s, s.head, [`replay sha256:${digest}`]);
    const yes = proof(s, ['replay']);
    must(yes.status === 0 && !/^(FAIL|BLOCKED|INVALID|INCONCLUSIVE) /m.test(yes.stdout), `${AC21} with the maintainer's yes on that list the change may merge: the lane must pass, ${showProof(yes)}`);
    must(linesOf(yes, ['PASS'], 'replay').some((l) => l.includes(PLANTED_BUG) && l.includes('src/config.ts:3') && l.includes('on the merge base, not on the change')), `${AC21} the approved list is still shown, both runs named: ${showProof(yes)}`);
  });
});
