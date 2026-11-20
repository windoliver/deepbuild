// The planted servers of #2898's acceptance tests (README: Planted programs), loaded into a real `deep mcp` with
// `node --import <this file>`. PLANT_2898 names one, as JSON; without it this file does nothing. Each changes only what
// the server writes to its client, or adds one line to what the server reads from it, so the plant is the server under
// test with one wrong thing in it, however the change builds its listing:
//   {"kind":"hint","tool":T,"hint":H,"value":V}  tools/list states T's hint H as V (a tools.ts or a table that says so)
//   {"kind":"records","tool":T}                  each call of T also records an open item, through deep_open_item
//   {"kind":"mix","tools":[A,B]}                 a reply to A and a reply to B that wait on each other go out swapped
import { setTimeout as later } from 'node:timers';

const plant = process.env.PLANT_2898 ? JSON.parse(process.env.PLANT_2898) : null;

if (plant) {
  const write = process.stdout.write.bind(process.stdout);
  /** Each tools/call the client sent, by its id's JSON: the tool it names. */
  const named = new Map();
  /** Ids this plant sent on its own; their replies never reach the client. */
  const own = new Set();
  let ownN = 0;
  let inbound = '';
  const emit = process.stdin.emit.bind(process.stdin);
  process.stdin.emit = (event, ...args) => {
    if (event !== 'data') return emit(event, ...args);
    const passed = emit(event, ...args);
    inbound += Buffer.isBuffer(args[0]) ? args[0].toString('utf8') : String(args[0]);
    const extra = [];
    for (let i = inbound.indexOf('\n'); i >= 0; i = inbound.indexOf('\n')) {
      const line = inbound.slice(0, i);
      inbound = inbound.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m?.method !== 'tools/call' || m.id === undefined) continue;
      named.set(JSON.stringify(m.id), m.params?.name);
      if (plant.kind === 'records' && m.params?.name === plant.tool) {
        const id = `plant-2898-${++ownN}`;
        own.add(JSON.stringify(id));
        extra.push(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'deep_open_item', arguments: { text: `planted: ${plant.tool} recorded this open item` } } })}\n`);
      }
    }
    for (const line of extra) emit('data', Buffer.from(line));
    return passed;
  };

  /** Replies held by the mix plant, waiting on a partner: the line and its flush timer. */
  const held = [];
  const out = (line) => write(`${line}\n`);
  const handle = (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return out(line); }
    const key = JSON.stringify(m?.id ?? null);
    if (own.has(key)) return undefined;
    if (plant.kind === 'hint' && Array.isArray(m?.result?.tools)) {
      for (const tool of m.result.tools) if (tool.name === plant.tool) tool.annotations = { ...(tool.annotations ?? {}), [plant.hint]: plant.value };
      return out(JSON.stringify(m));
    }
    if (plant.kind === 'mix' && 'result' in (m ?? {}) && plant.tools.includes(named.get(key))) {
      const partner = held.find((h) => named.get(JSON.stringify(h.m.id)) !== named.get(key));
      if (partner) {
        held.splice(held.indexOf(partner), 1);
        clearTimeout(partner.timer);
        out(JSON.stringify({ ...partner.m, result: m.result }));
        return out(JSON.stringify({ ...m, result: partner.m.result }));
      }
      const entry = { m, timer: later(() => { held.splice(held.indexOf(entry), 1); out(line); }, 1500) };
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
