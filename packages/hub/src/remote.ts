// A project's hub on another machine (#1338; design: Your hub, wherever it runs, under Socket roles). A person joins
// with the repo link and a one-time invite from someone already on the project: this machine makes a key of its own,
// checks that the hub answering at the invite's address is the hub the invite names before it sends anything, spends
// the invite, and keeps the credential the hub binds to that key, in ~/.deepbuild/hubs/<hub ID>.json. No hub address
// lives in the repo. From then on every clone of the project's repo here reaches that hub, by its forge identity:
// deep-hook's hooks, and the CLI's reads through remoteCall.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type tls from 'node:tls';
import { refusedGeneration } from './generations.js';
import { identityAt, idOf } from './identity.js';
import { forgeIdentity, forgeOf, installedRoot } from './paths.js';
import { inviteOf } from './people.js';
import type { Reply } from './client.js';
import type { Refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** A hub this machine joined: where it is reached, its ID, the person and project, and the credential bound to this machine's key. */
interface Joined { v: 1; hub: string; address: string; person: string; project: string; token: string }

const hubsDir = (): string => join(installedRoot(), 'hubs');
/** The key a machine's credential for one hub is bound to: `~/.deepbuild/keys/<hub ID>.key`, its certificate beside it. */
const keyFile = (hub: string): string => join(installedRoot(), 'keys', `${hub}.key`);

/**
 * The joined hub a folder's sessions reach: the one whose project is the folder's forge identity, so every clone of the
 * project's repo on this machine reaches the project's hub, as the design scopes a project; undefined for any other folder.
 */
export function joinedFor(cwd: string): Joined | undefined {
  const forge = forgeOf(cwd);
  if (!forge || !existsSync(hubsDir())) return undefined;
  for (const f of readdirSync(hubsDir()).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const joined = JSON.parse(readFileSync(join(hubsDir(), f), 'utf8')) as Joined;
      if (joined.project === forge) return joined;
    } catch { /* not one */ }
  }
  return undefined;
}

/**
 * A TLS connection to the hub at `address`, proving this machine's key for `hub`: it resolves only once the hub's
 * certificate carries the key `hub` names and its hello names a writer generation this machine may write to.
 */
async function open(address: string, hub: string): Promise<{ sock: tls.TLSSocket; lines: () => Promise<Obj> }> {
  const m = /^(.*):(\d{1,5})$/.exec(address);
  if (!m) return Promise.reject(Error(`${address} isn't <host>:<port>`));
  const key = identityAt(keyFile(hub), 'deep-client');
  const { connect } = await import('node:tls');
  return new Promise((resolve, reject) => {
    const sock = connect({ host: m[1]!.replace(/^\[|\]$/g, ''), port: Number(m[2]), key: key.key, cert: key.cert, rejectUnauthorized: false, minVersion: 'TLSv1.3', checkServerIdentity: () => undefined, timeout: 15_000 });
    let buffer = '';
    const waiting: ((o: Obj) => void)[] = [];
    const queued: Obj[] = [];
    let ended: Error | undefined;
    const fail = (error: Error) => { ended ??= error; reject(error); for (const w of waiting.splice(0)) w({ error: { remediation: error.message } }); };
    sock.on('error', (error) => fail(Error(`can't reach the hub at ${address}: ${error.message}`)));
    sock.on('timeout', () => { sock.destroy(); fail(Error(`the hub at ${address} didn't answer in 15 s`)); });
    sock.on('close', () => fail(Error(`the hub at ${address} closed the connection`)));
    const lines = (): Promise<Obj> => (queued.length ? Promise.resolve(queued.shift()!) : ended ? Promise.resolve({ error: { remediation: ended.message } }) : new Promise((r) => waiting.push(r)));
    sock.on('secureConnect', () => {
      // The hub proves who it is before anything is sent: a machine answering at a saved address that isn't this hub gets nothing.
      const cert = sock.getPeerX509Certificate();
      const id = cert ? idOf(cert) : 'no key';
      if (id !== hub) {
        sock.destroy();
        return fail(Error(`the machine at ${address} isn't the project's hub: it proved key ${id.slice(0, 16)}, and the hub is ${hub.slice(0, 16)}. Nothing was sent to it.`));
      }
      sock.setEncoding('utf8');
      sock.on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          let value: Obj;
          try { value = JSON.parse(buffer.slice(0, i)) as Obj; } catch { value = { error: { remediation: 'the hub answered a line that isn\'t JSON' } }; }
          buffer = buffer.slice(i + 1);
          const w = waiting.shift();
          if (w) w(value); else queued.push(value);
        }
      });
      void lines().then((hello) => {
        if (hello.hello !== 'deep-hub') return fail(Error(`the hub at ${address} said no hello: ${JSON.stringify(hello).slice(0, 200)}`));
        const stale = refusedGeneration(hub, hello.generation);
        if (stale) {
          sock.destroy();
          return fail(Error(stale));
        }
        resolve({ sock, lines });
      });
    });
  });
}

/** One call to a joined hub as its person: the result, or the hub's refusal; rejects when the hub can't be reached or is refused. */
export async function remoteCall(joined: Joined, method: string, params: Obj): Promise<Reply> {
  const { sock, lines } = await open(joined.address, joined.hub);
  try {
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: joined.token })}\n`);
    const hello = await lines();
    if (hello.error) return { error: hello.error as Refusal };
    sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
    const reply = await lines();
    return reply.error ? { error: reply.error as Refusal } : { result: reply.result as Obj };
  } finally {
    sock.destroy();
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.${process.pid}`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${file}.${process.pid}`, file);
}

/** `deep join <repo link> --invite <invite>`, in a clone of the project's repo. */
export async function joinCommand(args: readonly string[]): Promise<number> {
  const [link, flag, text] = args;
  if (args.length !== 3 || !link || flag !== '--invite' || !text) {
    process.stderr.write('Usage: deep join <repo link> --invite <invite>, in a clone of that repo\n');
    return 2;
  }
  const invite = inviteOf(text);
  if (typeof invite === 'string') {
    process.stderr.write(`deep join: ${invite}.\n`);
    return 2;
  }
  const project = forgeIdentity(link);
  const here = forgeOf(process.cwd());
  if (!project || project !== invite.project || here !== project) {
    process.stderr.write(`deep join changed nothing: the invite is for ${invite.project}, the link names ${project ?? link}, and this folder is ${here ? `a clone of ${here}` : 'no clone of a repo with an origin remote'}. Run it in a clone of ${invite.project}.\n`);
    return 1;
  }
  let joined: Obj;
  try {
    const { sock, lines } = await open(invite.address, invite.hub);
    try {
      sock.write(`${JSON.stringify({ v: 1, hello: 'join', invite: invite.secret })}\n`);
      const reply = await lines();
      if (!reply.joined) throw Error((reply.error as Refusal | undefined)?.remediation ?? `the hub answered ${JSON.stringify(reply).slice(0, 200)}`);
      joined = reply.joined as Obj;
    } finally {
      sock.destroy();
    }
  } catch (error) {
    process.stderr.write(`deep join changed nothing: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  writeJson(join(hubsDir(), `${invite.hub}.json`), { v: 1, hub: invite.hub, address: invite.address, person: String(joined.person), project: invite.project, token: String(joined.token) } satisfies Joined);
  process.stdout.write(`Joined ${invite.project} as ${String(joined.person)}: every clone of it here reaches the project's hub ${invite.hub.slice(0, 16)} at ${invite.address}, with a credential bound to this machine's key.\n`);
  return 0;
}
