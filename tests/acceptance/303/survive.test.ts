// #303 AC4: definitions survive a resume and a compaction. You ask for a change, and its handed definition locks.
// Claude Code then compacts the session (SessionStart compact, the same session ID, as the corpus's 2.1.304 compact
// session has it), and later the hub stops and the session resumes on a new hub (SessionStart resume). "Survive" is
// read where the design puts it: "After a compaction or a resume, SessionStart sends the open asks' requirement IDs
// again, in one short block", so each of those SessionStart replies names the definition's requirement IDs; and the
// record still holds that one locked definition for the task, with its hash, and no new lock or revision of it.
import { afterEach, describe, it } from 'vitest';
import {
  AC4, BEHAVIOR, askNamed, cleanup, expectTask, lockedFor, makeWorld, must, said, Session, settle, shown, startHub, stopHub,
  taskOf, type Ev, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The SessionStart reply names each requirement ID, as a word: what deep-hook gives Claude Code on stdout. */
function namesIds(r: Ran, ids: string[], when: string): void {
  const missing = ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(r.stdout));
  must(!missing.length, `${AC4} the SessionStart after ${when} must send the open ask's requirement IDs again (${ids.join(', ')}); it names none of ${missing.join(', ')}: ${shown(r)}`);
}

describe(`${AC4} definitions survive a resume and a compaction`, () => {
  it(`${AC4} after a compaction and after a resume on a restarted hub, SessionStart names the open ask's requirement IDs, and the record keeps its one locked definition`, async () => {
    const w = makeWorld();
    let hub = await startHub(w);
    const s = new Session(w);
    await s.start();
    await s.typed(BEHAVIOR);
    await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
    await s.stop('checkToken now rejects a token whose exp has passed.');
    let events: Ev[] = await settle(hub, (all) => { const ref = taskOf(askNamed(all, s, BEHAVIOR)); return ref !== undefined && lockedFor(all, ref).length > 0; });
    const ref = expectTask(events, s, BEHAVIOR, AC4);
    const [lock] = lockedFor(events, ref);
    must(lock !== undefined, `${AC4} the task ${ref} must hold a locked definition before the compaction: no definition.locked for it`);
    const ids = ((lock!.data.requirements ?? []) as { id: string }[]).map((r) => r.id);
    must(ids.length === 2, `${AC4} the locked definition holds the handed requirements R1 and R2: ${said(lock)}`);

    const compacted = await s.start('compact');
    namesIds(compacted, ids, 'the compaction');
    await s.read('src/auth.ts');
    await s.stop('Carrying on after the compaction.');
    await stopHub(hub);
    hub = await startHub(w);
    const resumed = await s.start('resume');
    namesIds(resumed, ids, 'the resume on a restarted hub');

    events = await settle(hub, () => true);
    const locks = lockedFor(events, ref);
    must(locks.length === 1 && locks[0]!.data.hash === lock!.data.hash, `${AC4} the record keeps the task's one locked definition, hash ${String(lock!.data.hash)}, through the compaction and the resume: ${locks.map(said).join('; ')}`);
    const revised = events.filter((e) => e.kind === 'definition.revised' && e.data.task_ref === ref);
    must(!revised.length, `${AC4} nothing revised the definition: ${revised.map(said).join('; ')}`);
  }, 240_000);
});
