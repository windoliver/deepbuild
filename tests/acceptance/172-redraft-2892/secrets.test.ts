// AC2 #172.33b3fb42: "A planted secret value from the app's store and the hub's socket path never appear in the bundle's
// bytes, and a piece with a status binding, a capture, a video strip, a video background or a video point set the
// bundle can't carry, or a canvas module the player lacks is refused at export, naming each"
//
// The blind redraft after #2892 (README) of the criterion's secrets half only: the first test of
// ../172/refusals.test.ts. Its refusal half is ../172-redraft-ac2/'s. It asserts, through `deep-show run` and the first
// draft's surfaces (../172/README.md: The surface under test):
//   - with a secret value in the app's store (the scenario's `secrets`) and the hub's socket path (the scenario's
//     `hub.socket`), the lab exports, and no file of its bundle holds the secret, its base64 or the socket path, each
//     file searched as stored and, where stored gzip, as the page reads it, inflated; each failure names the file;
//   - the leak twin: a copy of that bundle with the secret, its base64 and the socket path planted inside one file's
//     inflated bytes, that file stored gzip so its stored bytes don't hold them, fails the same search, naming the file
//     for each of the three.
// Wrong programs it fails on: an export that leaks the store or the hub's address into any file of the bundle, stored
// as it is or stored gzip (the twin is that bundle, made in test code); a search over stored bytes alone, which finds
// nothing inside a file stored gzip (#2892's wrong reading; the twin).
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, exportOnce, failsNaming, labDoc, labTrack, none, useShow, useTemp, webReceiptOf } from '../172/helpers.ts';
import { bundleAsRead, leakFailures, leakTwin } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

describe(`${AC[2]} no secret or hub address in any file of the bundle, read as the page reads it`, () => {
  it(`${AC[2]} a secret in the app's store and the hub's socket path appear in no file of the lab's bundle, stored or inflated`, () => {
    const evidence = temp();
    const secret = `deep172-secret-${randomBytes(16).toString('hex')}`;
    const socket = join(temp(), `hub-${randomBytes(6).toString('hex')}.sock`);
    const out = join(temp(), 'bundle');
    const reply = exportOnce(shows(FULL), evidence, labDoc(evidence), out, 'the lab with a secret in the store', {
      track: labTrack(), scenario: { secrets: { weather_key: secret }, hub: { socket } },
    });
    webReceiptOf(reply, 'the lab with a secret in the store');
    const needles: [string, Buffer][] = [
      ['the secret', Buffer.from(secret, 'utf8')], ['the secret in base64', Buffer.from(Buffer.from(secret, 'utf8').toString('base64'), 'utf8')],
      ['the hub\'s socket path', Buffer.from(socket, 'utf8')],
    ];
    const files = bundleAsRead(out);
    expect(files.size, 'the bundle holds files').toBeGreaterThan(0);
    none(leakFailures(files, needles), 'no file of the bundle, stored or inflated, holds the secret or the hub\'s socket path');

    // The leak twin: the three planted inside a file stored gzip, as #2892 stores most files.
    const twin = join(temp(), 'leak');
    const planted = leakTwin(out, twin, needles.map(([, n]) => n));
    const found = leakFailures(bundleAsRead(twin), needles);
    for (const [what] of needles) {
      failsNaming(found.filter((f) => f.includes(`holds ${what} at`)), planted, `the bundle with ${what} inside its gzip-stored ${planted}`);
    }
  }, TIMEOUT);
});
