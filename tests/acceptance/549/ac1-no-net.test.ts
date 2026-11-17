// AC1 #549.a86e15ac: In the app and in headless Chrome, with every socket and request logged over a 10-minute session,
// a piece without a net item shows no Join and opens no connection, and a net item without a relay, with an http relay
// or with a second host is refused at check, naming the field
//
// The piece without a net item is fixtures.ts's `plainDoc` (the army's scene and logic, played alone). In the app the
// session is ten minutes of the scenario's own clock (`deep-show run`: the scope read every minute, the app's
// `sockets` log read at the end). In headless Chrome it is ten minutes of the page's own clock with the bundle open and
// playing, every request and socket logged by the browser and by the page-side log. The three net items are refused
// by `deep show`'s check; the piece with one https relay is the one the other files play.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, armyProgram, lockstepDoc, plainDoc, type JsonObject, type NetFields } from './fixtures.ts';
import {
  AC, Chrome, FULL, Script, TIMEOUT, exportBundle, isObject, none, obj, presented, promptOf, putEvidence, runShow, scenario, serve, socketsOf, socketsReached, strayFailures,
  useBuilds, useChildren, useClosers, useTemp,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const closing = useClosers();
const temp = useTemp();
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const SESSION_S = 600;

describe(`${AC[1]} no net item, no Join and no connection; a relay that isn't one https host is refused at check`, () => {
  it(`${AC[1]} in the app, a piece without a net item shows no Join and opens no connection over a 10-minute session`, async () => {
    const evidence = temp();
    const program = armyProgram();
    putEvidence(evidence, program.bytes);
    const s = new Script();
    s.present(DOC.plain, plainDoc(program));
    const scopes = [s.scope()];
    s.add({ call: 'logic', doc: DOC.plain, steps: 200 });
    for (let minute = 1; minute <= SESSION_S / 60; minute++) { s.until(minute * 60); scopes.push(s.scope(0)); }
    const sockets = s.sockets(0);
    const r = await runShow(builds.show(), scenario({ evidence, docs: [{ id: DOC.plain }], calls: s.calls }), 'AC1 the app, ten minutes');
    presented(r[0], 'the piece without a net item');
    expect(s.now, 'the session lasts ten minutes of the scenario\'s clock').toBeGreaterThanOrEqual(SESSION_S * 705_600_000);
    const f: string[] = [];
    scopes.forEach((i, k) => { const p = promptOf(r[i], `the scope at minute ${k}`); if (p !== null) f.push(`at minute ${k} the app shows a Join prompt (${p.state}) for a piece with no net item`); });
    const log = socketsOf(r[sockets], 'the app\'s sockets');
    if (log.length) f.push(`the app's own log shows ${log.length} connections or requests: ${JSON.stringify(log.map((x) => x.raw)).slice(0, 400)}`);
    none(f, 'the app with a piece that has no net item');
  }, TIMEOUT);

  it(`${AC[1]} in headless Chrome, a piece without a net item shows no Join and opens no connection over a 10-minute session`, async () => {
    const evidence = temp();
    const program = armyProgram();
    putEvidence(evidence, program.bytes);
    const out = join(temp(), 'bundle');
    await exportBundle(builds.show(), evidence, plainDoc(program), out, 'AC1 the web bundle');
    const served = await serve(out);
    closing(() => served.stop());
    const chrome = await Chrome.open();
    closing(() => chrome.close());
    const tab = await chrome.open(`${served.origin}/index.html`);
    await tab.mustBeReady('AC1 the web player');
    // The player says so itself, before the session and after it: a piece with no net item holds no match
    // (probe().match is null, not absent).
    const holds = `(async () => { const v = await document.querySelector('deep-player').probe(); return { has: v !== null && typeof v === 'object' && 'match' in v, match: v && v.match !== undefined ? JSON.parse(JSON.stringify(v.match)) : null }; })()`;
    expect(await tab.evaluate<JsonObject | null>(holds), 'probe() says whether the player holds a match (probe().match, null for a piece with no net item)').toEqual({ has: true, match: null });
    const started = await tab.evaluate<number>('performance.now()');
    await tab.evaluate(`void document.querySelector('deep-player').play()`).catch(() => undefined);
    const f: string[] = [];
    // Ten minutes of the page's own clock, read each half minute.
    for (;;) {
      const prompt = await tab.prompt();
      if (prompt !== null) f.push(`the page shows a Join prompt (${prompt.state}) for a piece with no net item`);
      const now = await tab.evaluate<number>('performance.now()');
      if (now - started >= SESSION_S * 1000) break;
      await sleep(Math.min(30_000, SESSION_S * 1000 - (now - started) + 50));
    }
    const probe = await tab.evaluate<JsonObject | null>(holds);
    if (!probe || probe['has'] !== true || probe['match'] !== null) f.push(`after the session probe().match is ${JSON.stringify(probe).slice(0, 200)} for a piece with no net item`);
    const reached = await tab.everything();
    f.push(...strayFailures(reached, served.origin, [], 'over the session'));
    for (const x of socketsReached(reached, served.origin)) f.push(`over the session the page opened ${x.kind} to ${x.url}`);
    if (!reached.some((x) => x.by === 'browser' && x.url.startsWith(served.origin))) f.push('the browser logged no request for the bundle itself, so its log isn\'t on');
    none([...new Set(f)], 'headless Chrome with a piece that has no net item');
  }, TIMEOUT);

  it(`${AC[1]} a net item without a relay, with an http relay or with a second host is refused at check, naming the field`, async () => {
    const evidence = temp();
    const program = armyProgram();
    putEvidence(evidence, program.bytes);
    const cases: { what: string; id: string; net: NetFields }[] = [
      { what: 'without a relay', id: DOC.noRelay, net: {} },
      { what: 'with an http relay', id: DOC.httpRelay, net: { relay: 'http://relay.test/549' } },
      { what: 'with a second host', id: DOC.twoHosts, net: { relay: ['https://relay.test/549', 'https://other.test/549'] } },
    ];
    const s = new Script();
    const shown = cases.map((c) => s.present(c.id, lockstepDoc(program, c.net, c.id)));
    const good = s.present(DOC.lockstep, lockstepDoc(program, { relay: 'https://relay.test/549' }));
    const r = await runShow(builds.show(), scenario({ evidence, docs: [...cases.map((c) => ({ id: c.id })), { id: DOC.lockstep }], calls: s.calls }), 'AC1 the check');
    const f: string[] = [];
    cases.forEach((c, k) => {
      const reply = obj(r[shown[k]!], `the piece ${c.what}`);
      const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject);
      const errors = issues.filter((i) => i['severity'] === 'error');
      if (reply['outcome'] === 'presented') f.push(`a net item ${c.what} is presented, not refused at check`);
      // The net module's own refusal, naming the field: an error at the item's `relay`, not a kind or module the build lacks.
      const naming = errors.filter((i) => !['unknown_kind', 'module_missing', 'unknown_field'].includes(String(i['code']))
        && (/(^|\/)relay(\/|$)/.test(String(i['path'] ?? '')) || (isObject(i['actual']) && i['actual']['field'] === 'relay')));
      if (!naming.length) f.push(`a net item ${c.what}: no error names the field relay; the issues: ${JSON.stringify(issues.map((i) => ({ code: i['code'], path: i['path'] }))).slice(0, 400)}`);
      else if (!naming.some((i) => String(i['path'] ?? '').includes('match') || (Array.isArray(i['ids']) && i['ids'].includes('match')))) f.push(`a net item ${c.what}: the error names relay but not the net item \`match\`: ${JSON.stringify(naming[0]).slice(0, 300)}`);
    });
    none(f, 'the three net items');
    // The same piece with one https host is admitted.
    presented(r[good], 'the piece whose net item declares one https relay');
  }, TIMEOUT);
});
