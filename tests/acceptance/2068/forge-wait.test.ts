import { expect, it } from 'vitest';
import { join } from 'node:path';
import { CRITERIA, MEMBER, OWNER, acknowledged, forge, prompt, sleep, taskFor, timing, until, world, type Seen, type World } from './helpers.ts';

/** Keep both sockets ready before the measured interval: B is sent 100 ms after A, not after A's reply. */
async function pair(w: World) {
  const a = await w.startSession();
  const b = await w.startSession();
  await w.rpc('rows.read'); // Drain startup work before measuring the prompt, not during its forge read.
  const post = await w.prepare(b, 'PostToolUse', {
    tool_name: 'Read', tool_use_id: 'fixture-read-2068', tool_input: { file_path: join(b.cwd, 'fixture.txt') },
    tool_response: { type: 'text', file: { content: 'synthetic fixture, no remote\n', numLines: 1 } },
  });
  const asking = await w.typed(a, prompt());
  const sentA = asking.send();
  do { await sleep(Math.max(0, sentA.at + 100 - performance.now())); } while (performance.now() < sentA.at + 100);
  const sentB = post.send();
  return { a, b, sentA, sentB };
}

it('#2068 AC1: B records before the first 5 s forge answer, not after A\'s whole forge wait', async () => {
  const f = await forge('five-seconds');
  let w: World | undefined;
  try {
    w = await world(f);
    const { b, sentA, sentB } = await pair(w);
    // Keep observing after a failed ordering, so the SAME test reports the base's actual B-record wait.
    // Five paged requests on the base take ~25 s. This is a test watchdog, not a product deadline.
    await until(() => w!.events.some((e) => e.id === sentB.id) && f.requests.some((r) => r.answered !== undefined), 40_000);
    w.scan();
    timing('five-seconds', f, sentA, sentB, w);
    const first = f.requests.find((r) => r.answered !== undefined);
    if (!first || first.requested >= sentB.at) throw Error('INCONCLUSIVE AC1: no forge read in flight at B arrival; not proof of the wait');
    const recorded = w.events.find((e) => e.id === sentB.id);
    expect(recorded, 'AC1 forge wait: B PostToolUse must reach the record (ACK is not recording)').toBeDefined();
    expect(recorded?.session, 'AC1 the recorded event belongs to B').toBe(b.id);
    expect(recorded?.kind, 'AC1 the event is B PostToolUse, not a different session event').toBe('tool.after');
    expect(recorded!.present - first.answered!, `AC1 forge wait: B recorded ${Math.round(recorded!.present - sentB.at)} ms after arrival; must be in the record before the first 5 s answer, not behind A's whole read`).toBeLessThan(0);
  } finally { await w?.stop(); await f.close(); }
}, 110_000);

/** A late poll cannot certify an event right on a deadline: report the observation interval, never silently pass it. */
function byDeadline(event: Seen | undefined, deadline: number, assertion: string) {
  if (event && event.absent < deadline && event.present > deadline)
    throw Error(`INCONCLUSIVE ${assertion}: commit first observed across deadline (${event.present - event.absent} ms observation interval)`);
  expect.soft(event !== undefined && event.present <= deadline, assertion).toBe(true);
}

// The issue leaves the read's exact duration open. The hook publicly advertises its outer reply deadline.
// A read that is still holding intake after that hold cannot deliver the prompt's task/context in that hold.
for (const mode of ['never', 'pages-forever'] as const) {
  it(`#2068 AC2: ${mode} forge wait ends within the prompt's acknowledged hold, with a words task${mode === 'never' ? ' and row warning' : ' despite continuing page answers'}`, async () => {
    const f = await forge(mode);
    let w: World | undefined;
    try {
      w = await world(f);
      const { a, sentA, sentB } = await pair(w);
      const hold = await acknowledged(sentA);
      const deadline = sentA.at + hold - sentA.epoch;
      // These polls use the record directly: an events.read RPC would itself queue behind the defective read.
      await sleep(Math.max(0, deadline - performance.now()));
      w.scan();
      const atDeadline = w.events.find((e) => e.id === sentA.id);
      const taskAtDeadline = taskFor(w, a);
      const bAtDeadline = w.events.find((e) => e.id === sentB.id);
      // For the never-answering forge also obtain the base's ~20 s eventual record time and its final row.
      // pages-forever is deliberately unending; stop only our hub after taking the deadline observations.
      if (mode === 'never') await until(() => Boolean(taskFor(w!, a)) && w!.events.some((e) => e.id === sentA.id), 30_000);
      w.scan();
      timing(mode, f, sentA, sentB, w, { acknowledged_hold_ms: hold - sentA.epoch,
        prompt_at_deadline: Boolean(atDeadline), task_at_deadline: Boolean(taskAtDeadline), b_at_deadline: Boolean(bAtDeadline) });
      expect(f.requests.length, 'AC2 forge wait fixture must actually receive the issue read').toBeGreaterThan(0);
      if (mode === 'never') expect(f.requests.some((r) => r.answered !== undefined), 'AC2 the forge never answers').toBe(false);
      else expect(f.requests.filter((r) => r.path.endsWith('/comments') && r.answered !== undefined).length, 'AC2 whole-read wait: multiple pages answered, so a per-request timeout cannot settle this read').toBeGreaterThan(1);
      byDeadline(atDeadline, deadline, `AC2 ${mode} forge wait: A prompt must be recorded by its acknowledged hold, not wait on a network request timeout`);
      byDeadline(taskAtDeadline, deadline, `AC2 ${mode} forge wait: A task must open from your words by the same hold, not merely return a hook reply`);
      byDeadline(bAtDeadline, deadline, `AC2 ${mode} forge wait: later B must not remain behind A's read`);
      const recorded = w.events.find((e) => e.id === sentA.id);
      const task = taskFor(w, a);
      expect.soft(recorded?.data.text, `AC2 ${mode} forge wait: record the person's original words`).toBe(prompt());
      expect.soft(recorded?.data.from, `AC2 ${mode} forge wait: preserve the person's origin`).toBe('person');
      // Match the requested subject, not a new exact generated title or an opaque task-ID spelling.
      expect.soft(String(task?.data.title ?? ''), `AC2 ${mode} forge wait: fallback task names the expired-token request, not the forge title or partial criteria`).toMatch(/expir\w*.*token|token.*expir/i);
      expect.soft(task !== undefined && recorded?.data.tasks?.includes(task.data.task_ref), `AC2 ${mode} forge wait: the recorded prompt names the actual fallback task`).toBe(true);
      if (mode === 'never') {
        // Do not accept a hidden session.reading alone: inspect the row the app/deep status actually reads.
        const read = await w.rpc('rows.read', { detail: true });
        const row = read.rows?.find((r: { session: string; id: string }) => r.session === a.id && r.id.startsWith('session:'));
        const detail = read.detail?.[`session:${a.id}`];
        const visible = JSON.stringify({ why: row?.why, flag: row?.flag, note: detail?.note, readings: detail?.readings, detailWhy: detail?.why });
        const namesSource = /issue|github|forge/i.test(visible);
        const unread = /couldn['’]?t|cannot|can['’]?t|unable|fail|unread|timed?\s*out|deadline|unavailable|unreachable|exceeded|no response|not\s+(?:be\s+)?(?:read|fetch|load)/i.test(visible);
        expect.soft(row, 'AC2 forge wait: A has a visible session row').toBeDefined();
        expect.soft(namesSource && unread, `AC2 forge wait: A's session row must say the issue could not be read, not silently fall back; visible row: ${visible}`).toBe(true);
      }
    } finally { await w?.stop(); await f.close(); }
  }, 110_000);
}

it('#2068 AC3: instant forge twin preserves issue criteria and every fixture author\'s membership role', async () => {
  const f = await forge('instant');
  let w: World | undefined;
  try {
    w = await world(f);
    // No handed definition or work-item stub: both definitions must come from the real GitHub work source.
    // #322's unchanged github.test.ts supplies the comment/outside/bot/partial-membership proofs (entry config).
    for (const [n, handle, role] of [[7, OWNER, 'owner'], [8, MEMBER, 'collaborator']] as const) {
      const a = await w.startSession();
      (await w.typed(a, prompt(n))).send();
      await until(() => w!.events.some((e) => e.kind === 'definition.locked' && e.session === a.id), 15_000);
      const task = taskFor(w, a);
      const lock = w.events.find((e) => e.kind === 'definition.locked' && e.session === a.id);
      expect(task, `AC3 instant source: issue ${n} opens A's task`).toBeDefined();
      expect(lock, `AC3 instant source: ${handle}'s criteria reach the task definition`).toBeDefined();
      expect(lock?.data.task_ref, 'AC3 definition belongs to the opened task').toBe(task?.data.task_ref);
      expect(lock?.data.requirements?.map((r: { text: string }) => r.text), 'AC3 preserve each full issue criterion in order, not a words-only fallback').toEqual(CRITERIA);
      expect(lock?.data.requirements?.map((r: { author: unknown }) => r.author), `AC3 each criterion keeps author ${handle} and membership role ${role}`).toEqual(CRITERIA.map(() => ({ handle, role })));
    }
    expect(f.requests.some((r) => r.path.endsWith('/collaborators') && r.page === 2), 'AC3 membership includes the collaborator on page 2').toBe(true);
  } finally { await w?.stop(); await f.close(); }
}, 110_000);
