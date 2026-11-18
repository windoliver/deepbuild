// AC3: every direct dependency scripts/repo-rules.json names and every adapter's name reads as not listed, and a planted
// hash of a dependency's name fails the public text lane, naming it. A name reads as listed when the lane, reading it as
// written in one line of public text, finds it: any of its words, the parts of a joined word, or a run of up to four of
// its words (README). The plant names a dependency the base already ships, so the name is public.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKOUT, LIST, adapterNames, cleanIssues, commit, dependencies, fakeGh, laneForms, makeCopy, plantHashes, plantedDependency, readList, runLanes, sandboxEnv, saltedHash, verdicts } from './helpers.mjs';

const LANE = 'public text';
const DEPENDENCY = plantedDependency(CHECKOUT);

test("#2405.2014d5d9 AC3: every direct dependency named in scripts/repo-rules.json and every adapter's name reads as not listed in scripts/studied-names.json", () => {
  const { salt, hashes } = readList(CHECKOUT);
  const listed = new Set(hashes);
  const deps = [...dependencies(CHECKOUT).keys()];
  const adapters = adapterNames(CHECKOUT);
  assert.ok(deps.length > 0 && adapters.length > 0, `read ${deps.length} dependencies from scripts/repo-rules.json and ${adapters.length} adapter names from adapters/`);
  // A list that holds a dependency's or an agent's name, or a word or part of one, fails here, naming it.
  const read = [...deps, ...adapters].filter((name) => laneForms(name).some((form) => listed.has(saltedHash(salt, form))));
  assert.deepEqual(read, [], `these dependency or adapter names read as listed in ${LIST}`);
});

test(`#2405.2014d5d9 AC3: the public text lane passes with the checkout's list, and fails, naming it, once a change plants the hash of the dependency ${DEPENDENCY}`, (t) => {
  assert.ok(DEPENDENCY, 'scripts/repo-rules.json names no one-word dependency to plant');
  const { sandbox, repo } = makeCopy(t);
  commit(repo, 'The base', { base: true });
  fakeGh(sandbox, cleanIssues());
  const env = sandboxEnv(sandbox);
  const before = runLanes(repo, env, [LANE]);
  // The twin: a lane that fails for some other reason fails here.
  assert.deepEqual(verdicts(before, LANE), ['PASS'], `the public text lane doesn't pass with the checkout's list and no change:\n${before.output}`);

  plantHashes(repo, [DEPENDENCY]);
  commit(repo, 'List one more name');
  const after = runLanes(repo, env, [LANE]);
  // A lane that never reads its list against the dependencies, or reads only some manifests or sections, passes here.
  assert.deepEqual(verdicts(after, LANE), ['FAIL'], `the public text lane doesn't fail on a list holding the dependency ${DEPENDENCY}:\n${after.output}`);
  assert.notEqual(after.status, 0, after.output);
  const named = new RegExp(`(?<![\\p{L}\\p{N}._/@-])${DEPENDENCY}(?![\\p{L}\\p{N}._/-])`, 'iu');
  assert.ok(after.lines.some((line) => named.test(line)), `no line of the public text lane's output names ${DEPENDENCY}:\n${after.output}`);
});
