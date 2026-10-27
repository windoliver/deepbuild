// #19.21db8bc2 (AC8): `deep status` with 30 sessions shows every session that needs you, is stuck or is flagged
// within its first 20 lines; per the scope it is grouped by repo, quiet sessions fold into one line, and it says
// which hub it reads. The record is seeded through @deepbuild/record and @deepbuild/asks with the hub stopped, the
// hub is the real `deep hub run`, and `deep status` the built CLI (README: The 30 sessions, What `deep status` prints).

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTENTION, cleanup, deep, HOUR, hubNames, judgeStatus, makeHome, MINUTE, prefixOf, Seeder, seedSessions, setAddress, shown, startHub, stopHub, THIRTY,
  type Planned, type Seeded,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const ID = 'AC8 #19.21db8bc2';

describe(`${ID} deep status puts what needs you, what's stuck and what's flagged first`, () => {
  it(`${ID} with 30 sessions in three repos, every session that needs you, is stuck or is flagged is within the first 20 lines, grouped by repo, the quiet ones folded, naming the hub; and the same with the hub down, from the database`, async () => {
    const h = makeHome();
    const now = Date.now();
    const sessions = await seedSessions(h.root, THIRTY, now);
    expect(sessions.filter((s) => ATTENTION.has(s.state)).length, 'the seed holds 9 sessions that need you, are stuck or are flagged').toBe(9);
    const hub = await startHub(h.home);

    const up = await deep(h.home, ['status']);
    expect(up.code, `deep status with the hub up exits 0 (ok in the exit-code table): ${shown(up)}`).toBe(0);
    expect(judgeStatus(up.stdout, sessions, hubNames(h.home, h.root)), `deep status with the hub up:\n${up.stdout}`).toEqual([]);

    // With the hub down, read commands open the database read-only (design: the deep CLI row); it says what it read.
    await stopHub(hub);
    const down = await deep(h.home, ['status']);
    expect(down.code, `deep status with the hub down and the database there runs: ${shown(down)}`).not.toBe(2);
    expect(judgeStatus(down.stdout, sessions, hubNames(h.home, h.root)), `deep status with the hub down:\n${down.stdout}`).toEqual([]);
  }, 180_000);

  it(`${ID} reads the hub the address setting names, a dev hub started with --root, and says so`, async () => {
    const h = makeHome();
    const now = Date.now();
    // The installed hub's record holds the 30; the dev hub's holds three sessions of DeepBuild's own worktree.
    const installed = await seedSessions(h.root, THIRTY, now);
    const devRoot = join(h.tmp, 'dev');
    const devPlan: Planned[] = [
      { repo: 'deepbuild', agent: 'claude-code', state: 'needs-you', how: 'an open authority ask', lead: 'd' },
      { repo: 'deepbuild', agent: 'claude-code', state: 'working', how: 'a tool call a minute ago', lead: 'b' },
      { repo: 'deepbuild', agent: 'codex', state: 'quiet', how: 'hooks quiet since 2 days ago', lead: 'a' },
    ];
    const dev = await seedSessions(devRoot, devPlan, now);
    await startHub(h.home, { root: devRoot });
    setAddress(h.home, join(devRoot, 'hub.sock'));

    const r = await deep(h.home, ['status']);
    expect(r.code, `deep status against the dev hub exits 0: ${shown(r)}`).toBe(0);
    expect(judgeStatus(r.stdout, dev, hubNames(h.home, devRoot), ['deepbuild']), `deep status with hub.address at the dev hub ${devRoot}:\n${r.stdout}`).toEqual([]);
    const fromInstalled = installed.filter((s) => r.stdout.toLowerCase().includes(prefixOf(s.id)));
    expect(fromInstalled.map((s) => `${s.id} (${s.repo}, ${s.state})`), 'deep status reads the dev hub the address names, not the installed hub\'s database').toEqual([]);
  }, 180_000);
});

// The judge's own check on planted outputs, written here from the seed: no wrong program of `deep status` reaches it.
describe(`the status judge (self-check)`, () => {
  it(`fails a listing in log order, one that doesn't fold the quiet sessions, one that doesn't group by repo and one that doesn't name the hub, and passes a right one`, async () => {
    // The judge alone, on outputs written here from the seed (planted twins of `deep status`): no hub needed.
    const h = makeHome();
    const sessions = await seedSessions(h.root, THIRTY, Date.now());
    const hub = hubNames(h.home, h.root);
    const socket = `unix:${join(h.root, 'hub.sock')}`;
    const row = (s: Seeded) => `  ${s.id.slice(0, 8)}  ${s.agent}  ${s.state}  ${s.how}`;
    const attentionFirst = (s: Seeded) => (ATTENTION.has(s.state) ? 0 : s.state === 'working' ? 1 : 2);
    const byRepo = [...new Set(sessions.map((s) => s.repo))].sort((a, b) =>
      Math.min(...sessions.filter((s) => s.repo === a).map(attentionFirst)) - Math.min(...sessions.filter((s) => s.repo === b).map(attentionFirst)) || a.localeCompare(b));
    const right = [`Reading the hub at ${socket}`, ...byRepo.flatMap((repo) => {
      const mine = sessions.filter((s) => s.repo === repo);
      const quiet = mine.filter((s) => s.state === 'quiet').length;
      return [repo, ...mine.filter((s) => s.state !== 'quiet').sort((a, b) => attentionFirst(a) - attentionFirst(b)).map(row), ...(quiet ? [`  ${quiet} quiet, last seen days ago`] : [])];
    })].join('\n');
    expect(judgeStatus(right, sessions, hub), `a right listing passes the judge:\n${right}`).toEqual([]);

    // Every session in the order the log holds them (the seed appends the quiet ones first), under its repo, unfolded.
    const logged = [...sessions.filter((s) => s.state === 'quiet'), ...sessions.filter((s) => s.state !== 'quiet')];
    const logOrder = [`Reading the hub at ${socket}`, ...['orchard', 'quarry', 'tundra'].flatMap((repo) => [repo, ...logged.filter((s) => s.repo === repo).map(row)])].join('\n');
    const lateOnes = judgeStatus(logOrder, sessions, hub).filter((p) => /not within the first 20 lines/.test(p));
    expect(lateOnes.length, `a listing in log order leaves sessions that need you past line 20:\n${logOrder}`).toBeGreaterThan(0);
    expect(judgeStatus(logOrder, sessions, hub).some((p) => /^quiet session .* is listed/.test(p)), 'and lists quiet sessions one by one').toBe(true);

    const noHub = right.split('\n').slice(1).join('\n');
    expect(judgeStatus(noHub, sessions, hub), 'a listing that doesn\'t name the hub fails, saying so').toEqual([expect.stringMatching(/doesn't say which hub it reads/)]);

    const flat = [`Reading the hub at ${socket}`, 'Needs you, stuck or flagged', ...sessions.filter((s) => ATTENTION.has(s.state)).map(row), `${sessions.filter((s) => s.state === 'quiet').length} quiet`, ...sessions.filter((s) => s.state === 'working').map((s) => `${s.repo}\n${row(s)}`)].join('\n');
    expect(judgeStatus(flat, sessions, hub).filter((p) => /grouped by repo/.test(p)).length, `a listing that puts what needs you in one ungrouped block fails, naming each session:\n${flat}`).toBe(9);
  }, 60_000);
});

// The seed's own shape, read back from the record the hub reads: so a failure above is about `deep status`, not
// about a seed the record took differently (README: The 30 sessions).
describe(`the seed (self-check)`, () => {
  it(`the record holds the 30 sessions as seeded: open asks for those that need you, stuck, failed stops and a gone process, quiet ones last seen days ago`, async () => {
    const h = makeHome();
    const now = Date.now();
    const sessions = await seedSessions(h.root, THIRTY, now);
    const s = await Seeder.open(h.root, now);
    try {
      const rows = new Map((await s.record.table('sessions')).rows.map((r) => [String(r.id), r]));
      const asks = (await s.record.table('asks')).rows;
      expect(rows.size, 'the record holds 30 sessions').toBe(30);
      for (const x of sessions) {
        const row = rows.get(x.id);
        expect(row?.project_id, `${x.id} belongs to ${x.repo}`).toBe(x.repo);
        const open = asks.filter((a) => a.session_id === x.id && a.status === 'open').length;
        expect(open > 0, `${x.id} (${x.state}: ${x.how}) has ${open} open asks`).toBe(x.state === 'needs-you');
        if (x.state === 'quiet') expect(Number(row?.last_seen) < now - DAY_MS, `${x.id} was last seen days ago`).toBe(true);
        else expect(Number(row?.last_seen) > now - 4 * HOUR, `${x.id} was seen in the last hours`).toBe(true);
        if (x.how.includes('owner')) expect(row?.status, `${x.id} (${x.how})`).toBe('stuck');
        if (x.how.includes('attention reads stuck')) expect(row?.status).toBe('stuck');
        if (x.state === 'quiet') expect(row?.status).toBe('unknown');
        if (x.how.includes('without a claim')) expect(row?.status, `${x.id} (${x.how})`).toBe('failed');
        if (x.state === 'working') expect(Number(row?.last_seen)).toBeGreaterThan(now - 3 * MINUTE);
      }
    } finally {
      await s.close();
    }
  }, 60_000);
});
const DAY_MS = 24 * HOUR;
