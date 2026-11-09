// #1359 AC2 (README): under a Homebrew Node whose `opt/<formula>` link runs the same Node, setup writes the `opt` path
// into the login service and both MCP entries (Claude Code's ~/.claude.json, Codex's config.toml); elsewhere the Node's
// own path. The Homebrew Node is this Node, cloned into Homebrew's layout: `<prefix>/Cellar/node/<version>/bin/node`,
// and `<prefix>/opt/node` linking a version folder, as `brew install node` lays them out.
import { constants, copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NODE, SECOND, cleanup, needBuild, serviceProgram, setUp, shown, tempDir, world, type World } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.bb7ffee5';

/** Homebrew's layout with this Node cloned in as version `version`, and `opt/node` linking `optTo` when given. */
function brew(version: string, optTo?: string): { prefix: string; cellar: string; opt: string } {
  const prefix = join(tempDir(), 'homebrew');
  const cellar = join(prefix, 'Cellar', 'node', version, 'bin', 'node');
  mkdirSync(join(prefix, 'Cellar', 'node', version, 'bin'), { recursive: true });
  copyFileSync(NODE, cellar, constants.COPYFILE_FICLONE);
  chmodSync(cellar, 0o755);
  mkdirSync(join(prefix, 'opt'));
  if (optTo) {
    if (!existsSync(join(prefix, 'Cellar', 'node', optTo))) {
      // Another version, which `brew upgrade` installed beside it: a different program, answering with its version.
      const other = join(prefix, 'Cellar', 'node', optTo, 'bin', 'node');
      mkdirSync(dirname(other), { recursive: true });
      writeFileSync(other, `#!/bin/sh\ncase "$*" in *versions.node*) echo ${optTo} ;; *) echo v${optTo} ;; esac\n`);
      chmodSync(other, 0o755);
    }
    symlinkSync(`../Cellar/node/${optTo}`, join(prefix, 'opt', 'node'));
  }
  return { prefix, cellar, opt: join(prefix, 'opt', 'node', 'bin', 'node') };
}

/** The Node each of the three entries setup wrote starts. */
function written(w: World): { service: string | undefined; claude: unknown; codex: string | undefined; codexText: string } {
  const service = serviceProgram(w).argv[0];
  const claudeJson = JSON.parse(readFileSync(join(w.home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
  const claude = Object.values(claudeJson.mcpServers ?? {}).find((s) => Array.isArray(s.args) && s.args.includes('mcp') && typeof s.command === 'string' && /\/node$/.test(s.command))?.command;
  const codexText = existsSync(join(w.home, '.codex', 'config.toml')) ? readFileSync(join(w.home, '.codex', 'config.toml'), 'utf8') : '';
  const codex = /^\s*command\s*=\s*"([^"]*\/node)"\s*$/m.exec(codexText)?.[1];
  return { service, claude, codex, codexText };
}

/** setup under `node` in a fresh home that has Codex (a ~/.codex folder), so both MCP entries are written. */
async function setUpUnder(node: string): Promise<World> {
  needBuild();
  const w = world();
  mkdirSync(join(w.home, '.codex'));
  const r = await setUp(w, { node });
  if (!existsSync(join(w.home, '.claude.json'))) throw Error(`deep setup under ${node} wrote no ~/.claude.json: ${shown(r)}`);
  return w;
}

describe(`${ID} the Node path setup writes`, () => {
  it(`${ID} under a Homebrew Node whose opt link runs the same Node, the opt path in the login service and both MCP entries`, async () => {
    const { cellar, opt } = brew('24.22.0', '24.22.0');
    const w = await setUpUnder(cellar);
    const got = written(w);
    expect(got.service, `the login service ${serviceProgram(w).file} must start ${opt}, which brew upgrade keeps`).toBe(opt);
    expect(got.claude, `~/.claude.json's DeepBuild MCP entry must start ${opt}`).toBe(opt);
    expect(got.codex, `Codex's config.toml's DeepBuild MCP entry must start ${opt}: ${got.codexText}`).toBe(opt);
  }, 300 * SECOND);

  it(`${ID} under a Node outside Homebrew, the Node's own path`, async () => {
    const w = await setUpUnder(NODE);
    const got = written(w);
    expect(got.service).toBe(NODE);
    expect(got.claude).toBe(NODE);
    expect(got.codex, got.codexText).toBe(NODE);
  }, 300 * SECOND);

  it(`${ID} under a Homebrew Node whose opt link runs another version, the Node's own path`, async () => {
    const { cellar } = brew('24.22.0', '25.0.0');
    const w = await setUpUnder(cellar);
    const got = written(w);
    expect(got.service).toBe(cellar);
    expect(got.claude).toBe(cellar);
    expect(got.codex, got.codexText).toBe(cellar);
  }, 300 * SECOND);
});
