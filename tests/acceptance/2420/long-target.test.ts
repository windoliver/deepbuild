// #2420's third criterion: a request whose Host is 9,000 characters long is answered 403 and recorded with a target
// of its first 512 bytes followed by `9000`. The request is `GET / HTTP/1.1` with that Host (one Host of 9,000 ASCII
// characters, so a character is a byte; its name ends in `.invalid`), sent to the run's filter port from outside the
// run. To know the record has taken it, the test then sends one plain request under a short name never used, and
// waits for that refusal in the record (#2399's reading: a run's refusals are appended in the order its filter
// reported them). On the merge base no event is recorded for the long one, and this test fails.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, downWorld, type Up, upWorld } from '../1106/helpers.ts';
import { filterOf, plain } from '../2399/helpers.ts';
import { CUT, holds, plainHost, recordOf, show } from './helpers.ts';

afterEach(cleanup, 60_000);

/** A Host of exactly 9,000 bytes: labels `l0000.l0001.…`, each different, then `.invalid`. */
function longHost(length: number): string {
  let host = '';
  for (let i = 0; host.length < length; i++) host += `l${String(i).padStart(4, '0')}.`;
  const tail = 'invalid';
  return host.slice(0, length - tail.length - 1).replace(/\.$/, 'x') + `.${tail}`;
}

describe('a target past 512 bytes', () => {
  it('#2420.9574047b a request whose Host is 9,000 characters long is answered 403 and recorded with a target of its first 512 bytes followed by 9000', async () => {
    let u: Up | undefined;
    try {
      u = await upWorld();
      const f = await filterOf(u.port);
      const host = longHost(9000);
      expect(Buffer.byteLength(host), 'the Host sent is 9,000 bytes').toBe(9000);
      expect(await plainHost(f, host), 'the request under the 9,000-character Host is answered 403').toBe(403);
      const mark = 'dh2420-after-long.invalid';
      expect(await plain(f, mark), 'the request after it is answered 403').toBe(403);
      const marked = await holds(u.client, u.run, mark);
      const rec = await recordOf(u.client, u.run);
      expect(marked, `the refusal sent after the long one, ${mark}, is in run ${u.run}'s record: ${show(rec.naming)}`).toBe(true);
      const prefix = host.slice(0, CUT);
      const long = rec.naming.filter((d) => d.target.startsWith(prefix));
      expect(long.length, `run ${u.run} recorded ${long.length} sandbox.denied whose target starts with the Host's first ${CUT} bytes, expected 1; the run's events: ${show(rec.naming)}`).toBe(1);
      const target = long[0]!.target;
      const rest = target.slice(CUT);
      expect(rest.startsWith(host.slice(CUT, CUT + 4)), `the target holds no more of the Host past its first ${CUT} bytes (it is ${Buffer.byteLength(target)} bytes, ending ${JSON.stringify(target.slice(-40))})`).toBe(false);
      expect(Buffer.byteLength(rest), `what follows the first ${CUT} bytes is the length alone, not more of the Host: ${JSON.stringify(rest.slice(0, 60))}`).toBeLessThanOrEqual(32);
      expect(/(^|\D)9000(\D|$)/.test(rest), `the first ${CUT} bytes are followed by the Host's length, 9000: ${JSON.stringify(rest)}`).toBe(true);
    } finally {
      await downWorld(u);
    }
  }, 600_000);
});
