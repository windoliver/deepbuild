// #1106 AC4: the run's certificate authority is trusted in no process outside the run's sandbox; a planted setup that
// adds it to the login keychain fails, naming the store. The app's call with its stand-in to the shop API's host
// goes through the egress filter, which shows it a certificate for that host made by the run's CA; the app reports
// the chain it was shown and the CA bundles its trust variables name, and the run's CA is the self-signed
// certificate that issued what it was shown (never the sample API's own test CA). Reading, over the stores a process
// outside the run's sandbox would trust that the run could reach: the temp HOME's login keychain (by its explicit
// path, through `security find-certificate -a -Z` and its bytes), the CA bundle the hub's own trust variable names,
// and every other file under the temp HOME. None may hold the run's CA. This suite never reads or writes the real
// login keychain or a system trust store.
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bytesOf, call, type Call, cleanup, downWorld, filesUnder, home, type Up, upWorld, type World } from './helpers.ts';

afterEach(cleanup, 60_000);

/** Every certificate in a PEM bundle. */
function certsIn(pem: string): X509Certificate[] {
  const out: X509Certificate[] = [];
  for (const m of pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)) {
    try { out.push(new X509Certificate(m[0])); } catch { /* not one */ }
  }
  return out;
}
/** The run's CA: the self-signed certificate at the top of what issued the certificate the filter showed the app. */
function runCaOf(got: Call): X509Certificate | string {
  if (!got.chain?.length) return `the app's call through the filter showed it no certificate (${got.error ?? `status ${got.status}`})`;
  const candidates = [...got.chain.slice(1).map((b) => new X509Certificate(Buffer.from(b, 'base64'))), ...(got.trust ?? []).flatMap((t) => certsIn(t.pem))];
  let cur = new X509Certificate(Buffer.from(got.chain[0]!, 'base64'));
  for (let i = 0; i < 6; i++) {
    const issuer = candidates.find((c) => cur.checkIssued(c) && cur.verify(c.publicKey));
    if (!issuer) break;
    if (issuer.checkIssued(issuer)) return issuer;
    cur = issuer;
  }
  return `no CA the app was given issued the certificate it was shown for ${got.chain.length ? new X509Certificate(Buffer.from(got.chain[0]!, 'base64')).subject : 'the host'}`;
}

const hex = (fingerprint: string) => fingerprint.replace(/:/g, '').toUpperCase();
/** Whether bytes hold the certificate: its DER, or its base64 with line breaks taken out. */
function holdsCert(bytes: Buffer, ca: X509Certificate): boolean {
  if (bytes.includes(ca.raw)) return true;
  return bytes.toString('latin1').replace(/\s+/g, '').includes(ca.raw.toString('base64'));
}

/**
 * AC4's reading: null when none of the stores a process outside the run's sandbox trusts holds the run's CA;
 * otherwise each store that does, by name.
 */
function caTrustProblem(ca: X509Certificate, w: World): string | null {
  const found: string[] = [];
  const keychains = join(home(), 'Library', 'Keychains');
  for (const name of ['login.keychain-db', 'login.keychain']) {
    const path = join(keychains, name);
    if (!existsSync(path)) continue;
    let listed = '';
    try {
      listed = execFileSync('/usr/bin/security', ['find-certificate', '-a', '-Z', path], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home() } });
    } catch { /* not a keychain security reads: its bytes are read below */ }
    const bytes = bytesOf(path);
    if (listed.toUpperCase().includes(hex(ca.fingerprint)) || (bytes && holdsCert(bytes, ca))) found.push(`the login keychain ${path} holds the run's CA`);
  }
  // The hub's own trust variable: NODE_EXTRA_CA_CERTS, the sample APIs' test CA bundle the test gave it.
  if (holdsCert(readFileSync(w.tls.caFile), ca)) found.push(`the hub's NODE_EXTRA_CA_CERTS bundle ${w.tls.caFile} holds the run's CA`);
  // Every other file under the temp HOME, outside the run's own folders (the hub's root and the system temp folder).
  for (const path of filesUnder(home(), (p) => p === join(home(), '.deepbuild'))) {
    if (path.startsWith(join(keychains, 'login.keychain'))) continue;
    const bytes = bytesOf(path);
    if (bytes && holdsCert(bytes, ca)) found.push(`${path}, under HOME, holds the run's CA`);
  }
  return found.length ? `the run's CA is trusted outside its sandbox: ${found.join('; ')}` : null;
}

async function scenario(plant?: string): Promise<{ u: Up; problem: string | null; ca: X509Certificate | string }> {
  const u = await upWorld(plant);
  const got = await call(u.port, { variable: 'SHOP_API_KEY', to: u.w.shop.host, put: 'header', method: 'GET', attempt: 'ac4' });
  expect(got.status === 200 && got.upstream === 'shop', `the scenario formed: the app's call through the filter got the shop API's 200 (${JSON.stringify({ ...got, chain: got.chain?.length, trust: got.trust?.map((t) => t.variable) })})`).toBe(true);
  const ca = runCaOf(got);
  return { u, ca, problem: typeof ca === 'string' ? ca : caTrustProblem(ca, u.w) };
}

describe('AC4 #1106.70f52264 the run\'s certificate authority is trusted in no process outside the run\'s sandbox; a planted setup that adds it to the login keychain fails, naming the store', () => {
  it('AC4 the filter shows the app a certificate from the run\'s own CA, not the sample API\'s, and no keychain, hub trust bundle or file under HOME outside the run holds that CA', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario();
      u = s.u;
      expect(typeof s.ca === 'string' ? s.ca : null, 'the app was shown a certificate its run\'s CA issued').toBeNull();
      const ca = s.ca as X509Certificate;
      expect(ca.fingerprint256, 'the filter showed the sample API\'s own certificate: it made no run CA').not.toBe(s.u.w.tls.ca.fingerprint256);
      expect(s.problem).toBeNull();
    } finally {
      await downWorld(u);
    }
  }, 240_000);

  it('AC4 (wrong program) a setup that adds the run\'s CA to the login keychain (DEEP_HUB_PLANT=run-ca-in-login-keychain) fails the reading, naming the store', async () => {
    let u: Up | undefined;
    try {
      const s = await scenario('run-ca-in-login-keychain');
      u = s.u;
      expect(s.problem, 'the reading passes on a run CA added to the login keychain').not.toBeNull();
      expect(s.problem, 'and names the store').toMatch(/the login keychain \S+ holds the run's CA/);
    } finally {
      await downWorld(u);
    }
  }, 240_000);
});
