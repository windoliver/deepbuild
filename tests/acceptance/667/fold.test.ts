// AC5: five taste calls and a choice from one session, through its deep mcp. The sixth lands inside one exception,
// "this session keeps asking", in `deep inbox`; answering it in bulk closes all six. Left alone past the sixth's
// deadline, the folded ask still takes its own default: a hub that lets the deadline pass with it open fails here.

import { afterEach, expect, test } from 'vitest';
import {
  AC, Agent, cleanup, closings, deep, events, expectStreamMatchesRecord, inbox, inboxRead, makeHome, Proof, startHub, Stream, writeSettings,
  type Hub,
} from './helpers.ts';
import { foldedPastDeadline, sixAsks } from './scenarios.ts';

afterEach(cleanup, 30_000);

test(`${AC[5]} the sixth open ask from one session lands inside one "this session keeps asking" exception in deep inbox, and answering that exception in bulk closes all six`, async () => {
  const proof = new Proof(`${AC[5]} bulk`);
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    hub = await startHub(home, { confirm: 'confirmed' });
    await agent.establish(hub);
    await agent.initialize();
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);
    const { tastes, sixth, exception } = await sixAsks(agent, hub, 'bulk');
    const six = [...tastes, sixth].map((e) => `ask:${e.id}`);
    const fold = `ask:${exception.id}`;

    // In deep inbox: one exception for the session, the sixth inside it, the first five on their own lines.
    const rows = await inbox(home, proof, 'six open asks from one session');
    const exceptions = rows.filter((r) => r.kind === 'exception' && r.session === agent.session);
    expect(exceptions.map((r) => r.ask), `${AC[5]}: deep inbox lists one exception for session ${agent.session}`).toEqual([fold]);
    expect(exceptions[0]!.line, `${AC[5]}: the exception says this session keeps asking`).toMatch(/keeps asking/i);
    const own = rows.find((r) => r.ask === six[5]);
    expect(own === undefined || /\bfolded\b/.test(own.line), `${AC[5]}: deep inbox shows the sixth ask, ${six[5]}, inside the exception, not on a line of its own: ${own?.line}`).toBe(true);
    for (const handle of six.slice(0, 5)) {
      const line = rows.find((r) => r.ask === handle);
      expect(line && !/\bfolded\b/.test(line.line), `${AC[5]}: deep inbox lists ${handle}, one of the first five, on its own line: ${line?.line}`).toBe(true);
    }
    const read = await inboxRead(hub);
    expect(read.asks.filter((r) => six.includes(r.ask)).map((r) => [r.ask, r.status === 'folded']), `${AC[5]}: the inbox holds the sixth ask folded and none of the first five`)
      .toEqual(six.map((h, i) => [h, i === 5]));

    // Answering the exception in bulk closes all six, each with its recommended option, and the exception.
    const bulk = await deep(home, ['inbox', 'answer', fold, 'together']);
    proof.ran(`deep inbox answer ${fold} together`, bulk);
    expect(bulk.code, `${AC[5]}: deep inbox answer ${fold} together exits 0: ${bulk.stdout}${bulk.stderr}`).toBe(0);
    const all = await events(hub);
    for (const [i, handle] of six.entries()) {
      expect(closings(all, handle).map((e) => [e.kind, e.data.answer]), `${AC[5]}: answering the exception in bulk closes ${handle} once, with its recommended option`)
        .toEqual([['ask.answered', i === 5 ? 'files' : 'green']]);
    }
    expect(closings(all, fold).map((e) => [e.kind, e.data.answer]), `${AC[5]}: the exception ${fold} is answered, together`).toEqual([['ask.answered', 'together']]);
    const left = (await inbox(home, proof, 'after the bulk answer')).map((r) => r.ask);
    expect(left.filter((h) => [...six, fold].includes(h)), `${AC[5]}: none of the six, nor the exception, is left in deep inbox`).toEqual([]);
    await expectStreamMatchesRecord(AC[5], stream, hub);
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
}, 300_000);

test(`${AC[5]} left unanswered past its deadline, the folded sixth ask takes its own default: a hub that lets the deadline pass with the ask still open fails, naming the ask`, async () => {
  await foldedPastDeadline();
}, 360_000);
