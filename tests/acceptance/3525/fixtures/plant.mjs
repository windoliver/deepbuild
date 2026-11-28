// The planted servers of #3525's acceptance tests (README: Planted programs), loaded into a real `deep mcp` with
// `node --import <this file>`. PLANT_3525 names one, as JSON; without it this file does nothing. Each changes only the
// lines between the server and its client, so the plant is the server under test with one wrong thing in it, however
// the change builds its listing or its fetch:
//   {"kind":"still-fetch","fields":F}  deep_kinds still takes fetch: tools/list gives deep_kinds' op the value fetch
//                                      and the fields F (the base's fetch fields) back, and a deep_kinds call with op
//                                      fetch is sent on as the fetch's new form, deep_job {op: fetch, ...its fields}
//   {"kind":"empty"}                   a deep_kinds call with op fetch is answered with an empty listing, {rows: []}
//   {"kind":"mix"}                     replies to two deep_kinds calls of different ops that wait on each other go out
//                                      swapped (a lone one after 1.5 s, unchanged)
//   {"kind":"leave","fields":F}        the fetch fields F are copied and left: tools/list gives deep_kinds them back
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as later } from 'node:timers';

const plant = process.env.PLANT_3525 ? JSON.parse(process.env.PLANT_3525) : null;

if (plant) {
  const write = process.stdout.write.bind(process.stdout);
  /** Each tools/call the client sent, by its id's JSON: the tool it names and its op. */
  const calls = new Map();
  const isFetch = (c) => c?.name === 'deep_kinds' && c.op === 'fetch';

  // Inbound: deep mcp reads its stdin with fs.read on fd 0, so that read is wrapped: every complete line is noted, and
  // rewritten when the plant says so, then handed to the server as it would have read it.
  const rewrite = (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return text; }
    if (m?.method !== 'tools/call' || m.id === undefined) return text;
    const call = { name: m.params?.name, op: m.params?.arguments?.op };
    calls.set(JSON.stringify(m.id), call);
    if (plant.kind !== 'still-fetch' || !isFetch(call)) return text;
    const fields = Object.fromEntries(Object.entries(m.params.arguments).filter(([, v]) => v !== null && v !== undefined));
    return JSON.stringify({ ...m, params: { ...m.params, name: 'deep_job', arguments: fields } });
  };
  const realRead = fs.read;
  let pending = '';
  let ready = Buffer.alloc(0);
  let ended = false;
  const planted = function read(fd, buffer, offset, length, position, cb) {
    if (fd !== 0 || typeof cb !== 'function') return realRead.apply(this, arguments);
    const serve = () => {
      const n = Math.min(length, ready.length);
      ready.copy(buffer, offset, 0, n);
      ready = ready.subarray(n);
      cb(null, n, buffer);
    };
    if (ready.length || ended) return process.nextTick(serve);
    const chunk = Buffer.allocUnsafe(64 * 1024);
    realRead(0, chunk, 0, chunk.length, null, (error, n) => {
      if (error) return cb(error);
      if (n === 0) {
        ended = true;
        if (pending) ready = Buffer.concat([ready, Buffer.from(rewrite(pending))]);
        pending = '';
        return serve();
      }
      pending += chunk.subarray(0, n).toString('utf8');
      const last = pending.lastIndexOf('\n');
      if (last < 0) return planted(fd, buffer, offset, length, position, cb);
      const lines = pending.slice(0, last).split('\n').map(rewrite);
      pending = pending.slice(last + 1);
      ready = Buffer.concat([ready, Buffer.from(`${lines.join('\n')}\n`)]);
      return serve();
    });
    return undefined;
  };
  fs.read = planted;
  syncBuiltinESMExports();

  const withFields = (tool) => {
    const schema = tool.inputSchema ?? {};
    const props = { ...(schema.properties ?? {}) };
    for (const [k, v] of Object.entries(plant.fields ?? {})) if (!(k in props)) props[k] = v;
    const required = Array.isArray(schema.required) ? [...new Set([...schema.required, ...Object.keys(plant.fields ?? {}).filter((k) => !(k in (schema.properties ?? {})))])] : schema.required;
    return { ...tool, inputSchema: { ...schema, properties: props, ...(required ? { required } : {}) } };
  };

  /** Replies held by the mix plant, waiting on a partner: the line, its call and its flush timer. */
  const held = [];
  const out = (line) => write(`${line}\n`);
  const handle = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return out(line); }
    const call = calls.get(JSON.stringify(m?.id ?? null));
    if ((plant.kind === 'still-fetch' || plant.kind === 'leave') && Array.isArray(m?.result?.tools)) {
      m.result.tools = m.result.tools.map((tool) => {
        if (tool.name !== 'deep_kinds') return tool;
        let next = withFields(tool);
        if (plant.kind === 'still-fetch') {
          const op = next.inputSchema.properties.op ?? {};
          const values = Array.isArray(op.enum) ? op.enum : [];
          next = { ...next, inputSchema: { ...next.inputSchema, properties: { ...next.inputSchema.properties, op: { ...op, enum: values.includes('fetch') ? values : [...values, 'fetch'] } } } };
        }
        return next;
      });
      return out(JSON.stringify(m));
    }
    if (plant.kind === 'empty' && isFetch(call) && ('result' in (m ?? {}) || 'error' in (m ?? {}))) {
      const listing = { rows: [] };
      return out(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(listing) }], structuredContent: listing } }));
    }
    if (plant.kind === 'mix' && 'result' in (m ?? {}) && call?.name === 'deep_kinds') {
      const partner = held.find((h) => h.call.op !== call.op);
      if (partner) {
        held.splice(held.indexOf(partner), 1);
        clearTimeout(partner.timer);
        out(JSON.stringify({ ...partner.m, result: m.result }));
        return out(JSON.stringify({ ...m, result: partner.m.result }));
      }
      const entry = { m, call, timer: later(() => { held.splice(held.indexOf(entry), 1); out(line); }, 1500) };
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
