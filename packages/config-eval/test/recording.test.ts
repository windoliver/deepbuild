// What a replay counts as an outside call, and its one way out to a model endpoint off this machine (#1108): each
// test failed on the program it names.
import http from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { isOutside, openAnswering, reachesNetwork } from '../src/recording.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); });

it('counts a shell command as outside when any piece of it reaches the network, and no other', () => {
  // Failed on a classifier that read only the first word of the command (git push after cd, curl after a pipe), and
  // on one that split quoted text (a commit message naming ssh).
  for (const c of ['gh pr create --fill', 'cd shop && git push origin main', 'git -C shop push', 'echo x | curl -d @- https://chat.test', 'GH_HOST=x gh api /user', 'wget -q https://x.test', 'npm publish', 'out=$(curl -s https://x.test)'])
    expect(reachesNetwork(c), c).toBe(true);
  for (const c of ['git status', 'git commit -m "push the fix"', 'npm test', 'echo gh is the forge cli', 'ls ./curl', 'git commit -m "fix cart; ssh keys untouched"'])
    expect(reachesNetwork(c), c).toBe(false);
});

it('reads the program a wrapper runs, as it reads past sudo and env', () => {
  // Failed on a classifier that took the wrapper (timeout, xargs, nohup, time, nice) for the program, so the call ran
  // in the sandbox, unanswered and never counted as diverged.
  for (const c of ['timeout 60 gh pr create --fill', 'ls | xargs curl -d @-', 'nohup git push origin main', 'time gh api /user', 'nice -n 5 git fetch', 'timeout -s KILL 5 curl https://x.test', 'env -u GH_HOST gh api /user', 'sudo -u bob git push', 'xargs -n 1 -P 4 wget'])
    expect(reachesNetwork(c), c).toBe(true);
  for (const c of ['timeout 60 npm test', 'time make', 'nohup ./serve.sh', 'xargs rm'])
    expect(reachesNetwork(c), c).toBe(false);
});

it("keeps a command that only looks a program up, or prints its help or version, in the sandbox", () => {
  // Failed on a classifier that took `command -v` for a wrapper and read no further than the program, so a probe for gh
  // was refused as not in the recording and the pair counted as diverged, though it reaches no host.
  for (const c of ['command -v gh', 'command -V curl', 'gh --version', 'curl --help', 'git push --help', 'gh pr create --help'])
    expect(reachesNetwork(c), c).toBe(false);
  for (const c of ['command gh pr create --fill', 'command -p curl https://x.test'])
    expect(reachesNetwork(c), c).toBe(true);
});

it('reads a help or version flag as the program asking for it only before its arguments', () => {
  // Failed on a classifier that kept any piece holding --help or --version local, so a remote command's flag, or one
  // given as an option's value, ran in the sandbox and failed there instead of being answered from the recording.
  for (const c of ['ssh deploy@host node --version', 'ssh host node --version', 'curl -d --help https://x.test', 'gh api repos/o/r -f body=x --version'])
    expect(reachesNetwork(c), c).toBe(true);
});

/** A PreToolUse call, as the replay's hook hands it to the answering server. */
const hookCall = async (hookScript: string, tool_name: string, tool_input: unknown) => {
  const url = /fetch\('([^']+)'/.exec(hookScript)![1]!;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input }) });
  return (await r.json() as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string; updatedInput?: { command: string } } }).hookSpecificOutput;
};

it('answers a call the original session made twice with each of its results, in order', async () => {
  // Failed on a matcher that took the first recorded call with the same key every time, so the second look at a PR
  // after its merge still read the state before.
  const answering = await openAnswering([
    { tool: 'Bash', input: { command: 'gh pr view 12 --json state' }, result: '{"state":"OPEN"}' },
    { tool: 'Bash', input: { command: 'gh pr merge 12' }, result: 'merged' },
    { tool: 'Bash', input: { command: 'gh pr view 12 --json state' }, result: '{"state":"MERGED"}' },
  ], '127.0.0.1:9');
  closers.push(() => answering.close());
  const said = [];
  for (const command of ['gh pr view 12 --json state', 'gh pr merge 12', 'gh pr view 12 --json state', 'gh pr view 12 --json state']) {
    const out = await hookCall(answering.hookScript, 'Bash', { command });
    said.push(out.permissionDecision === 'allow' ? out.updatedInput!.command : out.permissionDecisionReason);
  }
  expect(said.slice(0, 3)).toEqual([`printf '%s\\n' '{"state":"OPEN"}'`, `printf '%s\\n' 'merged'`, `printf '%s\\n' '{"state":"MERGED"}'`]);
  expect(said[3]).toMatch(/not in the recording/);
  expect(answering.calls.map((c) => c.answered)).toEqual([true, true, true, false]);
});

it('answers web fetches and searches from the recording and makes none', async () => {
  // Failed on a replay that counted only MCP tools and network shell commands as outside calls, so a web search,
  // which the model's own service runs where the sandbox can't refuse it, was made, never recorded and never diverged.
  expect(isOutside('WebFetch', { url: 'https://x.test', prompt: 'p' })).toBe(true);
  expect(isOutside('WebSearch', { query: 'q' })).toBe(true);
  const answering = await openAnswering([{ tool: 'WebFetch', input: { url: 'https://docs.test/cart', prompt: 'the cart API' }, result: 'POST /cart adds an item.' }], '127.0.0.1:9');
  closers.push(() => answering.close());
  const fetched = await hookCall(answering.hookScript, 'WebFetch', { url: 'https://docs.test/cart', prompt: 'the cart API' });
  const searched = await hookCall(answering.hookScript, 'WebSearch', { query: 'cart api' });
  expect(fetched.permissionDecision).toBe('deny');
  expect(fetched.permissionDecisionReason).toContain('POST /cart adds an item.');
  expect(searched.permissionDecision).toBe('deny');
  expect(searched.permissionDecisionReason).toMatch(/WebSearch: this call is not in the recording/);
  expect(answering.calls).toEqual([
    { tool: 'WebFetch', input: { url: 'https://docs.test/cart', prompt: 'the cart API' }, answered: true },
    { tool: 'WebSearch', input: { query: 'cart api' }, answered: false },
  ]);
});

it('answers a web fetch of a recorded page whatever the agent asks of it', async () => {
  // Failed on a key that held the fetch's prompt, the model's own wording, so a replay that fetched the same page with
  // other words got "not in the recording" and the pair counted as diverged.
  const answering = await openAnswering([{ tool: 'WebFetch', input: { url: 'https://docs.test/cart', prompt: 'the cart API' }, result: 'POST /cart adds an item.' }], '127.0.0.1:9');
  closers.push(() => answering.close());
  const fetched = await hookCall(answering.hookScript, 'WebFetch', { url: 'https://docs.test/cart', prompt: 'cart endpoints' });
  const other = await hookCall(answering.hookScript, 'WebFetch', { url: 'https://docs.test/orders', prompt: 'the cart API' });
  expect(fetched.permissionDecisionReason).toContain('POST /cart adds an item.');
  expect(other.permissionDecisionReason).toMatch(/WebFetch: this call is not in the recording/);
});

it("tunnels only to the agent's model endpoint", async () => {
  // Failed on a tunnel that connected to whatever host the CONNECT named.
  const listen = async (host: string) => {
    const server = http.createServer((_req, res) => res.end(`answered by ${host}`));
    await new Promise<void>((done) => server.listen(0, host, done));
    closers.push(() => new Promise<void>((done) => server.close(() => done())));
    return `${host}:${(server.address() as AddressInfo).port}`;
  };
  const model = await listen('127.0.0.2');
  const other = await listen('127.0.0.3');
  const answering = await openAnswering([], model);
  closers.push(() => answering.close());
  const through = (target: string) => new Promise<string>((done, fail) => {
    const req = request({ host: '127.0.0.1', port: answering.port, method: 'CONNECT', path: target });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); done(`refused ${res.statusCode}`); return; }
      let text = '';
      socket.on('data', (d: Buffer) => { text += d.toString('utf8'); });
      socket.on('end', () => done(text.slice(text.indexOf('\r\n\r\n') + 4)));
      socket.write(`GET / HTTP/1.1\r\nHost: ${target}\r\nConnection: close\r\n\r\n`);
    });
    req.on('error', fail);
    req.end();
  });
  expect(await through(model)).toBe('answered by 127.0.0.2');
  expect(await through(other)).toBe('refused 403');
});
