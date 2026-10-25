// A test hub for #315's AC12 and AC13: a stand-in that speaks just enough of the hub's line protocol to fail in
// one named way. It is never the hub under test; the real hub is `deep hub run`.
//
//   node test-hub.mjs <mode> <socket> <log> [nonce]
//
// Modes:
//   accepts-never-reads   accepts every connection and then neither writes nor reads (no hello)
//   reads-never-replies   writes its hello, reads the request, never acknowledges it
//   garbled-reply         writes its hello, acknowledges the request, then replies with a line that doesn't parse
//   held-push             writes its hello, acknowledges the request at once with hold_until_ms 40 s ahead, and
//                         answers it 30 s later with a deny whose reason carries the nonce
//
// Every request line it reads is appended to <log>; every line it writes is appended to <log>.out. It prints
// `ready` on stdout once it listens.
import { appendFileSync, rmSync } from 'node:fs';
import net from 'node:net';

const [mode, path, log, nonce = ''] = process.argv.slice(2);
if (!['accepts-never-reads', 'reads-never-replies', 'garbled-reply', 'held-push'].includes(mode ?? '') || !path || !log) {
  process.stderr.write('usage: test-hub.mjs <mode> <socket> <log> [nonce]\n');
  process.exit(2);
}
// The held push's answer; helpers.ts's heldAnswer() builds the same text.
const HELD_ANSWER = (n) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `held answer ${n}` } });

const write = (sock, text) => {
  appendFileSync(`${log}.out`, text);
  sock.write(text);
};
rmSync(path, { force: true });
const server = net.createServer((sock) => {
  sock.on('error', () => undefined);
  if (mode === 'accepts-never-reads') {
    sock.pause();
    return;
  }
  write(sock, `${JSON.stringify({ v: 1, hello: 'deep-hub', start: `test-hub-${mode}-${nonce}`, features: [] })}\n`);
  let buffer = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      appendFileSync(log, `${line}\n`);
      let request;
      try { request = JSON.parse(line); } catch { continue; }
      if (mode === 'reads-never-replies') continue;
      if (mode === 'garbled-reply') {
        write(sock, `${JSON.stringify({ v: 1, ack: request.id, hold_until_ms: null })}\n`);
        // An unterminated string: the line doesn't parse.
        write(sock, `{"v":1,"exit":0,"stdout":"hub-bytes-${nonce}","stderr":"\n`);
      }
      if (mode === 'held-push') {
        write(sock, `${JSON.stringify({ v: 1, ack: request.id, hold_until_ms: Date.now() + 40_000 })}\n`);
        setTimeout(() => {
          if (!sock.destroyed) write(sock, `${JSON.stringify({ v: 1, exit: 0, stdout: HELD_ANSWER(nonce), stderr: '' })}\n`);
        }, 30_000);
      }
    }
  });
});
server.listen(path, () => process.stdout.write('ready\n'));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
