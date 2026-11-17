// AC1 #210.6dc8d5b9: "A fixture piece with a port that lists its notes control and its hits occurrence list, played live
// for 10 s with a test plug-in at the far end, delivers exactly the recorded entries and rows, once each, in step order,
// matched by hash against the track; seeking back 5 s and playing on sends nothing for the replayed span; an export sends
// nothing; and a planted port that sends on a seek fails, naming the first step it sent again"
//
// The drum pad on `stage`, its port `synth` to `test.gear` listing `notes` and `hits.occurrences` (README: The fixture).
// Your click opens the port; your press of Play plays the piece live; 21 notes go in over 8 s (two of them 2 ms apart,
// so one step reads two). At 10 s the play's input track and the item's list are read: the plug-in received exactly
// their `notes` entries and `hit` rows, each once, each in the Out of the step that read or emitted it, the steps in
// order, compared by SHA-256 of their canonical JSON. Then a seek back to 5 s plays on for 5.5 s, and a still export of
// the piece runs on its own track: neither sends anything (every later Out's step is past every step sent before it).
// The planted `port_sends_on_seek` sends the replayed steps again; the same judgement fails on it, its first failure
// naming the first step it sent again.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, Driver, FLICKS, GEAR, HITS, MS, NOTES, STEP, SYNTH_OUT, TIMEOUT, arr, connect, deepShow, inputTrack, install, matchFailures, none, note, obj,
  occurrences, orderFailures, outShapeFailures, outsOf, pieceDoc, playPiece, playWorld, portCall, portOf, prebuild, presented, secs, seek, show,
  showPiece, transport, useTemp, type JsonObject, type ShowPlanted,
} from './helpers.ts';

const ID = AC[1];
prebuild(() => { deepShow(['full']); });
const temp = useTemp();

const PORT = 'synth';
const PLAY = secs(0.7);
/** 20 notes 0.4 s apart from 0.5 s into the play, and one more 2 ms after the fifth: 21 entries, one step reading two. */
const NOTES_AT: [number, number][] = [
  ...Array.from({ length: 20 }, (_, i): [number, number] => [PLAY + secs(0.5 + 0.4 * i), 40 + i]),
  [PLAY + secs(2.102), 90],
];
const R1 = PLAY + secs(10);
const SEEK = R1 + MS;
const EXPORT = SEEK + secs(5.5);
const R3 = EXPORT + secs(0.5);

interface Played { calls: Record<string, JsonObject>; reply: (c: JsonObject) => JsonObject }
/** The world, driven as README: Criterion 1 says; with `planted`, the clean run's calls played once more under it. */
function playOut(evidence: string, out: string, planted?: ShowPlanted): Played {
  const bin = deepShow(['full']);
  const d = new Driver(bin, { evidence });
  const doc = pieceDoc(evidence, { [PORT]: { plugin: GEAR.id, out: SYNTH_OUT } });
  const c: Record<string, JsonObject> = {
    install: install(MS, GEAR, { [PORT]: { entries: [NOTES], rows: [HITS], sources: [], sound: false } }),
    show: showPiece(2 * MS, doc),
  };
  const s1 = d.click(secs(0.3), 'stage', 'AC1: your click before Connect', [c['install']!, c['show']!]);
  c['connect'] = connect(secs(0.4), PORT, { serial: s1 });
  const s2 = d.click(secs(0.6), 'stage', 'AC1: your click on Play', [c['connect']]);
  c['play'] = playPiece(PLAY, s2);
  c['track'] = inputTrack(R1);
  c['list'] = occurrences(R1);
  c['seek'] = seek(SEEK, 5 * FLICKS);
  c['replay'] = transport(SEEK, SEEK + secs(1));
  c['export'] = { call: 'export', at: EXPORT, doc: String(doc['id']), out, video: { codec: 'png_seq' }, range: { still: { t: '2s' } },
    track: [30, 60, 90].map((k, i) => ({ t: k * STEP, seq: 0, control: NOTES, value: 100 + i, writer: 'you', player: 1 })) };
  c['port'] = portCall(R3, PORT);
  const rest = [c['play'], ...NOTES_AT.map(([t, v]) => note(t, v)), c['track'], c['list'], c['seek'], c['replay'], c['export'], c['port']];
  if (!planted) {
    d.step(rest, 'AC1: the play');
    return { calls: c, reply: (x) => d.reply(x, 'AC1') };
  }
  const replies = playWorld(bin, { evidence, planted }, [...d.calls, ...rest], 'AC1');
  return { calls: c, reply: (x) => replies.get(x)! };
}

/** The set-up held: installed, shown, the port opened by your click, the piece playing, the seek played on from 5 s and
 * the export written. */
function setUp(p: Played, what: string): void {
  expect(obj(p.reply(p.calls['install']!), `${what}: install`)['installed'], `${what}: test.gear installs`).toBe(true);
  presented(p.reply(p.calls['show']!), `${what}: the drum pad`);
  expect(portOf(p.reply(p.calls['connect']!), `${what}: your Connect`).state, `${what}: your Connect click opens synth`).toBe('open');
  expect(obj(p.reply(p.calls['play']!), `${what}: Play`)['playing'], `${what}: your press of Play plays the piece`).toBe(true);
  expect('code' in obj(p.reply(p.calls['seek']!), `${what}: the seek`), `${what}: the seek is taken: ${show(p.reply(p.calls['seek']!))}`).toBe(false);
  const frames = arr(obj(obj(p.reply(p.calls['replay']!), `${what}: transport`)['transport'], `${what}: transport`)['frames'], `${what}: transport.frames`);
  const ts = frames.map((f, i) => Number(obj(f, `${what}: transport.frames[${i}]`)['t']));
  expect(ts.length > 30 && ts.every((t) => t >= 5 * FLICKS && t <= 6.1 * FLICKS), `${what}: the second after the seek plays on from 5 s (frame times ${ts.slice(0, 5).join(', ')} …)`).toBe(true);
  expect(obj(p.reply(p.calls['export']!), `${what}: the export`)['outcome'], `${what}: the still export is written: ${show(p.reply(p.calls['export']!))}`).toBe('exported');
}

describe(`AC1 ${ID} a port's out side: exactly the recorded entries and rows, once each, in step order, live and forward only`, () => {
  it(`AC1 ${ID} 10 s of live play deliver the track's notes entries and the list's hit rows by hash, once each, in step order; a seek back 5 s and an export send nothing`, () => {
    const evidence = temp();
    const p = playOut(evidence, join(temp(), 'still'));
    setUp(p, 'AC1');
    const entries = arr(obj(p.reply(p.calls['track']!), 'AC1: input_track')['input_track'], 'AC1: input_track').map((e, i) => obj(e, `input_track[${i}]`)).filter((e) => e['control'] === NOTES);
    const rows = arr(obj(obj(p.reply(p.calls['list']!), 'AC1: occurrences')['occurrences'], 'AC1: occurrences')[HITS], `AC1: occurrences.${HITS}`).map((r, i) => obj(r, `${HITS}[${i}]`));
    expect(entries.length, `AC1: the play's track holds the 21 notes played: ${show(entries, 400)}`).toBe(NOTES_AT.length);
    expect(rows.length, `AC1: hits emitted a row for each of the 21 notes it read: ${show(rows, 400)}`).toBe(NOTES_AT.length);

    const outs = outsOf(portOf(p.reply(p.calls['port']!), 'AC1: synth at the end'), 'AC1');
    const live = outs.filter((o) => o.at <= R1);
    const after = outs.filter((o) => o.at > R1);
    console.log(`${ID}: ${live.length} Out messages in the 10 s play (steps ${live[0]?.step} … ${live.at(-1)?.step}), ${after.length} after the seek and the export`);
    none([
      ...outShapeFailures(outs, PORT, NOTES),
      ...orderFailures(outs, PORT),
      ...matchFailures(live, entries, rows, PORT),
    ], `AC1 ${ID}: synth's Out messages against the play's track and list`);
  }, TIMEOUT);

  it(`AC1 ${ID} the planted port_sends_on_seek fails the same judgement, naming the first step it sent again`, () => {
    const p = playOut(temp(), join(temp(), 'still'), 'port_sends_on_seek');
    setUp(p, 'AC1 planted');
    const outs = outsOf(portOf(p.reply(p.calls['port']!), 'AC1 planted: synth at the end'), 'AC1 planted');
    const failures = orderFailures(outs, PORT);
    const before = Math.max(-1, ...outs.filter((o) => o.at <= SEEK).map((o) => o.step));
    const again = outs.find((o) => o.at > SEEK && o.step <= before);
    expect(again, `AC1 planted: the planted port sends a step it sent before, after the seek (it sent up to step ${before} before it)`).toBeDefined();
    expect(failures.length, 'AC1 planted: the judgement fails the planted port').toBeGreaterThan(0);
    expect(failures[0], `AC1 planted: the first failure names the first step sent again, step ${again!.step}`).toContain(`sent step ${again!.step} again`);
  }, TIMEOUT);
});
