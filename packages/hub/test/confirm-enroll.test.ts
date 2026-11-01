// deep-confirm's key set up again (#880, Scope: "a lost or replaced key is set up again only on the trusted path, and
// the old public key stops counting at that moment"): from the app alone, signed by a device you paired, and counted
// once you confirm with the new key. Built on #880's acceptance rig: a copy of the hub whose helper is a signed test
// binary holding a software P-256 key, so no Touch ID shows.
import { generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { canonicalize, type JsonValue } from '../../contracts/src/index.ts';
import { Conn } from '../../../tests/acceptance/24/helpers.ts';
import { cleanup, deep, expectCountedOnce, expectOpen, MINUTE, ready, rootOf, type Hub } from '../../../tests/acceptance/880/helpers.ts';

afterEach(cleanup);

async function as(hub: Hub, hello: 'app' | 'cli'): Promise<Conn> {
  const token = readFileSync(join(rootOf(hub.rig), 'control.token'), 'utf8').trim();
  return (await Conn.open(hub.socket, { hello, token })).conn;
}

it('sets the key up again only from the app with a paired device, and the old key stops counting then', async () => {
  const { rig, hub, asks: [a1, a2] } = await ready(['release v1', 'release v2']);
  const helperKey = join(rig.work, 'key.pem');
  const oldKey = join(rig.work, 'old.pem');
  copyFileSync(helperKey, oldKey);

  // A device paired from the CLI, which the setup key confirms.
  const device = generateKeyPairSync('ed25519');
  const cli = await as(hub, 'cli');
  const raw = device.publicKey.export({ format: 'jwk' }).x!;
  const paired = await cli.call('device.pair', { name: 'test app', public_key: raw }, MINUTE);
  expect(paired.result?.device, JSON.stringify(paired)).toMatch(/^device:/);
  const signed = (params: Record<string, unknown>) => {
    const body = { ...params, device: paired.result!.device as string };
    return { ...body, signature: sign(null, canonicalize(body as JsonValue), device.privateKey).toString('base64url') };
  };

  // Not from the CLI, and not from the app without a paired device's signature.
  expect((await cli.call('confirm.enroll', {}, MINUTE)).error?.code).toBe('role');
  cli.close();
  const app = await as(hub, 'app');
  expect((await app.call('confirm.enroll', {}, MINUTE)).error?.code).toBe('unconfirmed');
  expect(readFileSync(helperKey, 'utf8'), 'nothing was set up').toBe(readFileSync(oldKey, 'utf8'));

  // Signed by the paired device: the helper makes a new key and signs with it.
  const again = await app.call('confirm.enroll', signed({}), MINUTE);
  expect(again.result?.device, JSON.stringify(again)).toMatch(/^device:/);
  app.close();
  expect(readFileSync(helperKey, 'utf8'), 'the helper made a new key').not.toBe(readFileSync(oldKey, 'utf8'));

  // The old key, signing the hub's own fresh challenge, no longer counts; the new one does.
  const newKey = join(rig.work, 'new.pem');
  copyFileSync(helperKey, newKey);
  copyFileSync(oldKey, helperKey);
  const old = await deep(rig, ['inbox', 'answer', a1!, 'approve']);
  expect(old.code, `${old.stdout} ${old.stderr}`).toBe(3);
  await expectOpen(hub, a1!, 'signed by the key set up before');
  copyFileSync(newKey, helperKey);
  const fresh = await deep(rig, ['inbox', 'answer', a2!, 'approve']);
  expect(fresh.code, `${fresh.stdout} ${fresh.stderr}`).toBe(0);
  await expectCountedOnce(hub, a2!, 'approve', 'signed by the key set up again');
}, 5 * MINUTE);
