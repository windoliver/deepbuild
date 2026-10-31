// AC3: a stream source passes source@1 (#13) at install: read twice from one cursor it returns the same events in
// order and loses none across a hub restart; a planted reader that skips the first event after a resume fails it,
// naming the fixture.
//
// Both packages come from outside the release, so they run in the platform sandbox. The kit is source@1's from
// @deepbuild/conformance, run by the install on the source the package registers; its restart is a restart of the
// package's run (README, Readings). The planted reader skips only on the first read of a run that starts from a
// cursor, so it passes every read but the one after a real restart.
import { describe, expect, it } from 'vitest';
import { memoryStore, openHost, openWorld, pkg, routedClient } from './helpers.ts';

const open = async () => openHost(await openWorld(), { secrets: memoryStore(), http: routedClient({}).client });

describe('AC3 #364.3a628510 a stream source passes source@1 at install: read twice from one cursor it returns the same events in order and loses none across a hub restart; a planted reader that skips the first event after a resume fails it, naming the fixture', () => {
  it('AC3 the stream source installs with source@1\'s kit passed on it, and loads', async () => {
    const h = await open();
    const p = await h.install({ from: await pkg('feed'), builtBy: null });
    expect(p.kits, 'the kits the install ran').toContainEqual({ slot: 'source@1', fill: 'ext.feed.events', verdict: 'PASS' });
    const checked = await h.check(p);
    expect(checked.passed, checked.reasons.join('; ')).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
  }, 120_000);

  it('AC3 (wrong program) a planted reader that skips the first event after a resume is refused at install, naming the fixture', async () => {
    const h = await open();
    await expect(h.install({ from: await pkg('feed-skips'), builtBy: null }), 'the install refuses it, naming source@1\'s first fixture').rejects.toThrow(/five-by-two/);
    expect((await h.installed()).map((i) => i.id), 'installed packages').not.toContain('test/feed-skips');
  }, 120_000);
});
