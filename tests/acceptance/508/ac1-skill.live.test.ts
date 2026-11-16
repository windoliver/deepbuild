// AC1, the live half: "Given only the generated skill, Claude Code and Codex each write a fixture figure as a document
// that passes the document checks on the first try"
//
// Real Claude Code (`claude -p`) and Codex (`codex exec`) sessions, one each. They spend plan usage, so they are skipped
// unless DEEP_SKILL_LIVE=1, and never run in CI (scripts/lanes.mjs: byHand):
//   DEEP_SKILL_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... [CODEX_API_KEY=...] npx vitest run --root tests/acceptance/508 ac1-skill.live.test.ts --testTimeout=600000
// With it set, a missing CLI or credential fails BLOCKED. Each session starts in a fresh folder outside the checkout
// holding one file, skills/deepbuild-canvas/SKILL.md copied as SKILL.md, with a fresh config home, no MCP server and
// no shell tool, so the skill is all it has and nothing can check its document before it hands it in: the file it
// writes is its first try. The brief (helpers.ts FIGURE_PROMPT) asks for the issue's test rig with a throttle slider.
// The test keeps the session's figure.json as its run record, docs/evidence/508/agents/<agent>.run.json (README:
// Surfaces this job invents, 9), then judges it as the replay test does: `deep_show` presents it with no error.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIGURE_PROMPT, SKILL, ac, blocked, checkFailures, isObject, none, runShow, scenarioOf, sha256, show, showDoc, useBins,
  writeAgentRun, type Agent, type JsonObject, type JsonValue,
} from './helpers.ts';

const LIVE = process.env['DEEP_SKILL_LIVE'] === '1';
const bin = useBins();

function versionOf(agent: Agent): string {
  const r = spawnSync(agent === 'claude-code' ? 'claude' : 'codex', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) blocked(`${agent}'s command isn't on PATH: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim().split(/\s+/).find((w) => /^\d+\.\d+\.\d+/.test(w)) ?? r.stdout.trim();
}
/** Runs one session to its end; the child is ours, stopped by its own PID on timeout. */
function runAgent(argv: string[], env: NodeJS.ProcessEnv, cwd: string, stdin: string): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 1_200_000);
    child.on('close', (code) => { clearTimeout(timer); done({ code, out }); });
    child.stdin.end(stdin);
  });
}

async function session(agent: Agent): Promise<JsonObject> {
  if (!existsSync(SKILL)) blocked(`the generated skill ${SKILL} isn't there`);
  const version = versionOf(agent);
  const tmp = mkdtempSync(join(tmpdir(), `deep-508-${agent}-`));
  try {
    const work = join(tmp, 'work'); const home = join(tmp, 'home');
    mkdirSync(work); mkdirSync(home);
    copyFileSync(SKILL, join(work, 'SKILL.md'));
    const base: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '', HOME: home, LANG: 'en_US.UTF-8' };
    let ran;
    if (agent === 'claude-code') {
      const token = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
      if (!token) blocked('the live Claude Code session signs in with CLAUDE_CODE_OAUTH_TOKEN; it is not set');
      const mcp = join(tmp, 'mcp.json');
      writeFileSync(mcp, JSON.stringify({ mcpServers: {} }));
      ran = await runAgent(['claude', '-p', '--mcp-config', mcp, '--strict-mcp-config', '--setting-sources', 'user', '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Read', 'Write', '--disallowedTools', 'Bash', 'WebFetch', 'WebSearch', '--output-format', 'json'],
      { ...base, CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CONFIG_DIR: join(home, '.claude') }, work, FIGURE_PROMPT);
    } else {
      const codexHome = join(home, '.codex');
      mkdirSync(codexHome, { recursive: true });
      const env: NodeJS.ProcessEnv = { ...base, CODEX_HOME: codexHome };
      if (process.env['CODEX_API_KEY']) env['CODEX_API_KEY'] = process.env['CODEX_API_KEY'];
      else {
        const real = join(homedir(), '.codex', 'auth.json');
        if (!existsSync(real)) blocked('the live Codex session needs CODEX_API_KEY or ~/.codex/auth.json');
        copyFileSync(real, join(codexHome, 'auth.json'));
        chmodSync(join(codexHome, 'auth.json'), 0o600);
      }
      ran = await runAgent(['codex', 'exec', '--skip-git-repo-check', '--json', '-s', 'workspace-write', '-'], env, work, FIGURE_PROMPT);
    }
    expect(ran.code, `${agent} exited 0: ${ran.out.slice(-1500)}`).toBe(0);
    const file = join(work, 'figure.json');
    expect(existsSync(file), `the ${agent} session wrote ./figure.json: ${ran.out.slice(-1500)}`).toBe(true);
    let document: JsonValue;
    try { document = JSON.parse(readFileSync(file, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`the ${agent} session's figure.json is not JSON, so its first try fails: ${(e as Error).message}`); }
    expect(isObject(document), `the ${agent} session's figure.json is a document object: ${show(document)}`).toBe(true);
    writeAgentRun({ format: 'canvas-skill.run@1', agent: { name: agent, version }, skill_sha256: sha256(readFileSync(SKILL)), context: ['SKILL.md'], prompt: FIGURE_PROMPT, document: document as JsonObject });
    return document as JsonObject;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe.skipIf(!LIVE)(`${ac(1)} live: real Claude Code and Codex sessions write a fixture figure from the generated skill alone (set DEEP_SKILL_LIVE=1)`, () => {
  for (const agent of ['claude-code', 'codex'] as const) {
    it(`${ac(1)} live: a ${agent} session given only the generated skill writes a fixture figure that passes the document checks on its first try`, async () => {
      const document = await session(agent);
      const evidence = mkdtempSync(join(tmpdir(), 'deep-508-evidence-'));
      try {
        const [shown] = runShow(bin('deep-show'), scenarioOf(evidence, [1280, 720], [showDoc(document)]), `the ${agent} figure`);
        none(checkFailures(shown!, `the ${agent} session's first try`), `${agent}: its first try at a fixture figure`);
      } finally {
        rmSync(evidence, { recursive: true, force: true });
      }
    }, 1_800_000);
  }
});
