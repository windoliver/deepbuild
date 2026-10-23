// #159 AC2, AC3, AC6, AC13, AC17: how the runner launches Claude Code from its facts, and what it reads back:
// only the MCP servers a job's spec names, read-only, the binary your login shell resolves at a covered version,
// none of the checkout's own settings, and the model that actually answered.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup, closeListeners, coveredVersions, initOf, install, launches, reported, signIn, streamOf, sub, tcpListener, tempDir, makeRepo, sleep,
} from './helpers.ts';
import { job, openWorld, room, runJob } from './world.ts';
import type { Plant } from '../../../packages/runner/src/index.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

describe('AC2 #159.80a97ac6 a job gets only the MCP servers its spec names', () => {
  it('AC2 with three user-level MCP servers configured, a Claude Code job\'s init event lists only the server its spec names', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const server = { type: 'stdio', command: '/usr/bin/true', args: [] };
    signIn({ mcpServers: { alpha: server, beta: server, gamma: server } });
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      const { rec, stdout } = await runJob(w, job('read', 'Read the notes.', { mcp: { notes: { command: '/usr/bin/true' } } }));
      expect(rec.state, JSON.stringify(rec)).toBe('finished');
      const init = initOf(stdout);
      expect(init, `the job's output has an init event: ${stdout.slice(0, 2000)}`).toBeDefined();
      expect((init!.mcp_servers as { name: string }[]).map((s) => s.name), 'the init event\'s mcp_servers').toEqual(['notes']);
    } finally {
      signIn();
      await w.close();
    }
  }, 120_000);
});

describe('AC3 #159.28457d78 a job asked to write is refused by its read-only mode, and that is its stop cause', () => {
  it('AC3 a Claude Code job asked to write a file is refused by its read-only mode, the file isn\'t written, and the refusal is its recorded stop cause', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      const { rec, stdout } = await runJob(w, job('draft', 'Write the notes down.\n@write notes.md hello', {}));
      const write = reported(stdout, 'write');
      expect(write.ok, 'the job\'s write went through').toBe(false);
      expect(write.denied, 'the write was refused by the job\'s read-only mode (a permission denial), not by chance').toBe(true);
      expect(existsSync(join(rec.folder, 'notes.md')), 'the refused write left a file').toBe(false);
      const result = streamOf(stdout).find((e) => e.type === 'result');
      expect(result?.permission_denials?.length, 'Claude Code\'s result lists the denial').toBeGreaterThan(0);
      expect(rec.stop?.cause, `the job's recorded stop cause: ${JSON.stringify(rec)}`).toBe('refusal');
    } finally {
      await w.close();
    }
  }, 120_000);
});

describe('AC6 #159.0a463d06 the binary your login shell resolves, its path and version recorded; an uncovered version refused', () => {
  it('AC6 with two claude installs on the PATH, a job runs the one your login shell resolves and records its path and version; a version outside what its facts cover is refused, naming the range', async () => {
    const d = tempDir();
    const first = install(sub(d, 'first'), { version: '2.1.304' });
    const second = install(sub(d, 'second'), { version: '2.1.299' });
    // The hub's own PATH lists the other install first: only the login shell's PATH that setup recorded counts.
    const w = await openWorld({ loginPath: `${dirname(first)}:${dirname(second)}:/usr/bin:/bin`, env: { PATH: `${dirname(second)}:${dirname(first)}:/usr/bin:/bin` } });
    try {
      await room(w);
      const { rec, stdout } = await runJob(w, job('read', 'Which one are you?'));
      expect(rec.state, JSON.stringify(rec)).toBe('finished');
      expect(reported(stdout, 'start').argv0, 'the install that ran').toBe(first);
      expect(rec.binary, 'the job records the binary it ran').toMatchObject({ path: first, version: '2.1.304' });
    } finally {
      await w.close();
    }
    const range = coveredVersions();
    const outside = install(sub(d, 'outside'), { version: '0.0.1' });
    const v = await openWorld({ loginPath: `${dirname(outside)}:${dirname(first)}:/usr/bin:/bin` });
    try {
      await room(v);
      const rec = await v.runner.run(job('read', '@sleep 3000'));
      expect(rec.state, JSON.stringify(rec)).toBe('refused');
      expect(rec.pid, 'a refused job has no process').toBeUndefined();
      expect(launches(outside), 'the uncovered install ran a job').toEqual([]);
      for (const name of [range[0]!, range[range.length - 1]!, '0.0.1']) expect(String(rec.refused), `the refusal names ${name}`).toContain(name);
    } finally {
      await v.close();
    }
  }, 180_000);
});

describe('AC13 #159.f24927a9 none of the checkout\'s own settings reach a job', () => {
  it('AC13 a base checkout whose .claude/settings.json holds a SessionStart hook writing a marker and an env block pointing ANTHROPIC_BASE_URL at a local listener leaves no marker after a drafting job, and the listener gets no connection', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const api = await tcpListener();
    const marker = join(tempDir(), 'marker');
    const settings = {
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` },
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `/usr/bin/touch ${marker}; /usr/bin/touch hook-ran` }] }] },
    };
    const repo = makeRepo({ '.claude/settings.json': `${JSON.stringify(settings, null, 2)}\n` });
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      await room(w);
      const { rec, stdout } = await runJob(w, job('draft', 'Draft the checks for this repo.', { checkout: { repo: repo.dir, commit: repo.base } }));
      expect(rec.state, JSON.stringify(rec)).toBe('finished');
      expect(existsSync(join(rec.folder, '.claude', 'settings.json')), 'the job ran in the base checkout, which holds the settings').toBe(true);
      await sleep(500);
      expect(existsSync(marker), `the checkout's SessionStart hook wrote ${marker}`).toBe(false);
      expect(existsSync(join(rec.folder, 'hook-ran')), 'the checkout\'s SessionStart hook wrote into the job\'s folder').toBe(false);
      expect(api.connections, 'the listener the env block points ANTHROPIC_BASE_URL at got a connection').toBe(0);
      const ran = streamOf(stdout).filter((e) => e.type === 'system' && e.subtype === 'hook_response' && e.source === 'project');
      expect(ran, 'Claude Code loaded the checkout\'s settings and ran its SessionStart hook').toEqual([]);
    } finally {
      await w.close();
    }
  }, 120_000);
});

/** A job launched for one model whose output names another, and one whose output names none. */
async function answeredBy(plant?: Plant): Promise<void> {
  const bin = install(sub(tempDir(), 'bin'));
  const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, ...(plant ? { plant } : {}) });
  try {
    await room(w);
    const other = await w.runner.run(job('read', 'Answer.\n@answered-by claude-opus-4-1', { model: 'claude-haiku-4-5' }));
    expect(other.state, JSON.stringify(other)).toBe('finished');
    if (other.model !== 'claude-opus-4-1') {
      throw Error(`the job recorded ${String(other.model)}${other.model === 'claude-haiku-4-5' ? ', the model it launched,' : ''} not claude-opus-4-1, the model its output names`);
    }
    const none = await w.runner.run(job('read', 'Answer.\n@answered-by none', { model: 'claude-haiku-4-5' }));
    expect(none.state, JSON.stringify(none)).toBe('finished');
    expect(none.model, 'a job whose output names no model records unknown').toBe('unknown');
  } finally {
    await w.close();
  }
}

describe('AC17 #159.52a561ec each job records the model that actually answered', () => {
  it('AC17 a fake CLI launched for one model whose output names another records the one its output names; one whose output names no model records unknown', async () => {
    await answeredBy();
  }, 120_000);

  it('AC17 (wrong program) a runner that records the model it launched fails on the first, naming it', async () => {
    await expect(answeredBy('records-launched-model')).rejects.toThrow(/recorded claude-haiku-4-5, the model it launched/);
  }, 120_000);
});
