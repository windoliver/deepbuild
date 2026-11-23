// #2327 acceptance, criterion 4 (#2327.b5266f32): CONTRIBUTING.md and SECURITY.md state the rule
// in the same words, and `node scripts/repo-rules.mjs` fails when one of them is edited alone.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRIBUTING, RULE, SECURITY, assertChecked, assertFails, checkoutFiles, read, rules, sharedRun, tree } from './helpers.mjs';

test('#2327.b5266f32 CONTRIBUTING.md and SECURITY.md state the rule in the same words', () => {
  const contributing = read(CONTRIBUTING), security = read(SECURITY);
  assert.ok(contributing !== null, 'CONTRIBUTING.md is missing');
  assert.match(contributing, /private advisory/i, "CONTRIBUTING.md doesn't state the rule: it names no private advisory");
  assert.ok(security !== null, 'SECURITY.md is missing at the root');
  const run = sharedRun(contributing, security);
  for (const [what, pattern] of RULE) assert.match(run, pattern, `the longest run of words the two files share doesn't say that ${what} (${pattern}); the run is: ${JSON.stringify(run)}`);
  const line = contributing.split('\n').filter((one) => RULE.every(([, pattern]) => pattern.test(one)));
  assert.equal(line.length, 1, `the rule is one line of CONTRIBUTING.md; ${line.length} of its lines state all of it`);
});

/** One file's rule reworded, the other left as it is: "merged" becomes "landed" wherever the file says it. */
function editedAlone(t, path) {
  const files = checkoutFiles();
  assertChecked(rules(tree(t, files)), 'a copy of this checkout\'s files');
  const text = files.get(path);
  const planted = text.replace(/\bmerged\b/g, 'landed').replace(/\bMerged\b/g, 'Landed');
  assert.notEqual(planted, text, `INCONCLUSIVE: ${path} doesn't say "merged", so its rule cannot be reworded this way`);
  assertFails(rules(tree(t, new Map(files).set(path, planted))), [CONTRIBUTING, SECURITY], `a tree whose ${path} alone words the rule differently`);
}

test('#2327.b5266f32 the rule reworded in CONTRIBUTING.md alone fails the text check; unchanged it passes', (t) => {
  editedAlone(t, CONTRIBUTING);
});

test('#2327.b5266f32 the rule reworded in SECURITY.md alone fails the text check; unchanged it passes', (t) => {
  editedAlone(t, SECURITY);
});
