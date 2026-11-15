// #1606 AC8: a signed answer from a `deep` command inside an agent session's process tree is refused as that session's.
// An agent session is #667's stand-in, established with the hub through its hooks; its shell runs a deep command
// (fixtures/deep-answer.mjs: the cli role, the control token, its own process named as the peer, as every deep command
// calls the hub) that sends `ask.answer` approving a fixture authority ask, signed in the design's format by a device you
// paired (#1579's signer). The merge base counts it, since a signed answer counts there from any connection; that run is
// in BASE-FAILURE.txt.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE } from '../16/helpers.ts';
import { AC, Agent, answeredNothing, approve, cleanup, connect, DEEP_ANSWER, hubWorld, newDevice, pair, signNew, type Line } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC[8]} A signed ask.answer() call from a deep command inside an agent session's process tree is refused, naming the session`, () => {
  it(`${AC[8]} a deep command run in an agent session's shell, sending an approval signed by a device you paired, is refused naming the session, and the ask stays open`, async () => {
    const w = await hubWorld({ asks: [{ source: 'effect.push', question: 'Push the release branch to origin?' }] });
    const ask = w.asks[0]!;
    const cli = await connect(w);
    const hub = String(cli.hello?.hub ?? '');
    const device = newDevice('Test phone');
    await pair(w, device);
    const agent = Agent.start(w.home);
    await agent.establish(w.hub.socket);
    const file = join(dirname(w.home), 'answer.json');
    writeFileSync(file, JSON.stringify(signNew('ask.answer', approve(ask), device, { hub, at: Date.now() })));
    const ran = await agent.run([NODE, DEEP_ANSWER, file]);
    let reply: Line | undefined;
    try { reply = JSON.parse(ran.stdout.trim().split('\n').at(-1) ?? '') as Line; } catch { reply = undefined; }
    if (!reply || reply.failed !== undefined || !('result' in reply || 'error' in reply)) throw Error(`BLOCKED: the deep command got no reply from the hub: exit ${ran.code}, ${ran.stdout}${ran.stderr}`);
    const session = agent.session.id;
    const failures: string[] = [];
    if (!('error' in reply)) failures.push(`${ask.handle} was answered: the hub counted a signed ask.answer from a deep command inside agent session ${session}'s process tree: ${JSON.stringify(reply.result).slice(0, 300)}`);
    else if (!JSON.stringify(reply.error).includes(session)) failures.push(`the hub refused it without naming agent session ${session}: ${JSON.stringify(reply.error).slice(0, 600)}`);
    failures.push(...(await answeredNothing(cli, ask.handle)));
    expect(failures).toEqual([]);
  }, 600_000);
});
