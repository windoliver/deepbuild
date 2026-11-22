// A process that holds the control token (README: The surface). It reads the token file, says hello on the hub's
// socket as the CLI does (`{"hello":"cli","token":…}`, with `peer`, its own PID and `ps -o lstart=` start, when asked,
// as the base's deep commands name theirs), sends one call and reads its reply line. Run as a program it is a command's
// child, as the issue has it:
//
//   node client.mjs <socket> <token file> <method> <params JSON> [--peer] [--every <ms> --for <ms>] [--mark <word>]
//
// It prints one JSON line per call, `{"t":<ms when sent>,"done":<ms when the reply came>,"reply":<the reply line>}`
// (or `"closed"`/`"timeout"` where none came), and exits. With `--every`, it sends the same call again on a new
// connection every <ms> until <ms> of `--for` passed, as `deep hub promote` renews its drain while it waits for turns.
// `--mark` only puts a word in its command line, so a test can find this process's command line where the hub shows it.
// Imported, `rawCall` is the same call from the test's own process.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const startOf = (pid) => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();

/** One call: resolves `{ hub, role, reply }`, each a parsed line, or the string 'closed' or 'timeout' where none came. */
export function rawCall({ socket, tokenFile, method, params = {}, peer = false, ms = 60_000 }) {
  const token = readFileSync(tokenFile, 'utf8').trim();
  const hello = { v: 1, hello: 'cli', token, ...(peer ? { peer: { pid: process.pid, start: startOf(process.pid) } } : {}) };
  return new Promise((done) => {
    const got = [];
    let buffer = '', reply, ended = false;
    const sock = net.connect(socket);
    const finish = (why) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      sock.destroy();
      done({ hub: got[0] ?? why, role: got[1] ?? why, reply: reply ?? why });
    };
    const timer = setTimeout(() => finish('timeout'), ms);
    sock.setEncoding('utf8');
    sock.on('error', () => finish('closed'));
    sock.on('close', () => finish('closed'));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line;
        try { line = JSON.parse(buffer.slice(0, i)); } catch { line = { unparsed: buffer.slice(0, i) }; }
        buffer = buffer.slice(i + 1);
        got.push(line);
        if (got.length === 1) sock.write(`${JSON.stringify(hello)}\n`);
        else if (got.length === 2) {
          if (line.error) { reply = line; return finish('closed'); }
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (line.id === 1) {
          reply = line;
          return finish('closed');
        }
      }
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [socket, tokenFile, method, params, ...flags] = process.argv.slice(2);
  const flag = (name) => { const i = flags.indexOf(name); return i >= 0 ? Number(flags[i + 1]) : undefined; };
  const every = flag('--every'), span = flag('--for');
  const peer = flags.includes('--peer');
  const first = Date.now();
  for (;;) {
    const t = Date.now();
    const out = await rawCall({ socket, tokenFile, method, params: JSON.parse(params || '{}'), peer, ms: 30_000 });
    process.stdout.write(`${JSON.stringify({ t, done: Date.now(), reply: out.reply })}\n`);
    if (!every || Date.now() + every - first > span) break;
    await new Promise((go) => setTimeout(go, Math.max(0, t + every - Date.now())));
  }
}
