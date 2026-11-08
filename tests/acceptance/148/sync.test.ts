// AC1 #148.db662158: After a sync, each chosen agent lists the server through its own command, and undo leaves every
// file byte-identical to before.
// AC3 #148.3f741c71: A sync touches only DeepBuild's entries: a planted entry and comment of yours survive it.
// AC4 #148.5e23d774: No write lands in a repo's settings.
//
// The issue's Proof: one MCP server and one skill synced to Claude Code, Codex and pi, then undone, with the files
// compared byte for byte. Each agent is the real one, reading the world's HOME; its list command is its own.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, MINE, YOUR_COMMENT, approve, claudeJson, claudeList, claudeLists, codexList, codexToml, deep, differences, digest, fakeToken, gitRepo, gitStatus, homeSnapshot, makeWorld,
  piJson, piList, propose, ranText, same, skillFiles, snapshot, startHub, stdioServer, syncHandle, tag, useCleanup, type Line,
} from './helpers.ts';

useCleanup();
const THREE = ['claude-code', 'codex', 'pi'];

describe('#148 a sync, what it touches, and undo', () => {
  it(`${AC[1]} after a sync of one server and one skill, Claude Code, Codex and pi each list the server through their own command, and undo leaves every file byte-identical to before`, async () => {
    const w = await makeWorld();
    await startHub(w);
    const before = homeSnapshot(w);
    const name = `forge-${tag()}`;
    const server = await propose(w, { via: 'app', server: stdioServer(w, name, { token: fakeToken() }), agents: THREE });
    await approve(w, server);
    const skillName = `notes-${tag()}`;
    const src = gitRepo(w, 'skill-src', skillFiles(skillName));
    const skill = await propose(w, { via: 'app', skill: { repo: src.dir, commit: src.commit, path: `skills/${skillName}` }, agents: THREE });
    await approve(w, skill);

    const claude = await claudeList(w);
    expect(claudeLists(claude, name), `claude mcp list lists ${name}: ${ranText(claude)}`).toBe(true);
    const codex = await codexList(w);
    expect(codex.names, `codex mcp list --json lists ${name}: ${ranText(codex.ran)}`).toContain(name);
    const pi = await piList(w);
    expect(pi.servers.map((s) => s.name), `pi mcp list --json lists ${name}: ${ranText(pi.ran)}`).toContain(name);
    for (const f of [...server.files, ...skill.files]) expect(digest(f.path), `${f.path} holds the bytes the approved plan shows`).toBe(f.after);
    for (const agent of THREE) expect(skill.files.some((f) => f.agents.includes(agent)), `the skill's plan reaches ${agent}: ${JSON.stringify(skill.files).slice(0, 1500)}`).toBe(true);

    for (const p of [skill, server]) {
      const r = await deep(w, ['undo', syncHandle(p)]);
      expect(r.code, `deep undo ${syncHandle(p)} undoes it: ${ranText(r)}`).toBe(0);
    }
    expect(differences(before, homeSnapshot(w), w.home), 'after undo, every file under HOME is byte-identical to before the syncs (README: The world, for the agents\' own runtime files left out)').toEqual([]);
  });

  it(`${AC[3]} a sync touches only DeepBuild's entries: your own server entry in each agent's file, and your comment in Codex's config.toml, survive it`, async () => {
    const w = await makeWorld();
    await startHub(w);
    const yours = { claude: JSON.parse(readFileSync(claudeJson(w), 'utf8')) as Line, codex: readFileSync(codexToml(w), 'utf8'), pi: JSON.parse(readFileSync(piJson(w), 'utf8')) as Line };
    const name = `forge-${tag()}`;
    await approve(w, await propose(w, { via: 'app', server: stdioServer(w, name), agents: THREE }));

    // Codex: every line of yours, the comment among them, is still there, in its order.
    const lines = readFileSync(codexToml(w), 'utf8').split('\n');
    let at = 0;
    const lost: string[] = [];
    for (const line of yours.codex.split('\n').filter((l) => l.trim() !== '')) {
      const i = lines.indexOf(line, at);
      if (i < 0) lost.push(line);
      else at = i + 1;
    }
    expect(lost, `${codexToml(w)} keeps every line of yours in its order, ${JSON.stringify(YOUR_COMMENT)} among them`).toEqual([]);
    // JSON: every key of yours keeps its value, and your server keeps its entry.
    for (const [file, mine] of [[claudeJson(w), yours.claude], [piJson(w), yours.pi]] as const) {
      const now = JSON.parse(readFileSync(file, 'utf8')) as Line;
      for (const [k, v] of Object.entries(mine)) if (k !== 'mcpServers') expect(now[k], `${file} keeps your ${k}`).toEqual(v);
      expect(now.mcpServers?.[MINE], `${file} keeps your server ${MINE} as you wrote it`).toEqual(mine.mcpServers[MINE]);
    }
    // Each agent still lists yours beside DeepBuild's.
    const claude = await claudeList(w);
    for (const n of [MINE, name]) expect(claudeLists(claude, n), `claude mcp list lists ${n}: ${ranText(claude)}`).toBe(true);
    const codex = await codexList(w);
    expect(codex.names, `codex mcp list --json lists ${MINE} and ${name}: ${ranText(codex.ran)}`).toEqual(expect.arrayContaining([MINE, name]));
    const pi = await piList(w);
    expect(pi.servers.map((s) => s.name), `pi mcp list --json lists ${MINE} and ${name}: ${ranText(pi.ran)}`).toEqual(expect.arrayContaining([MINE, name]));
  });

  it(`${AC[4]} a server scoped to one repo is written at user level for Claude Code, Codex and pi: nothing lands in that repo or another`, async () => {
    const w = await makeWorld();
    await startHub(w);
    const shop = gitRepo(w, `shop-${tag()}`, { 'README.md': 'the shop\n' });
    const site = gitRepo(w, `site-${tag()}`, { 'README.md': 'the site\n' });
    const repos = [shop.dir, site.dir];
    const before = repos.map((r) => snapshot(r, [/^\.git\//]));
    const name = `forge-${tag()}`;
    const p = await propose(w, { via: 'app', server: stdioServer(w, name, { scope: { repos: [shop.dir] } }), agents: THREE });
    const inRepo = p.files.filter((f) => repos.some((r) => same(f.path, r) || f.path.startsWith(`${r}/`)));
    expect(inRepo.map((f) => f.path), 'the plan writes nothing inside a repo').toEqual([]);
    await approve(w, p);
    repos.forEach((r, i) => {
      expect(differences(before[i]!, snapshot(r, [/^\.git\//]), r), `no file in ${r} changed or appeared`).toEqual([]);
      expect(gitStatus(r), `git status in ${r} is clean, ignored files included`).toBe('');
    });
    // The sync did happen: Claude Code in the scoped repo lists the server.
    const claude = await claudeList(w, shop.dir);
    expect(claudeLists(claude, name), `claude mcp list in ${shop.dir} lists ${name}: ${ranText(claude)}`).toBe(true);
  });
});
