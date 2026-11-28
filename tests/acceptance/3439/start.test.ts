// #3439 AC2 (#3439.0f3a1117): "A hub launched without the flag reaches `started`, answers a hook inside the hook budget
// and records one reading a process that says its start-up garbage was not shed. The merge base with the V8 call
// planted to do nothing, as Node says it may, never posts `started` and fails this test, naming the worker."
//
// The hub is `node <built CLI> hub run` with no Node option before the script and none in its environment. The hook is
// Claude Code's PreToolUse through the entry `deep setup` wrote, so through deep-hook; the record is `events.read`.
import { afterEach, expect, it } from 'vitest';
import { Claude, callId, cleanup, makeHome, newSession, payload, setup, tag, typedPrompt, waitFor } from '../27/helpers.ts';
import { AC, launchWithoutFlag, record, shownEvent, spooled, told, unshed } from './helpers.ts';

afterEach(cleanup, 120_000);

/** How many hooks may be sent before one must have been answered inside deep-hook's window (README: The hook budget). */
const TRIES = 20;

it(`${AC.start} a hub launched without the flag reaches started, answers a hook inside the hook budget and records one reading a process that says its start-up garbage was not shed`, async () => {
  const { home } = makeHome();
  const launched = await launchWithoutFlag(home);
  // The hub prints its ready line only once its core worker has posted `started`. A worker that throws on the way
  // there is named by the hub's own output, quoted here.
  expect(launched.ready, `${AC.start} a hub launched without the flag (${launched.command}) reaches started: it printed no ready line. Its output, which names the worker that failed:\n${told(launched.output())}\n`).toBe(true);
  const { hub } = launched;

  await setup(home);
  const claude = Claude.start(home);
  const s = newSession(home);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'List the files here.');
  /** One PreToolUse through deep-hook: whether the hub answered it inside deep-hook's window, and what the entry printed. */
  const hook = async (): Promise<{ answered: boolean; said: string }> => {
    const marker = `t3439-${tag(6)}`;
    const fired = await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: `echo ${marker}` }, tool_use_id: callId() }));
    const said = fired.ran.map((r) => `exit ${r.code}${r.stderr ? `, stderr ${JSON.stringify(r.stderr.slice(0, 300))}` : ''}`).join('; ');
    // deep-hook spools a request the hub didn't acknowledge in time; one the hub answered is in the record and not in the spool.
    if (spooled(home, marker) || fired.ran.some((r) => r.code !== 0)) return { answered: false, said };
    const recorded = await waitFor(async () => (await record(hub)).some((e) => e.kind === 'tool.before' && JSON.stringify(e.data).includes(marker)), 30_000, `the call ${marker} to reach the record`).catch(() => false);
    return { answered: recorded && !spooled(home, marker), said };
  };
  const tries: string[] = [];
  let answered = false;
  for (let k = 0; k < TRIES && !answered; k++) {
    const one = await hook();
    answered = one.answered;
    tries.push(`${k + 1}: ${one.answered ? 'answered' : 'not answered in time'} (${one.said})`);
  }
  expect(answered, `${AC.start} the hub launched without the flag answers a hook inside the hook budget: of ${tries.length} PreToolUse hooks through deep-hook, none was answered inside its window (each was spooled, or never reached the record):\n${tries.join('\n')}\nThe hub's output:\n${told(launched.output(), 1500)}\n`).toBe(true);

  // The reading: one event of the record whose kind is a reading and whose words say the garbage was not shed.
  const first = await waitFor(async () => { const found = unshed(await record(hub)); return found.length ? found : undefined; }, 60_000, 'a reading that says start-up garbage was not shed').catch(() => []);
  const kinds = [...new Set((await record(hub)).map((e) => e.kind))].join(', ');
  expect(first.length, `${AC.start} the hub launched without the flag records a reading that says its start-up garbage was not shed: within 60 s of answering a hook, no event of the record has a reading's kind and says "shed". The record's kinds: ${kinds}. The hub's output:\n${told(launched.output(), 1500)}\n`).toBeGreaterThan(0);

  // One a process, not one a thread: three more hooks go through the main thread, a parser and the core, then the
  // record is read again.
  for (let k = 0; k < 3; k++) await hook();
  const all = unshed(await record(hub));
  expect(all.map(shownEvent), `${AC.start} one reading a process: the hub is one process, with a main thread, a core worker and a parser, and its record holds ${all.length} readings that say start-up garbage was not shed`).toHaveLength(1);
}, 600_000);
