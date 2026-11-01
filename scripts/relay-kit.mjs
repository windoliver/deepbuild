// The relay kit in the local preflight's lane `relay` (issue #309): the relay suite on the relay DeepBuild ships, and
// the interop run against every relay implementation in the repo, so a change to relay@1 passes against each of them
// in the same change. It starts each relay on 127.0.0.1 with a throwaway certificate made here by the openssl CLI, and
// stops each by its PID. A protocol change is relay@1's contract (packages/contracts/slots/relay@1.json) differing in
// its d1 digest from the merge base's; an interop run that leaves an implementation out of a protocol change fails,
// naming it. `--planted interop_shipped_only` is that wrong run: relay@1 changed in a scratch copy, interop on the
// shipped relay alone. Prints PASS or FAIL lines, then `{"relay_kit": {...}}`; exits 0 only on PASS. Never on push or
// pull request.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const planted = args[0] === '--planted' ? args[1] : undefined;
if (planted !== undefined && planted !== 'interop_shipped_only') {
  console.error(`relay-kit: no planted run ${planted}`);
  process.exit(2);
}
const bin = (name) => join(root, 'target', 'debug', name);
const CONTRACT = join(root, 'packages', 'contracts', 'slots', 'relay@1.json');

const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-relay', '--bin', 'deep-relay-suite', '--bin', 'deep-show'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
if (build.status !== 0) {
  console.error('relay-kit: the relay binaries did not build');
  process.exit(1);
}
if (!existsSync(join(root, 'packages/contracts/dist/index.js'))) {
  console.log('BLOCKED relay-kit: packages/contracts/dist is not built; run npm run build --workspaces');
  process.exit(3);
}
const { d1Digest } = await import('../packages/contracts/dist/index.js');

const dir = mkdtempSync(join(tmpdir(), 'deep-relay-kit-'));
const at = (f) => join(dir, f);
const children = new Set();

/** A throwaway certificate authority and a relay certificate for 127.0.0.1 it signed. */
function certificates() {
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = deep relay kit throwaway authority\n[ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('relay.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = 127.0.0.1\n');
  writeFileSync(at('relay.ext'), 'subjectAltName = IP:127.0.0.1\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\nauthorityKeyIdentifier = keyid\n');
  for (const step of [
    ['ecparam', '-name', 'prime256v1', '-param_enc', 'named_curve', '-out', at('p256.pem')],
    ['req', '-x509', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('ca.key'), '-out', at('ca.pem'), '-days', '1', '-config', at('ca.cnf'), '-extensions', 'ca'],
    ['req', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('relay.key'), '-out', at('relay.csr'), '-config', at('relay.cnf')],
    ['x509', '-req', '-in', at('relay.csr'), '-CA', at('ca.pem'), '-CAkey', at('ca.key'), '-set_serial', '1', '-out', at('relay.pem'), '-days', '1', '-sha256', '-extfile', at('relay.ext')],
  ]) {
    const r = spawnSync('openssl', step, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw Error(`openssl ${step[0]} failed: ${r.error?.message ?? r.stderr}`);
  }
}

/** The shipped relay on a port it picks: its URL and how to stop it. */
function startRelay() {
  const child = spawn(bin('deep-relay'), ['--listen', '127.0.0.1:0', '--cert', at('relay.pem'), '--key', at('relay.key')], { stdio: ['ignore', 'pipe', 'inherit'] });
  children.add(child);
  return new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(Error(`deep-relay exited ${code} before listening`)));
    child.stdout.setEncoding('utf8').once('data', (line) => {
      const host = JSON.parse(line.split('\n')[0]).listening;
      resolve({ url: `https://${host}`, stop: () => { child.kill('SIGTERM'); children.delete(child); } });
    });
  });
}

/** One command's stdout, without blocking the relays this process reads. */
function run(argv, input = '') {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
    children.add(child);
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.once('close', (status) => { children.delete(child); resolve({ status, stdout }); });
    child.stdin.end(input);
  });
}
const lastJson = (stdout) => JSON.parse(stdout.trim().split('\n').at(-1) || 'null');

/** Two test clients on the macOS backend exchanging frames through the shipped relay. */
async function interopShipped() {
  const relay = await startRelay();
  try {
    const match = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const call = { call: 'relay_client', relay: relay.url, ca: at('ca.pem'), match, players: 2, frames: 60 };
    const clients = await Promise.all([0, 1].map(() => run([bin('deep-show'), 'run'], `${JSON.stringify({ evidence: dir, calls: [call] })}\n`)));
    const replies = clients.map((c) => lastJson(c.stdout)?.replies?.[0]);
    const bad = replies.filter((r) => r?.outcome !== 'exchanged' || r?.reader?.status !== 'PASS');
    return bad.length ? `a test client ${bad[0]?.outcome ?? 'gave no reply'}: ${bad[0]?.reason ?? JSON.stringify(bad[0]?.reader?.failures ?? [])}` : '';
  } finally {
    relay.stop();
  }
}

/** The macOS backend's relay@1 session through the network seam's local test relay, behind its faults. */
async function interopTestRelay() {
  const call = { call: 'seam_suite', seam: 'network', backend: 'network.macos', messages: 10000, seed: 1 };
  const reply = lastJson((await run([bin('deep-show'), 'run'], `${JSON.stringify({ evidence: dir, calls: [call] })}\n`)).stdout)?.replies?.[0];
  return reply?.status === 'PASS' ? '' : `the network seam's suite answered ${reply?.status ?? 'nothing'} ${JSON.stringify(reply?.faults ?? [])}`;
}

/** Every relay implementation in the repo, by name, and its interop run. */
const IMPLEMENTATIONS = { 'deep-relay': interopShipped, 'relay.test': interopTestRelay };

/** Whether relay@1's contract differs in its digest from the merge base's (absent there counts as changed). */
function protocolChanged(contract) {
  const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const before = base ? spawnSync('git', ['show', `${base}:packages/contracts/slots/relay@1.json`], { cwd: root, encoding: 'utf8' }) : { status: 1 };
  return before.status !== 0 || d1Digest(JSON.parse(before.stdout)) !== d1Digest(contract);
}

const lines = [];
const report = { status: 'FAIL', suite: 'FAIL', protocol_changed: false, implementations: Object.keys(IMPLEMENTATIONS), interop: [], left_out: [] };
try {
  certificates();
  const relay = await startRelay();
  const suite = await run([bin('deep-relay-suite'), '--relay', relay.url, '--ca', at('ca.pem')]);
  relay.stop();
  const verdict = lastJson(suite.stdout);
  report.suite = verdict?.status === 'PASS' && suite.status === 0 ? 'PASS' : 'FAIL';
  const failing = Object.entries(verdict?.checks ?? {}).filter(([, c]) => c.status !== 'PASS');
  lines.push(`${report.suite} relay suite on deep-relay${failing.map(([n, c]) => `\n  ${n}: ${c.failures.slice(0, 3).join('; ')}`).join('')}`);

  let contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
  if (planted) contract = { ...contract, properties: { ...contract.properties, planted: { type: 'string' } } };
  report.protocol_changed = protocolChanged(contract);
  const covered = planted ? ['deep-relay'] : Object.keys(IMPLEMENTATIONS);
  let interopPass = true;
  for (const name of covered) {
    const problem = await IMPLEMENTATIONS[name]();
    report.interop.push(name);
    interopPass &&= problem === '';
    lines.push(problem ? `FAIL interop ${name}: ${problem}` : `PASS interop ${name}`);
  }
  report.left_out = report.protocol_changed ? report.implementations.filter((r) => !covered.includes(r)) : [];
  for (const r of report.left_out) lines.push(`FAIL relay-kit: relay@1 changed and its interop run left out the relay ${r}`);
  report.status = report.suite === 'PASS' && interopPass && report.left_out.length === 0 ? 'PASS' : 'FAIL';
} catch (error) {
  lines.push(`FAIL relay-kit: ${error.message}`);
} finally {
  for (const child of children) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
}
for (const line of lines) console.log(line);
console.log(JSON.stringify({ relay_kit: report }));
process.exit(report.status === 'PASS' ? 0 : 1);
