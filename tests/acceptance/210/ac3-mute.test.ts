// AC3 #210.da5965d7: "A sound port's out side stops within one audio block of a mute and its plug-in receives a stop; a
// port opened during quiet hours stays stopped; and a port without sound keeps sending through a mute; and a planted gate
// that silences the plug-in's own output but leaves the sound port's out side sending fails, naming the port"
//
// The drum pad (README: The fixture) with two ports: `synth` to `test.gear` with `sound: true`, and `lamp` to
// `test.lamp` without sound, both listing `notes`. Both opened by your clicks in the piece's panel, the piece playing,
// a note every 0.25 s; at 5.0003 s (a third of a millisecond into a step, so a stop that waits for the next step is
// late) the shell's mute of test.gear, the gate owner the sound port makes. synth sent in the second before it, sends
// nothing from one audio block (128 samples at 48 kHz) after it, its plug-in is told it stopped within that block, and
// it reads stopped; lamp goes on: every note played after the mute reaches test.lamp, and it reads open. In a second
// world with quiet hours from 2 s to 8 s, your Connect of synth at 3.1 s leaves it stopped and nothing goes out through
// 7.9 s. The planted `mute_leaves_port_sending` fails the same judgement, naming synth.
import { describe, expect, it } from 'vitest';
import {
  AC, BLOCK, Driver, GEAR, HITS, LAMP, MS, NOTES, SYNTH_OUT, TIMEOUT, connect, deepShow, deliveredValues, failsNaming, install, mute, muteFailures, none, note,
  obj, outsOf, pieceDoc, playPiece, playWorld, portCall, portOf, prebuild, presented, secs, showPiece, useTemp, type JsonObject, type ShowPlanted,
} from './helpers.ts';

const ID = AC[3];
prebuild(() => { deepShow(['full']); });
const temp = useTemp();

const MUTE = secs(5) + 211_680;
const NOTES_AT = Array.from({ length: 33 }, (_, i): [number, number] => [secs(1 + 0.25 * i), 30 + i]);
const END = secs(9.5);
const ports = { synth: { plugin: GEAR.id, out: SYNTH_OUT, sound: true }, lamp: { plugin: LAMP.id, out: [NOTES] } };
const setupCalls = (doc: JsonObject): JsonObject[] => [
  install(MS, GEAR, { synth: { entries: [NOTES], rows: [HITS], sources: [], sound: true } }),
  install(2 * MS, LAMP, { lamp: { entries: [NOTES], rows: [], sources: [], sound: false } }),
  showPiece(3 * MS, doc),
];

interface Muted { synth: JsonObject; lamp: JsonObject; replies: (c: JsonObject) => JsonObject; calls: JsonObject[] }
/** Both ports opened by your clicks, the piece playing with notes, test.gear muted; with `planted`, played once more under it. */
function mutedWorld(evidence: string, planted?: ShowPlanted): Muted {
  const bin = deepShow(['full']);
  const d = new Driver(bin, { evidence });
  const setup = setupCalls(pieceDoc(evidence, ports));
  const s1 = d.click(secs(0.3), 'stage', 'AC3: your Connect click on synth', setup);
  const c1 = connect(secs(0.35), 'synth', { serial: s1 });
  const s2 = d.click(secs(0.5), 'stage', 'AC3: your Connect click on lamp', [c1]);
  const c2 = connect(secs(0.55), 'lamp', { serial: s2 });
  const s3 = d.click(secs(0.7), 'stage', 'AC3: your click on Play', [c2]);
  const play = playPiece(secs(0.8), s3);
  const synth = portCall(END, 'synth');
  const lamp = portCall(END + MS, 'lamp');
  const rest = [play, ...NOTES_AT.map(([t, v]) => note(t, v)), mute(MUTE, GEAR.id), synth, lamp];
  const check = (reply: (c: JsonObject) => JsonObject, what: string): void => {
    presented(reply(setup[2]!), `${what}: the drum pad`);
    expect(portOf(reply(c1), `${what}: your Connect of synth`).state, `${what}: your click opens synth`).toBe('open');
    expect(portOf(reply(c2), `${what}: your Connect of lamp`).state, `${what}: your click opens lamp`).toBe('open');
    expect(obj(reply(play), `${what}: Play`)['playing'], `${what}: your press of Play plays the piece`).toBe(true);
  };
  if (!planted) {
    d.step(rest, 'AC3: the play and the mute');
    const replies = (c: JsonObject): JsonObject => d.reply(c, 'AC3');
    check(replies, 'AC3');
    return { synth, lamp, replies, calls: d.calls };
  }
  const run = playWorld(bin, { evidence, planted }, [...d.calls, ...rest], 'AC3');
  const replies = (c: JsonObject): JsonObject => run.get(c)!;
  check(replies, 'AC3 planted');
  return { synth, lamp, replies, calls: [...d.calls, ...rest] };
}

describe(`AC3 ${ID} a mute or quiet hours stop a sound port's out side; a port without sound keeps sending`, () => {
  it(`AC3 ${ID} synth stops within one audio block of test.gear's mute and its plug-in is told; lamp keeps sending; a Connect in quiet hours stays stopped`, () => {
    const w = mutedWorld(temp());
    const synth = portOf(w.replies(w.synth), 'AC3: synth after the mute');
    const lamp = portOf(w.replies(w.lamp), 'AC3: lamp after the mute');
    const f = muteFailures(synth, 'synth', MUTE, 'AC3');
    const lampOuts = outsOf(lamp, 'AC3: lamp');
    const all = deliveredValues(lampOuts).sort((a, b) => a - b);
    const want = NOTES_AT.map(([, v]) => v);
    if (JSON.stringify(all) !== JSON.stringify(want)) f.push(`lamp, without sound, delivered the notes ${JSON.stringify(all)}, not every note played before and after the mute ${JSON.stringify(want)}`);
    if (!lampOuts.some((o) => o.at >= MUTE + BLOCK)) f.push('lamp, without sound, sent nothing from one audio block after the mute on');
    if (lamp.state !== 'open') f.push(`lamp reads ${lamp.state} after test.gear's mute, not open`);

    // Quiet hours from 2 s to 8 s: a Connect at 3.1 s stays stopped.
    const evidence = temp();
    const d = new Driver(deepShow(['full']), { evidence, quiet: [{ from: secs(2), to: secs(8) }] });
    const setup = setupCalls(pieceDoc(evidence, ports));
    const sPlay = d.click(secs(0.3), 'stage', 'AC3 quiet: your click on Play', setup);
    const play = playPiece(secs(0.4), sPlay);
    const sQuiet = d.click(secs(3.0), 'stage', 'AC3 quiet: your Connect click', [play]);
    const open = connect(secs(3.1), 'synth', { serial: sQuiet });
    const read = portCall(secs(7.9), 'synth');
    d.step([open, ...[3.5, 4.5, 5.5, 6.5, 7.5].map((s, i) => note(secs(s), 90 + i)), read], 'AC3 quiet: the play');
    expect(obj(d.reply(play, 'AC3 quiet'), 'AC3 quiet: Play')['playing'], 'AC3 quiet: your press of Play plays the piece').toBe(true);
    const opened = portOf(d.reply(open, 'AC3 quiet'), 'AC3 quiet: your Connect of synth in quiet hours');
    if (opened.state !== 'stopped') f.push(`synth, opened by your click in quiet hours, reads ${opened.state}, not stopped`);
    const quiet = portOf(d.reply(read, 'AC3 quiet'), 'AC3 quiet: synth at 7.9 s');
    if (quiet.state !== 'stopped') f.push(`synth reads ${quiet.state} at 7.9 s, still in quiet hours, not stopped`);
    const sent = outsOf(quiet, 'AC3 quiet');
    if (sent.length) f.push(`synth, opened in quiet hours, sent ${sent.length} Out message(s) in them, the first at host ${sent[0]!.at} (step ${sent[0]!.step})`);
    none(f, `AC3 ${ID}`);
  }, TIMEOUT);

  it(`AC3 ${ID} the planted mute_leaves_port_sending fails the same judgement, naming synth`, () => {
    const w = mutedWorld(temp(), 'mute_leaves_port_sending');
    const synth = portOf(w.replies(w.synth), 'AC3 planted: synth after the mute');
    failsNaming(muteFailures(synth, 'synth', MUTE, 'AC3 planted').filter((x) => x.includes('kept sending')), 'synth', `AC3 ${ID} planted mute_leaves_port_sending`);
  }, TIMEOUT);
});
