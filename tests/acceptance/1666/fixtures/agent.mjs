#!/usr/bin/env node
// Installed as `claude` and as `codex` first on a test home's login PATH (README, The agent). The hub finds it as it
// finds the agent. The hub's start is the launch whose arguments carry the start's words as the prompt: the real
// binary runs it in its non-interactive mode with those arguments unchanged (the permission mode, the --settings JSON
// or the -c overrides, the prompt), and only the model's API pointed at the suite's local stand-in on 127.0.0.1:
// Claude Code as `claude -p --output-format stream-json --verbose <launch args>`, Codex as
// `codex exec --json -c model_provider=... -m ... <launch args>`. Every other call (`--version`, `plugin list`,
// `app-server`, ...) goes to the real binary unchanged, its input and output its caller's. Each call is logged to the
// test home, with how the real binary ended. helpers.ts fills the constants below and the first line when it installs it.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const AGENT = '__AGENT__';
const REAL = '__REAL__';
const API = '__API__';
const LOG = '__LOG__';
const PROMPT = '__PROMPT__';

const args = process.argv.slice(2);
const start = args.includes(PROMPT);
const claude = AGENT === 'claude';
const argv = !start ? args : claude
  ? ['-p', '--output-format', 'stream-json', '--verbose', ...args]
  : ['exec', '--json', '-c', 'model_provider="dh1666"', '-c', `model_providers.dh1666={name="dh1666",base_url="${API}/v1",wire_api="responses",env_key="DH1666_API_KEY"}`, '-m', 'gpt-dh1666', ...args];
// No key and no sign-in: the stand-in takes any. Claude Code's nonessential traffic is off.
const env = { ...process.env, ...(claude ? { ANTHROPIC_BASE_URL: API, ANTHROPIC_API_KEY: 'dh1666-not-a-key', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } : { DH1666_API_KEY: 'dh1666-not-a-key' }) };

mkdirSync(LOG, { recursive: true });
const file = join(LOG, `${AGENT}-${process.pid}.json`);
const record = { agent: AGENT, pid: process.pid, ppid: process.ppid, cwd: process.cwd(), start, launched: args, ran: [REAL, ...argv], started: Date.now(), done: false };
const save = () => writeFileSync(file, `${JSON.stringify(record)}\n`);
save();
const child = spawn(REAL, argv, { env, stdio: start ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
record.child = child.pid ?? null;
save();
let stdout = '';
let stderr = '';
child.stdout?.setEncoding('utf8').on('data', (d) => { stdout += d; });
child.stderr?.setEncoding('utf8').on('data', (d) => { stderr += d; });
// The hub ends a session by signalling the process its terminal started: the real agent goes with it.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { try { child.kill(signal); } catch { /* gone */ } });
child.on('error', (error) => { Object.assign(record, { done: true, ended: Date.now(), code: null, error: error.message }); save(); process.exit(1); });
child.on('close', (code, signal) => {
  Object.assign(record, { done: true, ended: Date.now(), code, signal, stdout: stdout.slice(-100_000), stderr: stderr.slice(-20_000) });
  save();
  process.exit(code ?? 1);
});
