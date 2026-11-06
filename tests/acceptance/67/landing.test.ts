// #67's scope lines, on the real hub, where no criterion names them: a workspace is a git repo under
// ~/.deepbuild/workspaces/ or a folder you pick; a project is a repo or a workspace and the record's project id covers
// both; a task from a work source with no repo lands in a new workspace, and you can move it.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, fill, git, listed, makeWorld, must, newWorkspace, req, Session, settle, startHub, workspace, type Ev, type Reading } from './hub.ts';

afterAll(cleanup, 60_000);
const made = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'workspace.created');

describe('#67 a workspace is a git repo DeepBuild keeps, or a folder you pick, and a project id covers it', () => {
  it('a workspace is made under ~/.deepbuild/workspaces/ with no question and no git identity; another in a folder you pick; each is a project of its own, recorded by the core', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    const kept = await newWorkspace(w, 'Household budget');
    must(dirname(kept.folder) === join(w.root, 'workspaces'), `it's kept under ~/.deepbuild/workspaces/: ${kept.folder}`);
    expect(git(w, kept.folder, ['rev-parse', '--show-toplevel']), 'a git repo of its own').toBe(kept.folder);
    expect(git(w, kept.folder, ['log', '--format=%H']).split('\n').filter(Boolean).length, 'with a first commit: history starts at once').toBeGreaterThan(0);

    const picked = join(w.tmp, 'picked');
    mkdirSync(picked);
    const yours = await newWorkspace(w, 'Household budget', '--folder', picked);
    expect(yours.folder, 'the folder you picked').toBe(picked);
    expect(yours.id, 'two workspaces on one topic are two projects').not.toBe(kept.id);

    const events = await settle(hub, (all) => made(all).length === 2);
    expect(made(events).map((e) => [e.data.workspace, e.data.folder, e.writer]), 'the record holds each, by the core').toEqual([[kept.id, kept.folder, 'core'], [yours.id, yours.folder, 'core']]);
    expect(events.filter((e) => e.kind === 'ask.created'), 'a person is asked nothing').toEqual([]);

    const s = new Session(w, kept.folder);
    await s.start();
    const started = await settle(hub, (all) => all.some((e) => e.kind === 'session.start' && e.session === s.id));
    expect(started.find((e) => e.kind === 'session.start' && e.session === s.id)?.project, 'a session in it is in that project').toBe(kept.id);
  }, 120_000);
});

describe('#67 a task from a work source with no repo lands in a new workspace, and you can move it', () => {
  it('a work item named outside any repo opens its task in a new workspace; moved to a folder you pick it keeps its id, files and history, and a session there is in the same project', async () => {
    const LINK = 'https://work.example.test/items/12';
    const item: Reading = {
      source_id: 'work-example#12', link: LINK, title: 'Monthly client report', body: '- [ ] The monthly report states the invoiced total', criteria: ['The monthly report states the invoiced total'],
      authors: [{ handle: 'you', role: 'owner' }], updated: '2026-11-01T09:00:00Z',
    };
    const w = makeWorld({ readings: [item], drafts: [{ issue: item.source_id, requirements: [req('R1', item.criteria[0]!)], deliverables: [], budget: null }] });
    const hub = await startHub(w);
    const s = new Session(w, w.outside);
    await s.start();
    await s.typed(`take this on ${LINK}`);
    const events = await settle(hub, (all) => made(all).length > 0 && all.some((e) => e.kind === 'task.created'));
    const opened = made(events);
    const task = events.find((e) => e.kind === 'task.created');
    expect(opened.map((e) => e.data.task_ref), `one workspace for the work item's task: ${listed(events.slice(-8))}`).toEqual([task?.data.task_ref]);
    const before = { id: String(opened[0]!.data.workspace), folder: String(opened[0]!.data.folder) };
    must(dirname(before.folder) === join(w.root, 'workspaces'), `it lands under ~/.deepbuild/workspaces/: ${before.folder}`);

    const keep = fill(w, { ...before, name: '' }, { 'notes/client.md': 'Invoice in euros.\n' });

    const to = join(w.tmp, 'clients', 'acme');
    mkdirSync(dirname(to), { recursive: true });
    const moved = await workspace(w, 'move', before.id, to);
    expect(moved, 'its id stays and its folder is the one you picked').toMatchObject({ id: before.id, folder: to });
    expect(existsSync(before.folder), 'nothing is left where it was').toBe(false);
    expect(readFileSync(join(to, 'notes/client.md'), 'utf8'), 'its files moved').toBe('Invoice in euros.\n');
    expect(git(w, to, ['rev-parse', 'HEAD']), 'and its history').toBe(keep);

    const there = new Session(w, to);
    await there.start();
    const after = await settle(hub, (all) => all.some((e) => e.kind === 'session.start' && e.session === there.id));
    expect(after.find((e) => e.kind === 'session.start' && e.session === there.id)?.project, 'a session in the moved workspace is in the same project').toBe(before.id);
  }, 180_000);
});
