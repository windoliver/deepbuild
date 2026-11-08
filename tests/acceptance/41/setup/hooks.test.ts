// AC3 #41.8ef78e02 Existing hooks are untouched after install and after undo.
//
// Your hooks live in Claude Code's user settings (~/.claude/settings.json) and in Codex's ~/.codex/hooks.json, with
// Codex's trust for them and your other settings in ~/.codex/config.toml. Each file is written by hand before setup, with
// your own entries in several events, several groups and several entries to a group, and keys that have nothing to do
// with hooks. After `deep setup`, every entry of yours is there with the same content, in the same group, in the same
// order (DeepBuild's own entries, which run deep-hook or the deep CLI, set aside); your keys and your config.toml lines
// are all still there, in order. After a confirmed `deep setup --undo`, each file is byte-for-byte as you wrote it.
// The undo runs with the OS confirmation stubbed `confirmed`, as #19's suite does. The wrong program is the planted
// `undo-reserializes` (DEEP_HUB_PLANT), an undo that takes DeepBuild's entries out and writes the JSON again.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC3, claudeSettings, cleanup, codexConfig, codexHooks, firstDifference, makeHome, onMac, parseObject, setup, undo, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

/** Your Claude Code user settings, by hand: tabs, a space before a colon, a \u escape, no newline at the end. */
const MY_CLAUDE = String.raw`{
	"$schema": "https://json.schemastore.org/claude-code-settings.json",
	"model" : "opus",
	"statusLine": {"type": "command", "command": "/bin/echo my-status"},
	"permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Read(./.env)"] },
	"env": {"MY_FLAG": "1", "GREETING": "café"},
	"myOwnKey": {"nested": [3, 1, 2], "on": true},
	"hooks": {
		"PreToolUse": [
			{ "matcher": "Bash", "hooks": [
				{ "type": "command", "command": "/bin/echo my-guard-1", "timeout": 10 },
				{ "type": "command", "command": "/bin/echo my-guard-2" }
			] },
			{ "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "/usr/bin/true my-format", "timeout": 30 } ] }
		],
		"PostToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "/bin/echo my-log", "async": true }, { "type": "command", "command": "/bin/echo my-after" } ] } ],
		"UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-prompt" } ] } ],
		"SessionStart": [ { "matcher": "startup", "hooks": [ { "type": "command", "command": "/bin/echo my-start" } ] } ],
		"Notification": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-notify" } ] } ],
		"Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-stop-1" } ] }, { "hooks": [ { "type": "command", "command": "/bin/echo my-stop-2", "timeout": 5 } ] } ]
	}
}`;

/** Your Codex hooks, by hand: two spaces, keys in your order, a trailing newline. */
const MY_CODEX_HOOKS = `{
  "hooks": {
    "SessionStart": [ { "matcher": "startup|resume", "hooks": [ { "type": "command", "command": "/bin/echo my-codex-start", "statusMessage": "mine" } ] } ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/bin/echo my-codex-guard-1", "timeout": 15 }, { "type": "command", "command": "/bin/echo my-codex-guard-2" } ] },
      { "matcher": "apply_patch", "hooks": [ { "type": "command", "command": "/usr/bin/true my-codex-patch" } ] }
    ],
    "PostToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/bin/echo my-codex-after" } ] } ],
    "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-codex-prompt" } ] } ],
    "Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-codex-stop", "timeout": 20 } ] } ]
  }
}
`;

/** Your config.toml: settings, a comment, your MCP server, and the trust you gave your hooks in /hooks. */
const MY_CODEX_CONFIG = `# my codex settings
model = "gpt-5.5"
approval_policy = "on-request"

[features]
codex_hooks = true

[mcp_servers.notes]
command = "/usr/bin/true"
args = ["--notes"]

[hooks.state."stop:0:0"]
trusted_hash = "sha256:1111111111111111111111111111111111111111111111111111111111111111"

[hooks.state."pre_tool_use:0:0"]
trusted_hash = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
`;

/** DeepBuild's own entries: they run deep-hook, or the deep CLI by its built file or as `deep`. */
const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(['"]?)(\s|$)/.test(command));

/**
 * Your hooks in a hooks object, DeepBuild's entries set aside: per event, each group as it is (its matcher and other
 * keys in place) with only your entries, and groups left with none of yours dropped. Serialized, so content, key order
 * and entry order all count.
 */
function yours(parsed: Line): Map<string, string> {
  const out = new Map<string, string>();
  const hooks = (parsed.hooks ?? {}) as Record<string, unknown>;
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = (Array.isArray(groups) ? groups : []).flatMap((g: Line) => {
      if (!Array.isArray(g?.hooks)) return [g];
      const left = (g.hooks as Line[]).filter((h) => !isDeepBuild(h?.command));
      return left.length ? [{ ...g, hooks: left }] : [];
    });
    if (kept.length) out.set(event, JSON.stringify(kept));
  }
  return out;
}

/** What setup changed of your hook entries in `file`, one line per event. */
function hookProblems(file: string, original: string): string[] {
  const text = readFileSync(file, 'utf8');
  const installed = parseObject(text);
  if (!installed) return [`AC3 ${file} must still be a JSON object after deep setup: ${text.slice(0, 400)}`];
  const was = yours(parseObject(original)!);
  const now = yours(installed);
  const out: string[] = [];
  for (const event of new Set([...was.keys(), ...now.keys()])) {
    if (was.get(event) !== now.get(event)) out.push(`AC3 after deep setup, your ${event} entries in ${file} must be exactly as you wrote them, in the same groups and order: were ${was.get(event) ?? 'none'}, now ${now.get(event) ?? 'none'}`);
  }
  return out;
}

/** The whole file byte-for-byte as before setup, or the line saying where it differs. */
function sameBytes(file: string, original: string): string[] {
  let now: Buffer;
  try { now = readFileSync(file); } catch { return [`AC3 deep setup --undo must leave ${file} byte-for-byte as it was before setup; it is gone`]; }
  const was = Buffer.from(original);
  return now.equals(was) ? [] : [`AC3 deep setup --undo must leave ${file} byte-for-byte as it was before setup: ${firstDifference(was, now)}`];
}

interface Outcome { claude: string[]; codex: string[] }
/** Your files in a fresh home, `deep setup`, the checks after install, a confirmed `deep setup --undo`, the checks after undo. */
async function installThenUndo(env: Record<string, string | undefined> = {}): Promise<Outcome> {
  onMac();
  const h = makeHome();
  const files: [string, string][] = [[claudeSettings(h.home), MY_CLAUDE], [codexHooks(h.home), MY_CODEX_HOOKS], [codexConfig(h.home), MY_CODEX_CONFIG]];
  for (const [file, text] of files) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
  await setup(h, { env });
  const out: Outcome = { claude: [], codex: [] };

  // After install. The control first: setup did write its entries into both hook files, so leaving yours alone is something to test.
  const installedClaude = parseObject(readFileSync(claudeSettings(h.home), 'utf8')) ?? {};
  const installedCodex = parseObject(readFileSync(codexHooks(h.home), 'utf8')) ?? {};
  const ours = (v: Line) => Object.values((v.hooks ?? {}) as Record<string, Line[]>).flat().flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])).filter((x: Line) => isDeepBuild(x?.command));
  expect(ours(installedClaude).length, `deep setup must add DeepBuild's hook entries to ${claudeSettings(h.home)} (the control): ${JSON.stringify(installedClaude.hooks).slice(0, 1200)}`).toBeGreaterThan(0);
  expect(ours(installedCodex).length, `deep setup must add DeepBuild's hook entries to ${codexHooks(h.home)} (the control): ${JSON.stringify(installedCodex.hooks).slice(0, 1200)}`).toBeGreaterThan(0);
  out.claude.push(...hookProblems(claudeSettings(h.home), MY_CLAUDE));
  const original = parseObject(MY_CLAUDE)!;
  for (const key of Object.keys(original)) {
    // Your status line runs behind DeepBuild's forwarder by design (#159); undo's byte check covers its return.
    if (key === 'hooks' || key === 'statusLine') continue;
    if (JSON.stringify(installedClaude[key]) !== JSON.stringify(original[key])) out.claude.push(`AC3 after deep setup, your "${key}" in ${claudeSettings(h.home)} must be as you wrote it: was ${JSON.stringify(original[key])}, now ${JSON.stringify(installedClaude[key])}`);
  }
  out.codex.push(...hookProblems(codexHooks(h.home), MY_CODEX_HOOKS));
  // config.toml: every line of yours still there, in your order (setup may add its MCP server's table).
  const tomlNow = readFileSync(codexConfig(h.home), 'utf8').split('\n');
  let at = 0;
  for (const line of MY_CODEX_CONFIG.split('\n').filter((l) => l !== '')) {
    const found = tomlNow.indexOf(line, at);
    if (found < 0) { out.codex.push(`AC3 after deep setup, ${codexConfig(h.home)} must keep your line ${JSON.stringify(line)} in its place among yours: now ${JSON.stringify(tomlNow.join('\n').slice(0, 1500))}`); break; }
    at = found + 1;
  }

  await undo(h, { env });
  out.claude.push(...sameBytes(claudeSettings(h.home), MY_CLAUDE));
  out.codex.push(...sameBytes(codexHooks(h.home), MY_CODEX_HOOKS), ...sameBytes(codexConfig(h.home), MY_CODEX_CONFIG));
  return out;
}

describe(`${AC3} Existing hooks are untouched after install and after undo`, () => {
  it(`${AC3} your Claude Code hooks in ~/.claude/settings.json keep their content, groups and order after deep setup, your other keys stay, and after deep setup --undo the file is byte-for-byte yours`, async () => {
    const { claude } = await installThenUndo();
    expect(claude).toEqual([]);
  }, 300_000);

  it(`${AC3} your Codex hooks in ~/.codex/hooks.json keep their content, groups and order after deep setup, your config.toml lines stay in order, and after deep setup --undo both files are byte-for-byte yours`, async () => {
    const { codex } = await installThenUndo();
    expect(codex).toEqual([]);
  }, 300_000);

  it(`${AC3} (wrong program) an undo that takes DeepBuild's entries out and writes the JSON again (undo-reserializes) fails this test, naming ~/.claude/settings.json`, async () => {
    const { claude } = await installThenUndo({ DEEP_HUB_PLANT: 'undo-reserializes' });
    expect(claude.join('\n'), 'the byte-for-byte check after undo must catch undo-reserializes').toMatch(/^AC3 deep setup --undo must leave \S*\/\.claude\/settings\.json byte-for-byte as it was before setup: /m);
  }, 300_000);
});
