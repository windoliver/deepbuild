// #111.ddf55f68, the tool-call half, blind redraft. You rejected a direction in chat; an agent's Bash call that revives
// it is denied by deep-hook, citing the decision. The calls that must run are ones the base's guards let through on a
// repo with no spec, so they aren't package installs: with the hub up, `npm install <x>` is effect:dependency, a
// decision a plan or a standing rule answers (README here). They run first, so a base run shows they pass there.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  claudeSession, cleanup, compile, decision, decisions, denialText, eventsOf, memoryHome, put, shown, toolCallIn, type Mem,
} from '../helpers.ts';

afterAll(cleanup, 60_000);
const AC = '#111.ddf55f68';
const KEY = 'kafka';

/** Asks filed that name the direction: a stop that also asks you is the same question twice (invariant 4). */
const asksNaming = async (m: Mem): Promise<number> =>
  (await eventsOf(m.h.home, ['ask.created'])).filter((e) => JSON.stringify(e.data).includes(KEY)).length;

describe(`${AC} a tool call that revives a direction you rejected`, () => {
  it(`${AC} is denied by deep-hook citing decision:<id>; a call that doesn't revive it runs, a longer name is another key, and the same call in another repo runs`, async () => {
    const m = memoryHome({ agents: ['claude'] });
    put(join(m.web, 'scripts', 'live.sh'), '#!/bin/sh\n');
    claudeSession(m, m.api,
      { role: 'user', text: `We went over the queue for api and said no to it. rejected: \`${KEY}\`.` },
      { role: 'assistant', text: 'Understood, the queue stays. rejected: `nats`.' });
    await compile(m);

    const revive = `sh scripts/live.sh ${KEY}`;
    const runs = async (cwd: string, command: string, why: string): Promise<void> => {
      const ran = await toolCallIn(m, cwd, command);
      expect(decision(ran), `${why} (\`${command}\`): ${shown(ran)}`).toBe('allow');
    };
    await runs(m.api, 'sh scripts/live.sh rabbitmq', 'a direction nobody rejected runs');
    await runs(m.api, 'sh scripts/live.sh nats', 'what only an agent called rejected runs');
    await runs(m.api, `sh scripts/live.sh ${KEY}-lite`, 'a longer name holding the key is another key');
    await runs(m.web, revive, 'the same call in another repo runs');

    const denied = await toolCallIn(m, m.api, revive);
    expect(decision(denied), `the revival is denied: ${shown(denied)}`).toBe('deny');
    const saved = (await decisions(m)).filter((d) => JSON.stringify(d.data).includes(KEY));
    expect(saved.length, `your rejection is one saved decision: ${JSON.stringify(saved).slice(0, 500)}`).toBe(1);
    expect(denialText(denied as never), 'the denial cites the decision by its handle').toContain(saved[0]!.handle);

    // The plainest revival is a package install, which the base treats as a dependency decision. The rejection answers
    // that decision already, so it's denied with the citation, and you aren't asked.
    const asksBefore = await asksNaming(m);
    const install = await toolCallIn(m, m.api, `npm install ${KEY}`);
    expect(decision(install), `an install of it is denied: ${shown(install)}`).toBe('deny');
    expect(denialText(install as never), 'citing the same decision').toContain(saved[0]!.handle);
    expect(await asksNaming(m), 'and no ask reaches you').toBe(asksBefore);
  }, 900_000);
});
