// AC15 #18.72bbbbb5 With the waiter entry's timeout edited to 300 s and an ask deadline of 20 minutes in your
// settings, the waiter relation shows broken, naming 300 s and 20 minutes, and an answer given 10 minutes after the
// stop arrives at the next prompt with the ask saying why, never lost; running setup again restores the timeout, and
// the relation holds.
//
// Your settings are ~/.deepbuild/config.json's asks block (#318), where the longest deadline is 20 minutes. The
// waiter is DeepBuild's asyncRewake entry (README: The waiter). Claude Code's side runs in the stand-in: it starts
// the waiter at the stop and stops it at its 300 s timeout, compressed (README: Time). The hub is started again
// 10 minutes on with its test clock (#16), and you answer then with `deep inbox answer` (#24, the OS confirmation
// stubbed to confirm).

import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, MINUTE, allEvents, cleanup, deep, doctor, editConfig, eventually, firedShown, inbox, itemText, makeHome, newSession, ours, payload,
  readSettings, readingTexts, setTimeoutOf, setup, shown, startHub, stopHub, tag, typedPrompt, waitFor, waiterEntry, type DoctorItem,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const brokenWaiter = (text: string) => /waiter/i.test(text) && text.includes('300 s') && text.includes('20 minutes');

describe('AC15 #18.72bbbbb5 With the waiter entry\'s timeout edited to 300 s and an ask deadline of 20 minutes in your settings, the waiter relation shows broken, naming 300 s and 20 minutes, and an answer given 10 minutes after the stop arrives at the next prompt with the ask saying why, never lost; running setup again restores the timeout, and the relation holds', () => {
  it('AC15 #18.72bbbbb5 a 300 s waiter against a 20-minute deadline reads broken; the answer given 10 minutes after the stop arrives at the next prompt, the ask saying why; setup again restores the timeout', async () => {
    const { home } = makeHome();
    // Your settings: every kind of ask waits at most 20 minutes.
    editConfig(home, (config) => { config.asks = { deadline: { taste: '20m', authority: '10m', unblock: '15m', exception: '15m', choice: '20m', definition: '4m' } }; });
    let hub = await startHub(home);
    await setup(home);
    const installed = waiterEntry(readSettings(home)).hook;
    expect(installed.timeout, `setup gives the waiter a timeout as long as the longest ask deadline, 20 minutes (the timeout to restore): ${JSON.stringify(installed)}`).toBeGreaterThanOrEqual(1200);
    await stopHub(hub);

    // You edit the waiter's timeout to 300 s; the hub starts on it.
    setTimeoutOf(home, waiterEntry, 300);
    hub = await startHub(home);
    const atStart = await eventually(async () => (await readingTexts(hub)).some(brokenWaiter), 20_000);
    expect(atStart, 'AC15 the waiter relation must show broken at hub start, naming 300 s and 20 minutes').toBe(true);
    const broken = await doctor(home);
    expect(broken.items.find((i: DoctorItem) => i.code === 'timing_relation_broken' && brokenWaiter(itemText(i))), `AC15 deep doctor must show the waiter relation broken as timing_relation_broken, naming 300 s and 20 minutes: ${broken.ran.stdout}`).toBeDefined();
    expect(broken.ran.code, 'AC15 deep doctor exits 1 with the broken relation').toBe(1);

    // A session asks you something, its ask's deadline 20 minutes, and stops.
    const s = newSession(home);
    const claude = Claude.start(home);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, 'Pick a header colour.');
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a header colour.' }));
    await claude.initialize();
    const t = tag(3);
    const green = { id: `green${t}`, label: `Green header ${t}` };
    const question = `Which header colour for ${t}?`;
    void claude.deepTool(s, 'deep_ask', { kind: 'choice', question, options: [{ id: `blue${t}`, label: `Blue header ${t}` }, green], recommended: `blue${t}` }).catch(() => undefined);
    const created = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}"`);
    const handle = `ask:${created.id}`;
    // The ask says why its answer may wait for the next prompt: its deadline passes the waiter's timeout.
    const askTexts = async () => [
      ...(await inbox(hub)).filter((row) => row.ask === handle).map((row) => JSON.stringify(row)),
      ...(await allEvents(hub)).filter((e) => e.id === created.id || e.subject === handle || JSON.stringify(e.data).includes(handle)).map((e) => JSON.stringify(e.data)),
    ];
    const says = await eventually(async () => (await askTexts()).some((text) => text.includes('300 s') && /next prompt/i.test(text)), 20_000);
    expect(says, `AC15 the ask must say why its answer may come at the next prompt, naming the waiter's 300 s: ${(await askTexts()).join('\n').slice(0, 2000)}`).toBe(true);

    void claude.hook('Stop', payload(s, 'Stop'));
    const waiter = await waitFor(async () => (await claude.background()).find((r) => r.asyncRewake && r.event === 'Stop' && r.ended === null), 30_000, 'DeepBuild\'s waiter, started at the stop');
    expect(waiter.timeout, 'the waiter runs with the 300 s you set (the control)').toBe(300);
    // Claude Code stops the waiter at its 300 s timeout; nothing has answered by then.
    await claude.expire(300);
    await stopHub(hub);

    // 10 minutes after the stop you answer.
    hub = await startHub(home, { clock: Date.now() + 10 * MINUTE });
    const answered = await deep(home, ['inbox', 'answer', handle, green.id]);
    expect(answered.code, `you answer ${handle} with ${green.id} 10 minutes after the stop: ${shown(answered)}`).toBe(0);

    // The next prompt brings it, never lost.
    typedPrompt(s, 'Anything for me?');
    const next = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Anything for me?' }));
    const delivered = ours(next).filter((r) => !r.async);
    expect(delivered.some((r) => r.code === 0 && (r.stdout.includes(green.label) || r.stdout.includes(green.id))), `AC15 the answer given after the waiter's timeout must arrive at the next prompt, in DeepBuild's UserPromptSubmit reply: ${firedShown(next)}`).toBe(true);
    for (const r of delivered) expect(r.stdout, `AC15 delivering the answer must not block your prompt: ${firedShown(next)}`).not.toMatch(/"decision"\s*:\s*"block"/);

    // Setup again restores the timeout, and the relation holds.
    await setup(home);
    const restored = waiterEntry(readSettings(home)).hook;
    expect(restored.timeout, `AC15 running setup again must restore the waiter's timeout to at least the 20-minute deadline: ${JSON.stringify(restored)}`).toBeGreaterThanOrEqual(1200);
    const holds = await doctor(home);
    expect(holds.items.filter((i) => i.code === 'timing_relation_broken' && /waiter/i.test(itemText(i))), `AC15 after setup the waiter relation must hold: ${holds.ran.stdout}`).toEqual([]);
    expect(holds.items.some((i) => i.level === 'ok' && /waiter/i.test(itemText(i)) && itemText(i).includes('20 minutes')), `AC15 after setup deep doctor must show the waiter relation as an ok item naming the 20 minutes: ${holds.ran.stdout}`).toBe(true);
  }, 900_000);
});
