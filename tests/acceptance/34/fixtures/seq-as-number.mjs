// A planted wrong hub for AC12, loaded with `node --import` before the hub: every line the hub writes to a
// socket carries `seq` as a JSON number instead of its decimal string. Only tests/acceptance/34 loads it.
import net from 'node:net';

const write = net.Socket.prototype.write;
const asNumber = (text) => text.replace(/"seq":"(\d+)"/g, '"seq":$1');
net.Socket.prototype.write = function (chunk, ...rest) {
  if (typeof chunk === 'string') chunk = asNumber(chunk);
  else if (Buffer.isBuffer(chunk)) chunk = Buffer.from(asNumber(chunk.toString('utf8')), 'utf8');
  return write.call(this, chunk, ...rest);
};
