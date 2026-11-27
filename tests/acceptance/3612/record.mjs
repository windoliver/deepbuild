// Records the merge base's own values for criteria 2 and 3 of #3612 into base.json (README: The recording), from
// the `deep-logic` of a checkout at the merge base, through the functions the tests read this build with (logic.mjs).
//
//   node tests/acceptance/3612/record.mjs            writes base.json; only in a checkout whose HEAD is the merge base
//   node tests/acceptance/3612/record.mjs --check    records again and compares with base.json; writes nothing
//
// It builds nothing unless `deep-logic` is missing from target/debug (or from DEEP_BIN_DIR). What it records:
//
// - `fixtures`: for each shipped pack with libraries or interfaces, what its check answers (each fixture's verdict
//   and full-state hashes by step, each planted library's first failed fixture, each kit twin's rules), and for each
//   fixture a shipped library runs, its piece's hash at every step, its checkpoints, its traps and its
//   logic.determinism verdict.
// - `planted`: every planted runner `crates/deep-logic/src/planted.rs` names, tried on every shipped pack's check and
//   every shipped library's link; one entry for each that is refused there for a fixture failing logic.determinism,
//   with the refusal. Each entry is asked three times, each in a process of its own; `varies` marks one whose
//   failures differ between them.
// - `control`: the first of those entries that the judge fails when the runner is joined by the base's own
//   `check_compares_step_hashes`, a logic.determinism that compares step hashes alone.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, same } from './common.mjs';
import { failsDeterminism, judgeFixtures, judgePlanted, logicPacks, openLogic, plantedCall, plantedOf, readFixtures } from './logic.mjs';

/** The merge base this suite was written at. */
const BASE = 'fd2899677b778284ddc6e860010b8831823b3901';
const FILE = fileURLToPath(new URL('./base.json', import.meta.url));
/** A planted runner's call that hasn't answered by then is left out, and named. */
const CALL_MS = 3 * 60_000;
const HASHES_ONLY = 'check_compares_step_hashes';
const say = (text) => process.stderr.write(`${text}\n`);

const check = process.argv.includes('--check');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
if (!check && head !== BASE) {
  say(`BLOCKED: base.json holds the merge base's values (${BASE}); this checkout is at ${head}. Record in a checkout at the merge base, or compare with --check.`);
  process.exit(2);
}

const packs = logicPacks();
const packOf = (folder) => packs.find((lp) => lp.folder === folder);

/** What `deep-logic --planted <runners>` answers at each of `sites` (`[folder, site]`), in one process: an answer, or null for none in time. */
async function answers(runners, sites) {
  const logic = openLogic(runners);
  const out = [];
  try {
    for (const [folder, site] of sites) {
      const { line, what } = plantedCall(packOf(folder), site);
      try {
        out.push(plantedOf(await logic.send(line, what, CALL_MS)));
      } catch (error) {
        say(`  ${runners.join(' + ')}: ${error.message}`);
        out.push(null);
        break;
      }
    }
  } finally {
    await logic.close();
  }
  return out;
}

const logic = openLogic();
let fixtures;
try {
  fixtures = await readFixtures(logic, packs);
} finally {
  await logic.close();
}
say(`fixtures: ${packs.length} packs, ${Object.values(fixtures).reduce((n, pack) => n + pack.runs.length, 0)} library fixtures`);

// Every planted runner the binary names, on every site.
const names = [...readFileSync(join(REPO, 'crates', 'deep-logic', 'src', 'planted.rs'), 'utf8').matchAll(/^\s*"([a-z0-9_]+)" => /gm)].map(([, name]) => name);
const sites = packs.flatMap((lp) => [[lp.folder, 'check'], ...Object.entries(lp.pack.libs).filter(([, l]) => (l.fixtures ?? []).length).map(([label]) => [lp.folder, label])]);
const fails = (answer) => answer !== null && answer.ok !== true && failsDeterminism(answer.refusals[0]);
const planted = [];
for (const runner of names) {
  // One process for the checks and one for the links finds the sites; each found site is then asked alone.
  const found = [];
  for (const group of [sites.filter(([, site]) => site === 'check'), sites.filter(([, site]) => site !== 'check')]) {
    const got = await answers([runner], group);
    group.forEach((at, n) => { if (fails(got[n] ?? null)) found.push(at); });
  }
  for (const [folder, site] of found) {
    const [first, second, third] = [(await answers([runner], [[folder, site]]))[0], (await answers([runner], [[folder, site]]))[0], (await answers([runner], [[folder, site]]))[0]];
    if (![first, second, third].every(fails) || ![second, third].every((a) => a.refusals[0].fixture === first.refusals[0].fixture)) {
      say(`  ${runner} at ${site} of ${folder}: not one fixture's logic.determinism failure in each of three processes of its own; left out`);
      continue;
    }
    const varies = !same(first, second) || !same(first, third);
    planted.push({ runner, pack: folder, site, ...(varies ? { varies: true } : {}), answer: first });
  }
  say(`planted ${runner}: ${found.length ? found.map(([folder, site]) => `${site} of ${folder}`).join(', ') : 'fails no fixture\'s logic.determinism run'}`);
}

// The control: the first entry the judge fails once logic.determinism compares step hashes alone.
let control = null;
for (const entry of planted) {
  if (entry.runner === HASHES_ONLY) continue;
  const [less] = await answers([entry.runner, HASHES_ONLY], [[entry.pack, entry.site]]);
  if (less !== null && judgePlanted(packOf(entry.pack), entry.runner, entry.site, entry.answer, less, entry.varies === true).length) {
    control = { runners: [entry.runner, HASHES_ONLY], pack: entry.pack, site: entry.site };
    break;
  }
}
say(`control: ${control ? `${control.runners.join(' + ')} at ${control.site} of ${control.pack}` : 'none found'}`);

if (check) {
  const kept = JSON.parse(readFileSync(FILE, 'utf8'));
  const problems = judgeFixtures(packs, kept.fixtures, fixtures);
  const stable = (list) => list.map((entry) => (entry.varies ? { ...entry, answer: { ...entry.answer, refusals: entry.answer.refusals.map((r) => ({ ...r, failures: null, what: null })) } } : entry));
  if (!same(stable(kept.planted), stable(planted))) problems.push(`the planted runners differ: ${kept.planted.length} kept, ${planted.length} now (${planted.filter((e) => !kept.planted.some((k) => same(stable([k]), stable([e])))).map((e) => `${e.runner} at ${e.site} of ${e.pack}`).join('; ') || 'the kept list holds more'})`);
  if (!same(kept.control, control)) problems.push(`the control differs: ${JSON.stringify(kept.control)} kept, ${JSON.stringify(control)} now`);
  for (const problem of problems) console.log(`DIFFERS ${problem}`);
  console.log(problems.length ? `${problems.length} differences from base.json (recorded at ${kept.commit}; this checkout is at ${head})` : `same as base.json (recorded at ${kept.commit}; this checkout is at ${head}): ${packs.length} packs, ${planted.length} planted fixture runs`);
  process.exit(problems.length ? 1 : 0);
}

// One fixture run, one planted entry a line.
const lines = ['{', `"commit": ${JSON.stringify(head)},`, '"command": "node tests/acceptance/3612/record.mjs",', '"fixtures": {'];
packs.forEach((lp, n) => {
  const { check: answered, runs } = fixtures[lp.folder];
  lines.push(`${JSON.stringify(lp.folder)}: {"check": ${JSON.stringify(answered)}, "runs": [`, runs.map((run) => JSON.stringify(run)).join(',\n'), `]}${n + 1 < packs.length ? ',' : ''}`);
});
lines.push('},', '"planted": [', planted.map((entry) => JSON.stringify(entry)).join(',\n'), '],', `"control": ${JSON.stringify(control)}`, '}');
writeFileSync(FILE, `${lines.join('\n')}\n`);
say(`wrote ${FILE.slice(REPO.length + 1)}: ${planted.length} planted fixture runs`);
