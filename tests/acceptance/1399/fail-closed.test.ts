// #1399.33228c2f: "A check that never ran reads failing, not zero"
//
// The check is the relay suite's reader (#309), which `deep-show run`'s `relay_client` call runs on every frame a
// test client received once it took its seat in a match; its reply carries it as `reader: {status, failures}`. Here
// the client is given a relay that isn't there (https://127.0.0.1 on a port nothing listens on, with an authority
// file that holds no certificate): it never connects, never takes a seat and receives nothing, so the reader never
// runs. One test: the client's `outcome` is not `exchanged` (the reader had nothing to run on), and the reader reads
// failing, status FAIL, never PASS on zero failures.
// At the base the reader's failures default to an empty list when the client has no seat, so it reads PASS.

import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isObject, runShow, show, sub, useBinary, useTemp } from './helpers.ts';

const AC = '#1399.33228c2f';
const bin = useBinary('deep-show');
const temp = useTemp();

/** A port on 127.0.0.1 that was free a moment ago: a server took it and closed. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

describe(`${AC} a check runs fail closed: before any run, its result is failing`, () => {
  it(`${AC} a check that never ran reads failing, not zero`, async () => {
    const port = await closedPort();
    const ca = join(sub(temp(), 'ca'), 'none.pem');
    writeFileSync(ca, '');
    const call = { call: 'relay_client', relay: `https://127.0.0.1:${port}`, ca, match: '13990000000000000000000000001399', players: 2, frames: 1 };
    const [reply] = runShow(bin(), { evidence: sub(temp(), 'evidence'), calls: [call] });
    expect(reply!['code'], `the relay_client call was answered, not refused: ${show(reply)}`).toBeUndefined();
    expect(reply!['outcome'], `the client never reached the relay, so it exchanged nothing and its reader had nothing to run on: ${show(reply)}`).not.toBe('exchanged');
    const reader = reply!['reader'];
    expect(isObject(reader) ? reader['status'] : undefined, `the reader never ran, so it reads failing, not PASS on zero failures: ${show(reader)}`).toBe('FAIL');
  });
});
