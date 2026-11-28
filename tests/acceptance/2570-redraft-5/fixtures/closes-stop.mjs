import net from 'node:net';
import { basename } from 'node:path';
import { isMainThread } from 'node:worker_threads';

const [, , first, second] = process.argv;
const hubSocket = (server) => {
  let address;
  try { address = server.address(); } catch { return false; }
  return typeof address === 'string' && basename(address) === 'hub.sock';
};

if (isMainThread && first === 'hub' && second === 'run') {
  const open = new Set();
  const emit = net.Server.prototype.emit;
  net.Server.prototype.emit = function tracked(name, sock, ...rest) {
    if (name === 'connection' && sock instanceof net.Socket && hubSocket(this)) {
      open.add(sock);
      sock.once('close', () => open.delete(sock));
    }
    return emit.call(this, name, sock, ...rest);
  };
  const close = net.Server.prototype.close;
  net.Server.prototype.close = function closesStop(...args) {
    const ours = hubSocket(this);
    const result = close.apply(this, args);
    if (ours) for (const sock of [...open]) sock.destroy();
    return result;
  };
}
