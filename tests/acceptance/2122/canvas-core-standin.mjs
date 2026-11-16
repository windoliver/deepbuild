// Permitted canvas stand-in: normal world handshake, one call reply, then a dead input pipe.
// Synchronous fd I/O makes stdin close BEFORE the reply can wake Canvas's next call.
import { closeSync, readSync, writeSync } from 'node:fs';
const byte = Buffer.alloc(1);
function line() {
  let text = '';
  while (readSync(0, byte, 0, 1, null)) {
    if (byte[0] === 10) return JSON.parse(text);
    text += byte.toString();
  }
  throw Error('stand-in received EOF before a complete line');
}
if (!line().world) throw Error('expected the canvas world');
writeSync(1, '{"ok":true}\n');
if (!line().call) throw Error('expected the first canvas call');
closeSync(0);
writeSync(1, '{"ok":true,"reply":{"answered":true}}\n');
process.exit(0);
