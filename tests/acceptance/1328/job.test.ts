// #1328 AC1 to AC3: the job itself. Each test starts it through a real hub on a real repository, with a stand-in agent
// doing what its plan says under the real sandbox, and reads the job's record, its result and the repository's refs.
import { afterAll, describe, expect, it } from 'vitest';
import {
  BLUE, byRef, everything, firstDraft, folderOf, git, HOLLOW, ISSUE, LIMIT, NEW, removeTemp, SAME, tagOf, widgetFile, widgetTest, withStage, type Session,
} from './helpers.ts';

afterAll(removeTemp, 60_000);

/** A job that also reads `target`: the sandbox stops the read, and the hub refuses the job, naming it. */
async function refusedRead(target: (session: Session) => string): Promise<void> {
  await withStage({}, async (s) => {
    const path = target(s.session());
    const refs = s.refs();
    s.plans.push({ ...firstDraft(ISSUE), reads: [path] });
    await s.start();
    const status = await s.judged();
    const read = (await s.saw(status.jobs[0]!)).reads.find((r) => r.path === path);
    expect(read?.ok, `from inside the job, the read of ${path} worked: ${JSON.stringify(read)}`).toBe(false);
    expect(status.result, `the job's result after it read ${path}: ${JSON.stringify(status)}`).toBe('refused');
    expect(status.why, `the refusal names the read of ${path}`).toContain(path);
    expect(status.commit, 'a refused job has no commit').toBeNull();
    expect(s.refs(), 'the repository refs after a refused job').toBe(refs);
    expect(await s.attempts(), 'attempts started by a refused job').toEqual([]);
  });
}

describe("AC1 #1328.c53e7397 a job's record lists exactly its inputs, and a planted job that reads another branch or a session's transcript is refused, naming the read", () => {
  it('AC1 the job record lists the issue body at that moment, the design documents and the base commit, and the job holds nothing of another branch or a transcript', async () => {
    await withStage({}, async (s) => {
      const session = s.session();
      const status = await s.ready();
      expect(status.jobs, 'the jobs of a first draft').toHaveLength(1);
      const job = status.jobs[0]!;
      expect((await s.inputsOf(job)).sort(byRef), `the input record of ${job}`).toEqual(s.expectedInputs().sort(byRef));
      const saw = await s.saw(job);
      const folder = await s.folderOfJob(job);
      expect(saw.stdin, "the job's stdin holds the issue's body").toContain(s.bodies[ISSUE]);
      expect(saw.cwd, "the job's working folder").toBe(folder);
      expect(git(folder, 'rev-parse', 'HEAD'), "the commit of the job's checkout").toBe(s.base);
      const seen = `${saw.stdin}\n${everything(folder)}`;
      for (const mark of session.marks) expect(seen.includes(mark), `the job's stdin or folder holds ${mark}`).toBe(false);
    });
  }, LIMIT);

  it("AC1 a planted job that reads a file of another branch's worktree is refused, naming the read", async () => {
    await refusedRead((session) => session.branchFile);
  }, LIMIT);

  it("AC1 a planted job that reads a session's transcript is refused, naming the read", async () => {
    await refusedRead((session) => session.transcript);
  }, LIMIT);
});

/** A job that writes its folder and also `path`: nothing of it is committed, and the refusal names `path`. */
async function refusedWrite(path: string): Promise<void> {
  await withStage({}, async (s) => {
    const refs = s.refs();
    s.plans.push({ writes: { ...firstDraft(ISSUE).writes, [path]: 'planted\n' } });
    await s.start();
    const status = await s.judged();
    expect(status.result, `the job's result after it wrote ${path}: ${JSON.stringify(status)}`).toBe('refused');
    expect(status.why, `the refusal names ${path}`).toContain(path);
    expect(status.commit, 'a job that wrote outside its folder has no commit').toBeNull();
    expect(s.refs(), 'the repository refs after a job that wrote outside its folder').toBe(refs);
    s.untouched();
    expect(await s.attempts(), 'attempts started by a refused job').toEqual([]);
  });
}

describe("AC2 #1328.0bdcba1d a planted job that writes outside its issue's folder gets nothing committed, naming the path", () => {
  it('AC2 a job that writes src/widget.mjs beside its folder gets nothing committed, naming the path', async () => {
    await refusedWrite('src/widget.mjs');
  }, LIMIT);

  it("AC2 a job that writes a sibling folder sharing its folder's prefix gets nothing committed, naming the path", async () => {
    await refusedWrite(`${folderOf(ISSUE)}1/sneak.test.mjs`);
  }, LIMIT);
});

describe("AC3 #1328.dfd2cdea a criterion whose test passes on the base, where the issue calls it new behavior, makes the job's result INVALID, naming the criterion, and it never starts an attempt", () => {
  it('AC3 a new-behavior test that passes on the base makes the result INVALID naming the criterion, though the job recorded a base failure, and no attempt starts', async () => {
    await withStage({}, async (s) => {
      const refs = s.refs();
      s.plans.push(firstDraft(ISSUE, HOLLOW));
      await s.start();
      const status = await s.judged();
      expect(status.result, `the job's result when its test passes on the base: ${JSON.stringify(status)}`).toBe('INVALID');
      const criterion = [tagOf(ISSUE, NEW), NEW];
      expect(criterion.some((name) => status.why?.includes(name)), `"${status.why}" names the criterion, by ${criterion.join(' or ')}`).toBe(true);
      expect(status.commit, 'an INVALID job has no commit').toBeNull();
      expect(s.refs(), 'the repository refs after an INVALID job').toBe(refs);
      s.untouched();
      expect(await s.attempts(), 'attempts started by an INVALID job').toEqual([]);
    });
  }, LIMIT);

  it("AC3 (its twin) a new-behavior test failing on the base at its assertion, beside an unchanged criterion's test that passes there, is ready: the folder alone is the attempt's first commit", async () => {
    await withStage({}, async (s) => {
      const status = await s.ready(ISSUE, BLUE);
      expect(status.base, 'the base run of each new-behavior test').toEqual([
        { test: widgetTest(ISSUE), criterion: tagOf(ISSUE, NEW), outcome: 'failed', at: `${widgetFile(ISSUE)}:6` },
      ]);
      expect(status.base.map((b) => b.criterion), `the unchanged criterion ${SAME} is no new behavior`).not.toContain(tagOf(ISSUE, SAME));
      expect(status.commit, 'a ready job has a commit').toBeTruthy();
      expect(git(s.repo, 'rev-parse', `refs/heads/${status.branch}`), `the head of the attempt's branch ${status.branch}`).toBe(status.commit);
      expect(git(s.repo, 'rev-parse', `${status.commit}^`), "the parent of the attempt's first commit").toBe(s.base);
      const files = git(s.repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', status.commit!).split('\n');
      expect(files, 'the first commit holds both tests').toEqual(expect.arrayContaining([widgetFile(ISSUE), `${folderOf(ISSUE)}/name.test.mjs`]));
      expect(files.filter((path) => !path.startsWith(`${folderOf(ISSUE)}/`)), "files of the first commit outside the issue's folder").toEqual([]);
      s.untouched();
      const attempts = await s.attempts();
      expect(attempts.map((e) => ({ branch: e.data.branch, commit: e.data.commit, base: e.data.base })), 'the attempt on the record').toEqual([{ branch: status.branch, commit: status.commit, base: s.base }]);
    });
  }, LIMIT);
});
