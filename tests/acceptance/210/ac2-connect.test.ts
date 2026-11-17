// AC2 #210.6f3c36ec: "Before Connect the plug-in receives nothing; a Connect click from hardware opens the port; a tour,
// the piece's logic, an agent's tool, a bridge and a replica each fail to open it, refused for want of a serial; and a
// plug-in that asks for a control the document doesn't list is refused at Connect, naming the control"
//
// The drum pad playing live on `stage` with two ports (README: The fixture): `synth` to `test.gear` (notes and hits out)
// and `spy` to `test.greedy` (notes out). Five notes go in before any Connect, while a tour, the piece's logic, an
// agent's tool, a bridge and a replica each ask to open `synth`: each is refused `no_serial`, and at 2.9 s `synth` is
// closed, its prompt names test.gear, its grant's host and what goes out and in, and its plug-in has received nothing.
// Your click opens it; the five notes after it reach test.gear and the five before it never do. `test.greedy`'s port
// takes `notes` and `tempo`, a control the drum pad has but `spy` doesn't list: your Connect of `spy` is refused
// `not_listed`, naming `tempo`, and its plug-in receives nothing.
import { describe, expect, it } from 'vitest';
import {
  AC, Driver, GEAR, GREEDY, HITS, MS, NOTES, SYNTH_OUT, TEMPO, TIMEOUT, canon, connect, deepShow, deliveredValues, install, none, note, obj, outsOf, pieceDoc,
  playPiece, portCall, portOf, prebuild, presented, refusalOf, secs, showPiece, useTemp, type Asker, type JsonObject,
} from './helpers.ts';

const ID = AC[2];
prebuild(() => { deepShow(['full']); });
const temp = useTemp();

const ASKERS: Asker[] = ['tour', 'logic', 'agent', 'bridge', 'replica'];
const BEFORE = [0.6, 1.1, 1.6, 2.1, 2.6].map((s, i): [number, number] => [secs(s), 20 + i]);
const AFTER = [3.5, 4.0, 4.5, 5.0, 5.5].map((s, i): [number, number] => [secs(s), 70 + i]);

describe(`AC2 ${ID} only a person's Connect click opens a port, and only for what the document lists`, () => {
  it(`AC2 ${ID} nothing reaches the plug-in before Connect; your click opens synth; the tour, the logic, an agent's tool, a bridge and a replica are refused no_serial; spy is refused at Connect naming tempo`, () => {
    const evidence = temp();
    const d = new Driver(deepShow(['full']), { evidence });
    const doc = pieceDoc(evidence, { synth: { plugin: GEAR.id, out: SYNTH_OUT }, spy: { plugin: GREEDY.id, out: [NOTES] } });
    const setup: JsonObject[] = [
      install(MS, GEAR, { synth: { entries: [NOTES], rows: [HITS], sources: [], sound: false } }),
      install(2 * MS, GREEDY, { spy: { entries: [NOTES, TEMPO], rows: [], sources: [], sound: false } }),
      showPiece(3 * MS, doc),
    ];
    const sPlay = d.click(secs(0.3), 'stage', 'AC2: your click on Play', setup);
    const play = playPiece(secs(0.4), sPlay);
    const asks = ASKERS.map((by, i) => connect(secs(1.0 + 0.2 * i), 'synth', { by }));
    const closed = portCall(secs(2.9), 'synth');
    const sConnect = d.click(secs(3.0), 'stage', 'AC2: your Connect click', [play, ...BEFORE.map(([t, v]) => note(t, v)), ...asks, closed]);
    const open = connect(secs(3.1), 'synth', { serial: sConnect });
    const opened = portCall(secs(6.0), 'synth');
    const sSpy = d.click(secs(6.2), 'stage', 'AC2: your Connect click on spy', [open, ...AFTER.map(([t, v]) => note(t, v)), opened]);
    const spy = connect(secs(6.3), 'spy', { serial: sSpy });
    const spyAfter = portCall(secs(6.5), 'spy');
    d.step([spy, spyAfter], 'AC2: spy');

    for (const c of setup.slice(0, 2)) expect(obj(d.reply(c, 'AC2'), 'AC2: install')['installed'], `AC2: ${String(c['plugin'])} installs`).toBe(true);
    presented(d.reply(setup[2]!, 'AC2'), 'AC2: the drum pad');
    expect(obj(d.reply(play, 'AC2'), 'AC2: Play')['playing'], 'AC2: your press of Play plays the piece').toBe(true);

    const f: string[] = [];
    // A tour, the piece's logic, an agent's tool, a bridge and a replica: each refused for want of a serial.
    ASKERS.forEach((by, i) => {
      const r = refusalOf(d.reply(asks[i]!, 'AC2'), `AC2: Connect asked by ${by}`);
      if (r['code'] !== 'no_serial' || r['port'] !== 'synth') f.push(`a Connect of synth asked by ${by} answers ${JSON.stringify(r)}, not a refusal no_serial naming synth`);
    });
    // Before Connect: closed, the app's prompt up, nothing received.
    const before = portOf(d.reply(closed, 'AC2'), 'AC2: synth before Connect');
    if (before.state !== 'closed') f.push(`synth reads ${before.state} before your Connect, not closed`);
    if (before.received.length) f.push(`test.gear received ${before.received.length} message(s) before your Connect, the first ${JSON.stringify(before.received[0])}`);
    const prompt = { port: 'synth', plugin: GEAR.id, hosts: [...GEAR.hosts], out: SYNTH_OUT, in: [], sound: false };
    if (canon(before.prompt) !== canon(prompt)) f.push(`synth's Connect prompt is ${JSON.stringify(before.prompt)}, not ${JSON.stringify(prompt)}`);
    // Your click opens it, and only what plays after it goes out.
    const accepted = portOf(d.reply(open, 'AC2'), 'AC2: your Connect of synth');
    if (accepted.state !== 'open') f.push(`your Connect click leaves synth ${accepted.state}, not open`);
    const after = portOf(d.reply(opened, 'AC2'), 'AC2: synth after Connect');
    if (after.state !== 'open') f.push(`synth reads ${after.state} after your Connect, not open`);
    const sent = deliveredValues(outsOf(after, 'AC2')).sort((a, b) => a - b);
    if (JSON.stringify(sent) !== JSON.stringify(AFTER.map(([, v]) => v))) f.push(`test.gear received the notes ${JSON.stringify(sent)}, not exactly the five played after Connect ${JSON.stringify(AFTER.map(([, v]) => v))}`);
    // A plug-in asking for a control the document doesn't list: refused at Connect, naming it.
    const greedy = refusalOf(d.reply(spy, 'AC2'), 'AC2: your Connect of spy');
    if (greedy['code'] !== 'not_listed' || greedy['port'] !== 'spy' || greedy['control'] !== TEMPO) f.push(`your Connect of spy answers ${JSON.stringify(greedy)}, not a refusal not_listed naming spy and the control tempo`);
    const spyView = portOf(d.reply(spyAfter, 'AC2'), 'AC2: spy after its refused Connect');
    if (spyView.state !== 'closed' || spyView.received.length) f.push(`spy reads ${spyView.state} with ${spyView.received.length} message(s) received after its refused Connect, not closed with none`);
    none(f, `AC2 ${ID}`);
  }, TIMEOUT);
});
