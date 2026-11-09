// What the redraft adds to the earlier #65 suite's helpers (../helpers.ts, imported as they are): the hub's ID as its
// hello names it, the phone signing in the current format (fixtures/phone.ts), and the app's answer signed in the
// same format (docs/technical-design.md, "The trusted path is a device you paired"; #1579). Everything else, the
// world, the providers, the record reads and cleanup, is the earlier suite's.
import net from 'node:net';
import { rpc, type Line, type World } from '../helpers.ts';
import { newOnce, paramsHash, Phone, sigOver, type Signature } from './fixtures/phone.ts';

/** The ID the hub's hello names (its first line on a connection: `{hello: 'deep-hub', …, hub}`). */
export function hubOf(w: { hub: { socket: string } }, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no hello from the hub within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8').on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      const i = buffer.indexOf('\n');
      if (i < 0) return;
      clearTimeout(timer);
      sock.destroy();
      let hello: Line | undefined;
      try { hello = JSON.parse(buffer.slice(0, i)) as Line; } catch { hello = undefined; }
      if (typeof hello?.hub === 'string' && hello.hub) resolve(hello.hub);
      else reject(Error(`BLOCKED: the hub's hello names no hub ID (the design: "hub the ID the hub's hello names"): ${buffer.slice(0, i).slice(0, 300)}`));
    });
  });
}

/** The world's paired phone, signing in the current format for the hub it paired with. */
export const phoneOf = async (w: World): Promise<Phone> => Phone.of(w.phone, await hubOf(w));

/**
 * The app's answer: `ask.answer {ask, option, signature}` on an app connection, signed by the app's paired device
 * for the method `ask.answer`, the hub its hello names, now, a fresh once, and the hash of `{ask, option}`.
 */
export async function appAnswer(w: World, ask: string, option: string): Promise<Line> {
  if (!w.app.id) throw Error('BLOCKED: the world paired no app device (world({app: true}))');
  const params = { ask, option };
  const signed = { device: w.app.id, method: 'ask.answer', hub: await hubOf(w), at: Date.now(), once: newOnce(), params: paramsHash(params) };
  const signature: Signature = { signed, sig: sigOver(signed, w.app.key) };
  return rpc(w, 'ask.answer', { ...params, signature: signature as unknown as Line }, 'app');
}
