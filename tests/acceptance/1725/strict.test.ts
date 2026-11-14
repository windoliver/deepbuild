// #1725.fb4e8d7a: "Every listed tool's schema passes the strict-validator test #26 runs; a planted schema with `anyOf` fails it,
// naming the tool."
//
// The tool list is the one the Claude Code session's own deep mcp serves. The validator is #26's (`strictProblems`, the check
// its done-when test runs on every tool). The plant is the same list with deep_show's `mode` typed the way a strict validator
// refuses: a nullable enum written as `anyOf`.
import { afterEach, expect, test } from 'vitest';
import { AC, CLAUDE, TEST_MS, cleanup, openWorld, standOf, t26, type Line } from './helpers.ts';

afterEach(cleanup, 60_000);

/** #26's strict-validator test over a tool list: every problem, each naming its tool and path. */
const strict = (tools: readonly t26.Tool[]): string[] => tools.flatMap((t) => t26.strictProblems(t.name, t.inputSchema));

/** deep_show's schema with `mode` as an anyOf of the mode names and null. */
function planted(schema: Line): Line {
  const properties = { ...(schema.properties as Line), mode: { anyOf: [{ type: 'string', enum: ['bounds', 'normals'] }, { type: 'null' }] } };
  return { ...schema, properties, required: [...new Set([...(schema.required as string[]), 'mode'])] };
}

test(`${AC.strict} every listed tool's schema passes #26's strict validator, and a planted anyOf schema fails it, naming the tool`, async () => {
  const w = await openWorld();
  const tools = await t26.listTools(standOf(w, CLAUDE));
  expect(tools.length, 'deep mcp lists its tools').toBeGreaterThan(0);
  expect(strict(tools), `every listed tool's input schema (${tools.map((t) => t.name).join(', ')}) passes #26's strict validator`).toEqual([]);

  const show = tools.find((t) => t.name === 'deep_show');
  expect(show, 'deep mcp lists deep_show').toBeDefined();
  const problems = strict(tools.map((t) => (t.name === 'deep_show' ? { ...t, inputSchema: planted(t.inputSchema) } : t)));
  expect(problems.some((p) => p.startsWith('deep_show ') && p.includes('anyOf')), `the planted anyOf in deep_show's schema fails the validator, naming deep_show: ${problems.join('; ')}`).toBe(true);
}, TEST_MS);
