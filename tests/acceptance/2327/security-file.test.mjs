// #2327 acceptance, criterion 1 (#2327.9c7a145b): SECURITY.md has its four parts in under a page,
// `node scripts/repo-rules.mjs` passes its check on this checkout, and a planted tree without the
// file, or whose file names no route, fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { REPOSITORY, ROUTE, SECURITY, assertChecked, assertFails, checkoutFiles, read, root, rules, tree } from './helpers.mjs';

// "Naming the missing part": the route, by that word or as the form it is (README: reading 6).
const ROUTE_PART = /route|private report|advisor/i;

test('#2327.9c7a145b SECURITY.md at the root has the four parts, in under a page', () => {
  const text = read(SECURITY);
  assert.ok(text !== null, 'SECURITY.md is missing at the root');
  for (const [what, pattern] of [
    ['a way past a guard', /\bguard\b/i], ['or the hook', /\bhook\b/i], ['out of the sandbox', /\bsandbox\b/i], ['onto the trusted card', /trusted card/i],
    ['to a credential', /\bcredentials?\b/i], ["or another session's data", /\bsession/i],
  ]) assert.match(text, pattern, `part 1, what to report privately: SECURITY.md doesn't name "${what}"`);
  assert.ok(text.includes(ROUTE), `part 2, the route: SECURITY.md doesn't name the private report form for this repository, ${ROUTE}`);
  assert.match(text, /acknowledge?ment/i, 'part 3, what the reporter hears back: SECURITY.md names no acknowledgement');
  assert.match(text, /\b(?:three|3) working days\b/i, 'part 3, by when: SECURITY.md doesn\'t say "three working days"');
  assert.match(text, /public issue/i, 'part 4: SECURITY.md doesn\'t say that everything else is a public issue');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0), count = text.split(/\s+/).filter(Boolean).length;
  assert.ok(lines <= 60 && count <= 700, `under a page is at most 60 lines and 700 words; SECURITY.md has ${lines} lines and ${count} words`);
});

test('#2327.9c7a145b node scripts/repo-rules.mjs passes its security check on this checkout', () => {
  assertChecked(rules(root), 'this checkout');
});

test('#2327.9c7a145b a planted tree without SECURITY.md fails, naming the file; with it the tree passes', (t) => {
  const files = checkoutFiles();
  const planted = new Map(files);
  planted.delete(SECURITY);
  assertFails(rules(tree(t, planted)), SECURITY, 'a tree without SECURITY.md');
  assert.ok(files.has(SECURITY), 'SECURITY.md is missing at the root, so the tree with it cannot be made');
  assertChecked(rules(tree(t, files)), 'a copy of this checkout\'s files');
});

test('#2327.9c7a145b a planted SECURITY.md that names no route fails, naming the missing part; unchanged it passes', (t) => {
  const files = checkoutFiles();
  assertChecked(rules(tree(t, files)), 'a copy of this checkout\'s files');
  const text = files.get(SECURITY);
  // Only the route goes: every spelling of the form's address, with or without its scheme and host.
  const planted = text.replace(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/security\/advisories(?:\/new)?/gi, '').replace(/\/?security\/advisories(?:\/new)?/gi, '');
  assert.notEqual(planted, text, 'INCONCLUSIVE: SECURITY.md has no private report form address to take out');
  assertFails(rules(tree(t, new Map(files).set(SECURITY, planted))), SECURITY, 'a SECURITY.md with its route taken out', ROUTE_PART);
});

test("#2327.9c7a145b a planted SECURITY.md whose only route is another repository's form fails, naming the missing part", (t) => {
  const files = checkoutFiles();
  assertChecked(rules(tree(t, files)), 'a copy of this checkout\'s files');
  const text = files.get(SECURITY);
  const planted = text.split(`github.com/${REPOSITORY}/security/advisories`).join('github.com/example-owner/example-repository/security/advisories');
  assert.notEqual(planted, text, `INCONCLUSIVE: SECURITY.md doesn't name ${ROUTE}`);
  assertFails(rules(tree(t, new Map(files).set(SECURITY, planted))), SECURITY, "a SECURITY.md that names another repository's form", ROUTE_PART);
});
