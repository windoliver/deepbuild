// AC3 #1867.5a700f0c With a Claude Code call running, removing the `deep` MCP server from ~/.claude.json puts it back
// within a second, with a reading naming the call.
//
// The `deep` MCP server is the entry `deep setup` writes under `mcpServers` that runs `deep mcp` (README: Readings,
// 1); its name is read off the file. ~/.claude.json holds a value of yours before setup, as Claude Code's own file
// does. A Claude Code session's Bash call runs the script (fixtures/tamper.mjs), a child of the session's own process,
// which takes that server out of the file in place and stays running. The call is still running when the file is
// read for the server, and until it is back or 30 s have passed.

import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, Agent, NODE, TAMPER, againstSecond, begin, callAfter, callBefore, canon, claudeJsonNow, claudeSession, cleanup, cut, deepServer, hubWithSetup,
  loadNow, makeHome, parseObject, quoted, readingNames, tag, tilde, watchBack,
} from './helpers.ts';

afterAll(cleanup, 120_000);

/** How long the server may stay gone before the test stops reading for it. The criterion's bound is a second; this only ends the wait. */
const GIVE_UP_MS = 30_000;
/** What ~/.claude.json holds before setup: a value of yours, as Claude Code keeps its own state there. */
const YOURS = { numStartups: 7 };

describe(`${AC[3]} With a Claude Code call running, removing the \`deep\` MCP server from ~/.claude.json puts it back within a second, with a reading naming the call`, () => {
  it(`${AC[3]} a running Bash call's script takes DeepBuild's MCP server out of ~/.claude.json: it is back within a second as setup wrote it, beside what is yours, and a reading names the call`, async () => {
    const h = makeHome({ claudeJson: YOURS });
    const hub = await hubWithSetup(h);
    const server = deepServer(h);
    const entry = `DeepBuild's MCP server (mcpServers.${server.name}: ${tilde(h, [server.entry.command, ...server.entry.args].join(' '))})`;
    const file = '~/.claude.json';

    // A Claude Code session's Bash call runs the script, which removes the server while the call runs.
    const claude = Agent.start(h);
    const s = claudeSession(h, claude);
    await begin(hub, s, 'Tidy my MCP servers.');
    const call = await callBefore(hub, s, [NODE, TAMPER, 'remove-server', server.name, tag()].map(quoted).join(' '));
    const running = await claude.open(call.command, s.cwd);
    const did = parseObject(running.line);
    if (did?.removed !== 1 || typeof did.at !== 'number') throw Error(`BLOCKED: the call's script took no MCP server ${server.name} out of ${file}: ${tilde(h, running.line)}`);
    const seen = await watchBack(() => claudeJsonNow(h)?.mcpServers?.[server.name] !== undefined, did.at, GIVE_UP_MS);
    await callAfter(hub, s, call, await claude.close(running.id));

    const name = `the Claude Code call ${call.id}`;
    const problems: string[] = [];
    const now = claudeJsonNow(h);
    // The criterion's second, read once: from the script's write to the first read that found the server back.
    const second = seen.back ? againstSecond(seen) : undefined;
    if (!seen.back) {
      problems.push(`${AC[3]} ${entry} was removed from ${file} while ${name} was running and was not put back: ${Math.round(seen.ms / 1000)} s later the file's mcpServers hold ${tilde(h, cut(JSON.stringify(Object.keys(now?.mcpServers ?? {})), 600))}`);
    } else {
      if (second === 'over') problems.push(`${AC[3]} ${entry} was back in ${file} ${seen.ms} ms after ${name}'s script removed it, over the criterion's second (a read ${seen.gone} ms after the removal still found it gone, at ${loadNow()})`);
      if (canon(now?.mcpServers?.[server.name]) !== canon(server.entry)) problems.push(`${AC[3]} ${entry} must go back into ${file} as setup wrote it: the file now holds ${tilde(h, cut(JSON.stringify(now?.mcpServers?.[server.name] ?? null), 600))}`);
    }
    if (canon(now?.numStartups) !== canon(YOURS.numStartups)) problems.push(`${AC[3]} what is yours in ${file} stays as it was: numStartups was ${YOURS.numStartups}, and the file now holds ${tilde(h, cut(JSON.stringify(now ?? null), 600))}`);
    if (!await readingNames(hub, s, call, '.claude.json')) problems.push(`${AC[3]} a reading must name ${name} ("${tilde(h, call.command)}"), which was running when ${entry} went from ${file}, and name that file: none does`);

    expect(problems, `${AC[3]} ${entry} in ${file}, removed while ${name} ran`).toEqual([]);
    // Back, but too late to read against the second on this machine in this run: never a pass.
    if (second === 'unmeasured') throw Error(`INCONCLUSIVE: ${AC[3]} ${entry} was back in ${file} ${seen.ms} ms after its removal, past the criterion's second, at ${loadNow()}; the last read that found it gone was ${seen.gone ?? 'none'} ms after the removal. On a machine this busy, or with reads this far apart, this run can't say whether the hub took the time: run it again under a timed grant`);
  }, 900_000);
});
