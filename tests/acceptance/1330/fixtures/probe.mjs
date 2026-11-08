// The test repo's `npm test` (helpers.ts copies it in as probe.mjs, run by `node probe.mjs`): a child of the agent's
// `npm test` that tries the three things AC6 names, reads the planted key, writes the shell's rc file and connects
// to a host the approval doesn't name, and writes what happened to probe-<PROBE_LABEL or in>.json in its folder.
// Each refusal is also printed to stderr as Node words it, which is what the Bash tool's output carries.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const config = JSON.parse(readFileSync(new URL('./probe-config.json', import.meta.url), 'utf8'));
const label = process.env.PROBE_LABEL || 'in';
const out = { label, pid: process.pid, ppid: process.ppid };
const failed = (error) => ({ ok: false, error: `${error.code ?? 'ERROR'}: ${error.message}` });

try {
  out.read = { ok: true, bytes: readFileSync(config.key, 'utf8').length };
} catch (error) {
  out.read = failed(error);
  console.error(error.message);
}
try {
  appendFileSync(config.rc, `# written by the probe (${label})\n`);
  out.write = { ok: true };
} catch (error) {
  out.write = failed(error);
  console.error(error.message);
}
out.connect = await new Promise((done) => {
  const socket = net.connect({ host: config.host, port: config.port });
  const timer = setTimeout(() => { socket.destroy(); done({ ok: false, error: 'TIMEOUT: no answer in 5 s' }); }, 5000);
  socket.on('connect', () => { clearTimeout(timer); socket.end(); done({ ok: true }); });
  socket.on('error', (error) => { clearTimeout(timer); console.error(`connect ${config.host}:${config.port}: ${error.message}`); done(failed(error)); });
});
writeFileSync(`probe-${label}.json`, `${JSON.stringify(out)}\n`);
