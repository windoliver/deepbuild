// #1579 AC3: an app answer signed in the new format counts, and the card's flow is otherwise unchanged. The app's half
// runs the app's own signer and send path (`deep_app::answer::send`, app/answer.rs) against a real hub, through a socket
// in front of the hub that keeps what the app sent, so the test reads the signature the app made; the hub's half holds
// what the record hands on to its twin answered from the CLI, as #34 AC4 does.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE } from '../16/helpers.ts';
import {
  cleanup, eventsAbout, hubNow, judgeCounted, MINUTE, paramsHash, REPO, run, signFor, tap, tempDir, world, type Line, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** What the record hands the agent's adapter for an answer: everything ask.answered says but where it came from. */
const delivered = (data: Line) => ({ answer: data.answer, decision: data.decision, plan_hash: data.plan_hash, verified: data.verified, words: data.words ?? null, image: data.image ?? null });

/** The CLI's twin answer, confirmed by the OS stand-in: the flow at the base, with no signature at all. */
async function cliTwin(w: World, ask: string): Promise<Line> {
  w.confirm.say(true);
  const reply = await w.cli.call('ask.answer', { ask, option: 'green' }, 20_000);
  w.confirm.say(false);
  expect(await judgeCounted(w, ask, reply), 'the CLI twin counts').toBeNull();
  return (await eventsAbout(w.app, ask, 'ask.answered'))[0]!.data as Line;
}

/** Judges a signature the app sent: null when it is the new format over exactly these params, for this hub, now. */
function judgeNewFormat(sent: Line, method: string, hubId: string, now: number, deviceId: string | undefined): string | null {
  const s = sent.params?.signature;
  if (typeof s !== 'object' || s === null) return `the app sent ${method} with signature ${JSON.stringify(s)}, not { signed, sig }`;
  const signed = s.signed as Line | undefined;
  if (!signed || typeof s.sig !== 'string') return `the app's signature has no signed fields or no sig: ${JSON.stringify(s)}`;
  if (signed.method !== method) return `the app signed method ${JSON.stringify(signed.method)}, not ${method}`;
  if (signed.hub !== hubId) return `the app signed hub ${JSON.stringify(signed.hub)}, not this hub's ID ${hubId}`;
  if (typeof signed.at !== 'number' || Math.abs(signed.at - now) > 2 * MINUTE) return `the app signed at ${JSON.stringify(signed.at)}, not about the hub's now ${now}`;
  if (typeof signed.once !== 'string' || !signed.once) return `the app signed no once-only ID: ${JSON.stringify(signed.once)}`;
  if (signed.params_hash !== paramsHash(sent.params)) return `the app signed params_hash ${JSON.stringify(signed.params_hash)}, not the hash of the params it sent (${paramsHash(sent.params)})`;
  if (typeof signed.device !== 'string' || !signed.device.startsWith('device:') || signed.device === deviceId) return `the app signed as ${JSON.stringify(signed.device)}, not its own paired device`;
  if ('device' in sent.params) return `the app's answer still carries device ${JSON.stringify(sent.params.device)} beside the signature`;
  return null;
}

let built: Promise<string> | undefined;
/** The acceptance_1579 test binary of deep-app, built once (README, Pinned here: 6). */
function testBinary(): Promise<string> {
  built ??= run('cargo', ['test', '--locked', '-p', 'deep-app', '--test', 'acceptance_1579', '--no-run', '--message-format=json'], {
    env: { ...process.env, PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}` } as Line, cwd: REPO, timeoutMs: 1_800_000,
  }).then((r) => {
    for (const line of r.stdout.split('\n')) {
      try {
        const m = JSON.parse(line) as Line;
        if (m.reason === 'compiler-artifact' && m.target?.name === 'acceptance_1579' && m.executable) return m.executable as string;
      } catch { /* not a message */ }
    }
    throw Error(`BLOCKED: deep-app's acceptance_1579 test target didn't build (README, Pinned here: 6): ${r.stderr.split('\n').filter((l) => /error/.test(l)).slice(0, 10).join('\n') || r.stderr.slice(-2000)}`);
  });
  return built;
}

describe('AC3 #1579 an app answer signed in the new format counts, and the card\'s flow is otherwise unchanged', () => {
  it('AC3 the app\'s own signer answers a taste call: the answer counts, its signature is the new format, and it is handed on as its CLI twin is', async () => {
    const exe = await testBinary();
    const w = await world({ open: 2 });
    const [viaApp, viaCli] = [w.asks[0]!, w.asks[1]!];
    // The app's own home: the hub's control token, and config.json pointing at the socket in front of the hub.
    const appHome = tempDir();
    const root = join(appHome, '.deepbuild');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    copyFileSync(join(w.hub.root, 'control.token'), join(root, 'control.token'));
    const front = await tap(tempDir(), w.hub.socket);
    writeFileSync(join(root, 'config.json'), JSON.stringify({ hub: { address: `unix:${front.path}` } }));
    const now = await hubNow(w);
    w.confirm.say(true);   // the app pairs its key at its first answer, with the OS confirming you
    const r = await run(exe, ['--ignored', '--exact', 'ac3_the_app_answers_with_its_own_signer', '--nocapture', '--test-threads=1'], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: appHome, DA1579_PARAMS: JSON.stringify({ ask: viaApp.handle, option: 'green' }) }, timeoutMs: 120_000,
    });
    w.confirm.say(false);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.code, `the app's answer went through: ${out.slice(-2000)}`).toBe(0);
    expect(out, 'the app printed the hub\'s reply').toMatch(/DA1579_REPLY \{/);
    const answers = front.sent.filter((l) => l.method === 'ask.answer');
    expect(answers.length, 'the app sent its answer through the socket in front of the hub').toBeGreaterThan(0);
    expect(judgeNewFormat(answers[answers.length - 1]!, 'ask.answer', w.hubId, now, w.device.id)).toBeNull();
    expect(await judgeCounted(w, viaApp.handle, { result: {} }), 'the app\'s answer is recorded once and shows answered').toBeNull();
    const app = (await eventsAbout(w.app, viaApp.handle, 'ask.answered'))[0]!.data as Line;
    expect(delivered(app), 'the app\'s answer is handed on as its CLI twin is').toEqual(delivered(await cliTwin(w, viaCli.handle)));
    expect(app.answer).toBe('green');
    await front.close();
  }, 1_800_000);

  it('AC3 the hub\'s half: an answer signed in the new format from the app\'s connection counts and is recorded and handed on as its CLI twin is', async () => {
    const w = await world({ open: 2 });
    const [viaApp, viaCli] = [w.asks[0]!, w.asks[1]!];
    const reply = await w.app.call('ask.answer', signFor('ask.answer', { ask: viaApp.handle, option: 'green' }, w.device, w.hubId, await hubNow(w)), 20_000);
    expect(await judgeCounted(w, viaApp.handle, reply)).toBeNull();
    expect(reply.result?.ask, 'the reply names the ask, as before').toBe(viaApp.handle);
    const app = (await eventsAbout(w.app, viaApp.handle, 'ask.answered'))[0]!.data as Line;
    expect(delivered(app)).toEqual(delivered(await cliTwin(w, viaCli.handle)));
  }, 120_000);

  it('AC3 (wrong program) the judge refuses a signature in the base\'s format, naming it', () => {
    const old = { method: 'ask.answer', params: { ask: 'ask:01X', option: 'green', device: 'device:01A', signature: 'c2ln' } };
    expect(judgeNewFormat(old, 'ask.answer', 'hub', Date.now(), undefined)).toMatch(/not \{ signed, sig \}/);
  });
});
