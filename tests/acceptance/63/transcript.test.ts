// #63 AC3: after an agent deletes a session's transcript, with the archive extension turned off, `deep read
// session:<id> --slice` returns the slice from the evidence its `transcript.archived` event links, and a session with
// no such event returns an error naming the handle, never an empty slice; a reader that opens the archive's folder
// or the agent's transcript path fails this test.
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { missingSliceProblems, sessionSliceProblems, storedMessages } from './checks.ts';
import { session, tag, transcriptOf, transcriptPath, writeTranscript } from './corpus.ts';
import { AC, cleanup, deep, letters, ulid } from './helpers.ts';
import { folderReader } from './wrong.ts';
import { hookIn, openWorld } from './world.ts';

afterAll(cleanup);

describe(`AC3 ${AC[3]} a session handle resolves through the record, by its transcript.archived link, never through a folder`, () => {
  it("AC3 a deleted transcript reads from the evidence its link names; an unlinked session is an error naming the handle; (wrong program) a reader of the archive's folder or the agent's path fails", async () => {
    const token = `ghp_${'dh63AC3x'.repeat(4)}wxyz`;
    const a = session(3000, { project: 'api', count: 5, texts: { 3: `${tag(3000, 3)} The staging token is ${token} for now.` } });
    const b = session(3001, { project: 'api', count: 5 });
    const w = await openWorld();
    try {
      // Day 0: the archive copies A, then is turned off: it runs no pass again in this test.
      await w.seed([a]);
      // The agent deletes A's transcript. A file in an archive folder of its own holds other text.
      const path = transcriptPath(w.agents, a);
      expect(existsSync(path), "A's transcript was where Claude Code keeps it").toBe(true);
      rmSync(path);
      const decoy = session(3000, { project: 'api', count: 5, texts: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, `DECOY-ARCHIVE-FOLDER message ${n}`])) });
      const folderCopy = join(w.root, 'archive', 'claude', `${a.id}.jsonl`);
      mkdirSync(dirname(folderCopy), { recursive: true });
      writeFileSync(folderCopy, transcriptOf(decoy));
      // B: recorded by its hooks, its transcript still in the agent's folder, never archived (the archive is off).
      const at = w.clock.now();
      await w.record.append(hookIn(letters(b.id), b.project), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: b.worktree, branch: 'main', thread: b.id } });
      writeTranscript(w.agents, b);
      await w.record.sync();
      const before = (await w.events()).length;

      const stored = await storedMessages(w, a.handle);
      expect(stored.messages.length, "the archived copy holds A's messages").toBe(5);
      expect(stored.messages.map((m) => m.text).join('\n'), 'the archived copy is redacted').not.toContain(token);
      const real = (handle: string) => deep(['read', handle, '--slice', '--json', '--root', w.root]);
      const readA = real(a.handle);
      expect(sessionSliceProblems(a.handle, readA, stored.messages, ['DECOY-ARCHIVE-FOLDER']), 'deep read of the deleted session').toEqual([]);
      expect(readA.stdout, 'the slice is the redacted copy').not.toContain(token);
      const plain = deep(['read', a.handle, '--slice', '--root', w.root]);
      expect(plain.status, `deep read ${a.handle} --slice (plain) exits 0: ${plain.stderr}`).toBe(0);
      for (const m of stored.messages) expect(plain.stdout, `the plain slice holds ${m.at}`).toContain(m.text.slice(0, 40));

      const bTexts = b.messages.map((m) => m.text);
      expect(missingSliceProblems(b.handle, real(b.handle), bTexts), 'deep read --json of a session no transcript.archived event links').toEqual([]);
      expect(missingSliceProblems(b.handle, deep(['read', b.handle, '--slice', '--root', w.root]), bTexts), 'deep read (plain) of a session no transcript.archived event links').toEqual([]);
      expect((await w.events()).length, 'deep read is read-only: the record gained nothing').toBe(before);

      // The twin, through the same checks.
      const twin = folderReader(w, [a, b]);
      const onA = sessionSliceProblems(a.handle, twin(a.handle), stored.messages, ['DECOY-ARCHIVE-FOLDER']);
      expect(onA.length, "the archive folder's reader gives the wrong slice for A").toBeGreaterThan(0);
      expect(onA.join('\n'), 'naming the handle').toContain(a.handle);
      const onB = missingSliceProblems(b.handle, twin(b.handle), bTexts);
      expect(onB.length, "the agent's-path reader gives B a slice instead of an error").toBeGreaterThan(0);
      expect(onB.join('\n'), 'naming the handle').toContain(b.handle);
      // And with the archive folder gone, the folder reader finds A's transcript path deleted: still no slice.
      rmSync(folderCopy);
      expect(sessionSliceProblems(a.handle, twin(a.handle), stored.messages, []).join('\n'), "the agent's-path reader fails A once its transcript is gone").toContain(a.handle);
    } finally {
      await w.close();
    }
  }, 600_000);
});
