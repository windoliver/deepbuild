// AC9 #148.d24b369d: Crashing a sync before it publishes, after its first target, and before it records completion each
// recovers per target from the approved base and target digests and never reports a partial sync complete; an edit of
// yours made in between survives, and one that changes the approved diff's meaning marks that file conflicted for a new
// decision; an invalid native file is refused without being reset; and a running session isn't reported as having
// loaded the new set because its files changed.
//
// The crash is the design's power cut under the test VFS (README: The storage seam): DEEP_HUB_TEST_VFS's `cutAt` ends
// the hub by SIGKILL from inside right after the nth point of a kind. One server goes to Claude Code, Codex and pi, so
// a sync has three target files; the plan gives each one's base (`before`) and target (`after`) digest. Before it
// publishes is right after `sync_intent`; after its first target, right after the first `sync_flush`; before it
// records completion, right after the last target's `sync_flush`. The hub then starts again on a real disk, where
// recovery runs. A running session is judged without a crash, in its own test.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ClaudeSession, approve, conflictingEdit, deep, digest, events, harmlessEdit, hubEnded, invalidEdit, makeWorld, names, parse, propose, readingsOf, rowOf, same, shown, sleep, startHub,
  stdioServer, syncOf, syncReaches, tag, useCleanup, waitFor, type Line, type Planned, type Proposal, type World,
} from './helpers.ts';

useCleanup();
const THREE = ['claude-code', 'codex', 'pi'];
const SETTLE_MS = 10_000;

interface Cut { w: World; p: Proposal; trace: Line[]; name: string }
/** A sync of one server to the three agents, approved, with the hub cut right after the nth point of `kind`. */
async function cutAt(kind: string, nth: (p: Proposal) => number): Promise<Cut> {
  const w = await makeWorld();
  const points = join(w.tmp, 'points.jsonl');
  writeFileSync(points, '');
  const name = `forge-${tag()}`;
  // The plan comes first, on a hub with no cut, so the cut's number can depend on it.
  await startHub(w, { vfs: { points } });
  const p = await propose(w, { via: 'app', server: stdioServer(w, name), agents: THREE });
  expect(p.files.length, `the plan has a target file for each agent: ${shown(p.files)}`).toBeGreaterThanOrEqual(3);
  const hub = w.hub!;
  w.hub = undefined;
  process.kill(hub.pid, 'SIGTERM');
  await hub.exit;
  await startHub(w, { vfs: { points, cutAt: { kind, nth: nth(p) } } });
  void deep(w, ['inbox', 'answer', `ask:${p.ask.replace(/^ask:/, '')}`, 'apply']);
  await hubEnded(w, 90_000, `right after ${kind} #${nth(p)}`);
  const trace = readFileSync(points, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : []));
  return { w, p, trace, name };
}
const at = (files: Planned[], pick: (f: Planned) => string | null) => files.map((f) => `${f.path}: ${digest(f.path) === pick(f) ? 'as expected' : `${digest(f.path)} where the plan's digest is ${pick(f)}`}`).filter((s) => !s.endsWith('as expected'));
const fileStatus = (sync: Line | undefined, path: string): string | undefined => ((sync?.files ?? []) as Line[]).find((f) => same(String(f.path), path))?.status;

describe('#148 a sync cut by a crash, and a running session', () => {
  it(`${AC[9]} cut before it publishes: every target keeps its base digest, recovery drops the sync, and it is never reported complete`, async () => {
    const { w, p } = await cutAt('sync_intent', () => 1);
    expect(at(p.files, (f) => f.before), 'at the cut, every target file still has its base digest').toEqual([]);
    await startHub(w);
    await sleep(SETTLE_MS);
    expect(at(p.files, (f) => f.before), 'after recovery, every target file has its base digest').toEqual([]);
    const s = await syncOf(w, p.sync);
    expect(s?.status, `the sync is not reported complete: ${shown(s)}`).not.toBe('complete');
  });

  it(`${AC[9]} cut after its first target: your edit to it survives, an edit that changes the approved diff's meaning puts that file in conflict for a new decision, an invalid file is refused and not reset, and the sync is never reported complete`, async () => {
    const { w, p, trace, name } = await cutAt('sync_flush', () => 1);
    const replaced = trace.filter((t) => t.kind === 'sync_replace').map((t) => String(t.path));
    expect(replaced.length, `the trace shows one replace before the cut: ${shown(trace.filter((t) => String(t.kind).startsWith('sync_')))}`).toBe(1);
    const first = p.files.find((f) => same(f.path, replaced[0]!))!;
    expect(first, `the replaced file ${replaced[0]} is one of the plan's`).toBeDefined();
    const [conflicted, invalid] = p.files.filter((f) => f !== first);
    expect(at([first], (f) => f.after), 'at the cut, the first target has its target digest').toEqual([]);
    expect(at([conflicted!, invalid!], (f) => f.before), 'at the cut, the others have their base digests').toEqual([]);

    // Your edits while the hub is down.
    harmlessEdit(first.path);
    conflictingEdit(conflicted!.path, name);
    invalidEdit(invalid!.path);
    const yours = new Map([first, conflicted!, invalid!].map((f) => [f.path, readFileSync(f.path)]));
    const restarted = Date.now();
    await startHub(w);
    const s = await waitFor(async () => { const x = await syncOf(w, p.sync); return fileStatus(x, conflicted!.path) === 'conflict' ? x : undefined; }, 60_000, `${conflicted!.path} in conflict in agents.read`);
    for (const f of [first, conflicted!, invalid!]) expect(readFileSync(f.path).equals(yours.get(f.path)!), `${f.path} holds your bytes: recovery wrote nothing over your edit`).toBe(true);
    expect(['conflict', 'refused'], `${invalid!.path}, invalid in its agent's format, is refused: ${shown(s)}`).toContain(fileStatus(s, invalid!.path));
    expect(s.status, `the sync is not reported complete: ${shown(s)}`).not.toBe('complete');
    const asks = (await events(w)).filter((e) => e.kind === 'ask.created' && e.ts >= restarted && names(String(e.data?.question ?? ''), conflicted!.path, w));
    expect(asks.length, `an ask names ${conflicted!.path} for a new decision`).toBeGreaterThan(0);
  });

  it(`${AC[9]} cut before it records completion: every target has its target digest, and recovery reports the sync complete`, async () => {
    const { w, p } = await cutAt('sync_flush', (q) => q.files.length);
    expect(at(p.files, (f) => f.after), 'at the cut, every target file has its target digest').toEqual([]);
    await startHub(w);
    await syncReaches(w, p.sync, ['complete'], 60_000);
    expect(at(p.files, (f) => f.after), 'after recovery, every target file has its target digest').toEqual([]);
  });

  it(`${AC[9]} a session running before a sync isn't reported as having loaded the new set because its files changed: its row says it runs the older set`, async () => {
    const w = await makeWorld();
    await startHub(w);
    const session = new ClaudeSession(w, w.work);
    await session.start();
    await approve(w, await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: ['claude-code'] }));
    await waitFor(async () => readingsOf(await rowOf(w, session.id)).some((r) => /older/i.test(r)), 60_000, `session ${session.id}'s row to say it runs the older set`);
  });
});

