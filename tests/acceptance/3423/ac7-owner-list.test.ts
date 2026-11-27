// AC7 #3423.408915d5: "The list holds all 98 with their issue, criterion and hashes, and a recorded overrule reopens
// its issue. A list that drops a record fails, naming it"
//
// `list` (README.md) over this checkout, the change: its readings among the records ebf1e7f44 held are the 98 the lane
// reads as an agent's, each under its issue, with the criterion and the hashes the merge base's copy of that record
// holds. In a scratch repository, `list --check` passes the list `list` printed and fails a copy with one reading
// dropped, naming it; and `reopen` reopens the issue of a record holding a recorded overrule through `gh` (a fake on
// PATH that logs its arguments: the forge is a boundary this repo doesn't own), naming the criterion.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, PERSON, READ_ON, REPO, TIMEOUT, agent, brief, fakeGh, fixtureRepo, hashesOf, issueOf, list, mergeBase, obj, record,
  recordPath, recordPathsAt, reply, scratchDir, showAt, taste, type JsonObject, type JsonValue,
} from './helpers.ts';

/** The list's readings, flattened: each with the issue it is listed under. */
function readings(listed: JsonObject): JsonObject[] {
  return list(listed['issues'], 'the list\'s issues').flatMap((i) => {
    const issue = obj(i, 'a listed issue');
    return list(issue['readings'], `issue ${String(issue['issue'])}'s readings`).map((r) => ({ ...obj(r, 'a listed reading'), under: issue['issue'] as JsonValue }));
  });
}

describe(`${AC[7]} the list of readings put to the owner`, () => {
  it(`${AC[7]} the list holds all 98 with their issue, criterion and hashes`, () => {
    const paths = new Set(recordPathsAt(READ_ON));
    const base = mergeBase();
    const listed = reply(taste(['list', '--root', REPO]), 'list on the change');
    const rows = readings(listed).filter((r) => paths.has(r['file'] as string));
    const lane = reply(taste(['lane', '--root', REPO]), 'lane on the change');
    const agents = list(lane['records'], 'lane records').map((e) => obj(e, 'a lane record'))
      .filter((e) => paths.has(e['file'] as string) && e['call'] !== null && e['maker'] === 'agent').map((e) => e['file'] as string).sort();
    expect(agents.length, 'the lane reads 98 of ebf1e7f44\'s records as an agent\'s').toBe(98);
    expect(rows.map((r) => r['file'] as string).sort(), 'the list holds exactly those 98, each once').toEqual(agents);
    const wrong: string[] = [];
    for (const row of rows) {
      const file = row['file'] as string;
      const was = JSON.parse(showAt(base, file)) as JsonObject;
      const want = { issue: issueOf(file, was), criterion: (was['criterion'] ?? null) as JsonValue, hashes: [...hashesOf(was)].sort() };
      const got = { issue: row['under'], criterion: row['criterion'] ?? null, hashes: [...new Set(list(row['hashes'], `${file} hashes`) as string[])].sort() };
      if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${file}: listed ${brief(got)}, the record holds ${brief(want)}`);
    }
    expect(wrong, 'each listed reading has its record\'s issue, criterion and hashes').toEqual([]);
  }, TIMEOUT);

  it(`${AC[7]} a list that drops a record fails, naming it`, () => {
    const files = { a: recordPath(9701), b: 'tests/acceptance/9701/TASTE.json', c: recordPath(9702), p: recordPath(9703) };
    const { dir } = fixtureRepo([{
      [files.a]: record(9701, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-1') }),
      [files.b]: record(9701, { verdict: 'looks_right', when: '2026-11-17T11:00:00Z', maker: agent('session-2') }),
      [files.c]: record(9702, { verdict: 'looks_right', when: '2026-11-17T12:00:00Z', maker: agent('session-3') }),
      [files.p]: record(9703, { verdict: 'looks_right', when: '2026-11-17T13:00:00Z', maker: PERSON }),
    }]);
    const r = taste(['list', '--root', dir]);
    const listed = reply(r, 'list on the scratch repository');
    expect(readings(listed).map((x) => x['file']).sort(), 'the scratch list holds the three readings and not the person\'s call').toEqual([files.a, files.b, files.c].sort());
    const side = scratchDir();
    const whole = join(side, 'whole.json');
    writeFileSync(whole, r.stdout);
    const kept = taste(['list', '--root', dir, '--check', whole]);
    expect(kept.status, `the whole list passes its check:\n${kept.out.slice(0, 1500)}`).toBe(0);
    const dropped = JSON.parse(readFileSync(whole, 'utf8')) as JsonObject;
    for (const i of list(dropped['issues'], 'issues')) { const issue = obj(i, 'issue'); issue['readings'] = list(issue['readings'], 'readings').filter((x) => obj(x, 'reading')['file'] !== files.b); }
    const short = join(side, 'short.json');
    writeFileSync(short, `${JSON.stringify(dropped, null, 2)}\n`);
    const check = taste(['list', '--root', dir, '--check', short]);
    expect(check.status, `a list missing ${files.b} fails its check:\n${check.out.slice(0, 1500)}`).not.toBe(0);
    expect(check.out, 'the failure names the dropped record').toContain(files.b);
    expect(check.out, 'the failure names only the dropped record').not.toContain(files.a);
  }, TIMEOUT);

  it(`${AC[7]} a recorded overrule reopens its issue, naming the criterion`, () => {
    const overruled = recordPath(9711), kept = recordPath(9712);
    const { dir } = fixtureRepo([{
      [overruled]: record(9711, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-1'), overrule: { by: PERSON, when: '2026-11-18T10:00:00Z' } }),
      [kept]: record(9712, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-2') }),
    }]);
    const gh = fakeGh();
    const r = taste(['reopen', '--root', dir, '--repo', 'fixture-owner/fixture-repo'], { cwd: dir, env: { ...process.env, PATH: `${gh.bin}:${process.env['PATH'] ?? ''}` } });
    const out = reply(r, 'reopen on the scratch repository');
    const calls = readFileSync(gh.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
    const reopens = calls.filter((c) => c[0] === 'issue' && c[1] === 'reopen');
    expect(reopens.map((c) => c[2]), `gh calls: ${brief(calls)}`).toEqual(['9711']);
    expect(reopens[0]!.join(' '), 'the reopen is on the repo given').toContain('fixture-owner/fixture-repo');
    expect(reopens[0]!.join(' '), 'the reopen names the criterion').toContain('#9711.0000c0de');
    expect(list(out['reopened'], 'reopened').map((x) => { const o = obj(x, 'a reopen'); return { issue: o['issue'], criterion: o['criterion'] }; }), 'reopen reports the issue and criterion')
      .toEqual([{ issue: 9711, criterion: '#9711.0000c0de' }]);
  }, TIMEOUT);
});
