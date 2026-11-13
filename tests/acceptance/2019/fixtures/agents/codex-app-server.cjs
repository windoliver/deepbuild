// A stand-in for Codex's app-server in a test home (#2019's acceptance suite): JSON lines on stdin and stdout, as the
// hub's own client and #39's suite speak to the real one. `initialize` is answered; `hooks/list` lists each hook entry
// of the home's ~/.codex/hooks.json (or $CODEX_HOME's) with the trust codex.json beside this file names, `trusted` or
// `untrusted`, in the fields Codex 0.160 reports (key, eventName, command, timeoutSec, matcher, currentHash,
// trustStatus, enabled). Every other method is refused. No model is called and nothing is written.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createInterface } = require('node:readline');

const conf = JSON.parse(readFileSync(join(__dirname, 'codex.json'), 'utf8'));
const home = process.env.CODEX_HOME || join(process.env.HOME || '', '.codex');
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function listed() {
  let file;
  try { file = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8')); } catch { return []; }
  const out = [];
  for (const [event, groups] of Object.entries(file.hooks || {})) {
    (groups || []).forEach((group, g) => (group.hooks || []).forEach((hook, i) => {
      const matcher = typeof group.matcher === 'string' ? group.matcher : null;
      const timeoutSec = typeof hook.timeout === 'number' ? hook.timeout : 600;
      out.push({
        key: `${join(home, 'hooks.json')}:${event}:${g}:${i}`,
        eventName: event.charAt(0).toLowerCase() + event.slice(1),
        command: hook.command,
        timeoutSec,
        matcher,
        currentHash: createHash('sha256').update(JSON.stringify([hook.command, timeoutSec, matcher])).digest('hex'),
        trustStatus: conf.trust,
        enabled: true,
      });
    }));
  }
  return out;
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (!m || m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { userAgent: `codex_cli_rs/${conf.version}` } });
  else if (m.method === 'hooks/list') send({ id: m.id, result: { data: ((m.params && m.params.cwds) || ['']).map((cwd) => ({ cwd, hooks: listed() })) } });
  else send({ id: m.id, error: { code: -32601, message: `${m.method} is not served by this stand-in` } });
});
