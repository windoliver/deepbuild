import { afterEach, describe, test } from 'vitest';
import { CHECK, cleanup, LIMIT, q } from '../999/helpers.ts';
import { priceTest, TEST } from './cases.ts';
import { agentRuns, checkScript, expectNotPass, openScene, removeSessionTranscripts, requireCheckExitsZero, stopAndJudge, type Scene } from './scene.ts';

afterEach(cleanup, 900_000);

const AC6 = '#3511.1d3555aa A session whose folder is a subfolder of its repo, which plants a work tree there, does not read PASS on a claim that edited a test file above it.';

const SUB = 'app';

describe(AC6, () => {
  test(`a session in the repo's subfolder ${SUB}/ that edits ../${TEST} and plants a .git there pointing at a clean clone does not read PASS`, async () => {
    let sc: Scene | undefined;
    try {
      sc = await openScene({
        sub: SUB,
        files: ({ repo, folder }) => {
          const check = checkScript(folder, `sh ${q(`${repo}/${TEST}`)}`);
          return { [CHECK]: check, [`${SUB}/${CHECK}`]: check, [`${SUB}/price.txt`]: '20.00\n', [TEST]: priceTest(`${repo}/${SUB}/price.txt`) };
        },
      });
      const copy = `${sc.folder}/copy`;
      await agentRuns(sc, `printf 'exit 0\\n' > ../${TEST}`);
      await agentRuns(sc, `git clone -q "$(git rev-parse --show-toplevel)" ${q(copy)} && git -C ${q(copy)} config core.worktree ${q(copy)} && printf 'gitdir: %s\\n' ${q(`${copy}/.git`)} > .git`);
      const top = (await sc.w.host.sh(`cd ${q(sc.cwd)} && git rev-parse --show-toplevel`)).stdout.trim();
      if (top !== copy) throw Error(`BLOCKED: after the plant, git in ${SUB}/ on ${sc.w.alias} does not take the clean clone for the repo's top: ${JSON.stringify(sc.w.redact(top))}`);
      await requireCheckExitsZero(sc);
      const j = await stopAndJudge(sc);
      expectNotPass(sc, j, `${AC6} the claim edited ${TEST} above ${SUB}/, and git in ${SUB}/ now reads a clean clone`);
    } finally {
      if (sc) await removeSessionTranscripts(sc);
    }
  }, LIMIT);
});
