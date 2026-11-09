// Loaded into every Node process a command starts (NODE_OPTIONS=--import, README: The socket spy): it changes nothing a
// program does and only notes, one line each in $DEEP1359_SPY_LOG (a file outside HOME and the working folder), every
// socket the process connects (net.Socket#connect, which net.connect, tls.connect, http, https and fetch all go
// through), every server it listens with, and every datagram socket it binds or sends from.
import dgram from 'node:dgram';
import { appendFileSync } from 'node:fs';
import net from 'node:net';

const log = process.env.DEEP1359_SPY_LOG;
if (log && !globalThis.__deep1359Spy) {
  globalThis.__deep1359Spy = true;
  const where = (args) => {
    let first = args[0];
    if (Array.isArray(first)) first = first[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'number') return `port ${first}`;
    if (first && typeof first === 'object') return first.path ?? `${first.host ?? ''}:${first.port ?? ''}`;
    return String(first);
  };
  const note = (what) => {
    try { appendFileSync(log, `${process.pid} ${what}\n`); } catch { /* the log's folder went away: nothing to note into */ }
  };
  const wrap = (proto, name, label) => {
    const original = proto[name];
    proto[name] = function (...args) {
      note(`${label} ${where(args)}`);
      return original.apply(this, args);
    };
  };
  wrap(net.Socket.prototype, 'connect', 'connect');
  wrap(net.Server.prototype, 'listen', 'listen');
  wrap(dgram.Socket.prototype, 'bind', 'bind');
  wrap(dgram.Socket.prototype, 'send', 'send');
}
