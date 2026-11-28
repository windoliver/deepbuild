import test from 'node:test';
import { AC, ISSUE_COMPILES, ISSUE_PROGRAMS, blocked, brief, must } from './common.mjs';
import { compileCountOf, openCore } from './core.mjs';
import { PACK_FOLDERS_THE_ISSUE_READ, compileCount, compileReadings, compiledAgainProblems, countsByPack, firstProgramNamed, logicPacks, openLogic, shippedPacks } from './logic.mjs';

async function readingsOnDeepLogicOfTheSameBuild(packs, options) {
  const logic = openLogic();
  try {
    const first = await compileCount(logic);
    must(first.count !== null, `AC1 ${AC[1]}: the canvas core answers a compile count and deep-logic of the same build doesn't: its compiles call answered ${brief(first.reply, 300)}, not {"ok": true, "compiles": <whole number>} (README: The count), so what the checks of the packs the issue didn't read count can't be taken off the core's count`);
    return await compileReadings(logic, packs, options);
  } finally {
    await logic.close();
  }
}

test(`AC1 ${AC[1]} a fresh canvas core with the shipped packs answers its first call having counted as many compiles as it compiled different programs: ${ISSUE_PROGRAMS} for the ${ISSUE_PROGRAMS} of the packs the issue read, beside what a newer pack's own check counts`, { timeout: 20 * 60_000 }, async (t) => {
  const shipped = shippedPacks();
  const core = await openCore(shipped.map(({ id, dir }) => ({ id, dir })));
  let count;
  try {
    const first = await core.call({ call: 'packs' });
    const rows = Array.isArray(first.reply?.packs) ? first.reply.packs : null;
    if (first.ok !== true || !rows) throw blocked(`the core's first call, packs, gave no pack rows: ${brief(first)}`);
    const left = shipped.filter(({ id, manifest }) => !rows.some((row) => row.pack === id && row.version === manifest.version && row.state === 'installed'));
    if (left.length) throw blocked(`the core didn't install ${left.length} of the ${shipped.length} shipped packs, so its count isn't the shipped packs': ${left.map(({ folder, id }) => `${folder} (${brief(rows.find((row) => row.pack === id && row.version === shipped.find((pack) => pack.folder === folder).manifest.version)?.issues ?? 'no row', 300)})`).join('; ')}`);
    const answer = await core.call({ call: 'compiles' });
    count = compileCountOf(answer);
    must(count !== null, `AC1 ${AC[1]}: the canvas core answered its first call, with all ${shipped.length} shipped packs installed, and no test can read how many compiles it counted: its compiles call answered ${brief(answer, 300)}, not {"ok": true, "reply": {"compiles": <whole number>}} (README: The count). Nothing shows it compiled each program once; the issue reads ${ISSUE_COMPILES} compiles for ${ISSUE_PROGRAMS} different programs on the merge base it was written on`);
  } finally {
    await core.close();
  }
  const sameChecksOnDeepLogic = await readingsOnDeepLogicOfTheSameBuild(logicPacks(), { again: false });
  const newerPacks = sameChecksOnDeepLogic.checks.filter((check) => !check.readByIssue);
  const onNewerPacks = sameChecksOnDeepLogic.made - sameChecksOnDeepLogic.madeOnPacksTheIssueRead;
  const onPacksTheIssueRead = count - onNewerPacks;
  const shareOfNewerPacks = `deep-logic of the same build, checking the same packs in one process, counts ${onNewerPacks} for the packs the issue didn't read (${countsByPack(newerPacks) || 'none'})`;
  t.diagnostic(`the core counted ${count} compiles before its first answer; ${shareOfNewerPacks}, which leaves ${onPacksTheIssueRead} for the ${PACK_FOLDERS_THE_ISSUE_READ.length} it read`);
  if (onPacksTheIssueRead === ISSUE_PROGRAMS) return;
  let which;
  try {
    const read = await readingsOnDeepLogicOfTheSameBuild(logicPacks());
    const problems = compiledAgainProblems(read);
    const twice = firstProgramNamed(problems);
    which = twice
      ? `A program compiled twice: ${twice}. On deep-logic of the same build the checks counted ${read.made} compiles (${countsByPack(read.checks)}), and ${problems.slice(0, 4).join('; ')}`
      : `On deep-logic of the same build the checks counted ${read.made} compiles (${countsByPack(read.checks)}) and no second item of the same bytes was compiled again, so no one program is named`;
  } catch (error) {
    which = `No program could be named on deep-logic of the same build: ${error.message}`;
  }
  must(false, `AC1 ${AC[1]}: a fresh canvas core with the ${shipped.length} shipped packs counted ${count} compiles before its first answer; ${shareOfNewerPacks}, which leaves ${onPacksTheIssueRead} for the ${PACK_FOLDERS_THE_ISSUE_READ.length} packs the issue read, where their checks compile ${ISSUE_PROGRAMS} different programs (the issue's count). ${which}`);
});
