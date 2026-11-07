// Lists Codex's hooks through app-server and writes each one's trusted hash into config.toml (what /hooks approval writes).
import { spawn } from 'node:child_process'; import { appendFileSync } from 'node:fs';
const [codex, cwd, config] = process.argv.slice(2);
const c = spawn(codex, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
let out = '', sent = false;
c.stdout.setEncoding('utf8').on('data', (d) => {
  out += d;
  if (!sent && out.includes('"id":1,')) { sent = true; c.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })}\n`); }
  for (const l of out.split('\n')) { let j; try { j = JSON.parse(l); } catch { continue; } if (j.id === 2) {
    const hooks = j.result.data.flatMap((x) => x.hooks);
    appendFileSync(config, '\n' + hooks.map((h) => `[hooks.state.${JSON.stringify(h.key)}]\ntrusted_hash = ${JSON.stringify(h.currentHash)}\n`).join('\n'));
    console.log('trusted', hooks.map((h) => `${h.eventName}:${h.trustStatus}`).join(' ')); c.kill(); process.exit(0); } }
});
c.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 's1330', version: '0' }, capabilities: { experimentalApi: true } } })}\n`);
setTimeout(() => { console.log('no hooks/list reply', out.slice(0, 300)); process.exit(1); }, 30000);
