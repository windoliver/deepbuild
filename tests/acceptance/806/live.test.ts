// AC2, the live form: a real `claude -p` session and a real `codex exec` session, scripted by their prompts, each call deep_show through
// `deep mcp` with the six-item figure, against a test hub. They spend plan usage, so they never run in CI and never pass unopted:
//   DEEP_SHOW_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... CODEX_API_KEY=... npx vitest run --root tests/acceptance/806 live
// Without DEEP_SHOW_LIVE=1 each test fails with a message starting `INCONCLUSIVE:`; with it, a missing binary or credential fails BLOCKED.
// README: Live tests says how the agents reach the test hub.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  App, CLI, FIGURE, FIGURE_ITEMS, LIVE, LIVE_VARIABLE, NODE, REPO, World, childEnv, cleanup, drawnAs, events, layerFailures, makeHome,
  own, requireMacos, startHub, t26, t393, useApp, uuidOf,
} from './helpers.ts';
import { expectPresentedReply, expectRecordedRevision, findReply } from './figure.ts';

afterEach(cleanup, 60_000);
const appReady = useApp();

const NAMES = { 'claude-code': 'Live Claude Code', codex: 'Live Codex' };

function optedIn(...needs: string[]): void {
  if (!LIVE) expect.fail(`INCONCLUSIVE: a live session spends plan usage; set ${LIVE_VARIABLE}=1 to run it (this is not a pass)`);
  for (const name of needs) if (!process.env[name]) expect.fail(`BLOCKED: the live session runs under a temporary HOME and signs in with ${name}; it is not set`);
}

const SCRIPT = (doc: string): string => [
  'This session is scripted: no one will answer a question. Do exactly this and nothing else.',
  `Call the MCP tool deep_show once, with doc "${doc}", t "0s", size [320, 200], include ["issues", "pixels"], and a document that is exactly this JSON (give it as the tool's document argument, unchanged):`,
  JSON.stringify(FIGURE),
  'When the tool has answered, reply with only the word DONE.',
].join('\n');

/** Runs the real agent for one scripted turn, as a child of this test, under the temporary HOME; resolves with its exit code and output. */
function runAgent(argv: string[], env: NodeJS.ProcessEnv, cwd: string, stdin: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin.end(stdin);
  });
}

describe('AC2 (live) a real Claude Code session and a real Codex session each call deep_show through deep mcp with a six-item figure on their own claim', () => {
  it('AC2 live: a real `claude -p` session, with deep mcp registered, shows the figure: presented at revision 1, drawn in its layer outlined with the session\'s name, held by the record by hash', async () => {
    optedIn('CLAUDE_CODE_OAUTH_TOKEN');
    requireMacos();
    appReady();
    const { tmp, home } = makeHome();
    const session = uuidOf('live-claude');
    const world = new World(join(tmp, 'world.json'), { names: NAMES, panels: t393.PANELS, docs: { [t393.DOC.a]: { panel: 'main' } } });
    const hub = await startHub(home, { world: world.path });
    const app = await App.start(home, join(tmp, 'app'));
    const work = t26.makeWorktree(join(tmp, 'work'));
    // The hub is reached through the temporary HOME (its default address): the hooks and deep mcp run with HOME set to it.
    const hook = (event: string) => `HOME='${home}' '${join(REPO, 'target/debug/deep-hook')}' claude-code ${event}`;
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, JSON.stringify({ hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'SessionEnd'].map((e) => [e, [{ hooks: [{ type: 'command', command: hook(e) }] }]])) }));
    const mcp = join(tmp, 'mcp.json');
    writeFileSync(mcp, JSON.stringify({ mcpServers: { deep: { type: 'stdio', command: NODE, args: [CLI, 'mcp'], env: { HOME: home } } } }));
    const env = { ...childEnv(home), CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN!, CLAUDE_CONFIG_DIR: join(home, '.claude') };
    mkdirSync(join(home, '.claude'), { recursive: true });
    const ran = await runAgent(['claude', '-p', '--session-id', session, '--settings', settings, '--mcp-config', mcp, '--strict-mcp-config', '--setting-sources', 'user', '--allowedTools', 'mcp__deep__deep_show', '--output-format', 'stream-json', '--verbose'], env, work.path, SCRIPT(t393.DOC.a));
    expect(ran.code, `claude -p exited 0: ${ran.out.slice(0, 800)}`).toBe(0);
    await app.sync();
    // The call and its reply are in the session's own output; the figure is where the app drew it, and the record holds it.
    const reply = findReply(ran.out);
    expect(reply, `the session's output holds deep_show's reply: ${ran.out.slice(-1500)}`).toBeDefined();
    await expectPresentedReply(home, 'the real Claude Code session', reply!);
    expect(layerFailures(app.drawn(), t393.DOC.a, 1, { thread: session, name: NAMES['claude-code'] }, FIGURE_ITEMS), 'the app draws the figure in the real session\'s layer, outlined with its name').toEqual([]);
    await expectRecordedRevision(hub, home, { session, thread: session, doc: t393.DOC.a, label: 'the real Claude Code session' });
  }, 900_000);

  it('AC2 live: a real `codex exec` session, with deep mcp registered, shows the figure: presented at revision 1, drawn in its layer outlined with the session\'s name, held by the record by hash', async () => {
    optedIn('CODEX_API_KEY');
    requireMacos();
    appReady();
    const { tmp, home } = makeHome();
    const world = new World(join(tmp, 'world.json'), { names: NAMES, panels: t393.PANELS, docs: { [t393.DOC.b]: { panel: 'main' } } });
    const hub = await startHub(home, { world: world.path });
    const app = await App.start(home, join(tmp, 'app'));
    const work = t26.makeWorktree(join(tmp, 'work'));
    // Codex reads its MCP servers and hooks from $CODEX_HOME/config.toml: deep mcp and deep-hook, each run with HOME set to the temporary one.
    const codexHome = join(home, '.codex');
    mkdirSync(codexHome, { recursive: true });
    const hook = (event: string) => `HOME='${home}' '${join(REPO, 'target/debug/deep-hook')}' codex ${event}`;
    writeFileSync(join(codexHome, 'config.toml'), [
      '[mcp_servers.deep]', `command = "${NODE}"`, `args = ["${CLI}", "mcp"]`, `env = { HOME = "${home}" }`, '',
      ...['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop'].flatMap((e) => [`[[hooks.${e}]]`, `command = "${hook(e)}"`, '']),
    ].join('\n'));
    const env = { ...childEnv(home), CODEX_HOME: codexHome, CODEX_API_KEY: process.env.CODEX_API_KEY! };
    const ran = await runAgent(['codex', 'exec', '--skip-git-repo-check', '--json', '-s', 'read-only', '-'], env, work.path, SCRIPT(t393.DOC.b));
    expect(ran.code, `codex exec exited 0: ${ran.out.slice(0, 800)}`).toBe(0);
    await app.sync();
    const start = (await events(hub)).find((e) => e.kind === 'session.start' && e.data?.agent === 'codex');
    expect(start, 'the hub saw the Codex session start through the hooks Codex ran').toBeDefined();
    const session = String(start!.session);
    const reply = findReply(ran.out);
    expect(reply, `the session's output holds deep_show's reply: ${ran.out.slice(-1500)}`).toBeDefined();
    await expectPresentedReply(home, 'the real Codex session', reply!);
    expect(layerFailures(app.drawn(), t393.DOC.b, 1, { thread: String(start!.data.thread), name: NAMES.codex }, FIGURE_ITEMS), 'the app draws the figure in the real session\'s layer, outlined with its name').toEqual([]);
    expect(drawnAs(app.drawn(), t393.DOC.b, uuidOf('live-claude')), 'and not in any other session\'s').toEqual([]);
    await expectRecordedRevision(hub, home, { session, thread: String(start!.data.thread), doc: t393.DOC.b, label: 'the real Codex session' });
  }, 900_000);
});
