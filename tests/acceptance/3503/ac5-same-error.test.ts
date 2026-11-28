// #3503 criterion 5: "The same over-long request gets the same error code and the same words from both servers. A
// planted server whose cap differs fails, naming both"
//
// Both servers a session runs, `deep mcp` (this checkout's packages/cli/dist/main.js) and `deep-hook mcp actions`, get
// the same three lines: a ping of exactly the cap, a ping one byte over it, and a short ping. Each must answer the first
// and the last, and refuse the second. The two refusals must have the same `error.code` and the same `error.message`,
// and that message names the cap. A server whose cap is lower refuses the first ping, and one whose cap is higher answers
// the second, so either differs from the other server; the failure shows both servers' answers.
import { expect, test } from 'vitest';
import { AC, CAP, LONG, NAMES_CAP, Server, actions, deepMcp, isError, pingOf, request, tempHome, type Line } from './helpers.ts';

async function answers(argv: string[], name: string): Promise<{ name: string; byId: (id: number) => Line | undefined; errors: Line[]; shown: string }> {
  const { dir, home } = tempHome();
  const server = new Server(argv, home, dir, name);
  await server.write(`${pingOf(1, CAP)}\n`);
  await server.waitFor((l) => l.id === 1, 120_000);
  await server.write(`${pingOf(2, CAP + 1)}\n`);
  await server.write(request(3, 'ping'));
  await server.waitFor((l) => l.id === 3, 120_000);
  await server.end();
  return { name, byId: (id) => server.lines.find((l) => l.id === id), errors: server.lines.filter(isError), shown: server.shown() };
}

test(`${AC.same} the same over-long request gets the same error code and the same words from deep mcp and deep-hook mcp actions`, async () => {
  const node = await answers(deepMcp(), 'deep mcp');
  const hook = await answers(actions(), 'deep-hook mcp actions');
  const both = `deep mcp: ${node.shown}\ndeep-hook mcp actions: ${hook.shown}`;
  const said = (s: typeof node) => JSON.stringify(s.errors.map((e) => e.error));

  expect(node.byId(1)?.result, `setup: deep mcp answers a request of exactly the cap: ${node.shown}`).toEqual({});
  expect(node.errors.length, `setup: deep mcp refuses the one-byte-over request once: ${node.shown}`).toBe(1);
  expect(String(node.errors[0]?.error?.message ?? ''), `setup: deep mcp's refusal names the cap: ${said(node)}`).toMatch(NAMES_CAP);
  expect(hook.byId(1)?.result, `deep-hook mcp actions answers the ${CAP}-byte request as deep mcp does; deep mcp ${JSON.stringify(node.byId(1))}, deep-hook ${JSON.stringify(hook.byId(1) ?? null)}\n${both}`).toEqual({});
  expect(hook.errors.length, `deep-hook mcp actions refuses the ${CAP + 1}-byte request once, as deep mcp does; deep mcp said ${said(node)}, deep-hook said ${said(hook)}\n${both}`).toBe(1);
  expect({ code: hook.errors[0]?.error?.code, message: hook.errors[0]?.error?.message }, `the two servers refuse the ${CAP + 1}-byte request with the same code and words; deep mcp said ${said(node)}, deep-hook mcp actions said ${said(hook)}`).toEqual({ code: node.errors[0]!.error.code, message: node.errors[0]!.error.message });
  expect(hook.byId(3)?.result, `deep-hook mcp actions serves the line after: ${hook.shown}`).toEqual({});
}, LONG);
