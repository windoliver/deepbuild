// AC7 #148.a2efc551: A server scoped to one repo is denied, naming its scope, when a session in another repo calls it.
//
// The server is synced to Claude Code with the scope `{repos: [<shop>]}`. Claude Code sessions are played through the
// real deep-hook (README: Sessions): a session in the site repo calls one of its tools, `mcp__<server>__list_issues`,
// and its PreToolUse must be denied with words naming the shop repo, by its path or its folder's name. The same call
// from a session in the shop repo is the control: it goes through.
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, ClaudeSession, approve, decision, gitRepo, makeWorld, propose, ranText, startHub, stdioServer, tag, useCleanup } from './helpers.ts';

useCleanup();

describe('#148 a server\'s scope', () => {
  it(`${AC[7]} a server scoped to one repo is denied, naming its scope, when a session in another repo calls it, and goes through in its own repo`, async () => {
    const w = await makeWorld();
    await startHub(w);
    const shop = gitRepo(w, `shop-${tag()}`, { 'README.md': 'the shop\n' });
    const site = gitRepo(w, `site-${tag()}`, { 'README.md': 'the site\n' });
    const name = `forge-${tag()}`;
    await approve(w, await propose(w, { via: 'app', server: stdioServer(w, name, { scope: { repos: [shop.dir] } }), agents: ['claude-code'] }));

    const outside = new ClaudeSession(w, site.dir);
    await outside.start();
    const denied = await outside.mcp(name, 'list_issues');
    expect(decision(denied), `the call to ${name} from a session in ${site.dir} is denied: ${ranText(denied)}`).toBe('deny');
    const said = `${denied.stdout}\n${denied.stderr}`;
    expect(said.includes(shop.dir) || said.includes(basename(shop.dir)), `the denial names the server's scope, ${shop.dir}: ${ranText(denied)}`).toBe(true);

    const inside = new ClaudeSession(w, shop.dir);
    await inside.start();
    const allowed = await inside.mcp(name, 'list_issues');
    expect(decision(allowed), `the same call from a session in ${shop.dir}, its scope, goes through: ${ranText(allowed)}`).toBe('allow');
  });
});
