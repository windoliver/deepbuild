// #67 AC3: a state source's diff names what changed since the definition was fixed: not since the workspace was made,
// not since the last read. A host setting and a file each change before the lock and after it, through the shipped
// `host` and `git` state sources; `deep workspace diff` names the later two and neither earlier one, every time it's read.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC3, changed, cleanup, draft, fill, git, hostLog, listed, locked, makeWorld, newWorkspace, req, Session, settle, startHub, taskOf, workspace } from './hub.ts';

afterAll(cleanup, 60_000);
const ASK = 'keep the web host on its settings';
interface Diff { touch: string; item: string; was?: unknown; now?: unknown }

describe(`${AC3} a state source's diff names what changed since the definition was fixed`, () => {
  it(`${AC3} a setting and a file changed after the lock are named, and those changed between the workspace's making and the lock are not`, async () => {
    const w = makeWorld({ drafts: [draft(ASK, [req('R1', 'The web host holds its settings', { reads: ['web-1'] })])] });
    const hub = await startHub(w);
    const log = hostLog(w, 'web-1', { port: 80, tls: true });
    const ws = await newWorkspace(w, 'Web host');
    fill(w, ws, { 'notes/early.md': 'one\n' }, [{ id: 'web-1', source: 'host', log }, { id: 'files', source: 'git' }]);

    // Before the definition is fixed.
    changed(log, 'tls', false);
    fill(w, ws, { 'notes/early.md': 'two\n' });

    const s = new Session(w, ws.folder);
    await s.start();
    await s.typed(ASK);
    const events = await settle(hub, (all) => locked(all, taskOf(all, s, ASK)) !== undefined);
    expect(locked(events, taskOf(events, s, ASK)), `the definition must lock: ${listed(events.slice(-6))}`).toBeDefined();

    expect((await workspace(w, 'diff', ws.id)).diffs, 'right after the lock nothing has changed since it').toEqual([]);

    // After it.
    changed(log, 'port', 8080);
    writeFileSync(join(ws.folder, 'notes/late.md'), 'three\n');
    git(w, ws.folder, ['add', '-A']);
    git(w, ws.folder, ['commit', '-q', '-m', 'A late note']);

    for (const read of ['first', 'second']) {
      const { diffs } = await workspace(w, 'diff', ws.id) as { diffs: Diff[] };
      expect(diffs.filter((d) => d.touch === 'web-1'), `the ${read} read names the host's setting, what it was and what it is`).toEqual([{ touch: 'web-1', item: 'port', was: 80, now: 8080 }]);
      expect(diffs.filter((d) => d.touch === 'files').map((d) => d.item), `the ${read} read names the file`).toEqual(['notes/late.md']);
    }
  }, 180_000);
});
