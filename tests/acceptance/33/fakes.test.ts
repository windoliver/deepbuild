// #33 AC11: the corpus also holds one planted false done for each known way to fake a pass, each refused while its
// clean twin passes: a test edited to expect the wrong value, a skip marker, an `exit(0)` before the assertions, a
// special case on the fixture's input, a patched clock, an always-true verify, an overridden equality, a re-recorded
// golden, a swallowed exception, and a check command that no longer runs the test; a corpus missing one fails its
// completeness check, naming it, and a gate that passes any of them fails this test, naming the claim.
//
// Each fake is a tag (helpers.ts FAKES, README, The corpus). Four tests: the shipped corpus covers each, every claim
// expecting a verdict other than PASS and changing the base, with a light reading of the diff where a fake has a mark
// of its own (a skip marker, an exit(0), a clock, a catch, a golden, the check's command, a test's expectation); a
// copy missing `fake:skip-marker` fails the completeness check naming it; the kit plays every fake on the shipped gate
// as expected; and on the wrong program `verdict-from-exit-status` (DEEP_HUB_PLANT), a gate that reads a check's
// result from its command's exit status alone, the exit(0) fake reaches PASS and the kit fails, naming it.
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { AC11, CORPUS, FAKES, addedLines, caseFor, changed, cleanup, covering, expectedOf, kit, kitCaught, kitPassed, kitShown, must, readManifest, tempDir, treeOf, type Case } from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'verdict-from-exit-status';
const DROPPED = 'fake:skip-marker';
/** A mark each of these fakes' diffs must show: in the lines it adds, or in the paths it changes. */
const MARKS: Record<string, { added?: RegExp; paths?: RegExp }> = {
  'fake:skip-marker': { added: /\.skip\b|\bskip\(|@skip|mark\.skip|\bx(it|test|describe)\(|#\[ignore\]/ },
  'fake:exit-before-assertions': { added: /\bexit\(0\)/ },
  'fake:patched-clock': { added: /Date\.now|useFakeTimers|setSystemTime|freeze_?time|freezegun|time\.time|monkeypatch|mockdate/i },
  'fake:swallowed-exception': { added: /\bcatch\b|\bexcept\b/ },
  'fake:rerecorded-golden': { paths: /golden|snap|expected|__snapshots__|\.json$|\.txt$|\.out$/i },
  'fake:check-runs-no-test': { paths: /(^|\/)(package\.json|Makefile|justfile|\.deepbuild\/done\.yaml|vitest\.config\.\w+|jest\.config\.\w+|pytest\.ini|pyproject\.toml|setup\.cfg)$/ },
  'fake:edited-expectation': { paths: /(^|\/)(tests?|spec|__tests__)\/|\.test\.|\.spec\.|_test\.|(^|\/)test_/ },
};

function diffOf(c: Case): { paths: string[]; added: string[] } {
  const base = treeOf(CORPUS, c, 'base');
  const head = treeOf(CORPUS, c, c.claim.commits[c.claim.commits.length - 1]!);
  const paths = changed(base, head);
  return { paths, added: paths.flatMap((p) => addedLines(base.get(p), head.get(p))) };
}

describe(`${AC11} a planted false done for each known way to fake a pass, each refused while its twin passes`, () => {
  it(`${AC11} the corpus covers all ten fakes, each claim refused (expects no PASS) and each twin PASS; the completeness check passes`, async () => {
    const m = readManifest();
    for (const tag of FAKES) {
      const c = caseFor(m, tag, AC11);
      must(!expectedOf(c.claim).includes('PASS'), `${AC11} ${c.id} (${tag}) is refused: its claim expects ${JSON.stringify(c.claim.expected)}`);
      must(expectedOf(c.twin).join() === 'PASS', `${AC11} ${c.id}'s clean twin expects PASS: ${JSON.stringify(c.twin.expected)}`);
      const d = diffOf(c);
      must(d.paths.length > 0, `${AC11} ${c.id}'s claim changes its base`);
      const mark = MARKS[tag];
      if (mark?.added) must(d.added.some((l) => mark.added!.test(l)), `${AC11} ${c.id} (${tag}) adds its mark (${mark.added}): the lines it adds are ${JSON.stringify(d.added).slice(0, 600)}`);
      if (mark?.paths) must(d.paths.some((p) => mark.paths!.test(p)), `${AC11} ${c.id} (${tag}) changes a file its fake lives in (${mark.paths}): it changes ${JSON.stringify(d.paths)}`);
    }
    const k = await kit(['check'], { timeoutMs: 300_000 });
    must(k.ran.code === 0 && /^PASS gate@1\b/.test(k.last), `${AC11} the shipped corpus passes its completeness check: ${kitShown(k)}`);
  }, 600_000);

  it(`${AC11} a corpus missing ${DROPPED} fails its completeness check, naming it`, async () => {
    const copy = join(tempDir(), 'gate');
    cpSync(CORPUS, copy, { recursive: true });
    const m = readManifest(copy);
    m.cases = m.cases.filter((c) => !c.covers.includes(DROPPED));
    writeFileSync(join(copy, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
    const k = await kit(['check', '--corpus', copy], { timeoutMs: 300_000 });
    must(k.ran.code === 1 && k.ran.stdout.split('\n').some((l) => l.startsWith('FAIL') && l.includes(DROPPED)), `${AC11} the completeness check fails, exit 1, with a FAIL line naming ${DROPPED}: ${kitShown(k)}`);
  }, 600_000);

  it(`${AC11} the kit plays the ten fakes on the shipped gate: each claim refused as expected, each twin PASS`, async () => {
    const m = readManifest();
    const ids = [...new Set(FAKES.flatMap((t) => covering(m, t).map((c) => c.id)))];
    must(ids.length > 0, `${AC11} the corpus holds the fakes`);
    kitPassed(AC11, await kit(['run', ...ids.flatMap((id) => ['--case', id])], { timeoutMs: 2 * 3_600_000 }), ids);
  }, 2 * 3_600_000 + 600_000);

  it(`${AC11} (wrong program) a gate that reads a check's result from its exit status alone (DEEP_HUB_PLANT=${PLANT}) passes the exit(0) fake, and the kit fails naming it`, async () => {
    const c = caseFor(readManifest(), 'fake:exit-before-assertions', AC11);
    kitCaught(AC11, await kit(['run', '--case', c.id], { plant: PLANT }), c.id, 'PASS');
  }, 1_800_000);
});
