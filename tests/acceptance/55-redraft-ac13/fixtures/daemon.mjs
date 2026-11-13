// #55 AC13's stand-in for paseo's daemon (README, The world): one process that hosts the plugin and starts the agents
// it runs, as paseo's daemon does, so an agent, its hooks and everything they start are in this process's tree. It
// runs ../../55/fixtures/paseo-host.mjs inside itself, unchanged: stdin and stdout carry that host's protocol (the
// plugin loaded with the PluginServerContext it builds, hooks fired, SDK calls read back). The agents it runs are
// driven over fd 3.
//
//   node daemon.mjs <paseo-host.mjs> <plugin entry>
//
// fd 3, one JSON line each way:
//   test → daemon  {op:'start', id, argv, cwd}  starts argv[0] with the rest of argv in cwd, a child of this process
//                                               with its environment, stdin and stdout piped through fd 3
//                  {id, data}                   text for that agent's stdin
//   daemon → test  {id, started: pid}           {id, data}: text the agent wrote on stdout   {id, exit, signal}
//                  {plugin: 'stopped'}          the host ran the plugin's cleanup and ended it (paseo disabled the
//                                               plugin): the daemon and the agents it runs go on.
// The daemon ends when fd 3 closes or on SIGTERM, stopping its agents first.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [, , HOST, ENTRY] = process.argv;
const exit = process.exit.bind(process);
const link = new net.Socket({ fd: 3, readable: true, writable: true });
const say = (o) => { if (!link.destroyed) link.write(`${JSON.stringify(o)}\n`); };
const agents = new Map();

let ending = false;
function end() {
  if (ending) return;
  ending = true;
  for (const child of agents.values()) try { child.kill('SIGTERM'); } catch { /* gone */ }
  setTimeout(() => exit(0), 1500);
}
process.on('SIGTERM', end);
link.on('error', end);
link.on('close', end);

createInterface({ input: link }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.op === 'start') {
    const [command, ...args] = c.argv;
    const child = spawn(command, args, { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
    agents.set(c.id, child);
    child.stdin.on('error', () => undefined);
    child.stdout.setEncoding('utf8').on('data', (data) => say({ id: c.id, data }));
    child.on('exit', (code, signal) => { agents.delete(c.id); say({ id: c.id, exit: code, signal }); });
    say({ id: c.id, started: child.pid });
  } else if (typeof c.data === 'string') {
    agents.get(c.id)?.stdin.write(c.data);
  }
});

// The host exits after its `stop` (the plugin's cleanup has run) and when its stdin ends: that ends the plugin, not
// paseo's daemon, so the agents it runs go on.
process.exit = (code) => { say({ plugin: 'stopped', code: code ?? 0 }); };
process.argv = [process.argv[0], HOST, ENTRY];
await import(pathToFileURL(HOST).href);
