// #322 AC7: each definition of done's drafted checks are kept under `.deepbuild/`, behind its guard: an agent's edit to
// one is refused as an edit to a spec is (design: Protection, "each definition of done's drafted checks (kept under
// `.deepbuild/`) are protected by a guard that is fail-closed"; the done-gate row's floor, the `.deepbuild/` guard).
//
// Both halves of the criterion, through the real hub and the real deep-hook:
//
// 1. Kept under `.deepbuild/`. A handed definition names its drafted check at `tests/checks/outside.sh`, a file the
//    repo holds at its base commit but a path the guard doesn't protect. The gate keeps drafted checks under
//    `.deepbuild/`, so no definition locks for the task with a check at that path, and the record says why: an event
//    after the task's creation (any kind but `user.ask` and `task.created`) whose data names the handed path and
//    `.deepbuild/`. The base locks a check at any path under the folder, so it fails here.
// 2. Behind its guard. A second session's handed definition locks with R1's check at `.deepbuild/checks/expired-token.sh`.
//    The agent's Edit and Write of that file are refused at PreToolUse, each refusal naming `deep_propose`, the way an
//    Edit of the spec `.deepbuild/done.yaml` is refused; an ordinary Edit of `src/auth.js` is allowed.
import { afterEach, describe, it } from 'vitest';
import {
  AC7, BEHAVIOR, BEHAVIOR_DRAFT, CHECK_FILE, cleanup, decision, expectTask, listed, lockedFor, makeWorld, must, replyText, req, requirementsOf,
  Session, settle, shown, startHub, trustRepo, type Ev, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The drafted check handed at a path outside `.deepbuild/`: a file the repo holds, which the guard doesn't protect. */
const OUTSIDE = 'tests/checks/outside.sh';
const OUTSIDE_BYTES = '#!/bin/sh\n# Drafted check handed outside .deepbuild/: a sixth login attempt within a minute is rejected.\nnode -e "process.exit(require(\'./src/auth.js\').lockout ? 0 : 1)"\n';
/** The prompt whose handed definition names it; a change request, so it opens a task. */
const OUTSIDE_PROMPT = 'add a lockout after five failed logins within a minute';
const OUTSIDE_DRAFT = () => ({ ask: OUTSIDE_PROMPT, requirements: [req('R1', 'A sixth login attempt within a minute is rejected', { check: OUTSIDE, asserts: [`${OUTSIDE}:3`] })], deliverables: ['src/auth.js'], budget: null });

/** The log position of the task's creation, or undefined while none is recorded. */
const createdAt = (events: readonly Ev[], ref: string): number | undefined => events.find((e) => e.kind === 'task.created' && e.data.task_ref === ref)?.log_pos;
/** Whether an event's data names `what`, anywhere in its JSON. */
const names = (e: Ev, what: string): boolean => JSON.stringify(e.data ?? {}).includes(what);
/** The events after the task's creation, of any kind but `user.ask` and `task.created`, whose data names the handed path. */
const aboutOutside = (events: readonly Ev[], ref: string): Ev[] => {
  const at = createdAt(events, ref);
  return at === undefined ? [] : events.filter((e) => e.log_pos > at && e.kind !== 'user.ask' && e.kind !== 'task.created' && names(e, OUTSIDE));
};
/** The definitions locked for the task whose requirements name a check at the handed path. */
const lockedOutside = (events: readonly Ev[], ref: string): Ev[] => lockedFor(events, ref).filter((lock) => requirementsOf(lock).some((r) => r.check === OUTSIDE));
/** A call's PreToolUse reply, trimmed for a message; never throws. */
const reply = (r: { before: Ran }): string => replyText(r.before).slice(0, 400) || 'no reason';

describe(`${AC7} each definition of done's drafted checks are kept under .deepbuild/, behind its guard`, () => {
  it(`${AC7} a handed check at ${OUTSIDE} never locks at that path and the record names it and .deepbuild/; the Edit and Write of ${CHECK_FILE} are refused naming deep_propose, as an Edit of .deepbuild/done.yaml is; an Edit of src/auth.js is allowed`, async () => {
    const w = makeWorld({ drafts: [OUTSIDE_DRAFT(), BEHAVIOR_DRAFT()], files: { [OUTSIDE]: OUTSIDE_BYTES } });
    await trustRepo(w, true);
    const hub = await startHub(w);

    // ---- Half 1: kept under .deepbuild/. The handed definition names a check outside it.
    const a = new Session(w);
    await a.start();
    await a.typed(OUTSIDE_PROMPT);
    await a.read('src/auth.js');
    const first = await settle(hub, (all) => {
      try { const ref = expectTask(all, a, OUTSIDE_PROMPT, AC7); return lockedFor(all, ref).length > 0 || aboutOutside(all, ref).length > 0; } catch { return false; }
    }, 45_000);
    const outsideRef = expectTask(first, a, OUTSIDE_PROMPT, AC7);
    const lockedAtPath = lockedOutside(first, outsideRef);
    must(lockedAtPath.length === 0, `${AC7} each definition of done's drafted checks are kept under .deepbuild/: the definition of ${outsideRef} must not lock with R1's check at ${OUTSIDE}, a path outside .deepbuild/ that its guard doesn't protect; it locked: ${listed(lockedAtPath)}`);
    const why = aboutOutside(first, outsideRef).filter((e) => names(e, '.deepbuild/'));
    must(why.length > 0, `${AC7} the record must say why the drafted check handed at ${OUTSIDE} wasn't kept there: an event after ${outsideRef}'s creation (log_pos ${createdAt(first, outsideRef) ?? 'none'}) naming ${OUTSIDE} and .deepbuild/; the events naming the path are ${listed(aboutOutside(first, outsideRef))}; the locks are ${listed(lockedFor(first, outsideRef))}`);

    // ---- Half 2: behind its guard. A definition locked with its check under .deepbuild/, which the agent then tries to change.
    const b = new Session(w);
    await b.start();
    await b.typed(BEHAVIOR);
    await b.read('src/auth.js');
    const second = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, b, BEHAVIOR, AC7)).length > 0; } catch { return false; } }, 45_000);
    const ref = expectTask(second, b, BEHAVIOR, AC7);
    const lock = lockedFor(second, ref)[0];
    must(lock !== undefined, `${AC7} the handed definition for "${BEHAVIOR}", whose R1 check is ${CHECK_FILE}, must lock for ${ref}: no definition.locked was recorded`);
    const r1 = requirementsOf(lock).find((r) => r.id === 'R1');
    must(r1?.check === CHECK_FILE, `${AC7} the locked definition's R1 must name its drafted check under .deepbuild/, ${CHECK_FILE}: R1 is ${JSON.stringify(r1 ?? null)}`);

    const edit = await b.editCall(CHECK_FILE, 'exit(require', 'exit(0 || require');
    must(!edit.allowed, `${AC7} the agent's Edit of the drafted check ${CHECK_FILE} must be refused at PreToolUse, as an edit to the spec is (decision ${decision(edit.before)}): ${shown(edit.before)}`);
    must(/deep_propose/.test(reply(edit)), `${AC7} the refusal of the Edit of ${CHECK_FILE} must name deep_propose, the way to propose the change: ${reply(edit)}`);
    const write = await b.writeCall(CHECK_FILE, '#!/bin/sh\nexit 0\n');
    must(!write.allowed, `${AC7} the agent's Write of the drafted check ${CHECK_FILE} must be refused at PreToolUse (decision ${decision(write.before)}): ${shown(write.before)}`);
    must(/deep_propose/.test(reply(write)), `${AC7} the refusal of the Write of ${CHECK_FILE} must name deep_propose: ${reply(write)}`);
    const spec = await b.editCall('.deepbuild/done.yaml', 'unit', 'none');
    must(!spec.allowed, `${AC7} an Edit of the spec .deepbuild/done.yaml is refused the same way (decision ${decision(spec.before)}): ${shown(spec.before)}`);
    must(/deep_propose/.test(reply(spec)), `${AC7} the refusal of the Edit of .deepbuild/done.yaml names deep_propose, as the drafted check's does: ${reply(spec)}`);
    const source = await b.editCall('src/auth.js', 'token.exp > 0', 'token.exp > 1');
    must(source.allowed, `${AC7} an ordinary Edit of src/auth.js is allowed (decision ${decision(source.before)}): ${shown(source.before)}`);
  }, 300_000);
});
