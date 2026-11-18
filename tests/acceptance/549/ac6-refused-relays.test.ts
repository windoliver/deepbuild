// AC6 #549.28bcfddc: At Join, a test relay that answers relay@1 with another digest, and one that answers another
// protocol, are each refused before any entry is sent, naming the relay host and what it answered, with no frame in
// the socket log
//
// The two test relays are #309's planted twins of the shipped relay, which the base holds: `deep-relay --planted
// hello_other_digest` (its hello names relay@1 with the digest d1:0123…cdef) and `--planted hello_other_protocol`
// (its hello names relay@2). Each stands behind this suite's door, whose log of what the copy sent is the socket log,
// and each prints what it received. The Join is a person's click on the app's prompt (`deep-show run`) and on the web
// player's own prompt in headless Chrome, whose network backend this task adds. #309 proved the macOS backend's test
// client refuses these relays; what is read here is the Join: the prompt's refusal, and nothing sent.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { armyProgram, lockstepDoc, script } from './fixtures.ts';
import {
  AC, Chrome, FULL, TIMEOUT, exportBundle, framesThrough, gaveUp, liveCopy, none, pinOf, putEvidence, serve, startDoor, startRelay, useBuilds, useCertificate, useChildren, useCleanup,
  useClosers, useTemp, type Door, type Relay,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The two relays, by #309's planted names, and what each one's hello answers. */
const RELAYS = [
  { planted: 'hello_other_digest', answers: 'd1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', what: 'relay@1 with another digest' },
  { planted: 'hello_other_protocol', answers: 'relay@2', what: 'another protocol' },
] as const;

async function relayAndDoor(planted: string): Promise<{ relay: Relay; door: Door }> {
  const relay = await startRelay(builds.relay(), certs(), planted);
  closing(() => relay.stop());
  const door = await startDoor(relay.host, certs());
  closing(() => door.close());
  return { relay, door };
}
/** Nothing of a match reached the relay: no frame crossed the door, and the relay's own record shows no forward. */
function sentFailures(relay: Relay, door: Door, what: string): string[] {
  const f: string[] = [];
  if (framesThrough(door).length) f.push(`${what}: ${framesThrough(door).length} frames are in the socket log`);
  if (relay.received.some((m) => m.received === 'forward')) f.push(`${what}: the relay's own record shows a forward`);
  if (!door.connections.length) f.push(`${what}: no connection reached the relay, so its hello was never read`);
  return f;
}
/** A refusal as the prompt must show it: the relay's host and what it answered. */
function refusalFailures(state: string | undefined, text: string, door: Door, answers: string, what: string): string[] {
  const f: string[] = [];
  if (state !== 'refused') f.push(`${what}: the prompt is ${String(state)}, not refused`);
  if (!text.includes(door.host)) f.push(`${what}: the refusal doesn't name the relay host ${door.host}: "${text.slice(0, 300)}"`);
  if (!text.includes(answers)) f.push(`${what}: the refusal doesn't name what the relay answered, ${answers}: "${text.slice(0, 300)}"`);
  return f;
}

describe(`${AC[6]} a relay that answers another digest or another protocol is refused at Join, before any entry is sent`, () => {
  it(`${AC[6]} in the app, each relay is refused on the prompt, naming its host and what it answered, with no frame in the socket log`, async () => {
    const f: string[] = [];
    for (const r of RELAYS) {
      const { relay, door } = await relayAndDoor(r.planted);
      const evidence = temp();
      const program = armyProgram();
      putEvidence(evidence, program.bytes);
      const document = lockstepDoc(program, { relay: door.url, hash_every: 60, timeout: 120 });
      const copy = await liveCopy(builds.show(), { evidence, document, steps: 40, plays: script(1, 40), relayCa: certs().ca }, `AC6 the app at a relay that answers ${r.what}`);
      if (copy.reply['code'] !== 'refused') f.push(`${r.what}: play_match answers ${JSON.stringify(copy.reply).slice(0, 300)}, not the code refused`);
      f.push(...refusalFailures(copy.after?.state, copy.after?.text ?? '', door, r.answers, `${r.what}, in the app`));
      await sleep(300);
      f.push(...sentFailures(relay, door, `${r.what}, in the app`));
      if (copy.sockets.some((s) => s.host !== door.host)) f.push(`${r.what}: the app opened a connection past the declared relay: ${JSON.stringify(copy.sockets.map((s) => s.host))}`);
    }
    none(f, 'the app\'s Join at the two relays');
  }, TIMEOUT);

  it(`${AC[6]} in headless Chrome, each relay is refused on the player's prompt, naming its host and what it answered, with no frame in the socket log`, async () => {
    const f: string[] = [];
    const chrome = await Chrome.open([pinOf(certs().cert)]);
    closing(() => chrome.close());
    for (const r of RELAYS) {
      const { relay, door } = await relayAndDoor(r.planted);
      const evidence = temp();
      const program = armyProgram();
      putEvidence(evidence, program.bytes);
      const out = join(temp(), 'bundle');
      await exportBundle(builds.show(), evidence, lockstepDoc(program, { relay: door.url, hash_every: 60, timeout: 120 }), out, `AC6 the web bundle for a relay that answers ${r.what}`);
      const served = await serve(out);
      closing(() => served.stop());
      const tab = await chrome.open(`${served.origin}/index.html`);
      await tab.mustBeReady('AC6 the web player');
      const prompt = await tab.prompt();
      expect(prompt?.button, `the web player draws its own Join prompt with a button: ${JSON.stringify(prompt)}`).toBeTruthy();
      await tab.click(prompt!.button!.x + prompt!.button!.w / 2, prompt!.button!.y + prompt!.button!.h / 2);
      const until = Date.now() + 600_000;
      let after = await tab.prompt();
      while (after?.state !== 'refused' && Date.now() < until) { await sleep(250); after = await tab.prompt(); }
      if (after?.state !== 'refused' && !door.connections.length) gaveUp(`AC6: ten minutes after a person's click the web player reached no relay and its prompt is ${JSON.stringify(after)}`);
      f.push(...refusalFailures(after?.state, after?.text ?? '', door, r.answers, `${r.what}, in the web player`));
      await sleep(300);
      f.push(...sentFailures(relay, door, `${r.what}, in the web player`));
    }
    none(f, 'the web player\'s Join at the two relays');
  }, TIMEOUT);
});
