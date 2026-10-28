// The scenarios the tests and the planted wrong programs share: each drives the kernel through its surface
// and asserts only what the issue or the design states. A test runs one on the real kernel; plants.test.ts
// runs the same one on a plant and requires the failure its criterion names.

import { expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import type { Definition } from '../../../packages/tasks/src/index.ts';
import { ulid } from '../../../packages/record/src/index.ts';
import {
  asRecorded, CHANGE, CHECK_BYTES, CHECK_PATH, checkedDefinition, cli, core, issueDefinition, isObj, MID_CHANGE, MID_QUESTION, OPENS, OUTSIDE, pythonEdit,
  QUESTION, sessionDefinition, sha256, since, YOU, type World,
} from './helpers.ts';

/** The task.created events for a message handle, and the tasks row for it. */
async function taskFor(w: World, task_ref: string): Promise<{ created: number; row: Record<string, unknown> | undefined }> {
  const created = (await w.events('task.created')).filter((e) => isObj(e.data) && e.data.task_ref === task_ref).length;
  const row = (await w.table('tasks')).find((r) => r.task_ref === task_ref);
  return { created, row };
}
/** The user.ask the hook recorded for a message handle: by its session and msg. */
async function askFor(w: World, session: string, msg: number) {
  const asks = (await w.events('user.ask')).filter((e) => e.session === session && isObj(e.data) && e.data.msg === msg);
  expect(asks, `${session}#${msg}: one user.ask is recorded`).toHaveLength(1);
  return asks[0]!;
}

/** Criterion 7: a first prompt opens a task only when it asks for a change; the question's user.ask records tasks: []. */
export async function firstPrompts(w: World): Promise<void> {
  await w.start('S1', 'T1');
  await w.start('S2', 'T2');
  const before = await w.tail();
  const q = await w.prompt('S1', QUESTION);
  expect(q.task, `${q.handle}: a question opens no task`).toBeNull();
  const asked = await askFor(w, 'S1', q.msg);
  expect(asked.data, `${q.handle}: its user.ask records from person and tasks: []`).toMatchObject({ from: 'person', tasks: [], text: QUESTION });
  const noTask = await taskFor(w, q.handle);
  expect(noTask.created, `${q.handle}: no task.created for the question's message handle`).toBe(0);
  expect(noTask.row, `${q.handle}: no tasks row for the question's message handle`).toBeUndefined();
  const opened = since(await w.events(), before).filter((e) => OPENS(e.kind));
  expect(opened.map((e) => e.kind), `${q.handle}: a question opens no task and starts no drafting job`).toEqual([]);

  const c = await w.prompt('S2', CHANGE);
  const askedChange = await askFor(w, 'S2', c.msg);
  expect(askedChange.data, `${c.handle}: its user.ask names the task it opened`).toMatchObject({ from: 'person', tasks: [c.handle] });
  expect(c.task, `${c.handle}: a prompt asking for a change opens one task, keyed by its message handle`).toBe(c.handle);
  const task = await taskFor(w, c.handle);
  expect(task.created, `${c.handle}: one task.created`).toBe(1);
  expect(task.row, `${c.handle}: its tasks row sits under the session's thread`).toMatchObject({ task_ref: c.handle, thread: 'T2' });
}

/** Criterion 8: typed while the agent works, a question opens no task and a change opens one within one hook. */
export async function midTurn(w: World): Promise<void> {
  await w.start('S1', 'T1');
  const first = await w.prompt('S1', CHANGE);
  expect(first.task, `${first.handle}: the turn's prompt opens a task`).toBe(first.handle);
  await w.call('S1', 'read', 'src/auth/middleware.ts');
  // The turn is open: no stop yet. The next prompts are messages typed while the agent works.
  let before = await w.tail();
  const q = await w.prompt('S1', MID_QUESTION);
  expect(q.task, `${q.handle}: a question typed mid-turn opens no task`).toBeNull();
  expect((await askFor(w, 'S1', q.msg)).data, `${q.handle}: recorded as typed by a person, with tasks: []`).toMatchObject({ from: 'person', tasks: [] });
  expect((await taskFor(w, q.handle)).created, `${q.handle}: no task.created for the mid-turn question`).toBe(0);
  expect(since(await w.events(), before).filter((e) => OPENS(e.kind)).map((e) => e.kind), `${q.handle}: nothing opened`).toEqual([]);

  before = await w.tail();
  const c = await w.prompt('S1', MID_CHANGE);
  // Within one hook: the task is in the record when the prompt hook's call resolves, with nothing else appended since.
  const added = since(await w.events(), before);
  expect(c.task, `${c.handle}: a change typed mid-turn opens a task`).toBe(c.handle);
  expect(added.map((e) => e.kind), `${c.handle}: the hook appended the prompt and its task, in one hook`).toEqual(expect.arrayContaining(['user.ask', 'task.created']));
  expect((await taskFor(w, c.handle)).row, `${c.handle}: its tasks row sits under the session's thread`).toMatchObject({ task_ref: c.handle, thread: 'T1' });
  expect((await askFor(w, 'S1', c.msg)).data, `${c.handle}: its user.ask names its task`).toMatchObject({ tasks: [c.handle] });
}

/** The recorded definition.locked for a task. */
export async function lockedEvent(w: World, task_ref: string) {
  const locks = (await w.events('definition.locked')).filter((e) => isObj(e.data) && e.data.task_ref === task_ref);
  expect(locks, `${task_ref}: one definition.locked`).toHaveLength(1);
  return locks[0]!;
}

/** Criterion 9: the lock's hash, recomputed from the locked definition, equals the recorded one, and a requirement edited after the lock gives another. */
export async function lockHash(w: World): Promise<void> {
  await w.start('S1', 'T1');
  const c = await w.prompt('S1', CHANGE);
  const input = sessionDefinition(c.handle, CHANGE, w.repo, 1, w.clock.now());
  const locked = await w.tasks.lock(core('S1'), input);
  expect(locked.state, `${c.handle}: the definition locks`).toBe('locked');
  const event = await lockedEvent(w, c.handle);
  const data = event.data as Record<string, unknown>;
  expect(typeof data.hash, `${c.handle}: definition.locked carries the hash`).toBe('string');
  expect(data.issue_rev, `${c.handle}: definition.locked carries the issue's revision`).toBe(input.issue_rev);
  expect(data.base_commit, `${c.handle}: definition.locked carries the base commit`).toBe(input.base_commit);
  expect(validate(`definition.locked@${event.v}`, asRecorded(event)), `${c.handle}: the recorded definition.locked passes its schema`).toMatchObject({ ok: true });

  const read = await w.tasks.definition(c.handle);
  expect(read, `${c.handle}: the locked definition reads back`).toBeDefined();
  expect(read!.hash, `${c.handle}: the definition read back carries the recorded hash`).toBe(data.hash);
  expect(w.tasks.hashOf(read!), `${c.handle}: the hash recomputed from the locked definition equals the recorded one`).toBe(data.hash);
  const edited: Definition = structuredClone(read!);
  const r2 = edited.requirements.find((r) => r.id === 'R2')!;
  r2.text = `${r2.text}, except on the login route`;
  expect(w.tasks.hashOf(edited), `${c.handle}: requirement R2 edited after the lock gives another hash`).not.toBe(data.hash);
}

/** Criterion 5: text from an account outside the repo stays in, marked with its author, and the lock waits for one answer. */
export async function outsideText(w: World, comment: string): Promise<void> {
  await w.start('S1', 'T1');
  const task_ref = 'task:gh303';
  // "Fix #303" on the command line opens the issue's task under the session's thread.
  await w.record.append(cli, { v: 1, id: ulid(w.clock.now()), kind: 'task.created', ts: w.clock.now(), data: { task_ref, thread: 'T1', owner: 'you', title: 'Expired tokens are accepted' } });
  const before = await w.tail();
  const result = await w.tasks.lock(core('S1'), issueDefinition(task_ref, comment, w.repo, w.clock.now()));
  const locks = since(await w.events(), before).filter((e) => e.kind === 'definition.locked');
  expect(locks, `${task_ref}: no definition.locked while the outside text waits for your answer`).toEqual([]);
  expect(result.state, `${task_ref}: the definition waits for one answer before it locks`).toBe('waiting');
  const asks = since(await w.events(), before).filter((e) => e.kind === 'ask.created');
  expect(asks, `${task_ref}: one ask about the outside text`).toHaveLength(1);
  const ask = asks[0]!;
  expect((ask.data as Record<string, unknown>).kind, `${task_ref}: the ask is a definition ask`).toBe('definition');
  expect(result.waiting, `${task_ref}: the definition names the ask it waits for`).toBe(`ask:${ask.id}`);
  const r2 = result.requirements.find((r) => r.text === comment);
  expect(r2, `${task_ref}: the outside account's requirement stays in the definition`).toBeDefined();
  expect(r2!.author, `${task_ref}: what the outside text added is marked with its author, at the role the work.item@1 reading gives`).toEqual({ handle: OUTSIDE.handle, role: 'outside' });
  expect(result.requirements.find((r) => r.id === 'R1')!.author, `${task_ref}: your requirement carries your role from the reading`).toEqual({ handle: YOU.handle, role: 'owner' });

  // One answer on the trusted path, as the core records it, and the definition locks with the requirement still in.
  const options = (ask.data as { options: { id: string }[] }).options;
  expect(options.length, `${task_ref}: the ask offers options`).toBeGreaterThan(0);
  await w.record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: ulid(w.clock.now()), kind: 'ask.answered', subject: `ask:${ask.id}`, ts: w.clock.now(), data: { answer: options[0]!.id, plan_hash: null, decision: 'none' } });
  await w.tasks.tick();
  const after = await w.tasks.definition(task_ref);
  expect(after?.state, `${task_ref}: locks after one answer`).toBe('locked');
  const event = await lockedEvent(w, task_ref);
  const recorded = (event.data as { requirements: { text: string }[] }).requirements;
  expect(recorded.map((r) => r.text), `${task_ref}: the locked definition keeps the outside account's requirement`).toContain(comment);
  expect(JSON.stringify(event.data), `${task_ref}: the lock marks the requirement's author`).toContain(OUTSIDE.handle);
  expect(after!.requirements.find((r) => r.text === comment)!.author, `${task_ref}: the author's mark survives the lock`).toEqual({ handle: OUTSIDE.handle, role: 'outside' });
}

/** Criterion 10: the stop rule on recorded turns. Returns nothing; asserts each stop's reading. */
export async function stopRule(w: World): Promise<void> {
  const reading = async (session: string, stop: string) => {
    const read = (await w.tasks.stops(session)).find((r) => r.stop === stop);
    expect(read, `stop ${stop}: the stop rule reads it`).toBeDefined();
    return read!;
  };
  // Right after startup.
  await w.start('S1', 'T1');
  const startup = await w.stop('S1');
  expect((await reading('S1', startup)).claim, `stop ${startup}: a stop right after startup is no claim`).toBe(false);
  // Right after a resume: the same session starts again.
  await w.start('S1', 'T1');
  const resumed = await w.stop('S1');
  expect((await reading('S1', resumed)).claim, `stop ${resumed}: a stop right after a resume is no claim`).toBe(false);
  // Right after /clear: a new ID in the same thread.
  await w.start('S2', 'T1');
  const cleared = await w.stop('S2');
  expect((await reading('S2', cleared)).claim, `stop ${cleared}: a stop right after /clear is no claim`).toBe(false);
  // A typed question that opened no task, and a turn that only read two files.
  const q = await w.prompt('S2', QUESTION);
  expect(q.task, `${q.handle}: the question opens no task`).toBeNull();
  await w.call('S2', 'read', 'src/auth/middleware.ts');
  await w.call('S2', 'read', 'src/auth/expiry.ts');
  const answered = await w.stop('S2');
  expect((await reading('S2', answered)).claim, `stop ${answered}: an answer to your typed question, with two reads and no edit, is no claim`).toBe(false);
  // The same question's turn with one edit in it.
  await w.start('S3', 'T3');
  const q2 = await w.prompt('S3', QUESTION);
  expect(q2.task, `${q2.handle}: the question opens no task`).toBeNull();
  await w.call('S3', 'read', 'src/auth/middleware.ts');
  await w.call('S3', 'read', 'src/auth/expiry.ts');
  await w.call('S3', 'edit', 'src/auth/middleware.ts');
  const edited = await w.stop('S3');
  expect((await reading('S3', edited)).claim, `stop ${edited}: the same question's turn with one edit in it is a claim`).toBe(true);
}

/** Criterion 12: a drafted check file under .deepbuild/ changed by python after the lock. */
export async function checkFileChanged(w: World): Promise<void> {
  await w.start('S1', 'T1');
  const c = await w.prompt('S1', CHANGE);
  const file = w.write(CHECK_PATH, CHECK_BYTES);
  const locked = await w.tasks.lock(core('S1'), checkedDefinition(c.handle, w.repo, w.clock.now()));
  expect(locked.state, `${c.handle}: the definition locks`).toBe('locked');
  const digest = sha256(CHECK_BYTES);
  const approved = await w.tasks.approved(c.handle);
  expect(approved.map((f) => [f.path, f.sha256]), `${c.handle}: the lock keeps the check file by digest`).toEqual([[CHECK_PATH, digest]]);
  expect(Buffer.from(approved[0]!.bytes).toString('utf8'), `${c.handle}: the approved bytes are the drafted ones`).toBe(CHECK_BYTES);

  pythonEdit(file, 'exit 0\n');
  const before = await w.tail();
  const claim = await w.tasks.claim(core('S1'), c.handle);
  expect(claim.locked, `${c.handle}: the claim names the locked hash`).toBe(locked.hash);
  expect(claim.hash, `${c.handle}: the next claim's recomputed hash differs from the locked one after ${CHECK_PATH} changed`).not.toBe(locked.hash);
  expect(claim.changed, `${c.handle}: the claim names the file that changed`).toEqual([CHECK_PATH]);
  const kept = await w.tasks.approved(c.handle);
  expect(Buffer.from(kept[0]!.bytes).toString('utf8'), `${c.handle}: the claim's checks run the approved bytes kept by digest, not the changed file`).toBe(CHECK_BYTES);
  expect(kept[0]!.sha256, `${c.handle}: the kept bytes keep their digest`).toBe(digest);
  expect(claim.proposal, `${c.handle}: the change becomes a proposal`).toBeTypeOf('string');
  const proposal = since(await w.events(), before).find((e) => e.id === claim.proposal);
  expect(proposal, `${c.handle}: the proposal is in the record`).toBeDefined();
  expect(JSON.stringify(proposal!.data), `${c.handle}: the proposal names the file`).toContain(CHECK_PATH);
  // The lock stands: no definition.locked or definition.revised followed the change.
  expect(since(await w.events(), before).filter((e) => e.kind === 'definition.locked' || e.kind === 'definition.revised'), `${c.handle}: the lock changes only through a dispute you answer`).toEqual([]);
}
