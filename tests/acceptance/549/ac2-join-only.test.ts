// AC2 #549.83ea272a: With every socket and request logged in the app and in headless Chrome, a piece whose net item
// declares a relay opens nothing to it or to any other host before a person clicks Join; a tour's entry, the piece's
// logic, deep_drive's click in a replica and a synthetic click dispatched in the page each leave the prompt unanswered
// with nothing opened; after a person's click every connection goes only to the declared relay's host or, on a direct
// path, to the other copy, with no cookie or credential; and a third connection to the relay with a guessed match ID
// receives nothing from the match
//
// The relay is the shipped relay behind this suite's door, which the piece declares; whatever reaches the door is
// logged there, from outside the copy. In the app (`deep-show run`): the app's own `sockets` log, the prompt in the
// scope's state, a person's click (an `input` on the prompt's button; every input of the scenario is hardware's) and a
// synthetic one (the same events posted by a process, as deep_drive's actions in a replica are). In headless Chrome:
// the browser's own network log and a page-side log of every constructor that opens a connection, the player's prompt
// in the page, a person's click (the browser's input) and clicks dispatched by script. The piece that tries to join by
// itself is fixtures.ts's `decoyDoc`: a press control named Join, a tour that presses it, and its logic.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, armyProgram, decoyDoc, lockstepDoc, script, scripts, tourEntry } from './fixtures.ts';
import {
  AC, Chrome, FULL, LIVE_MS, Script, TIMEOUT, centreOf, copyOf, credentialFailures, exportBundle, fragmentOf, framesThrough, gaveUp, guess, hashFailures, joinedMatches,
  leakFailures, liveCopy, livePair, none, pinOf, playedOf, presented, promptOf, putEvidence, readFrame, runShow, scenario, sentThrough, serve, socketsOf, socketsReached,
  startDoor, startRelay, strayFailures, third, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, type Door, type Relay, type Third,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
/** A secret in the app's store, which no connection may carry. */
const SECRET = 'deep549-canary-0f3a9c27d1e84b56';

async function relayAndDoor(): Promise<{ relay: Relay; door: Door }> {
  const relay = await startRelay(builds.relay(), certs());
  closing(() => relay.stop());
  const door = await startDoor(relay.host, certs());
  closing(() => door.close());
  return { relay, door };
}
/** What a prompt must say: the relay's host, and who sees the copy's network address. */
function promptFailures(text: string, host: string, what: string): string[] {
  const f: string[] = [];
  if (!text.includes(host)) f.push(`${what}: the prompt doesn't name the relay host ${host}: "${text.slice(0, 300)}"`);
  if (!/network address/i.test(text)) f.push(`${what}: the prompt doesn't say who sees the copy's network address: "${text.slice(0, 300)}"`);
  return f;
}

describe(`${AC[2]} nothing opens before a person clicks Join, and then only the declared relay and the other copy`, () => {
  it(`${AC[2]} in the app, a tour's entry, the piece's logic and deep_drive's synthetic click leave the prompt unanswered with nothing opened`, async () => {
    const { door } = await relayAndDoor();
    const evidence = temp();
    const program = armyProgram();
    putEvidence(evidence, program.bytes);
    const document = decoyDoc(program, { relay: door.url, hash_every: 60, timeout: 120 });
    const world = { evidence, docs: [{ id: DOC.decoy }], relayCa: certs().ca, secrets: { relay_token: SECRET } };
    // A first run reads where the app drew its prompt's button.
    const probe = new Script();
    probe.present(DOC.decoy, document);
    const seen = probe.scope();
    const first = await runShow(builds.show(), scenario({ ...world, calls: probe.calls }), 'AC2 the app\'s prompt');
    presented(first[0], 'the piece that tries to join by itself');
    const prompt = promptOf(first[seen], 'the scope');
    expect(prompt, 'a piece whose net item declares a relay shows the app\'s Join prompt (state.join)').not.toBeNull();

    const s = new Script();
    s.present(DOC.decoy, document);
    const before = s.scope();
    // A tour's entry on the piece's own Join control, the piece's logic stepped, and ten seconds for the tour to play.
    s.add({ call: 'track', doc: DOC.decoy, load: [tourEntry(2), tourEntry(3)] });
    s.add({ call: 'logic', doc: DOC.decoy, steps: 100 });
    s.until(10);
    const afterPiece = s.scope();
    // deep_drive's click in a replica: the click a person makes, posted by a process, with no gesture serial.
    s.click(centreOf(prompt!.button), true);
    const afterClick = s.scope();
    const played = s.playMatch(10);
    const sockets = s.sockets();
    const r = await runShow(builds.show(), scenario({ ...world, calls: s.calls }), 'AC2 the app with no person\'s click');
    const f: string[] = [];
    f.push(...promptFailures(prompt!.text, door.host, 'the app'));
    if (prompt!.relay !== door.host) f.push(`the prompt's relay is ${prompt!.relay}, not ${door.host}`);
    for (const [i, label] of [[before, 'at the start'], [afterPiece, 'after a tour\'s entry and the piece\'s logic'], [afterClick, 'after deep_drive\'s synthetic click']] as const) {
      const p = promptOf(r[i], `the scope ${label}`);
      if (p?.state !== 'open') f.push(`${label}, the prompt is ${p ? p.state : 'gone'}, not open and unanswered`);
    }
    if (r[played]!['code'] !== 'not_joined') f.push(`play_match with no person's click answers ${JSON.stringify(r[played]).slice(0, 300)}, not the code not_joined`);
    const log = socketsOf(r[sockets], 'the app\'s sockets');
    if (log.length) f.push(`the app's own log shows ${log.length} connections or requests before any person's click: ${JSON.stringify(log.map((x) => x.raw)).slice(0, 400)}`);
    await sleep(500);
    if (door.connections.length) f.push(`${door.connections.length} connections reached the declared relay before any person's click`);
    none(f, 'the app before a person clicks Join');
  }, TIMEOUT);

  it(`${AC[2]} in headless Chrome, the piece's tour and logic and a synthetic click dispatched in the page leave the prompt unanswered with nothing opened`, async () => {
    const { door } = await relayAndDoor();
    const evidence = temp();
    const program = armyProgram();
    putEvidence(evidence, program.bytes);
    const out = join(temp(), 'bundle');
    await exportBundle(builds.show(), evidence, decoyDoc(program, { relay: door.url, hash_every: 60, timeout: 120 }), out, 'AC2 the web bundle');
    const served = await serve(out);
    closing(() => served.stop());
    const chrome = await Chrome.open([pinOf(certs().cert)]);
    closing(() => chrome.close());
    const tab = await chrome.open(`${served.origin}/index.html`);
    await tab.mustBeReady('AC2 the web player');
    const f: string[] = [];
    const prompt = await tab.prompt();
    expect(prompt?.button, `the web player draws its own Join prompt with a button (an element marked data-deep-join): ${JSON.stringify(prompt)}`).toBeTruthy();
    f.push(...promptFailures(prompt!.text, door.host, 'the web player'));
    if (prompt!.state !== 'open') f.push(`the player's prompt starts ${prompt!.state}, not open`);
    // The piece plays: its tour presses its own Join control at 2 s and 3 s, and its logic steps. No gesture is given.
    await tab.evaluate(`void document.querySelector('deep-player').play()`).catch(() => undefined);
    const until = Date.now() + 120_000;
    while (Date.now() < until && !((await tab.evaluate<number>(`document.querySelector('deep-player').currentTime || 0`)) >= 4)) await sleep(250);
    // Synthetic clicks dispatched in the page, every way a script can make one.
    await tab.evaluate(`(() => { const b = document.querySelector('[data-deep-join] button'); const r = b.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) b.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, at) : new MouseEvent(type, at));
      b.click(); b.focus(); for (const type of ['keydown', 'keypress', 'keyup']) b.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); })()`);
    await sleep(3_000);
    const after = await tab.prompt();
    if (after?.state !== 'open') f.push(`after the tour, the logic and the synthetic clicks, the player's prompt is ${after ? after.state : 'gone'}, not open and unanswered`);
    const reached = await tab.everything();
    f.push(...strayFailures(reached, served.origin, [], 'before a person\'s click'));
    for (const s of socketsReached(reached, served.origin)) f.push(`before a person's click the page opened ${s.kind} to ${s.url}`);
    if (door.connections.length) f.push(`${door.connections.length} connections reached the declared relay before any person's click`);
    none([...new Set(f)], 'headless Chrome before a person clicks Join');
  }, TIMEOUT);

  it(`${AC[2]} in the app, after a person's click every connection goes to the declared relay or the other copy with no cookie or credential, and a third connection with a guessed match ID receives nothing`, async () => {
    const { relay, door } = await relayAndDoor();
    const program = armyProgram();
    const stores: [string, string] = [temp(), temp()];
    for (const s of stores) putEvidence(s, program.bytes);
    const steps = 200;
    const document = lockstepDoc(program, { relay: door.url, hash_every: 1, timeout: 120 });
    const thirds: { what: string; conn: Third }[] = [];
    const pair = await livePair({ bins: [builds.show(), builds.show()], stores, linkFile: join(temp(), 'link'), document, steps, plays: scripts(2, steps), relayCa: certs().ca, secrets: { relay_token: SECRET } }, 'AC2 two copies', async (link) => {
      // Third connections, straight to the relay, once the match is open and before it starts: a random ID, and the
      // match's own ID with its last digit changed, each as a copy that opens a match and as one that joins one.
      const id = /[0-9a-f]{32}/.exec(fragmentOf(link, null, 'the first player\'s link'))?.[0];
      expect(id, `the link's fragment carries the match ID, 32 hex digits: ${link}`).toBeDefined();
      const near = id!.slice(0, 31) + (id!.endsWith('0') ? '1' : '0');
      for (const [what, match, open] of [['a random ID, opening', guess(), true], ['a random ID, joining', guess(), false], ['the ID one digit off, opening', near, true], ['the ID one digit off, joining', near, false]] as const) {
        const conn = await third(relay.host, certs().ca);
        closing(() => conn.close());
        await conn.waitFor('hello');
        conn.send({ join: { match, players: 2, open } });
        thirds.push({ what, conn });
      }
    });
    const one = playedOf(pair.one.reply, 'AC2 copy 1');
    const two = playedOf(pair.two.reply, 'AC2 copy 2');
    const f: string[] = [];
    fragmentOf(pair.link, one.match, 'the first player\'s link');
    if (one.match !== two.match) f.push('the copies name two match IDs');
    if (pair.one.after?.state === 'open') f.push('after a person\'s click the first copy\'s prompt is still open and unanswered');
    f.push(...hashFailures(one, two, 'the two copies', { hashEvery: 1, atLeast: steps - 10 }));
    // The door, outside both copies: each connection's request head, and every message it sent.
    if (door.connections.length < 2) f.push(`${door.connections.length} connections reached the relay for two copies`);
    f.push(...leakFailures(door, [SECRET], 'after Join'));
    for (const m of sentThrough(door)) {
      if (m.message.kind === 'text' && m.message.member !== 'join' && m.message.member !== 'signal') f.push(`connection ${m.conn} sent the relay a ${String(m.message.member)} message: more than a join, signaling and frames`);
      if (m.message.kind === 'binary' && readFrame(m.message.bytes, 'a frame').match !== one.match) f.push(`connection ${m.conn} sent a frame for another match`);
    }
    if (joinedMatches(door).some((m) => m !== one.match)) f.push(`a join named a match other than ${one.match}`);
    // Each copy's own log: the relay, or the other copy on this machine.
    [pair.one.sockets, pair.two.sockets].forEach((log, i) => {
      if (!log.some((s) => s.host === door.host)) f.push(`copy ${i + 1}'s sockets log shows no connection to the relay ${door.host}`);
      for (const s of log) {
        if (s.host !== door.host && !/^127\.0\.0\.1:\d+$/.test(s.host)) f.push(`copy ${i + 1} opened ${s.kind} to ${s.host}, neither the declared relay nor the other copy`);
        if (JSON.stringify(s.raw).includes(SECRET) || /"(cookie|authorization)"/i.test(JSON.stringify(s.raw))) f.push(`copy ${i + 1}'s ${s.kind} to ${s.host} carries a cookie, a credential or the secret`);
      }
    });
    // The third connections stayed open through the match: none got a frame, a start, or anything naming the match.
    await sleep(500);
    for (const t of thirds) {
      for (const m of t.conn.received) {
        if (m.kind === 'binary') f.push(`the third connection with ${t.what} received a frame`);
        else if (m.kind === 'text' && !['hello', 'joined', 'refused'].includes(String(m.member))) f.push(`the third connection with ${t.what} received a ${String(m.member)} message`);
        if (m.bytes.includes(Buffer.from(one.match)) || m.bytes.includes(Buffer.from(one.match, 'hex'))) f.push(`the third connection with ${t.what} received the match's ID`);
      }
      if (!t.conn.received.some((m) => m.member === 'joined' || m.member === 'refused')) f.push(`the relay never answered the third connection's join with ${t.what}`);
    }
    if (framesThrough(door).length === 0 && ![pair.one.sockets, pair.two.sockets].every((log) => log.some((s) => s.host !== door.host))) f.push('no frame crossed the relay and no copy shows a direct path: the match\'s messages went nowhere this file can see');
    none(f, 'the app after a person clicks Join');
  }, TIMEOUT);

  it(`${AC[2]} in headless Chrome, after a person's click every connection goes to the declared relay or the other copy, with no cookie or credential`, async () => {
    const { door } = await relayAndDoor();
    const program = armyProgram();
    const [webStore, appStore, out] = [temp(), temp(), join(temp(), 'bundle')];
    for (const s of [webStore, appStore]) putEvidence(s, program.bytes);
    const steps = 100;
    const document = lockstepDoc(program, { relay: door.url, hash_every: 1, timeout: 120 });
    await exportBundle(builds.show(), webStore, document, out, 'AC2 the web bundle');
    const served = await serve(out);
    closing(() => served.stop());
    const chrome = await Chrome.open([pinOf(certs().cert)]);
    closing(() => chrome.close());
    const tab = await chrome.open(`${served.origin}/index.html`);
    await tab.mustBeReady('AC2 the web player');
    const prompt = await tab.prompt();
    expect(prompt?.button, `the web player draws its own Join prompt with a button: ${JSON.stringify(prompt)}`).toBeTruthy();
    expect(socketsReached(await tab.everything(), served.origin), 'nothing is open before the click').toEqual([]);
    // A person's click: the browser's own input at the button.
    await tab.click(prompt!.button!.x + prompt!.button!.w / 2, prompt!.button!.y + prompt!.button!.h / 2);
    const until = Date.now() + LIVE_MS;
    let mine = await tab.match();
    while (typeof mine?.['link'] !== 'string' && Date.now() < until) { await sleep(250); mine = await tab.match(); }
    if (typeof mine?.['link'] !== 'string') gaveUp(`AC2: after a person's click the web player's match (probe().match) gives no link: ${JSON.stringify(mine)?.slice(0, 400)}; the prompt: ${JSON.stringify(await tab.prompt())}`);
    const link = String(mine!['link']);
    // The app's copy joins through that link and plays 100 steps, then leaves.
    const app = await liveCopy(builds.show(), { evidence: appStore, document, steps, plays: script(2, steps), relayCa: certs().ca, link }, 'AC2 the app\'s copy');
    const a = playedOf(app.reply, 'AC2 the app\'s copy');
    fragmentOf(link, a.match, 'the web player\'s link');
    let seen = await tab.match();
    while ((seen?.['end'] === null || seen?.['end'] === undefined) && Date.now() < until) { await sleep(250); seen = await tab.match(); }
    const w = copyOf(seen, 'the web player\'s copy (probe().match)');
    const f: string[] = [];
    if (w.player !== 1 || a.player !== 2) f.push(`the web player's copy is player ${w.player} and the app's player ${a.player}, not 1 and 2 in the order the relay saw them join`);
    f.push(...hashFailures(a, w, 'the app\'s copy and the web player\'s', { hashEvery: 1, atLeast: steps - 10 }));
    const reached = await tab.everything();
    // Only the declared relay, or the other copy on a direct path set up through that relay alone.
    f.push(...strayFailures(reached, served.origin, [door.host], 'after a person\'s click'));
    if (!reached.some((r) => /^wss:/.test(r.url) && r.url.includes(door.host))) f.push(`the page opened no connection to the declared relay ${door.host}: ${JSON.stringify(socketsReached(reached, served.origin)).slice(0, 400)}`);
    f.push(...credentialFailures(reached.filter((r) => r.kind !== 'request' || !r.url.startsWith(served.origin)), 'after a person\'s click'));
    f.push(...leakFailures(door, [], 'after Join'));
    // The host serving the piece never sees the match ID, and was sent no cookie.
    for (const q of served.requests) {
      if (q.path.includes(a.match)) f.push(`the host serving the piece was asked for ${q.path}, which holds the match ID`);
      if (q.cookie) f.push(`the request for ${q.path} carried a cookie`);
    }
    none([...new Set(f)], 'headless Chrome after a person clicks Join');
  }, TIMEOUT);
});
