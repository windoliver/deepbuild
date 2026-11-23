// #2854: the corpus check's MCP handshake case holds each version's entry to that version's own recorded request
// (adapters/corpus/<agent>/<version>/mcp-initialize.json, from that version's client) and to one entry per version,
// so a facts file can't claim a revision by citing another client's recording or by a second entry for a version.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * The corpus check's handshake lines in a copy of the scripts, adapters and the handshake entry, `plant` applied to
 * Codex's handshake entries (and given the copy's root, to change a recording). The check must have run to its end.
 */
function handshakeLines(plant) {
  const dir = mkdtempSync(join(tmpdir(), 'corpus-handshake-'));
  try {
    for (const file of ['scripts/corpus.mjs', 'scripts/corpus-redact.mjs', 'packages/contracts/schemas/mcp.handshake@1.json']) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      cpSync(join(root, file), join(dir, file));
    }
    cpSync(join(root, 'adapters'), join(dir, 'adapters'), { recursive: true });
    const file = join(dir, 'adapters/codex.facts.json');
    const facts = JSON.parse(readFileSync(file, 'utf8'));
    plant(facts.mcpHandshake.entries, dir);
    writeFileSync(file, JSON.stringify(facts));
    const run = spawnSync(process.execPath, ['scripts/corpus.mjs', 'check'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.ok(run.status === 0 || run.status === 1, `corpus.mjs check exited ${run.status}: ${run.stderr.slice(-2000)}`);
    assert.match(run.stdout, /^(PASS corpus|FAIL corpus: )/m, 'corpus.mjs check reported no verdict');
    return run.stdout.split('\n').filter((line) => /^FAIL corpus: .*(MCP handshake|MCP client opens|initialize request)/.test(line));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const at = (entries, version) => entries.find((e) => e.versions.includes(version));

test('the shipped facts give no handshake failure', () => {
  assert.deepEqual(handshakeLines(() => {}), []);
});

test("an entry citing another version's recorded request fails, naming the agent, the version and the file", () => {
  const lines = handshakeLines((entries) => {
    const e = at(entries, '0.160.0');
    e.revision = '2025-11-25';
    e.request = 'adapters/corpus/claude-code/2.1.308/mcp-initialize.json';
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /codex 0\.160\.0/);
  assert.match(lines[0], /adapters\/corpus\/claude-code\/2\.1\.308\/mcp-initialize\.json/);
});

test("an entry citing another version's recording of the same agent fails, naming the version and the file", () => {
  const lines = handshakeLines((entries) => {
    at(entries, '0.160.0').request = 'adapters/corpus/codex/0.144.0/mcp-initialize.json';
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /codex 0\.160\.0/);
  assert.match(lines[0], /adapters\/corpus\/codex\/0\.144\.0\/mcp-initialize\.json/);
});

test("a version's own recording path holding another client version's line fails, naming the version", () => {
  const lines = handshakeLines((entries, dir) => {
    const file = join(dir, at(entries, '0.160.0').request);
    const line = JSON.parse(readFileSync(file, 'utf8'));
    line.params.clientInfo.version = '0.144.0';
    writeFileSync(file, `${JSON.stringify(line)}\n`);
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /codex 0\.160\.0/);
});

test("a version's own recording filed under another agent's folder fails, naming the version and the file", () => {
  const lines = handshakeLines((entries, dir) => {
    const moved = 'adapters/corpus/claude-code/0.160.0/mcp-initialize.json';
    mkdirSync(join(dir, moved, '..'), { recursive: true });
    cpSync(join(dir, 'adapters/corpus/codex/0.160.0/mcp-initialize.json'), join(dir, moved));
    at(entries, '0.160.0').request = moved;
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /codex 0\.160\.0/);
  assert.match(lines[0], /adapters\/corpus\/claude-code\/0\.160\.0\/mcp-initialize\.json/);
});

test('a version given a second entry fails, naming the agent and the version', () => {
  const lines = handshakeLines((entries) => {
    entries.push({ versions: ['0.144.0'], revision: '2026-07-28', request: 'adapters/corpus/codex/0.144.0/mcp-initialize.json' });
  });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /codex 0\.144\.0/);
  assert.match(lines[0], /more than one/);
});
