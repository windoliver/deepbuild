// Criterion 1, the live half (README: Criterion 1, live): real Claude Code (`claude -p`) and Codex (`codex exec`)
// sessions, each with `deep mcp` registered through a recording wrapper (fixtures/mcp-record.sh), against a real hub in a
// temporary home. They spend plan usage, so they are skipped unless DEEP_DRIVE_LIVE=1, and are never in CI:
//   DEEP_DRIVE_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... [CODEX_API_KEY=...] npx vitest run --root tests/acceptance/124 ac1-agents.live.test.ts
// With it set, a missing credential or binary fails BLOCKED. Each run file is written under $DEEP_DRIVE_LIVE_OUT (else a
// temp folder, printed), in fixtures/runs' format, so a recorded run can be kept as a fixture.
//
// 1. Per agent, one session drives the fixture panel with deep_drive; its recorded calls, replayed in a fresh replica,
//    pass on the fixture panel and fail on the twin naming save-enabled, which the verdict engine sends back.
// 2. Per agent, five sessions each build a panel from one brief and drive it to passing assertions; whether the first
//    drive passed is read from the replica's own answer to the session's first close. scripts/drive-reading.mjs turns
//    the five into the reading, never a pass or fail; under 4 of 5 it opens one open item naming the agent and the step.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURES, ID, LIVE, LIVE_VARIABLE, PANEL, REPO, buildDrive, cleanup, judge, own, replay, requireMacos, t26, type Obj, type RunFile,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const OUT = process.env.DEEP_DRIVE_LIVE_OUT ?? mkdtempSync(join(tmpdir(), 'dd124-live-'));
const NODE = process.execPath;
// Not a proxy in front of `deep mcp`: the wrapper execs into it, so `deep mcp` stays the agent's direct child, which the hub
// requires to bind a deep_* call to the session (its hello names its parent, and a call binds only to that session's agent).
const RECORD = join(FIXTURES, 'mcp-record.sh');
type Agent = 'claude-code' | 'codex';

function versionOf(agent: Agent): string {
  const r = spawnSync(agent === 'claude-code' ? 'claude' : 'codex', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) expect.fail(`BLOCKED: ${agent}'s command isn't on PATH: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim().split(/\s+/).find((w) => /^\d+\.\d+\.\d+/.test(w)) ?? r.stdout.trim();
}
function codexSignIn(codexHome: string): Record<string, string> {
  if (process.env.CODEX_API_KEY) return { CODEX_API_KEY: process.env.CODEX_API_KEY };
  const real = join(homedir(), '.codex', 'auth.json');
  if (!existsSync(real)) expect.fail('BLOCKED: the live Codex session needs CODEX_API_KEY or ~/.codex/auth.json');
  copyFileSync(real, join(codexHome, 'auth.json'));
  chmodSync(join(codexHome, 'auth.json'), 0o600);
  return {};
}
function runAgent(argv: string[], env: NodeJS.ProcessEnv, cwd: string, stdin: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 1_200_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin.end(stdin);
  });
}

/** One real session in a fresh home and worktree, its deep mcp recorded by the wrapper; the deep_drive calls and replies it made. */
async function session(agent: Agent, prompt: (work: string) => string, setup: (work: string) => void, tag: string): Promise<{ run: RunFile; replies: Obj[]; work: string }> {
  const { tmp, home } = t26.makeHome();
  await t26.startHub(home);
  const work = t26.makeWorktree(join(tmp, 'work')).path;
  setup(work);
  const log = join(tmp, 'mcp');
  mkdirSync(log);
  const hook = (event: string) => `HOME='${home}' '${join(REPO, 'target/debug/deep-hook')}' ${agent} ${event}`;
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'];
  const version = versionOf(agent);
  let ran;
  if (agent === 'claude-code') {
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [{ type: 'command', command: hook(e) }] }]])) }));
    const mcp = join(tmp, 'mcp.json');
    writeFileSync(mcp, JSON.stringify({ mcpServers: { deep: { type: 'stdio', command: '/bin/bash', args: [RECORD, log, NODE, join(REPO, 'packages/cli/dist/main.js'), 'mcp'], env: { HOME: home } } } }));
    mkdirSync(join(home, '.claude'), { recursive: true });
    const env = { ...t26.childEnv(home), CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN!, CLAUDE_CONFIG_DIR: join(home, '.claude') };
    ran = await runAgent(['claude', '-p', '--settings', settings, '--mcp-config', mcp, '--strict-mcp-config', '--setting-sources', 'user', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'mcp__deep__deep_drive', 'Read', 'Write', 'Edit', '--output-format', 'stream-json', '--verbose'], env, work, prompt(work));
  } else {
    const codexHome = join(home, '.codex');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), [
      '[mcp_servers.deep]', 'command = "/bin/bash"', `args = ["${RECORD}", "${log}", "${NODE}", "${join(REPO, 'packages/cli/dist/main.js')}", "mcp"]`, `env = { HOME = "${home}" }`, '',
      '[mcp_servers.deep.tools.deep_drive]', 'approval_mode = "approve"', '',
    ].join('\n'));
    writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [{ type: 'command', command: hook(e) }] }]])) }));
    const env = { ...t26.childEnv(home), CODEX_HOME: codexHome, ...codexSignIn(codexHome) };
    ran = await runAgent(['codex', 'exec', '--dangerously-bypass-hook-trust', '--skip-git-repo-check', '--json', '-s', 'workspace-write', '-'], env, work, prompt(work));
  }
  expect(ran.code, `${agent} exited 0: ${ran.out.slice(-1500)}`).toBe(0);
  const read = (dir: 'in' | 'out') => {
    const file = join(log, `${dir}.jsonl`);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [{ dir, line: JSON.parse(l) as Obj }]; } catch { return []; } }) : [];
  };
  const lines = [...read('in'), ...read('out')];
  const asked = lines.filter((l) => l.dir === 'in' && l.line.method === 'tools/call' && l.line.params?.name === 'deep_drive');
  const answers = new Map(lines.filter((l) => l.dir === 'out').map((l) => [String(l.line.id), l.line]));
  const calls = asked.map((l) => l.line.params.arguments as Obj);
  const replies = asked.map((l) => { const r = answers.get(String(l.line.id)); return (r?.result?.structuredContent ?? JSON.parse(r?.result?.content?.[0]?.text ?? 'null')) as Obj; });
  expect(calls.length, `the ${agent} session called deep_drive: ${ran.out.slice(-1500)}`).toBeGreaterThan(0);
  const launchCall = calls.find((c) => c.call === 'launch');
  const run: RunFile = { format: 'deep_drive.run@1', agent: { name: agent, version }, session: `session:${tag}`, panel: String(launchCall?.launch?.panel ?? ''), calls };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${agent}-${tag}.run.json`), `${JSON.stringify(run, null, 2)}\n`);
  return { run, replies, work };
}

const DRIVE_PROMPT = (panel: string) => [
  'This session is scripted: no one will answer a question.',
  `A panel is at ${panel}: a form with a field labelled Email and a Save button. Using only the MCP tool deep_drive,`,
  `launch a replica with that panel (launch.panel "${panel}"), type an email address into the field, assert with an expect named "save-enabled"`,
  'that the Save button is enabled, click Save, assert that the text "Saved <the address>" is visible, then close the replica.',
  'Reply DONE when you are finished.',
].join('\n');
const BUILD_PROMPT = [
  'Build a DeepBuild panel in the folder ./panel of this repository: a gpui-shell script panel (main.js) with a field labelled Email',
  'and a Save button that is enabled only when the field holds an email address; clicking Save shows "Saved <the address>".',
  'Then check it the way a person would, with the MCP tool deep_drive: launch a replica with launch.panel set to the absolute path of ./panel,',
  'drive it, and use expect assertions until they pass. Close the replica after each attempt. Reply DONE when the assertions pass.',
].join('\n');

function optedIn(agent: Agent): void {
  if (agent === 'claude-code' && !process.env.CLAUDE_CODE_OAUTH_TOKEN) expect.fail('BLOCKED: the live Claude Code session signs in with CLAUDE_CODE_OAUTH_TOKEN; it is not set');
  requireMacos();
  buildDrive();
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js')) || !existsSync(join(REPO, 'target/debug/deep-hook'))) expect.fail('BLOCKED: build the CLI (npm run build --workspaces) and deep-hook (cargo build --locked --bin deep-hook) first');
}

describe.skipIf(!LIVE)(`${ID.replay} live: real Claude Code and Codex sessions drive a panel with deep_drive (set ${LIVE_VARIABLE}=1)`, () => {
  for (const agent of ['claude-code', 'codex'] as const) {
    it(`${ID.replay} live: a ${agent} session's recorded run on the fixture panel, replayed, passes; on the twin it fails save-enabled and is sent back`, async () => {
      optedIn(agent);
      // The session drives its own copy of the fixture panel; the replay puts the fixture panel and then its twin in its place.
      const { run } = await session(agent, (work) => DRIVE_PROMPT(join(work, 'panel')), (work) => cpSync(PANEL.form, join(work, 'panel'), { recursive: true }), 'fixture');
      const passed = await replay(run, PANEL.form);
      expect(passed.journey.outcome, `the recorded run passes on the fixture panel: ${JSON.stringify(passed.journey).slice(0, 800)}`).toBe('passed');
      expect(judge(passed.journey).outcome).toBe('PASS');
      const failed = await replay(run, PANEL.twin);
      expect((failed.journey.failures as Obj[]).map((f) => f.test), 'on the twin the run fails save-enabled').toContain('save-enabled');
      const v = judge(failed.journey);
      expect(v.outcome).toBe('FAIL');
      expect(v.send_backs.some((b) => `${b.cause} ${b.smallest}`.includes('save-enabled')), `sent back naming save-enabled: ${JSON.stringify(v.send_backs)}`).toBe(true);
    }, 1_800_000);

    it(`${ID.replay} live: five ${agent} sessions build a panel and drive it; how often the first drive passes is a reading, and under 4 of 5 opens one open item`, async () => {
      optedIn(agent);
      const version = versionOf(agent);
      const runs: Obj[] = [];
      for (let i = 0; i < 5; i++) {
        const { run, replies } = await session(agent, () => BUILD_PROMPT, () => undefined, `build-${i + 1}`);
        expect(run.agent.version, 'each run on the pinned version').toBe(version);
        const firstClose = replies.find((_r, k) => run.calls[k]?.call === 'close');
        const journey = firstClose?.journey as Obj | undefined;
        const failedStep = journey?.outcome === 'passed' ? null : String((journey?.failures as Obj[] | undefined)?.[0]?.test ?? 'no close: the session never finished a drive');
        runs.push({ version, first_try: failedStep === null, failed_step: failedStep });
      }
      const { driveReading } = await import(join(REPO, 'scripts', 'drive-reading.mjs')) as { driveReading: (i: Obj) => Obj };
      const reading = driveReading({ agent: { name: agent, version }, runs });
      writeFileSync(join(OUT, `${agent}-reading.json`), `${JSON.stringify(reading, null, 2)}\n`);
      console.log(`${agent} ${version}: ${reading.first_try} of 5 first-try drives; ${OUT}`);
      expect([reading.runs, JSON.stringify(reading).match(/"(PASS|FAIL)"/)], 'a reading of five runs, never a pass or fail').toEqual([5, null]);
      if (reading.first_try < 4) expect(String(reading.open_item?.text), 'under 4 of 5 opens an open item naming the agent').toContain(agent);
      else expect(reading.open_item).toBeNull();
    }, 7_200_000);
  }
});
