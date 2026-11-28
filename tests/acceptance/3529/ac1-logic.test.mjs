import test from 'node:test';
import { AC, ISSUE_COMPILES, ISSUE_PROGRAMS, brief, must } from './common.mjs';
import { ISSUE, PACK_FOLDERS_THE_ISSUE_READ, compileCount, compileReadings, compiledAgainProblems, countsByPack, firstProgramNamed, logicPacks, openLogic } from './logic.mjs';

const MERGE_BASE_RUNNER = 'item_compiles_own_program';
const FIXTURE_RUN_OF_THE_ISSUES_MERGE_BASE = 'fixture_checks_piece_twice';

const sum = (runs, field) => runs.reduce((n, run) => n + run[field], 0);
const secondItems = (read) => `${read.again.length} library fixtures' pieces baked after their checks: ${sum(read.again, 'first')} compiles, and baked again: ${sum(read.again, 'made')}; two items of one program: ${read.pair.made.join(', then ')}`;

async function readingsUnderPlantedRunners(planted, whatIsMissingWithoutThem, packs, options) {
  const logic = openLogic(planted);
  try {
    const about = await logic.send({ call: 'about' }, 'about');
    must(about.interface === 'logic@1', `AC1 ${AC[1]}: ${logic.name} doesn't run: ${brief(about, 300)}. ${whatIsMissingWithoutThem}`);
    const first = await compileCount(logic);
    must(first.count !== null, `AC1 ${AC[1]}: no test can read how many compiles ${logic.name} counted: its compiles call answered ${brief(first.reply, 300)}, not {"ok": true, "compiles": <whole number>} (README: The count). ${whatIsMissingWithoutThem}`);
    return await compileReadings(logic, packs, options);
  } finally {
    await logic.close();
  }
}

test(`AC1 ${AC[1]} the logic module counts as many compiles as the shipped packs' checks compile different programs: ${ISSUE_PROGRAMS} for the ${ISSUE_PROGRAMS} of the packs the issue read, no more for a newer pack than its fixtures' different programs, and none for a second item of the same bytes`, { timeout: 12 * 60_000 }, async (t) => {
  const read = await readingsUnderPlantedRunners([], `Nothing shows each program was compiled once; the issue reads ${ISSUE_COMPILES} compiles for ${ISSUE_PROGRAMS} different programs on the merge base it was written on`, logicPacks());
  t.diagnostic(`compiles by pack: ${countsByPack(read.checks)}; ${secondItems(read)}`);
  const problems = compiledAgainProblems(read);
  const twice = firstProgramNamed(problems);
  must(problems.length === 0, `AC1 ${AC[1]}: the shipped packs' checks counted ${read.made} compiles, ${read.madeOnPacksTheIssueRead} of them for the packs the issue read; ${ISSUE}.${twice ? ` A program compiled twice: ${twice}.` : ''}\n  ${problems.slice(0, 24).join('\n  ')}`);
  must(read.madeOnPacksTheIssueRead === ISSUE_PROGRAMS, `AC1 ${AC[1]}: the checks of the ${PACK_FOLDERS_THE_ISSUE_READ.length} packs the issue read counted ${read.madeOnPacksTheIssueRead} compiles; ${ISSUE}, one compile each (${countsByPack(read.checks)})`);
});

test(`AC1 ${AC[1]} the merge base's runner, planted, counts more compiles than different programs and fails, naming a program compiled twice, and with its fixture run that checks a piece twice it counts the issue's ${ISSUE_COMPILES} for ${ISSUE_PROGRAMS} on the packs the issue read`, { timeout: 12 * 60_000 }, async (t) => {
  const withoutIt = `The merge base can't be read with a count without the planted runner ${MERGE_BASE_RUNNER} (README: The planted runners)`;
  const base = await readingsUnderPlantedRunners([MERGE_BASE_RUNNER], withoutIt, logicPacks());
  t.diagnostic(`planted ${MERGE_BASE_RUNNER}, compiles by pack: ${countsByPack(base.checks)}; ${secondItems(base)}`);
  must(base.madeOnPacksTheIssueRead > ISSUE_PROGRAMS, `AC1 ${AC[1]}: the planted runner ${MERGE_BASE_RUNNER} counted ${base.madeOnPacksTheIssueRead} compiles on the checks of the packs the issue read, no more than the ${ISSUE_PROGRAMS} different programs they compile: it isn't the merge base's runner, which compiles a program for each item that runs it (${countsByPack(base.checks)})`);
  const problems = compiledAgainProblems(base);
  must(problems.length > 0, `AC1 ${AC[1]}: the judge passed the planted runner ${MERGE_BASE_RUNNER}, which compiles a program for each item that runs it: ${base.made} compiles on the shipped packs' checks`);
  const twice = firstProgramNamed(problems);
  must(twice !== null, `AC1 ${AC[1]}: the planted runner ${MERGE_BASE_RUNNER} fails, but no program is named as compiled twice:\n  ${problems.slice(0, 12).join('\n  ')}`);
  t.diagnostic(`the judge fails the planted runner, naming program ${twice}: ${problems.length} problems, the first: ${problems[0]}`);

  const issue = await readingsUnderPlantedRunners([MERGE_BASE_RUNNER, FIXTURE_RUN_OF_THE_ISSUES_MERGE_BASE], withoutIt, logicPacks().filter((pack) => pack.readByIssue), { again: false });
  t.diagnostic(`planted ${MERGE_BASE_RUNNER} and ${FIXTURE_RUN_OF_THE_ISSUES_MERGE_BASE}, compiles by pack: ${countsByPack(issue.checks)}`);
  must(issue.made === ISSUE_COMPILES, `AC1 ${AC[1]}: the planted runners ${MERGE_BASE_RUNNER} and ${FIXTURE_RUN_OF_THE_ISSUES_MERGE_BASE} together counted ${issue.made} compiles on the checks of the ${PACK_FOLDERS_THE_ISSUE_READ.length} packs the issue read, where the merge base the issue read counts ${ISSUE_COMPILES} for ${ISSUE_PROGRAMS} different programs: ${MERGE_BASE_RUNNER} isn't that merge base's runner (${countsByPack(issue.checks)})`);
});
