// The test's deep-confirm (README: The helper's protocol). A small signed launcher (fixtures/launcher.c, compiled and
// ad-hoc signed per test) runs `node helper.mjs <config.json> <role> <the hub's arguments…>`, so the file at the hub's
// helper location is a real Mach-O binary with a code identity of its own, and this script is what it does. It holds
// a software P-256 key in a file the test controls: no test touches the Secure Enclave or shows Touch ID.
//
// Roles, compiled into the launcher, so each role is a binary with its own code identity:
// - `helper`: the helper `deep setup` records. `enroll` makes a key and prints its public key; `sign` reads the hub's
//   challenge from stdin and does what `<dir>/mode.json` says (sign, capture, capture-cancel, replay, cancel).
// - `impostor`: a helper whose code signature differs. The first thing it does when started is write
//   `<dir>/impostor-started`, the marker criterion 3 checks; then it signs honestly, so only the code-signature check
//   can keep its answer from counting. Under the base's protocol (one argument, the reason) it exits 0.
// Every call is logged to `<dir>/calls.jsonl`: the role, the arguments, the challenge read and the reply given.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [configFile, role, ...args] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const dir = config.dir;
if (role === 'impostor') writeFileSync(join(dir, 'impostor-started'), `${process.pid} ${JSON.stringify(args)}\n`);
const log = (entry) => appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify({ at: Date.now(), pid: process.pid, role, args, ...entry })}\n`);

/** RFC 8785 bytes of a JSON value: keys sorted by UTF-16 code units, no whitespace; strings and numbers as ECMAScript writes them. */
const jcs = (v) => Array.isArray(v) ? `[${v.map(jcs).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`
  : JSON.stringify(v);
const reply = (o, code) => { process.stdout.write(`${JSON.stringify(o)}\n`); process.exitCode = code; };
const signed = (challenge) => {
  const key = createPrivateKey(readFileSync(config.key, 'utf8'));
  return { signed: challenge, signature: sign('sha256', Buffer.from(jcs(challenge), 'utf8'), { key, dsaEncoding: 'der' }).toString('base64url') };
};
/** The challenge: the first line on stdin (the hub may close stdin after it, or not). */
const firstLine = () => new Promise((done) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    text += d;
    const i = text.indexOf('\n');
    if (i >= 0) { process.stdin.pause(); process.stdin.destroy(); done(text.slice(0, i)); }
  });
  process.stdin.on('end', () => done(text));
  process.stdin.on('error', () => done(text));
});

if (args.length === 1 && args[0] === 'enroll') {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const tmp = `${config.key}.tmp`;
  writeFileSync(tmp, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  renameSync(tmp, config.key);
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const out = { public_key: point.toString('base64url') };
  log({ enrolled: out.public_key });
  reply(out, 0);
} else if (args.length === 1 && args[0] === 'sign') {
  const line = await firstLine();
  let challenge;
  try {
    challenge = JSON.parse(line);
  } catch {
    log({ unreadable: line });
    reply({ error: `no challenge on stdin: ${JSON.stringify(line.slice(0, 200))}` }, 1);
  }
  if (challenge !== undefined) {
    const modeFile = join(dir, 'mode.json');
    const mode = existsSync(modeFile) ? JSON.parse(readFileSync(modeFile, 'utf8')) : { mode: 'sign' };
    const capture = (response) => appendFileSync(join(dir, 'captures.jsonl'), `${JSON.stringify({ challenge, response })}\n`);
    let out;
    let code = 0;
    if (role === 'impostor' || mode.mode === 'sign') out = signed(challenge);
    else if (mode.mode === 'capture') { out = signed(challenge); capture(out); }
    else if (mode.mode === 'capture-cancel') { capture(signed(challenge)); out = { error: 'cancelled' }; code = 1; }
    else if (mode.mode === 'replay') {
      const captures = readFileSync(join(dir, 'captures.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      out = captures[mode.capture].response;
    } else { out = { error: 'cancelled' }; code = 1; }
    log({ mode: role === 'impostor' ? 'impostor' : mode, challenge, reply: out });
    reply(out, code);
  }
} else {
  // The base's protocol: the reason as the one argument, the exit code the answer.
  log({ base_protocol: true });
  if (role === 'impostor') process.exitCode = 0;
  else {
    process.stderr.write(`deep-confirm (the #880 test helper): called as ${JSON.stringify(args)}, not as "enroll" or "sign" with a challenge on stdin\n`);
    process.exitCode = 1;
  }
}
