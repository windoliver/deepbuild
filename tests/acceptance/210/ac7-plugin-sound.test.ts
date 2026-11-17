// AC7 #210.ca29345d: "A port whose plug-in's port says its gear makes sound, in a document that leaves sound false, still
// needs a gesture in the piece's panel to open and stops within one audio block of a mute; and a planted gate that trusts
// the document's flag keeps sending through the mute and fails, naming the port"
//
// The drum pad (README: The fixture) with `synth` to `test.gear` and no `sound` field (false); test.gear's registered
// port says `sound: true`. The piece playing, your click in the other panel gives a serial that is yours but not the
// piece's panel's: Connect with it is refused `serial_not_granting`, and synth stays closed with nothing received. Your
// click in the piece's panel opens it; notes go out every 0.25 s; test.gear's mute at 5.0003 s stops synth's out side
// within one audio block, its plug-in is told, and it reads stopped (#AC3's judgement). The planted
// `gate_trusts_document_sound` makes test.gear no gate owner, so synth keeps sending through the mute and the same
// judgement fails, naming synth.
import { describe, expect, it } from 'vitest';
import {
  AC, Driver, GEAR, HITS, MS, NOTES, SYNTH_OUT, TIMEOUT, connect, deepShow, failsNaming, install, mute, muteFailures, none, note, obj, pieceDoc,
  playPiece, playWorld, portCall, portOf, prebuild, presented, refusalOf, secs, showPiece, useTemp, type JsonObject, type ShowPlanted,
} from './helpers.ts';

const ID = AC[7];
prebuild(() => { deepShow(['full']); });
const temp = useTemp();

const MUTE = secs(5) + 211_680;
const NOTES_AT = Array.from({ length: 31 }, (_, i): [number, number] => [secs(1.5 + 0.25 * i), 50 + i]);

interface Played { other: JsonObject; closed: JsonObject; open: JsonObject; end: JsonObject; reply: (c: JsonObject) => JsonObject }
function soundWorld(evidence: string, planted?: ShowPlanted): Played {
  const bin = deepShow(['full']);
  const d = new Driver(bin, { evidence });
  const setup = [
    install(MS, GEAR, { synth: { entries: [NOTES], rows: [HITS], sources: [], sound: true } }),
    showPiece(2 * MS, pieceDoc(evidence, { synth: { plugin: GEAR.id, out: SYNTH_OUT } })),
  ];
  const sPlay = d.click(secs(0.3), 'stage', 'AC7: your click on Play', setup);
  const play = playPiece(secs(0.4), sPlay);
  const sOther = d.click(secs(0.6), 'other', 'AC7: your click in the other panel', [play]);
  const other = connect(secs(0.7), 'synth', { serial: sOther });
  const closed = portCall(secs(0.8), 'synth');
  const sStage = d.click(secs(1.0), 'stage', 'AC7: your Connect click in the piece\'s panel', [other, closed]);
  const open = connect(secs(1.1), 'synth', { serial: sStage });
  const end = portCall(secs(9.5), 'synth');
  const rest = [open, ...NOTES_AT.map(([t, v]) => note(t, v)), mute(MUTE, GEAR.id), end];
  let reply: (c: JsonObject) => JsonObject;
  if (!planted) {
    d.step(rest, 'AC7: the play and the mute');
    reply = (c) => d.reply(c, 'AC7');
  } else {
    const run = playWorld(bin, { evidence, planted }, [...d.calls, ...rest], 'AC7');
    reply = (c) => run.get(c)!;
  }
  presented(reply(setup[1]!), 'AC7: the drum pad');
  expect(obj(reply(play), 'AC7: Play')['playing'], 'AC7: your press of Play plays the piece').toBe(true);
  return { other, closed, open, end, reply };
}

describe(`AC7 ${ID} a plug-in whose port makes sound is a gate owner whatever the document says`, () => {
  it(`AC7 ${ID} synth needs your gesture in the piece's panel to open, and stops within one audio block of test.gear's mute`, () => {
    const p = soundWorld(temp());
    const f: string[] = [];
    const refused = refusalOf(p.reply(p.other), 'AC7: Connect with your click in the other panel');
    if (refused['code'] !== 'serial_not_granting' || refused['port'] !== 'synth') f.push(`Connect with the serial of your click in the other panel answers ${JSON.stringify(refused)}, not a refusal serial_not_granting naming synth`);
    const closed = portOf(p.reply(p.closed), 'AC7: synth after that Connect');
    if (closed.state !== 'closed' || closed.received.length) f.push(`after a Connect with the other panel's serial synth reads ${closed.state} with ${closed.received.length} message(s) received, not closed with none`);
    const open = portOf(p.reply(p.open), 'AC7: your Connect click in the piece\'s panel');
    if (open.state !== 'open') f.push(`your Connect click in the piece's panel leaves synth ${open.state}, not open`);
    f.push(...muteFailures(portOf(p.reply(p.end), 'AC7: synth after the mute'), 'synth', MUTE, 'AC7'));
    none(f, `AC7 ${ID}`);
  }, TIMEOUT);

  it(`AC7 ${ID} the planted gate_trusts_document_sound keeps sending through the mute and fails, naming synth`, () => {
    const p = soundWorld(temp(), 'gate_trusts_document_sound');
    const synth = portOf(p.reply(p.end), 'AC7 planted: synth after the mute');
    failsNaming(muteFailures(synth, 'synth', MUTE, 'AC7 planted').filter((x) => x.includes('kept sending')), 'synth', `AC7 ${ID} planted gate_trusts_document_sound`);
  }, TIMEOUT);
});
