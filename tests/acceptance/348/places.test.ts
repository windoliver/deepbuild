// AC5: an extension your agent built loads only in the platform sandbox, out of process, never in the hub. AC6: a
// TypeScript package from outside DeepBuild's signed release, installed from a folder and written by no agent, loads
// only in the platform sandbox, out of process, and reads only the record its grant names; a host that loads it in
// the hub because no agent built it fails this test, naming the package.
//
// Where a package runs is read three ways: the host's `place`; the probe's own PID, which must not be the hub's
// (this process, where the host runs) and must be one the supervisor tracked for the load's run (#236's
// process.tracked, so it was started through host@1); and, for the sandbox, a canary file outside the package that
// the probe can't read. A control loads the same probe from the release, byte for byte, in the hub, where it reads
// the canary, so the canary's refusal is the sandbox's and not the probe's.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtensionHost, Load, Plant } from '../../../packages/extension-host/src/index.ts';
import { agentSession, hookIn, openHost, openWorld, pkg, releaseEntry, report, tempDir, tracked, ulid, YOU, type World } from './helpers.ts';

const opened: ExtensionHost[] = [];
afterAll(async () => { for (const h of opened.splice(0)) await h.close(); });

interface Seen { pid: number; canary?: string | null; canaryError?: string; kinds?: string[]; count?: number; queryError?: string; askedKinds?: string[]; askedError?: string }

function canaryFile(): string {
  const path = join(tempDir('canary'), 'secret.txt');
  writeFileSync(path, 'dh348-canary\n');
  return path;
}
async function hostOn(w: World, options: { release?: Awaited<ReturnType<typeof releaseEntry>>[]; plant?: Plant } = {}): Promise<ExtensionHost> {
  const h = await openHost(w, options);
  opened.push(h);
  await h.ready();
  return h;
}

/** The criteria's assertion: the package runs in the sandbox, out of the hub's process, through host@1. The failure names the package. */
async function loadsOnlyInSandbox(w: World, id: string, load: Load, seen: Seen): Promise<void> {
  expect(load.status, `${id} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
  if (load.status !== 'loaded') return;
  expect(load.place, `${id} loaded in the ${load.place}, not the platform sandbox`).toBe('sandbox');
  expect(seen.pid, `${id} runs in the hub's own process`).not.toBe(process.pid);
  expect(await tracked(w, load.run), `${id}'s process (pid ${seen.pid}) wasn't started and tracked by the supervisor`).toContain(seen.pid);
}

describe('AC5 #348.7391eba7 an extension your agent built loads only in the platform sandbox, out of process, never in the hub', () => {
  it('AC5 a package an agent session built loads in the sandbox, out of the hub\'s process, and can\'t read a file outside its grant', async () => {
    const w = await openWorld();
    const h = await hostOn(w);
    const canary = canaryFile();
    const p = await h.install({ from: await pkg('probe', { probe: { canary } }), builtBy: agentSession() });
    expect((await h.check(p)).passed).toBe(true);
    const load = await h.load(p);
    const seen = await report<Seen>(h, 'ext.probe.report');
    await loadsOnlyInSandbox(w, p.id, load, seen);
    expect(seen.canary, 'the sandboxed package read the canary outside its grant').toBeNull();
  }, 60_000);

  it('AC5 a release package your agent changed is no longer the release\'s: it loads in the sandbox, while the unchanged copy loads in the hub and reads the canary', async () => {
    const canary = canaryFile();
    const original = await pkg('probe', { probe: { canary } });
    const release = [await releaseEntry(original)];

    // Control: the release's own bytes, written by no agent, load in the hub, where the canary is readable.
    const wa = await openWorld();
    const ha = await hostOn(wa, { release });
    const pa = await ha.install({ from: original, builtBy: null });
    expect((await ha.check(pa)).passed).toBe(true);
    const inHub = await ha.load(pa);
    const seenHub = await report<Seen>(ha, 'ext.probe.report');
    expect(inHub.status === 'loaded' && inHub.place, JSON.stringify(inHub)).toBe('hub');
    expect(seenHub.pid, 'a hub extension runs in the hub\'s process').toBe(process.pid);
    expect(seenHub.canary).toBe('dh348-canary\n');

    // The same package after an agent session changed one line: sandboxed, and the canary is out of reach.
    const wb = await openWorld();
    const hb = await hostOn(wb, { release });
    const changed = await pkg('probe', { probe: { canary }, files: { 'NOTES.md': 'an agent added this file\n' } });
    const pb = await hb.install({ from: changed, builtBy: agentSession() });
    expect((await hb.check(pb)).passed).toBe(true);
    const load = await hb.load(pb);
    const seen = await report<Seen>(hb, 'ext.probe.report');
    await loadsOnlyInSandbox(wb, pb.id, load, seen);
    expect(seen.canary).toBeNull();
  }, 120_000);
});

describe('AC6 #348.4c1dd1d8 a TypeScript package from outside the signed release, installed from a folder by no agent, loads only in the sandbox and reads only the record its grant names; a host that loads it in the hub because no agent built it fails, naming the package', () => {
  /** The scenario: a record holding session.start and task.created events; the probe installed with a grant naming session.start. */
  async function scenario(plant?: Plant): Promise<{ w: World; id: string; load: Load; seen: Seen }> {
    const w = await openWorld();
    const session = ulid();
    await w.record.append(hookIn(session), { v: 1, id: ulid(), kind: 'session.start', ts: Date.now(), data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } });
    await w.record.append(YOU, { v: 1, id: ulid(), kind: 'task.created', ts: Date.now(), data: { task_ref: `task:${ulid()}`, thread: session, owner: 'you', title: 'not for the probe' } });
    const h = await hostOn(w, plant ? { plant } : {});
    const p = await h.install({ from: await pkg('probe', { manifest: { access: { words: ['record'] } }, probe: { query: true } }), builtBy: null, grant: { record: ['session.start'] } });
    expect((await h.check(p)).passed).toBe(true);
    const load = await h.load(p);
    const seen = await report<Seen>(h, 'ext.probe.report');
    return { w, id: p.id, load, seen };
  }

  it('AC6 the package loads in the sandbox, out of the hub\'s process, through host@1', async () => {
    const { w, id, load, seen } = await scenario();
    await loadsOnlyInSandbox(w, id, load, seen);
  }, 60_000);

  it('AC6 it reads only the record its grant names: session.start events cross into the sandbox, and no other kind does, asked for or not', async () => {
    const { seen } = await scenario();
    expect(seen.queryError, 'a query its grant allows went through').toBeUndefined();
    expect(seen.kinds, 'the kinds the probe got from deep.record.query').toEqual(['session.start']);
    expect(seen.count).toBeGreaterThan(0);
    expect(seen.askedKinds ?? [], 'asked for task.created by name, it got none').toEqual([]);
  }, 60_000);

  it('AC6 (wrong program) a host that loads it in the hub because no agent built it fails this test, naming the package', async () => {
    const { w, id, load, seen } = await scenario('hub-unless-agent-built');
    await expect(loadsOnlyInSandbox(w, id, load, seen)).rejects.toThrow(/test\/probe/);
  }, 60_000);
});
