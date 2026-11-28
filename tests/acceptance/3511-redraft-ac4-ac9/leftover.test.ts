import { afterEach, describe, expect, test } from 'vitest';
import { CHECK, cleanup, LIMIT, q } from '../999/helpers.ts';
import { BASE_TEST, TEST } from './cases.ts';
import { checkScript, openScene, shownJudged, stopAndJudge } from './scene.ts';

afterEach(cleanup, 900_000);

const AC9 = "#3511.aeb1c56e On a host, a code-only claim made after another claim's check left an untracked file under a test folder reads PASS.";

const LEFT = 'test/last-run.log';

describe(AC9, () => {
  test(`a code-only claim on the host, made after the first claim's check left ${LEFT} untracked in the session's folder, reads PASS`, async () => {
    const sc = await openScene({
      files: ({ repo, folder }) => {
        const log = q(`${repo}/${LEFT}`);
        return { [CHECK]: checkScript(folder, `sh ${TEST} > ${log} 2>&1; s=$?; cat ${log}; exit "$s"`), [TEST]: BASE_TEST };
      },
    });
    await sc.s.edit('price.txt', '18.00\n');
    const first = await stopAndJudge(sc);
    const left = await sc.w.host.sh(`cd ${q(sc.repo)} && test -f ${LEFT} && ! git ls-files --error-unmatch ${LEFT} > /dev/null 2>&1`);
    if (left.code !== 0) throw Error(`BLOCKED: the first claim's check left no untracked ${LEFT} in the session's folder on ${sc.w.alias}: ${shownJudged(sc, first)}`);
    await sc.s.edit('price.txt', '17.00\n');
    const second = await stopAndJudge(sc);
    expect(first.outcome, `${AC9} (control) the first claim, made while price.txt holds 18.00, reads FAIL by its check on the host: ${shownJudged(sc, first)}`).toBe('FAIL');
    expect(second.outcome, `${AC9} the second claim changes only price.txt, to 17.00, and reads PASS though ${LEFT}, which the first claim's check wrote, is untracked under test/: ${shownJudged(sc, second)}`).toBe('PASS');
  }, LIMIT);
});
