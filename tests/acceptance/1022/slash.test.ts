// AC2: a Codex slash command records no user.ask; if Codex fires UserPromptSubmit for it, the adapter records it as a
// reading naming the command, and it opens no ask and bounds no turn (README).
import { afterAll, expect, test } from 'vitest';
import { AC2, cleanup, commandAsks, control, deliver, readings, recorded, replay, said, settled, sleep, world, type Ev } from './helpers.ts';

afterAll(cleanup);

const TYPED = ['say hi'];

test(`${AC2} /compact records no user.ask; fired as UserPromptSubmit it is a reading naming /compact that opens no ask and bounds no turn`, async () => {
  const problems: string[] = [];
  // Codex fires no UserPromptSubmit for the command (the recorded 0.144.0 run).
  {
    const w = await world();
    const run = recorded(w);
    await replay(w, run);
    problems.push(...commandAsks(await settled(w, run.session), TYPED).map((p) => `no UserPromptSubmit: ${p}`));
  }
  // Codex fires UserPromptSubmit with the command as its prompt, in the command's own turn, before PreCompact.
  {
    const w = await world();
    const run = recorded(w);
    const pre = run.hooks.findIndex((h) => h.event === 'PreCompact');
    await replay(w, run, run.hooks.slice(0, pre));
    const before = await settled(w, run.session);
    const top = before.at(-1)?.log_pos ?? 0;
    const rowBefore = ((await control(w, 'status.read')).rows as { id: string; state?: string }[]).find((r) => r.id === run.session);
    const { trigger: _trigger, ...base } = run.hooks[pre]!.payload;
    await deliver(w, run.session, 'UserPromptSubmit', { ...base, hook_event_name: 'UserPromptSubmit', permission_mode: 'default', prompt: '/compact' });
    // Its reading, recorded for the prompt hook itself, before PreCompact fires.
    let named: Ev | undefined;
    for (const end = Date.now() + 15_000; !named && Date.now() < end; await sleep(250)) {
      named = readings(await settled(w, run.session)).find((e) => e.log_pos > top && String(e.data.reading).includes('/compact'));
    }
    if (!named) problems.push('UserPromptSubmit "/compact": no reading naming /compact was recorded for it');
    await replay(w, run, run.hooks.slice(pre));
    const after = (await settled(w, run.session)).filter((e) => e.log_pos > top);
    problems.push(...commandAsks(after, TYPED).map((p) => `UserPromptSubmit "/compact": ${p}`));
    const opened = after.filter((e) => e.kind === 'task.created' || e.kind === 'ask.created' || e.kind === 'permission.request');
    if (opened.length) problems.push(`UserPromptSubmit "/compact" opened an ask: ${opened.map(said).join(' | ')}`);
    const working = after.filter((e) => e.kind === 'session.state' && e.data.state === 'working');
    if (working.length) problems.push(`UserPromptSubmit "/compact" began a turn: ${working.map(said).join(' | ')}`);
    const rowAfter = ((await control(w, 'status.read')).rows as { id: string; state?: string }[]).find((r2) => r2.id === run.session);
    if (rowAfter?.state !== rowBefore?.state) problems.push(`UserPromptSubmit "/compact" bounded a turn: the session's row read "${rowBefore?.state}" after the typed prompt's stop and "${rowAfter?.state}" after /compact`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
}, 600_000);
