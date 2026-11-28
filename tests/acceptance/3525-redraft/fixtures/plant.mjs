// The planted servers of #3525's redrafted tests (README: Planted programs), loaded into a real `deep mcp` with
// `node --import <this file>`. PLANT_3525 names one, as JSON; without it this file does nothing. Each is the server
// under test with one wrong thing in it, made only in the lines it reads from its client and writes back:
//   {"kind":"kinds-fetch"}            deep_kinds still takes fetch: when the server's listing leaves `fetch` out of
//                                     deep_kinds' op, the listing puts it back with the fetch fields (library, id), and
//                                     a deep_kinds call naming op fetch goes to the tool whose own `op` lists fetch
//                                     (the drafted form of deep_job), with that tool's fields, so it fetches as that
//                                     form does. Where deep_kinds already takes fetch (the merge base) it changes nothing.
//   {"kind":"mix","tool":T,"holdMs":N} two replies to calls of T, waiting on each other, go out swapped: each carries
//                                     the other's result under its own request ID; a lone reply goes out unchanged after N
//                                     ms (1500 when not given)
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as later } from 'node:timers';

const plant = process.env.PLANT_3525 ? JSON.parse(process.env.PLANT_3525) : null;

if (plant) {
  const write = process.stdout.write.bind(process.stdout);
  /** Each tools/call the client sent, by its id's JSON: the tool it names. */
  const named = new Map();
  /** kinds-fetch: the tool and field that now take fetch, with its input schema, once a listing named one. */
  let moved = null;

  const rewrite = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return line; }
    if (m?.method !== 'tools/call' || m.id === undefined) return line;
    named.set(JSON.stringify(m.id), m.params?.name);
    if (plant.kind !== 'kinds-fetch' || !moved || m.params?.name !== 'deep_kinds' || m.params?.arguments?.op !== 'fetch') return line;
    const given = m.params.arguments;
    const props = Object.keys(moved.schema.properties ?? {});
    const args = Object.fromEntries(props.map((k) => [k, k === moved.field ? 'fetch' : (given[k] ?? null)]));
    return JSON.stringify({ ...m, params: { ...m.params, name: moved.tool, arguments: args } });
  };
  // deep mcp reads its client's lines with fs.read on fd 0 (packages/hub/src/mcp.ts, `requests`), so the plant reads
  // them there first: whole lines, each passed through `rewrite`, handed on as the server asks for bytes.
  const realRead = fs.read;
  const decoder = new StringDecoder('utf8');
  let partial = '';
  let pending = Buffer.alloc(0);
  fs.read = function read(fd, buffer, offset, length, position, cb) {
    if (fd !== 0 || typeof cb !== 'function') return realRead.apply(this, arguments);
    const give = () => { const n = Math.min(length, pending.length); pending.copy(buffer, offset, 0, n); pending = pending.subarray(n); cb(null, n, buffer); };
    if (pending.length) return void setImmediate(give);
    const tmp = Buffer.allocUnsafe(Math.max(length, 1));
    realRead(0, tmp, 0, length, position, (error, n) => {
      if (error) return cb(error, 0, buffer);
      if (n === 0) {
        partial += decoder.end();
        if (!partial) return cb(null, 0, buffer);
        pending = Buffer.from(rewrite(partial));
        partial = '';
        return give();
      }
      partial += decoder.write(tmp.subarray(0, n));
      const cut = partial.lastIndexOf('\n');
      if (cut < 0) return void fs.read(fd, buffer, offset, length, position, cb);
      const whole = partial.slice(0, cut);
      partial = partial.slice(cut + 1);
      pending = Buffer.from(`${whole.split('\n').map(rewrite).join('\n')}\n`);
      give();
    });
  };
  syncBuiltinESMExports();

  const held = [];
  const out = (line) => write(`${line}\n`);
  const handle = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return out(line); }
    const key = JSON.stringify(m?.id ?? null);
    if (plant.kind === 'kinds-fetch' && Array.isArray(m?.result?.tools)) {
      const kinds = m.result.tools.find((t) => t.name === 'deep_kinds');
      const op = kinds?.inputSchema?.properties?.op;
      if (op && Array.isArray(op.enum) && !op.enum.includes('fetch')) {
        for (const tool of m.result.tools) {
          const props = tool.inputSchema?.properties ?? {};
          const field = Object.keys(props).find((k) => Array.isArray(props[k]?.enum) && props[k].enum.includes('fetch'));
          if (tool.name !== 'deep_kinds' && field) { moved = { tool: tool.name, field, schema: tool.inputSchema }; break; }
        }
        op.enum = [...op.enum, 'fetch'];
        const schema = kinds.inputSchema;
        for (const f of ['library', 'id']) {
          if (!schema.properties[f]) schema.properties[f] = { type: ['string', 'null'], description: `fetch: the row's ${f}.` };
          if (Array.isArray(schema.required) && !schema.required.includes(f)) schema.required.push(f);
        }
      }
      return out(JSON.stringify(m));
    }
    if (plant.kind === 'mix' && 'result' in (m ?? {}) && named.get(key) === plant.tool) {
      const partner = held.find((h) => JSON.stringify(h.m.result) !== JSON.stringify(m.result));
      if (partner) {
        held.splice(held.indexOf(partner), 1);
        clearTimeout(partner.timer);
        out(JSON.stringify({ ...partner.m, result: m.result }));
        return out(JSON.stringify({ ...m, result: partner.m.result }));
      }
      const entry = { m, timer: later(() => { held.splice(held.indexOf(entry), 1); out(line); }, plant.holdMs ?? 1500) };
      held.push(entry);
      return undefined;
    }
    return out(line);
  };
  let outbound = '';
  process.stdout.write = (chunk, ...rest) => {
    outbound += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    for (let i = outbound.indexOf('\n'); i >= 0; i = outbound.indexOf('\n')) {
      const line = outbound.slice(0, i);
      outbound = outbound.slice(i + 1);
      handle(line);
    }
    const done = rest.find((r) => typeof r === 'function');
    if (done) done();
    return true;
  };
}
