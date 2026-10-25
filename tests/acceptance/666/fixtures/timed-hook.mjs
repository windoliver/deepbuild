// The hook command the test's Claude Code user settings run for every hook event: `node timed-hook.mjs <config>
// <Event>`. It runs deep-hook as an agent's hook entry runs it (`deep-hook claude-code <Event>`, the hook's JSON on
// stdin, HOME the test's temporary home so deep-hook reads and spools under <home>/.deepbuild), times deep-hook from
// its spawn to its exit, appends one JSON line for it to the log, and hands deep-hook's stdout, stderr and exit code
// back to the agent unchanged. It decides nothing itself.
//
// config: {"deepHook": <binary>, "agent": "claude-code", "home": <temporary home>, "log": <hooks.jsonl>}
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const [configPath, event] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const input = readFileSync(0);
const now = () => performance.timeOrigin + performance.now();

const spawnedAtMs = now();
const child = spawn(config.deepHook, [config.agent, event], { env: { ...process.env, HOME: config.home }, stdio: ['pipe', 'pipe', 'pipe'] });
let exitedAtMs = Number.NaN;
const out = [];
const err = [];
child.stdout.on('data', (d) => out.push(d));
child.stderr.on('data', (d) => err.push(d));
child.stdin.on('error', () => {});
child.stdin.end(input);
child.on('exit', () => { exitedAtMs = now(); });
child.on('error', () => { exitedAtMs = now(); });
child.on('close', (code, signal) => {
  const stdout = Buffer.concat(out).toString('utf8');
  const stderr = Buffer.concat(err).toString('utf8');
  let parsed;
  try { parsed = JSON.parse(input.toString('utf8')); } catch { parsed = { unparsed: input.toString('utf8') }; }
  appendFileSync(config.log, `${JSON.stringify({ event, pid: child.pid ?? null, spawnedAtMs, exitedAtMs, ms: exitedAtMs - spawnedAtMs, exit: code, signal, stdout, stderr, input: parsed })}\n`);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code ?? 1;
});
