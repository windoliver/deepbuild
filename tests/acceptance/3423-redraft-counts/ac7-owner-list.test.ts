import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PERSON, READ_ON, REPO, TIMEOUT, agent, brief, fakeGh, fixtureRepo, hashesOf, issueOf, list, mergeBase, obj, record,
  recordPath, recordPathsAt, reply, scratchDir, showAt, taste, type JsonObject, type JsonValue,
} from '../3423/helpers.ts';
import { DELEGATED } from './records.ts';

function readings(listed: JsonObject): JsonObject[] {
  return list(listed['issues'], 'the list\'s issues').flatMap((i) => {
    const issue = obj(i, 'a listed issue');
    return list(issue['readings'], `issue ${String(issue['issue'])}'s readings`).map((r) => ({ ...obj(r, 'a listed reading'), under: issue['issue'] as JsonValue }));
  });
}

describe('#3423.e825ce4d the list of readings put to the owner', () => {
  it('#3423.e825ce4d the list holds all 103 with their issue, criterion and hashes', () => {
    const paths = new Set(recordPathsAt(READ_ON));
    const base = mergeBase();
    const listed = reply(taste(['list', '--root', REPO]), 'list on the change');
    const rows = readings(listed).filter((r) => paths.has(r['file'] as string));
    const files = rows.map((r) => r['file'] as string).sort();
    expect(files.length, `the list holds 103 of ebf1e7f44's records: ${brief(files)}`).toBe(103);
    expect(new Set(files).size, 'each listed once').toBe(103);
    expect(DELEGATED.filter((f) => !files.includes(f)), 'the five records whose notes say the owner delegated are on the list').toEqual([]);
    const lane = reply(taste(['lane', '--root', REPO]), 'lane on the change');
    const agents = list(lane['records'], 'lane records').map((e) => obj(e, 'a lane record'))
      .filter((e) => paths.has(e['file'] as string) && e['call'] !== null && e['maker'] === 'agent').map((e) => e['file'] as string).sort();
    expect(files, 'the list holds exactly the records the lane reads as an agent\'s').toEqual(agents);
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

  it('#3423.e825ce4d a recorded overrule reopens its issue', () => {
    const overruled = recordPath(9721), kept = recordPath(9722);
    const { dir } = fixtureRepo([{
      [overruled]: record(9721, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-1'), overrule: { by: PERSON, when: '2026-11-18T10:00:00Z' } }),
      [kept]: record(9722, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-2') }),
    }]);
    const gh = fakeGh();
    const r = taste(['reopen', '--root', dir, '--repo', 'fixture-owner/fixture-repo'], { cwd: dir, env: { ...process.env, PATH: `${gh.bin}:${process.env['PATH'] ?? ''}` } });
    const out = reply(r, 'reopen on the scratch repository');
    const calls = readFileSync(gh.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
    const reopens = calls.filter((c) => c[0] === 'issue' && c[1] === 'reopen');
    expect(reopens.map((c) => c[2]), `gh reopens only the overruled record's issue: ${brief(calls)}`).toEqual(['9721']);
    expect(reopens[0]!.join(' '), 'the reopen is on the repo given').toContain('fixture-owner/fixture-repo');
    expect(reopens[0]!.join(' '), 'the reopen names the criterion').toContain('#9721.0000c0de');
    expect(list(out['reopened'], 'reopened').map((x) => { const o = obj(x, 'a reopen'); return { issue: o['issue'], criterion: o['criterion'], file: o['file'] }; }), 'reopen reports the issue, criterion and record')
      .toEqual([{ issue: 9721, criterion: '#9721.0000c0de', file: overruled }]);
  }, TIMEOUT);

  it('#3423.e825ce4d a list that drops a record fails, naming it', () => {
    const files = { a: recordPath(9731), b: 'tests/acceptance/9731/TASTE.json', c: recordPath(9732), p: recordPath(9733) };
    const { dir } = fixtureRepo([{
      [files.a]: record(9731, { verdict: 'looks_right', when: '2026-11-17T10:00:00Z', maker: agent('session-1') }),
      [files.b]: record(9731, { verdict: 'looks_right', when: '2026-11-17T11:00:00Z', maker: agent('session-2') }),
      [files.c]: record(9732, { verdict: 'looks_right', when: '2026-11-17T12:00:00Z', maker: agent('session-3') }),
      [files.p]: record(9733, { verdict: 'looks_right', when: '2026-11-17T13:00:00Z', maker: PERSON }),
    }]);
    const r = taste(['list', '--root', dir]);
    const listed = reply(r, 'list on the scratch repository');
    expect(readings(listed).map((x) => x['file']).sort(), 'the scratch list holds the three readings and not the person\'s call').toEqual([files.a, files.b, files.c].sort());
    const side = scratchDir();
    const whole = join(side, 'whole.json');
    writeFileSync(whole, r.stdout);
    const kept = taste(['list', '--root', dir, '--check', whole]);
    expect(kept.status, `the whole list passes its check:\n${kept.out.slice(0, 1500)}`).toBe(0);
    expect(list(obj(kept.json, 'the check\'s reply')['missing'], 'missing'), 'the whole list misses nothing').toEqual([]);
    const dropped = JSON.parse(readFileSync(whole, 'utf8')) as JsonObject;
    for (const i of list(dropped['issues'], 'issues')) { const issue = obj(i, 'issue'); issue['readings'] = list(issue['readings'], 'readings').filter((x) => obj(x, 'reading')['file'] !== files.b); }
    const short = join(side, 'short.json');
    writeFileSync(short, `${JSON.stringify(dropped, null, 2)}\n`);
    const check = taste(['list', '--root', dir, '--check', short]);
    expect(check.status, `a list missing ${files.b} fails its check:\n${check.out.slice(0, 1500)}`).not.toBe(0);
    expect(list(obj(check.json, 'the check\'s reply')['missing'], 'missing'), 'the check names the dropped record and only it').toEqual([files.b]);
    expect(check.stderr, 'the failure names the dropped record').toContain(files.b);
  }, TIMEOUT);
});
