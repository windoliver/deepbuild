// #3421 AC2: each of the issue's six lines, written by a stand-in hub on the home's own socket, reads as the hub
// away, and deep-hook prints none of its bytes. The hook is this checkout's binary, run as a hook entry runs it.
//
// "Reads as the hub away" is read off two records: the hook's exit code and stdout are the ones the same binary gives
// the same call with no hub at the address, byte for byte; and the request is in the spool with no `late` mark, so the
// line was read inside the hub's time and refused, not waited out. (stderr is not compared whole: with the hub away
// deep-hook may add a line of its own about its spool, which names the event's new ID.) "Prints none of its bytes":
// every string the stand-in wrote carries a random marker, and no marker is in the hook's stdout or stderr. An
// acknowledgement the hook must refuse is followed at once by a reply that holds to hook.reply@2 (exit 3, markers on
// both streams), so a hook that took the acknowledgement prints it.
//
// The control comes first: the same stand-in writing the design's own two lines has its reply taken, exit code and
// both streams. Without it the six would pass against a stand-in no hook ever heard.
import { afterEach, describe, expect, test } from 'vitest';
import {
  ackLine, buildChange, cleanup, exchangeInTime, hubAway, loadNow, nonce, otherUlid, readsAway, replyLine, replyOf, shown, type Line,
} from './helpers.ts';

afterEach(cleanup);

interface Planted { name: string; lines(request: Line, mark: string): string[]; marks(mark: string): string[] }
const followed = (mark: string): string => replyLine(3, `out-${mark}`, `err-${mark}`);
const OTHER = otherUlid();
const PLANTED: Planted[] = [
  {
    name: 'an acknowledgement with a fourth key',
    lines: (r, m) => [ackLine(r.id, { extra: `key-${m}` }), followed(m)],
    marks: (m) => [`key-${m}`, `out-${m}`, `err-${m}`],
  },
  {
    name: "an acknowledgement whose ack is another request's ID",
    lines: (_r, m) => [ackLine(OTHER), followed(m)],
    marks: (m) => [OTHER, `out-${m}`, `err-${m}`],
  },
  {
    name: 'an acknowledgement with hold_until_ms of -1',
    lines: (r, m) => [ackLine(r.id, { hold_until_ms: -1 }), followed(m)],
    marks: (m) => [`out-${m}`, `err-${m}`],
  },
  {
    name: 'a reply with exit of 256',
    lines: (r, m) => [ackLine(r.id), replyLine(256, `out-${m}`, `err-${m}`)],
    marks: (m) => [`out-${m}`, `err-${m}`],
  },
  {
    name: 'a reply with no stderr',
    lines: (r, m) => [ackLine(r.id), JSON.stringify({ v: 1, exit: 3, stdout: `out-${m}` })],
    marks: (m) => [`out-${m}`],
  },
  {
    name: 'a reply with v of 2',
    lines: (r, m) => [ackLine(r.id), JSON.stringify({ v: 2, exit: 3, stdout: `out-${m}`, stderr: `err-${m}` })],
    marks: (m) => [`out-${m}`, `err-${m}`],
  },
];

describe('#3421 AC2 lines from a stand-in hub that do not hold to hook.ack@2 or hook.reply@2', () => {
  test('#3421.7b68a484 each of the six lines reads as the hub away, and the hook prints none of its bytes', async () => {
    const built = buildChange();
    expect(built.error, 'this checkout builds deep-hook: cargo build --locked -q -p deep-hook').toBe('');
    const away = await hubAway(built.bin);
    expect(away.timedOut, `with no hub at the address deep-hook answers by itself: ${shown(away)}`).toBe(false);

    // The control: the design's own acknowledgement and reply are taken, exit code and both streams.
    const mark = nonce();
    const taken = await exchangeInTime(built.bin, away, (r) => [ackLine(r.id), followed(mark)]);
    expect({ told: taken.told, reply: replyOf(taken.ran) }, `the stand-in's acknowledgement and reply, as the design writes them, are taken (${taken.tries} tries, load ${loadNow()}, last ${taken.how}): ${shown(taken.ran)}`)
      .toEqual({ told: true, reply: { exit: 3, stdout: `out-${mark}`, stderr: `err-${mark}` } });

    const faults: string[] = [];
    for (const planted of PLANTED) {
      const m = nonce();
      const x = await exchangeInTime(built.bin, away, (r) => planted.lines(r, m));
      const output = `${x.ran.stdout}\n${x.ran.stderr}`;
      const printed = planted.marks(m).filter((text) => output.includes(text));
      if (printed.length) faults.push(`${planted.name}: the hook printed the hub's bytes ${JSON.stringify(printed)}: ${shown(x.ran)}`);
      else if (!readsAway(x.ran, away)) faults.push(`${planted.name}: the hook's exit code and stdout are not the ones it gives with the hub away (${shown(away)}): ${shown(x.ran)}`);
      else if (!x.told) faults.push(`${planted.name}: in ${x.tries} tries (load ${loadNow()}) no run shows the line was read in the hub's time: the last was ${x.how}, with ${x.spool.length} spooled`);
      else if (x.how !== 'refused') faults.push(`${planted.name}: the hub away spools the request with no late mark, and this run's is ${x.how}`);
    }
    expect(faults, 'each of the six lines reads as the hub away and none of its bytes is printed').toEqual([]);
  }, 30 * 60_000);
});
