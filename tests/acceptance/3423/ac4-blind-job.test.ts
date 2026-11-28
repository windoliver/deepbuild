import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, agent, brief, fixtureRepo, list, obj, put, record, reply, scratchDir, taste } from './helpers.ts';

function world() {
  const { dir, shas } = fixtureRepo([
    { 'src/scene.txt': 'a box\n' },
    { 'src/scene.txt': 'a box and a lamp\n' },
  ]);
  const side = scratchDir();
  const commits = join(side, 'commits.json');
  put(commits, `${JSON.stringify([{ sha: shas[0], session: 'session-x' }, { sha: shas[1], session: 'session-b' }], null, 2)}\n`);
  const reading = (name: string, session: string, inputs: string[]) => {
    const file = `readings/${name}.json`;
    put(join(dir, file), record(9501, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent(session, inputs) }));
    return file;
  };
  return { dir, ranOn: shas[1]!, commits, reading };
}

describe(`${AC[4]} who may make a reading`, () => {
  it(`${AC[4]} a reading whose session authored a commit the pictures' check ran on is refused, naming the session`, () => {
    const w = world();
    const file = w.reading('by-session', 'session-b', ['criterion', 'files']);
    const r = taste(['accept', '--root', w.dir, '--record', file, '--ran-on', w.ranOn, '--commits', w.commits]);
    const a = reply(r, `accept ${file}`);
    expect(a['accepted'], `session-b made the commit the pictures' check ran on, so its reading is refused: ${brief(a)}`).toBe(false);
    expect(r.status, 'accept exits non-zero on a refusal').not.toBe(0);
    expect(list(a['refused'], 'refused').map((x) => obj(x, 'a refusal')).filter((x) => x['reason'] === 'session').map((x) => x['session']), `the refusal names the session: ${brief(a['refused'])}`).toEqual(['session-b']);
    expect(r.out, 'the output names the session').toContain('session-b');
  }, TIMEOUT);

  it(`${AC[4]} the same pictures read by a job given only the criterion and the files are accepted`, () => {
    const w = world();
    const file = w.reading('by-job', 'session-j', ['criterion', 'files']);
    const r = taste(['accept', '--root', w.dir, '--record', file, '--ran-on', w.ranOn, '--commits', w.commits]);
    const a = reply(r, `accept ${file}`);
    expect({ accepted: a['accepted'], status: r.status }, `a job given only the criterion and the files: ${brief(a)}`).toEqual({ accepted: true, status: 0 });
  }, TIMEOUT);

  it(`${AC[4]} a planted job that was also given the diff fails, naming the input`, () => {
    const w = world();
    const file = w.reading('by-planted-job', 'session-p', ['criterion', 'files', 'diff']);
    const r = taste(['accept', '--root', w.dir, '--record', file, '--ran-on', w.ranOn, '--commits', w.commits]);
    const a = reply(r, `accept ${file}`);
    expect(a['accepted'], `a job also given the diff is refused: ${brief(a)}`).toBe(false);
    expect(r.status, 'accept exits non-zero on a refusal').not.toBe(0);
    expect(list(a['refused'], 'refused').map((x) => obj(x, 'a refusal')).filter((x) => x['reason'] === 'input').map((x) => x['input']), `the refusal names the input: ${brief(a['refused'])}`).toEqual(['diff']);
  }, TIMEOUT);
});
