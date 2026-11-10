// AC1 #1998.97e49eef "Remove DeepBuild from Codex", once approved, leaves Codex's settings as they were before install,
// the same as `deep setup --undo`. The Proof: shown failing first (BASE-FAILURE.txt).
//
// Your Codex settings (~/.codex/hooks.json with your own hooks, ~/.codex/config.toml with your settings, a comment, your
// MCP server and the trust you gave your hooks) and your Claude Code settings are written by hand, then `deep setup`
// runs. The words "remove DeepBuild from Codex" go to the box; before you approve, Codex's files still hold what setup
// wrote. You approve with `deep inbox answer <ask> apply`, the OS confirming you. Then both Codex files must be
// byte-for-byte as you wrote them, and stay so (the hub's watch doesn't put DeepBuild's entries back), the whole of
// ~/.codex must be what `deep setup --undo` leaves in a twin home set up the same way, and Claude Code keeps DeepBuild,
// since the words named Codex only. The wrong programs: the base, which has no box; and, judged on modelled bytes, a
// removal that takes DeepBuild's entries out and writes hooks.json again, and one that leaves its MCP server's table in
// config.toml.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  answer, bytesOf, changes, claudeSettings, cleanup, codexConfig, codexDir, codexHooks, firstDifference, ID, makeHome, parseObject, say, setup,
  shown, sleep, snapshot, undo, waitFor, type Home, type Line, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** Your Codex hooks, by hand: two spaces, keys in your order, a trailing newline. */
const MY_CODEX_HOOKS = `{
  "hooks": {
    "SessionStart": [ { "matcher": "startup|resume", "hooks": [ { "type": "command", "command": "/bin/echo my-codex-start", "statusMessage": "mine" } ] } ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/bin/echo my-codex-guard", "timeout": 15 } ] }
    ],
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
`;
/** Your Claude Code user settings, with a hook of your own. */
const MY_CLAUDE = `{
  "model": "opus",
  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-stop" } ] } ] }
}
`;

/** DeepBuild's own entries: they run deep-hook, or the deep CLI by its built file or as `deep`. */
const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(['"]?)(\s|$)/.test(command));
/** How many of DeepBuild's hook entries a hooks object holds. */
const ours = (text: string | null): number => {
  const v = text === null ? undefined : parseObject(text);
  return Object.values((v?.hooks ?? {}) as Record<string, Line[]>).flat().flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : [])).filter((x: Line) => isDeepBuild(x?.command)).length;
};

interface Files { hooks: Buffer | null; config: Buffer | null }
interface Removal {
  /** Codex's two files after setup, after the words, and once the approval landed, then 5 s later. */
  installed: Files; beforeApproval: Files; afterApproval: Files; later: Files;
  /** ~/.codex after the approval, and after `deep setup --undo` in the twin home. */
  tree: Map<string, string>; undoTree: Map<string, string>;
  /** DeepBuild's entries left in Claude Code's settings after the approval. */
  claudeOurs: number;
  answered: Ran;
}

/** What the criterion says is wrong with a removal, one line each; none when it holds. */
function removalProblems(r: Removal): string[] {
  const out: string[] = [];
  const mine: Files = { hooks: Buffer.from(MY_CODEX_HOOKS), config: Buffer.from(MY_CODEX_CONFIG) };
  for (const key of ['hooks', 'config'] as const) {
    const name = key === 'hooks' ? '~/.codex/hooks.json' : '~/.codex/config.toml';
    const at = r.beforeApproval[key];
    if (!(at === null ? r.installed[key] === null : r.installed[key] !== null && at.equals(r.installed[key]!))) out.push(`AC1 the box changed ${name} before you approved "remove DeepBuild from Codex"`);
    for (const [when, now] of [['once approved', r.afterApproval[key]], ['5 s after the approval', r.later[key]]] as const) {
      if (now === null) out.push(`AC1 ${when}, ${name} must be as you wrote it before install; it is gone`);
      else if (!now.equals(mine[key]!)) out.push(`AC1 ${when}, ${name} must be byte-for-byte as you wrote it before install: ${firstDifference(mine[key]!, now)}`);
    }
  }
  const differs = changes(r.undoTree, r.tree);
  if (differs.length) out.push(`AC1 once approved, ~/.codex must be what deep setup --undo leaves: ${differs.join('; ')}`);
  if (r.claudeOurs === 0) out.push('AC1 "remove DeepBuild from Codex" took DeepBuild out of Claude Code too; the words named Codex only');
  return out;
}

function writeMine(h: Home): void {
  for (const [file, text] of [[codexHooks(h), MY_CODEX_HOOKS], [codexConfig(h), MY_CODEX_CONFIG], [claudeSettings(h), MY_CLAUDE]] as const) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
const files = (h: Home): Files => ({ hooks: bytesOf(codexHooks(h)), config: bytesOf(codexConfig(h)) });

async function removal(): Promise<Removal> {
  // The twin home: the same files, set up, then `deep setup --undo`.
  const twin = makeHome();
  writeMine(twin);
  await setup(twin);
  await undo(twin);
  const undoTree = snapshot(codexDir(twin));

  const h = makeHome();
  writeMine(h);
  await setup(h);
  const installed = files(h);
  // The control: setup wrote DeepBuild's entries into Codex's hooks, so taking them out is something to test.
  expect(ours(installed.hooks === null ? null : installed.hooks.toString('utf8')), `deep setup must add DeepBuild's hook entries to ${codexHooks(h)} (the control)`).toBeGreaterThan(0);
  const ask = await say(h, 'remove DeepBuild from Codex');
  await sleep(3000);
  const beforeApproval = files(h);
  const answered = await answer(h, ask);
  const mine = (f: Files) => f.hooks?.equals(Buffer.from(MY_CODEX_HOOKS)) === true && f.config?.equals(Buffer.from(MY_CODEX_CONFIG)) === true;
  await waitFor(() => mine(files(h)), 60_000);
  const afterApproval = files(h);
  await sleep(5000);
  const later = files(h);
  return {
    installed, beforeApproval, afterApproval, later, tree: snapshot(codexDir(h)), undoTree,
    claudeOurs: ours(bytesOf(claudeSettings(h))?.toString('utf8') ?? null), answered,
  };
}

describe(`${ID.ac1} "Remove DeepBuild from Codex", once approved, leaves Codex's settings as they were before install, the same as deep setup --undo`, () => {
  it(`${ID.ac1} the words come back as a proposed change; once you approve it, ~/.codex/hooks.json and config.toml are byte-for-byte yours and stay so, ~/.codex is what deep setup --undo leaves, and Claude Code keeps DeepBuild`, async () => {
    const r = await removal();
    expect(removalProblems(r), `the approval: ${shown(r.answered)}`).toEqual([]);
  }, 600_000);

  // The wrong programs below are judged on modelled outcomes: the removal's judge must name what each gets wrong.
  const passing = (): Removal => {
    const mine: Files = { hooks: Buffer.from(MY_CODEX_HOOKS), config: Buffer.from(MY_CODEX_CONFIG) };
    const installed: Files = { hooks: Buffer.from('{"hooks":{}}\n'), config: Buffer.from(MY_CODEX_CONFIG) };
    const tree = new Map([['config.toml', 'file a'], ['hooks.json', 'file b']]);
    return { installed, beforeApproval: installed, afterApproval: mine, later: mine, tree, undoTree: new Map(tree), claudeOurs: 4, answered: { code: 0, stdout: '', stderr: '', timedOut: false } };
  };

  it(`${ID.ac1} (wrong program) a removal that takes DeepBuild's entries out and writes hooks.json again fails, naming ~/.codex/hooks.json`, () => {
    expect(removalProblems(passing()), 'the modelled passing removal passes the judge (the control)').toEqual([]);
    const reserialized = Buffer.from(`${JSON.stringify(JSON.parse(MY_CODEX_HOOKS), null, 2)}\n`);
    const r = { ...passing(), afterApproval: { ...passing().afterApproval, hooks: reserialized }, later: { ...passing().later, hooks: reserialized } };
    expect(removalProblems(r).join('\n')).toMatch(/^AC1 once approved, ~\/\.codex\/hooks\.json must be byte-for-byte as you wrote it before install: /m);
  });

  it(`${ID.ac1} (wrong program) a removal that leaves DeepBuild's MCP server in config.toml fails, naming ~/.codex/config.toml`, () => {
    const left = Buffer.from(`${MY_CODEX_CONFIG}\n[mcp_servers.deepbuild]\ncommand = "deep"\nargs = ["mcp"]\n`);
    const r = { ...passing(), afterApproval: { ...passing().afterApproval, config: left }, later: { ...passing().later, config: left } };
    expect(removalProblems(r).join('\n')).toMatch(/^AC1 once approved, ~\/\.codex\/config\.toml must be byte-for-byte as you wrote it before install: /m);
  });
});

