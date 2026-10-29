// #23.cf7a32f5 "Merge #215?" is answered by the decision that covers your own fix PRs, whatever the number;
// #23.eba26419 never a PR another thread opened or one past its size and kind bounds; #23.b439b4e7 never a
// change that touches a CI workflow file, which reaches you naming it. "Never" is held by generated properties.

import fc from 'fast-check';
import { expect, test } from 'vitest';
import { FIX_40, HOUR, inWorld, mergeAsk, reachesYou, REPO_A, type World } from './helpers.ts';
import { mergeAnyNumber, mergeCiFile, mergeNotOthers } from './scenarios.ts';

test('#23.cf7a32f5 "Merge #215?" and "Merge #9001?" are answered by the saved decision that covers your own fix PRs, whatever the PR number', async () => {
  await inWorld(mergeAnyNumber);
});

test('#23.eba26419 the decision to merge your own fix PRs never answers for a PR another thread opened, a 4,000-line fix or a feature: each merge reaches you', async () => {
  await inWorld(mergeNotOthers);
});

test('#23.b439b4e7 the decision answers "Merge #215?" for a 30-line fix, and the same fix plus one changed line in .github/workflows/release.yml reaches you, naming that file', async () => {
  await inWorld(mergeCiFile);
});

/** Your yes to "Merge #212?", a 40-line fix thread T1 opened, in session S1 of repo A; S2 is thread T2's session there. */
async function decided(w: World): Promise<void> {
  await w.start('S1', 'T1', REPO_A);
  await w.start('S2', 'T2', REPO_A);
  const m212 = await w.raise('S1', 'effect.merge', mergeAsk(212, 'T1', FIX_40, w.clock.now()));
  await w.answer(m212, 'merge');
  w.clock.set(w.clock.now() + HOUR);
}

// Generator: one merge question in thread T1 after your yes to a 40-line fix T1 opened: a PR number, the thread
// that opened it (T1 or T2), the kind of change (fix, feature or docs) and its size, either within the 40 lines
// the decision was saved from or 4,000 lines and up. Holds: it is answered for you exactly when T1 opened it, it is
// a fix and it is within 40 lines; otherwise it reaches you. The bound itself is DeepBuild's to set, so no size
// between 41 and 3,999 lines is generated.
const NEVER_SEED = 0x23_10;
const merge = fc.record({
  pr: fc.integer({ min: 213, max: 99_999 }),
  opener: fc.constantFrom('T1', 'T2'),
  kind: fc.constantFrom('fix', 'feature', 'docs'),
  lines: fc.oneof(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 4000, max: 20_000 })),
});

test('#23.eba26419 property: a saved decision to merge your own fix PRs answers only PRs this thread opened within its size and kind bounds; every other merge reaches you', async () => {
  await fc.assert(fc.asyncProperty(merge, async (m) => {
    await inWorld(async (w) => {
      await decided(w);
      const ask = await w.raise('S1', 'effect.merge', mergeAsk(m.pr, m.opener, { kind: m.kind, lines: m.lines, paths: ['src/cart/sum.ts'] }, w.clock.now()));
      const covered = m.opener === 'T1' && m.kind === 'fix' && m.lines <= 40;
      const what = `"Merge #${m.pr}?", a ${m.lines}-line ${m.kind} thread ${m.opener} opened`;
      if (!covered) await reachesYou(w, ask, what);
      else expect([(await w.row(ask)).outcome, w.deliveries.filter((d) => d.ask === ask).map((d) => d.option)], `${what} is answered for you`).toEqual(['decided_for_you', ['merge']]);
    });
  }), { seed: NEVER_SEED, numRuns: 100 });
}, 600_000);

// Generator: a fix thread T1 opened within the decision's 40 lines, touching one or two CI workflow files
// (.github/workflows/<name>.yml or .yaml, or .gitlab-ci.yml) among other paths. Holds: it reaches you, and its card
// names exactly the CI files.
const CI_SEED = 0x23_11;
const ciFile = fc.oneof(
  fc.tuple(fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/), fc.constantFrom('yml', 'yaml')).map(([name, ext]) => `.github/workflows/${name}.${ext}`),
  fc.constant('.gitlab-ci.yml'),
);
const touching = fc.record({
  ci: fc.uniqueArray(ciFile, { minLength: 1, maxLength: 2 }),
  code: fc.subarray(['src/cart/sum.ts', 'src/cart/sum.test.ts', 'README.md', 'docs/release.md'], { minLength: 0 }),
  lines: fc.integer({ min: 1, max: 40 }),
  pr: fc.integer({ min: 213, max: 99_999 }),
});

test('#23.b439b4e7 property: a saved decision to merge never covers a change that touches a CI workflow file, whatever its size; the merge reaches you naming the files', async () => {
  await fc.assert(fc.asyncProperty(touching, async (c) => {
    await inWorld(async (w) => {
      await decided(w);
      const paths = [...c.code, ...c.ci];
      const ask = await w.raise('S1', 'effect.merge', mergeAsk(c.pr, 'T1', { kind: 'fix', lines: c.lines, paths }, w.clock.now()));
      const card = await reachesYou(w, ask, `"Merge #${c.pr}?", a ${c.lines}-line fix touching ${paths.join(', ')}`);
      expect([...card.needs_person].sort(), `the card of ${ask} names the CI files`).toEqual([...c.ci].sort());
    });
  }), { seed: CI_SEED, numRuns: 100 });
}, 600_000);
