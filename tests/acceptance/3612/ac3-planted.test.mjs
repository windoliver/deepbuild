// Criterion 3 of #3612 (#3612.5bdaac1f): "Each planted runner that fails a fixture's `logic.determinism` run on the
// merge base still fails it, naming the fixture: the run compares what it compared before, on the piece the bake
// checked"
//
// base.json lists every planted runner of `deep-logic` (`--planted <name>`) under which a shipped fixture's
// logic.determinism run fails on the merge base, at a pack's check and at a library's link, with the refusal the
// merge base gave: the fixture it names and the failures the run reported, which are what it compared (README: The
// recording). Each is asked again of this build, in a process of its own, and must be refused for the same fixture
// with the same failures. Then the control: one of those runners together with the base's own planted check that
// compares step hashes alone (`check_compares_step_hashes`) is a run that compares less than before, and the same
// judge must fail it, naming the fixture.
// Run: node --test tests/acceptance/3612/ac3-planted.test.mjs
import test from 'node:test';
import { AC, blocked, isObject, must } from './common.mjs';
import { judgePlanted, logicPacks, openLogic, plantedCall, plantedOf, recording } from './logic.mjs';

/** What `deep-logic --planted <each runner>` answers at `site` of the pack in `folder`, in a process of its own. */
async function asked(packs, runners, folder, site) {
  const lp = packs.find((pack) => pack.folder === folder);
  if (!lp) throw blocked(`base.json names ${folder}, which isn't a shipped pack with libraries or interfaces: it is the merge base's recording`);
  const { line, what } = plantedCall(lp, site);
  const logic = openLogic(runners);
  try {
    return { lp, answer: plantedOf(await logic.send(line, what)) };
  } finally {
    await logic.close();
  }
}

test(`AC3 ${AC[3]} each planted runner that fails a fixture's logic.determinism run on the merge base still fails it, naming the fixture, by what the run compared there`, { timeout: 10 * 60_000 }, async (t) => {
  const base = recording();
  const packs = logicPacks();
  if (!base.planted.length || !isObject(base.control)) throw blocked('base.json names no planted runner that fails a fixture\'s logic.determinism run on the merge base, or no control');
  const problems = [];
  for (const { runner, pack, site, varies, answer: was } of base.planted) {
    const { lp, answer } = await asked(packs, [runner], pack, site);
    problems.push(...judgePlanted(lp, runner, site, was, answer, varies === true));
  }
  const runners = [...new Set(base.planted.map(({ runner }) => runner))];
  t.diagnostic(`${base.planted.length} fixture runs asked again under ${runners.length} planted runners: ${runners.join(', ')}`);
  must(problems.length === 0, `AC3 ${AC[3]}: ${problems.length} of the ${base.planted.length} planted fixture runs that failed logic.determinism on the merge base (${base.commit.slice(0, 9)}, tests/acceptance/3612/base.json) ${problems.length === 1 ? 'doesn\'t' : 'don\'t'} fail as there:\n  ${problems.slice(0, 24).join('\n  ')}`);

  // The control: a run that compares less than it compared before must not pass this judge.
  const { runners: less, pack, site } = base.control;
  const kept = base.planted.find((entry) => entry.runner === less[0] && entry.pack === pack && entry.site === site);
  if (!kept) throw blocked(`base.json's control names ${less[0]} at ${site} of ${pack}, which it doesn't list`);
  const { lp, answer } = await asked(packs, less, pack, site);
  const caught = judgePlanted(lp, less[0], site, kept.answer, answer, kept.varies === true);
  must(caught.length > 0, `AC3 ${AC[3]}: the judge passed a logic.determinism run that compares step hashes alone (deep-logic --planted ${less.join(' --planted ')}, at ${site} of ${pack}): it answers as ${less[0]} alone did on the merge base, so nothing here shows the run compares what it compared before`);
  t.diagnostic(`the control fails as it must: ${caught[0]}`);
});
